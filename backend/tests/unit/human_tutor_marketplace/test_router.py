from dataclasses import replace
from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.clerk import ClerkPrincipal
from app.core.config import Settings
from app.main import create_app
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref
from app.modules.human_tutor_marketplace.repository import (
    ApplicationAlreadyExistsError,
    StoredTutorApplication,
    TutorApplicationRepository,
)
from app.modules.human_tutor_marketplace.schemas import (
    CreateTutorApplicationRequest,
    TutorApplicationDecision,
)
from app.modules.human_tutor_marketplace.service import HumanTutorMarketplaceService

KEY = b"marketplace-router-pseudonym-key-32-bytes"
TUTOR_USER_ID = "user_tutor_123"
OPERATOR_USER_ID = "user_operator_123"
OUTSIDER_USER_ID = "user_outsider_123"


class TokenVerifier:
    def verify(self, token: str) -> ClerkPrincipal:
        users = {
            "tutor-token": TUTOR_USER_ID,
            "operator-token": OPERATOR_USER_ID,
            "outsider-token": OUTSIDER_USER_ID,
        }
        return ClerkPrincipal(user_id=users[token], issuer="https://clerk.test")


class MemoryRepository:
    def __init__(self) -> None:
        self.applications: dict[UUID, StoredTutorApplication] = {}
        self.application_by_actor: dict[str, UUID] = {}
        self.operator_refs: set[str] = set()

    def get_by_actor(self, *, actor_ref: str) -> StoredTutorApplication | None:
        application_id = self.application_by_actor.get(actor_ref)
        return self.applications.get(application_id) if application_id is not None else None

    def get_by_id(self, *, application_id: UUID) -> StoredTutorApplication | None:
        return self.applications.get(application_id)

    def create_draft(
        self,
        *,
        application_id: UUID,
        actor_ref: str,
        request: CreateTutorApplicationRequest,
    ) -> StoredTutorApplication:
        if actor_ref in self.application_by_actor:
            raise ApplicationAlreadyExistsError
        application = StoredTutorApplication(
            application_id=application_id,
            actor_ref=actor_ref,
            status="draft",
            version=1,
            headline=request.headline,
            biography=request.biography,
            time_zone=request.time_zone,
            languages=tuple(request.languages),
            specialties=tuple(request.specialties),
            submitted_at=None,
            reviewed_at=None,
            decision_reason=None,
            reviewer_actor_ref=None,
        )
        self.applications[application_id] = application
        self.application_by_actor[actor_ref] = application_id
        return application

    def submit(self, *, actor_ref: str, expected_version: int) -> StoredTutorApplication | None:
        application = self.get_by_actor(actor_ref=actor_ref)
        if (
            application is None
            or application.status != "draft"
            or application.version != expected_version
        ):
            return None
        updated = replace(
            application,
            status="submitted",
            version=application.version + 1,
            submitted_at=datetime.now(UTC),
        )
        self.applications[application.application_id] = updated
        return updated

    def has_operator_capability(self, *, actor_ref: str, capability: str) -> bool:
        assert capability == "review_tutor_applications"
        return actor_ref in self.operator_refs

    def list_review_queue(
        self, *, offset: int, limit: int
    ) -> tuple[list[StoredTutorApplication], bool]:
        queue = sorted(
            (
                application
                for application in self.applications.values()
                if application.status in {"submitted", "under_review"}
            ),
            key=lambda application: (
                application.submitted_at or datetime.min.replace(tzinfo=UTC),
                application.application_id,
            ),
        )
        return queue[offset : offset + limit], len(queue) > offset + limit

    def start_review(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        expected_version: int,
    ) -> StoredTutorApplication | None:
        application = self.applications.get(application_id)
        if (
            application is None
            or application.status != "submitted"
            or application.version != expected_version
        ):
            return None
        updated = replace(
            application,
            status="under_review",
            version=application.version + 1,
            reviewer_actor_ref=operator_actor_ref,
        )
        self.applications[application_id] = updated
        return updated

    def decide(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        decision: TutorApplicationDecision,
        reason: str,
        expected_version: int,
    ) -> StoredTutorApplication | None:
        application = self.applications.get(application_id)
        if (
            application is None
            or application.status != "under_review"
            or application.reviewer_actor_ref != operator_actor_ref
            or application.version != expected_version
        ):
            return None
        assert decision in {"approved", "rejected"}
        updated = replace(
            application,
            status=decision,
            version=application.version + 1,
            reviewed_at=datetime.now(UTC),
            decision_reason=reason,
        )
        self.applications[application_id] = updated
        return updated


