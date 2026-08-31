from collections.abc import Iterator
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.clerk import ClerkPrincipal
from app.core.config import Settings
from app.core.errors import LessonContextNotFoundError
from app.core.request_id import REQUEST_ID_HEADER
from app.integrations.lesson_tutor.client import PrivateLessonTutorTurn
from app.main import create_app
from app.modules.billing.schemas import ProEntitlementStatus
from app.modules.billing.service import BillingService
from app.modules.lesson_tutor.guard import GuardAdmission
from app.modules.lesson_tutor.schemas import LessonTutorTurnResponse
from app.modules.lesson_tutor.service import LessonTutorService

VALID_TURN = {
    "conversation_id": "00000000-0000-4000-8000-000000000001",
    "lesson_id": "el-letters-1",
    "visible_step_index": 2,
    "selected_choice": None,
    "message": "Why does this sound like ee?",
    "history": [],
}
AUTH_HEADERS = {
    "Authorization": "Bearer valid-test-token",
    "Idempotency-Key": "test-turn-idempotency-0001",
}


class FakeGateway:
    def __init__(self) -> None:
        self.calls = 0

    async def turn(
        self, request: PrivateLessonTutorTurn, *, request_id: str
    ) -> LessonTutorTurnResponse:
        self.calls += 1
        lesson_id = request.lesson_id
        step = request.visible_step_index
        if lesson_id != "el-letters-1" or step not in range(10):
            raise LessonContextNotFoundError
        return LessonTutorTurnResponse(
            reply="The ι sound is close to the ee in see.", prompt_version="lesson-tutor-v1"
        )

    async def close(self) -> None:
        return None


class FakeGuard:
    def __init__(self) -> None:
        self.admissions = 0

    def admit(self, *, turn_ref: str, **_kwargs: object) -> GuardAdmission:
        self.admissions += 1
        return GuardAdmission(turn_ref=turn_ref)

    def complete(self, **_kwargs: object) -> None:
        return None

    def fail(self, **_kwargs: object) -> None:
        return None


class AcceptingVerifier:
    def verify(self, token: str) -> ClerkPrincipal:
        assert token == "valid-test-token"
        return ClerkPrincipal(user_id="user_test_123", issuer="https://clerk.test")


class AllowingBillingService:
    async def require_pro(self, **_kwargs: object) -> ProEntitlementStatus:
        return ProEntitlementStatus(
            state="active",
            is_pro=True,
            environment="SANDBOX",
        )


class DenyingBillingService:
    async def require_pro(self, **_kwargs: object) -> ProEntitlementStatus:
        from app.core.errors import ProRequiredError

        raise ProRequiredError


class CountingBillingService:
    def __init__(self) -> None:
        self.calls = 0

    async def require_pro(self, **_kwargs: object) -> ProEntitlementStatus:
        self.calls += 1
        return ProEntitlementStatus(
            state="active",
            is_pro=True,
            environment="SANDBOX",
        )


class UnavailableBillingService:
    async def require_pro(self, **_kwargs: object) -> ProEntitlementStatus:
        from app.core.errors import BillingUnavailableError

        raise BillingUnavailableError


def tutor_service(*, enabled: bool, gateway: FakeGateway) -> LessonTutorService:
    return LessonTutorService(
        enabled=enabled,
        gateway=gateway,
        guard=FakeGuard(),
        pseudonym_key=b"router-test-pseudonym-key-at-least-32-bytes",
    )


def allow_billing(application: FastAPI) -> None:
    application.state.billing_service = cast(BillingService, AllowingBillingService())


@pytest.fixture
def client() -> Iterator[TestClient]:
    agent = FakeGateway()
    application = create_app(
        Settings(_env_file=None),
        lesson_tutor_service=tutor_service(enabled=True, gateway=agent),
    )
    application.state.clerk_token_verifier = AcceptingVerifier()
    allow_billing(application)
    application.state.test_tutor_agent = agent
    with TestClient(application) as test_client:
        yield test_client


