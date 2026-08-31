from collections.abc import Iterator
from pathlib import Path
from typing import cast
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.clerk import ClerkPrincipal
from app.core.config import Settings
from app.core.request_id import REQUEST_ID_HEADER
from app.main import create_app
from app.modules.lesson_tutor.context import LessonTutorContext
from app.modules.lesson_tutor.schemas import TutorHistoryMessage
from app.modules.lesson_tutor.service import LessonTutorService

VALID_TURN = {
    "conversation_id": "00000000-0000-4000-8000-000000000001",
    "lesson_id": "el-letters-1",
    "visible_step_index": 2,
    "selected_choice": None,
    "message": "Why does this sound like ee?",
    "history": [],
}
AUTH_HEADERS = {"Authorization": "Bearer valid-test-token"}


class FakeAgent:
    def __init__(self) -> None:
        self.calls = 0

    async def reply(
        self,
        *,
        context: LessonTutorContext,
        history: list[TutorHistoryMessage],
        message: str,
        conversation_id: UUID,
    ) -> str:
        self.calls += 1
        return "The ι sound is close to the ee in see."


class AcceptingVerifier:
    def verify(self, token: str) -> ClerkPrincipal:
        assert token == "valid-test-token"
        return ClerkPrincipal(user_id="user_test_123")


@pytest.fixture
def client() -> Iterator[TestClient]:
    agent = FakeAgent()
    application = create_app(
        Settings(_env_file=None),
        lesson_tutor_service=LessonTutorService(
            enabled=True,
            agent=agent,
            content_root=Path(__file__).resolve().parents[4] / "content",
        ),
    )
    application.state.clerk_token_verifier = AcceptingVerifier()
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
    agent = FakeAgent()
    application = create_app(
        Settings(_env_file=None),
        lesson_tutor_service=LessonTutorService(
            enabled=True,
            agent=agent,
            content_root=Path(__file__).resolve().parents[4] / "content",
        ),
    )
    application.state.clerk_token_verifier = AcceptingVerifier()

    with TestClient(application) as unauthenticated_client:
        response = unauthenticated_client.post("/v1/lesson-tutor/turns", json=VALID_TURN)

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert agent.calls == 0


def test_valid_bearer_disabled_app_returns_unavailable_without_agent_call() -> None:
    agent = FakeAgent()
    application = create_app(
        Settings(_env_file=None),
        lesson_tutor_service=LessonTutorService(
            enabled=False,
            agent=agent,
            content_root=Path(__file__).resolve().parents[4] / "content",
        ),
    )
    application.state.clerk_token_verifier = AcceptingVerifier()

    with TestClient(application) as disabled_client:
        response = disabled_client.post(
            "/v1/lesson-tutor/turns",
            json={**VALID_TURN, "lesson_id": "../../private"},
            headers=AUTH_HEADERS,
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "lesson_tutor_unavailable"
    assert "openai" not in response.text.lower()
    assert agent.calls == 0


def test_unconfigured_authentication_fails_closed_before_agent_call() -> None:
    agent = FakeAgent()
    application = create_app(
        Settings(_env_file=None),
        lesson_tutor_service=LessonTutorService(
            enabled=True,
            agent=agent,
            content_root=Path(__file__).resolve().parents[4] / "content",
        ),
    )

    with TestClient(application) as unconfigured_client:
        response = unconfigured_client.post(
            "/v1/lesson-tutor/turns",
            json=VALID_TURN,
            headers=AUTH_HEADERS,
        )

    assert response.status_code == 503
    assert response.json() == {"detail": "Authentication is unavailable."}
    assert agent.calls == 0


def test_post_cors_is_explicitly_allowed(client: TestClient) -> None:
    response = client.options(
        "/v1/lesson-tutor/turns",
        headers={
            "Origin": "http://localhost:8081",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "Authorization" in response.headers["access-control-allow-headers"]
    assert "Content-Type" in response.headers["access-control-allow-headers"]


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
    for status in ("404", "503", "504"):
        assert operation["responses"][status]["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/ErrorResponse"
        }