def application_payload(*, headline: str = "Friendly conversation tutor") -> dict[str, object]:
    return {
        "headline": headline,
        "biography": "I help adult learners build confident real-world conversation skills.",
        "time_zone": "America/Chicago",
        "languages": ["en", "el-GR"],
        "specialties": ["Conversation", "Travel"],
    }


def make_client() -> tuple[TestClient, MemoryRepository]:
    repository = MemoryRepository()
    operator_ref = derive_marketplace_actor_ref(
        key=KEY,
        clerk_user_id=OPERATOR_USER_ID,
    )
    repository.operator_refs.add(operator_ref)
    service = HumanTutorMarketplaceService(
        enabled=True,
        repository=cast(TutorApplicationRepository, repository),
        pseudonym_key=KEY,
        actor_allowlist=(TUTOR_USER_ID, OPERATOR_USER_ID),
    )
    application = create_app(
        Settings(_env_file=None),
        human_tutor_marketplace_service=service,
    )
    application.state.clerk_token_verifier = TokenVerifier()
    return TestClient(application), repository


def authorization(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_routes_are_absent_when_marketplace_is_disabled() -> None:
    application = create_app(Settings(_env_file=None))

    assert "/v1/tutor-applications" not in application.openapi()["paths"]
    assert not hasattr(application.state, "human_tutor_marketplace_service")


def test_application_rejects_unknown_time_zone_before_service_execution() -> None:
    client, repository = make_client()
    payload = application_payload()
    payload["time_zone"] = "Not/A_Time_Zone"

    with client:
        response = client.post(
            "/v1/tutor-applications",
            json=payload,
            headers=authorization("tutor-token"),
        )

    assert response.status_code == 422
    assert repository.applications == {}


def test_application_uses_verified_allowlisted_actor_and_is_idempotent() -> None:
    client, repository = make_client()
    payload = application_payload()
    with client:
        missing_auth = client.post("/v1/tutor-applications", json=payload)
        outsider = client.post(
            "/v1/tutor-applications",
            json=payload,
            headers=authorization("outsider-token"),
        )
        first = client.post(
            "/v1/tutor-applications",
            json=payload,
            headers=authorization("tutor-token"),
        )
        retry = client.post(
            "/v1/tutor-applications",
            json=payload,
            headers=authorization("tutor-token"),
        )

    assert missing_auth.status_code == 401
    assert outsider.status_code == 403
    assert outsider.json()["error"]["code"] == "human_tutor_marketplace_forbidden"
    assert first.status_code == 201
    assert retry.status_code == 201
    assert retry.json() == first.json()
    assert len(repository.applications) == 1
    assert TUTOR_USER_ID not in str(first.json())
    stored = next(iter(repository.applications.values()))
    assert stored.actor_ref == derive_marketplace_actor_ref(
        key=KEY,
        clerk_user_id=TUTOR_USER_ID,
    )


def test_different_retry_conflicts_and_optimistic_submit_is_stable() -> None:
    client, _repository = make_client()
    with client:
        created = client.post(
            "/v1/tutor-applications",
            json=application_payload(),
            headers=authorization("tutor-token"),
        )
        conflicting_draft = client.post(
            "/v1/tutor-applications",
            json=application_payload(headline="A different tutor profile"),
            headers=authorization("tutor-token"),
        )
        submitted = client.post(
            "/v1/tutor-application/submit",
            json={"expected_version": created.json()["version"]},
            headers=authorization("tutor-token"),
        )
        retry = client.post(
            "/v1/tutor-application/submit",
            json={"expected_version": created.json()["version"]},
            headers=authorization("tutor-token"),
        )
        stale = client.post(
            "/v1/tutor-application/submit",
            json={"expected_version": 99},
            headers=authorization("tutor-token"),
        )

    assert conflicting_draft.status_code == 409
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "submitted"
    assert retry.json() == submitted.json()
    assert stale.status_code == 409


def test_only_capable_operator_can_review_and_decide() -> None:
    client, _repository = make_client()
    with client:
        created = client.post(
            "/v1/tutor-applications",
            json=application_payload(),
            headers=authorization("tutor-token"),
        )
        submitted = client.post(
            "/v1/tutor-application/submit",
            json={"expected_version": created.json()["version"]},
            headers=authorization("tutor-token"),
        )
        forbidden_queue = client.get(
            "/v1/marketplace-operations/tutor-applications",
            headers=authorization("tutor-token"),
        )
        queue = client.get(
            "/v1/marketplace-operations/tutor-applications",
            headers=authorization("operator-token"),
        )
        application_id = submitted.json()["application_id"]
        review = client.post(
            f"/v1/marketplace-operations/tutor-applications/{application_id}/review",
            json={"expected_version": submitted.json()["version"]},
            headers=authorization("operator-token"),
        )
        review_retry = client.post(
            f"/v1/marketplace-operations/tutor-applications/{application_id}/review",
            json={"expected_version": submitted.json()["version"]},
            headers=authorization("operator-token"),
        )
        decision_payload = {
            "decision": "approved",
            "reason": "Identity and tutor application checks passed.",
            "expected_version": review.json()["version"],
        }
        decision = client.post(
            f"/v1/marketplace-operations/tutor-applications/{application_id}/decision",
            json=decision_payload,
            headers=authorization("operator-token"),
        )
        decision_retry = client.post(
            f"/v1/marketplace-operations/tutor-applications/{application_id}/decision",
            json=decision_payload,
            headers=authorization("operator-token"),
        )

    assert forbidden_queue.status_code == 403
    assert queue.status_code == 200
    assert queue.json()["items"][0]["status"] == "submitted"
    assert review.status_code == 200
    assert review.json()["status"] == "under_review"
    assert review_retry.json() == review.json()
    assert decision.status_code == 200
    assert decision.json()["status"] == "approved"
    assert decision_retry.json() == decision.json()


def test_operator_cannot_review_their_own_tutor_application() -> None:
    client, _repository = make_client()
    with client:
        created = client.post(
            "/v1/tutor-applications",
            json=application_payload(),
            headers=authorization("operator-token"),
        )
        submitted = client.post(
            "/v1/tutor-application/submit",
            json={"expected_version": created.json()["version"]},
            headers=authorization("operator-token"),
        )
        response = client.post(
            "/v1/marketplace-operations/tutor-applications/"
            f"{submitted.json()['application_id']}/review",
            json={"expected_version": submitted.json()["version"]},
            headers=authorization("operator-token"),
        )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "human_tutor_marketplace_forbidden"


def test_openapi_marks_every_marketplace_operation_as_clerk_authenticated() -> None:
    client, _repository = make_client()
    with client:
        schema = cast(FastAPI, client.app).openapi()

    paths = {
        path: operations
        for path, operations in schema["paths"].items()
        if path.startswith("/v1/tutor-") or path.startswith("/v1/marketplace-operations/")
    }
    assert paths
    for operations in paths.values():
        for operation in operations.values():
            assert operation["security"] == [{"ClerkSessionToken": []}]