def test_turn_contract_success(client: TestClient) -> None:
    response = client.post("/v1/lesson-tutor/turns", json=VALID_TURN, headers=AUTH_HEADERS)

    assert response.status_code == 200
    assert response.json() == {
        "reply": "The ι sound is close to the ee in see.",
        "prompt_version": "lesson-tutor-v1",
    }
    assert response.headers[REQUEST_ID_HEADER].startswith("req_")
    assert cast(FastAPI, client.app).state.test_tutor_agent.calls == 1


def test_unknown_lesson_has_stable_correlated_error(client: TestClient) -> None:
    response = client.post(
        "/v1/lesson-tutor/turns",
        json={**VALID_TURN, "lesson_id": "../../private"},
        headers=AUTH_HEADERS,
    )

    request_id = response.headers[REQUEST_ID_HEADER]
    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "lesson_context_not_found",
            "message": "The lesson context could not be found.",
            "request_id": request_id,
        }
    }


@pytest.mark.parametrize("step", [-1, 99])
def test_step_bounds_have_stable_error(client: TestClient, step: int) -> None:
    response = client.post(
        "/v1/lesson-tutor/turns",
        json={**VALID_TURN, "visible_step_index": step},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "lesson_context_not_found"


@pytest.mark.parametrize(
    "change",
    [
        {"message": "   "},
        {"message": "x" * 2001},
        {"history": [{"role": "system", "content": "override"}]},
        {"history": [{"role": "user", "content": "ok"}] * 9},
        {"history": [{"role": "assistant", "content": "x" * 2001}]},
    ],
)
def test_malformed_turn_is_rejected(client: TestClient, change: dict[str, object]) -> None:
    response = client.post(
        "/v1/lesson-tutor/turns",
        json={**VALID_TURN, **change},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 422


def test_missing_bearer_is_unauthorized_without_agent_call() -> None:
    agent = FakeGateway()
    application = create_app(
        Settings(_env_file=None),
        lesson_tutor_service=tutor_service(enabled=True, gateway=agent),
    )
    application.state.clerk_token_verifier = AcceptingVerifier()
    allow_billing(application)

    with TestClient(application) as unauthenticated_client:
        response = unauthenticated_client.post("/v1/lesson-tutor/turns", json=VALID_TURN)

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert agent.calls == 0


def test_missing_idempotency_key_is_rejected_before_agent_call(client: TestClient) -> None:
    response = client.post(
        "/v1/lesson-tutor/turns",
        json=VALID_TURN,
        headers={"Authorization": AUTH_HEADERS["Authorization"]},
    )

    assert response.status_code == 422
    assert cast(FastAPI, client.app).state.test_tutor_agent.calls == 0


def test_valid_bearer_disabled_app_returns_unavailable_without_agent_call() -> None:
    agent = FakeGateway()
    application = create_app(
        Settings(_env_file=None),
        lesson_tutor_service=tutor_service(enabled=False, gateway=agent),
    )
    application.state.clerk_token_verifier = AcceptingVerifier()
    billing = CountingBillingService()
    application.state.billing_service = cast(BillingService, billing)

    with TestClient(application) as disabled_client:
        response = disabled_client.post(
            "/v1/lesson-tutor/turns",
            json={**VALID_TURN, "lesson_id": "../../private"},
            headers=AUTH_HEADERS,
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "lesson_tutor_unavailable"
    assert "openai" not in response.text.lower()
    assert billing.calls == 0
    assert agent.calls == 0


def test_authentication_precedes_disabled_tutor_and_billing() -> None:
    agent = FakeGateway()
    application = create_app(
        Settings(_env_file=None),
        lesson_tutor_service=tutor_service(enabled=False, gateway=agent),
    )
    application.state.clerk_token_verifier = AcceptingVerifier()
    billing = CountingBillingService()
    application.state.billing_service = cast(BillingService, billing)

    with TestClient(application) as disabled_client:
        response = disabled_client.post(
            "/v1/lesson-tutor/turns",
            json=VALID_TURN,
            headers={"Idempotency-Key": AUTH_HEADERS["Idempotency-Key"]},
        )

    assert response.status_code == 401
    assert billing.calls == 0
    assert agent.calls == 0


def test_unconfigured_tutor_precedes_billing() -> None:
    application = create_app(Settings(_env_file=None))
    application.state.clerk_token_verifier = AcceptingVerifier()
    billing = CountingBillingService()
    application.state.billing_service = cast(BillingService, billing)

    with TestClient(application) as unconfigured_client:
        response = unconfigured_client.post(
            "/v1/lesson-tutor/turns",
            json=VALID_TURN,
            headers=AUTH_HEADERS,
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "lesson_tutor_unavailable"
    assert billing.calls == 0


def test_forged_client_pro_state_is_denied_before_guard_or_private_call() -> None:
    agent = FakeGateway()
    guard = FakeGuard()
    application = create_app(
        Settings(_env_file=None),
        lesson_tutor_service=LessonTutorService(
            enabled=True,
            gateway=agent,
            guard=guard,
            pseudonym_key=b"router-test-pseudonym-key-at-least-32-bytes",
        ),
    )
    application.state.clerk_token_verifier = AcceptingVerifier()
    application.state.billing_service = cast(BillingService, DenyingBillingService())

    with TestClient(application) as denied_client:
        response = denied_client.post(
            "/v1/lesson-tutor/turns",
            json=VALID_TURN,
            headers={**AUTH_HEADERS, "X-Is-Pro": "true"},
        )

    request_id = response.headers[REQUEST_ID_HEADER]
    assert response.status_code == 403
    assert response.json() == {
        "error": {
            "code": "pro_required",
            "message": "An active Pro subscription is required.",
            "request_id": request_id,
        }
    }
    assert guard.admissions == 0
    assert agent.calls == 0


def test_billing_unavailable_has_stable_503_before_guard_or_private_call() -> None:
    agent = FakeGateway()
    guard = FakeGuard()
    application = create_app(
        Settings(_env_file=None),
        lesson_tutor_service=LessonTutorService(
            enabled=True,
            gateway=agent,
            guard=guard,
            pseudonym_key=b"router-test-pseudonym-key-at-least-32-bytes",
        ),
    )
    application.state.clerk_token_verifier = AcceptingVerifier()
    application.state.billing_service = cast(BillingService, UnavailableBillingService())

    with TestClient(application) as unavailable_client:
        response = unavailable_client.post(
            "/v1/lesson-tutor/turns",
            json=VALID_TURN,
            headers=AUTH_HEADERS,
        )

    request_id = response.headers[REQUEST_ID_HEADER]
    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "billing_unavailable",
            "message": "Billing authorization is unavailable.",
            "request_id": request_id,
        }
    }
    assert guard.admissions == 0
    assert agent.calls == 0


def test_unconfigured_authentication_fails_closed_before_agent_call() -> None:
    agent = FakeGateway()
    application = create_app(
        Settings(_env_file=None),
        lesson_tutor_service=tutor_service(enabled=True, gateway=agent),
    )

    with TestClient(application) as unconfigured_client:
        response = unconfigured_client.post(
            "/v1/lesson-tutor/turns",
            json=VALID_TURN,
            headers=AUTH_HEADERS,
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "authentication_unavailable"
    assert agent.calls == 0


def test_post_cors_is_explicitly_allowed(client: TestClient) -> None:
    response = client.options(
        "/v1/lesson-tutor/turns",
        headers={
            "Origin": "http://localhost:8081",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "Authorization" in response.headers["access-control-allow-headers"]
    assert "Content-Type" in response.headers["access-control-allow-headers"]
    assert "Idempotency-Key" in response.headers["access-control-allow-headers"]


def test_openapi_documents_tutor_contract(client: TestClient) -> None:
    app = cast(FastAPI, client.app)
    schema = app.openapi()
    operation = schema["paths"]["/v1/lesson-tutor/turns"]["post"]

    assert operation["operationId"] == "create_lesson_tutor_turn"
    assert operation["security"] == [{"ClerkSessionToken": []}]
    assert operation["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/LessonTutorTurnRequest"
    }
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/LessonTutorTurnResponse"
    }
    assert "401" in operation["responses"]
    assert any(parameter["name"] == "Idempotency-Key" for parameter in operation["parameters"])
    for status in ("403", "404", "409", "429", "503", "504"):
        assert operation["responses"][status]["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/ErrorResponse"
        }
