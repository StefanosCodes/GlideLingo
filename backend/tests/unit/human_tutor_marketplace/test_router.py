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
    StoredMarketplacePolicyVersion,
    StoredTutorApplication,
    StoredTutorCredential,
    StoredTutorOffering,
    StoredTutorProfile,
    TutorApplicationRepository,
)
from app.modules.human_tutor_marketplace.schemas import (
    ChangeTutorStatusRequest,
    CreateTutorApplicationRequest,
    SaveTutorCredentialRequest,
    SaveTutorOfferingRequest,
    TutorApplicationDecision,
    TutorApplicationStatus,
    TutorCredentialDecision,
    UpdateTutorApplicationDraftRequest,
    UpdateTutorProfileDraftRequest,
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
        self.operator_capabilities: set[tuple[str, str]] = set()
        self.profiles: dict[str, StoredTutorProfile] = {}

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

    def update_draft(
        self,
        *,
        actor_ref: str,
        request: UpdateTutorApplicationDraftRequest,
    ) -> StoredTutorApplication | None:
        application = self.get_by_actor(actor_ref=actor_ref)
        if (
            application is None
            or application.status != "draft"
            or application.version != request.expected_version
        ):
            return None
        updated = replace(
            application,
            version=application.version + 1,
            headline=request.headline,
            biography=request.biography,
            time_zone=request.time_zone,
            languages=tuple(request.languages),
            specialties=tuple(request.specialties),
        )
        self.applications[application.application_id] = updated
        return updated

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
        return (actor_ref, capability) in self.operator_capabilities

    def list_review_queue(
        self, *, offset: int, limit: int
    ) -> tuple[list[StoredTutorApplication], bool]:
        queue = sorted(
            (
                application
                for application in self.applications.values()
                if application.status in {"submitted", "under_review", "approved", "suspended"}
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

    def get_profile_by_actor(self, *, actor_ref: str) -> StoredTutorProfile | None:
        return self.profiles.get(actor_ref)

    def get_profile_by_credential_id(self, *, credential_id: UUID) -> StoredTutorProfile | None:
        return next(
            (
                profile
                for profile in self.profiles.values()
                if profile.credential is not None
                and profile.credential.credential_id == credential_id
            ),
            None,
        )

    def get_profile_by_application_id(self, *, application_id: UUID) -> StoredTutorProfile | None:
        return next(
            (
                profile
                for profile in self.profiles.values()
                if profile.application_id == application_id
            ),
            None,
        )

    def update_profile_draft(
        self,
        *,
        actor_ref: str,
        request: UpdateTutorProfileDraftRequest,
    ) -> StoredTutorProfile | None:
        profile = self.profiles.get(actor_ref)
        if (
            profile is None
            or profile.application_status != "approved"
            or profile.is_published
            or profile.version != request.expected_version
        ):
            return None
        updated = replace(
            profile,
            version=profile.version + 1,
            headline=request.headline,
            biography=request.biography,
            time_zone=request.time_zone,
        )
        self.profiles[actor_ref] = updated
        return updated

    def save_credential(
        self,
        *,
        actor_ref: str,
        request: SaveTutorCredentialRequest,
    ) -> StoredTutorProfile | None:
        profile = self.profiles.get(actor_ref)
        if profile is None or profile.application_status != "approved" or profile.is_published:
            return None
        current = profile.credential
        if current is None and request.expected_version == 0:
            credential = StoredTutorCredential(
                credential_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9992345"),
                version=1,
                credential_type=request.credential_type,
                title=request.title,
                issuer=request.issuer,
                verification_status="unverified",
                verification_reason=None,
                reviewed_at=None,
                verified_by_actor_ref=None,
            )
        elif (
            current is not None
            and current.version == request.expected_version
            and current.verification_status == "unverified"
        ):
            credential = replace(
                current,
                version=current.version + 1,
                credential_type=request.credential_type,
                title=request.title,
                issuer=request.issuer,
            )
        else:
            return None
        updated = replace(profile, credential=credential)
        self.profiles[actor_ref] = updated
        return updated

    def decide_credential(
        self,
        *,
        credential_id: UUID,
        operator_actor_ref: str,
        request_version: int,
        decision: TutorCredentialDecision,
        reason: str,
    ) -> StoredTutorProfile | None:
        profile = self.get_profile_by_credential_id(credential_id=credential_id)
        credential = profile.credential if profile is not None else None
        if (
            profile is None
            or credential is None
            or profile.actor_ref == operator_actor_ref
            or credential.version != request_version
            or credential.verification_status != "unverified"
            or (operator_actor_ref, "verify_tutor_credentials") not in self.operator_capabilities
        ):
            return None
        updated = replace(
            profile,
            credential=replace(
                credential,
                version=credential.version + 1,
                verification_status=decision,
                verification_reason=reason,
                reviewed_at=datetime.now(UTC),
                verified_by_actor_ref=operator_actor_ref,
            ),
        )
        self.profiles[profile.actor_ref] = updated
        return updated

    def save_offering(
        self,
        *,
        actor_ref: str,
        request: SaveTutorOfferingRequest,
    ) -> StoredTutorProfile | None:
        profile = self.profiles.get(actor_ref)
        if profile is None or profile.application_status != "approved" or profile.is_published:
            return None
        current = profile.offering
        policy_time = datetime(2026, 9, 4, tzinfo=UTC)
        if current is None and request.expected_version == 0:
            offering = StoredTutorOffering(
                offering_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9993456"),
                version=1,
                title=request.title,
                duration_minutes=request.duration_minutes,
                amount_minor=request.amount_minor,
                currency=request.currency,
                state="draft",
                commission_policy=StoredMarketplacePolicyVersion(
                    policy_id=UUID("10000000-0000-4000-8000-000000000001"),
                    policy_type="commission",
                    version=1,
                    commission_basis_points=2000,
                    cancellation_cutoff_hours=None,
                    dispute_window_hours=None,
                    effective_at=policy_time,
                ),
                cancellation_policy=StoredMarketplacePolicyVersion(
                    policy_id=UUID("20000000-0000-4000-8000-000000000001"),
                    policy_type="cancellation",
                    version=1,
                    commission_basis_points=None,
                    cancellation_cutoff_hours=12,
                    dispute_window_hours=24,
                    effective_at=policy_time,
                ),
            )
        elif (
            current is not None
            and current.version == request.expected_version
            and current.state == "draft"
        ):
            offering = replace(
                current,
                version=current.version + 1,
                title=request.title,
                duration_minutes=request.duration_minutes,
                amount_minor=request.amount_minor,
                currency=request.currency,
            )
        else:
            return None
        updated = replace(profile, offering=offering)
        self.profiles[actor_ref] = updated
        return updated

    def set_publication(
        self,
        *,
        actor_ref: str,
        expected_profile_version: int,
        expected_offering_version: int,
        publish: bool,
    ) -> StoredTutorProfile | None:
        profile = self.profiles.get(actor_ref)
        offering = profile.offering if profile is not None else None
        if (
            profile is None
            or offering is None
            or profile.application_status != "approved"
            or profile.version != expected_profile_version
            or offering.version != expected_offering_version
            or (publish and not profile.payout_ready)
        ):
            return None
        updated = replace(
            profile,
            version=profile.version + 1,
            is_published=publish,
            offering=replace(
                offering,
                version=offering.version + 1,
                state="active" if publish else "draft",
            ),
        )
        self.profiles[actor_ref] = updated
        return updated

    def change_tutor_status(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        request: ChangeTutorStatusRequest,
    ) -> StoredTutorApplication | None:
        application = self.applications.get(application_id)
        from_status = "approved" if request.action == "suspend" else "suspended"
        desired: TutorApplicationStatus = "suspended" if request.action == "suspend" else "approved"
        if (
            application is None
            or application.status != from_status
            or application.version != request.expected_version
            or application.actor_ref == operator_actor_ref
            or (operator_actor_ref, "manage_tutor_status") not in self.operator_capabilities
        ):
            return None
        updated = replace(
            application,
            status=desired,
            version=application.version + 1,
            reviewer_actor_ref=operator_actor_ref,
            reviewed_at=datetime.now(UTC),
            decision_reason=request.reason,
        )
        self.applications[application_id] = updated
        profile = self.profiles.get(application.actor_ref)
        if profile is not None:
            self.profiles[application.actor_ref] = replace(
                profile,
                application_status=desired,
                is_published=False,
                offering=(
                    replace(profile.offering, state="draft")
                    if profile.offering is not None
                    else None
                ),
            )
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
        if decision == "approved":
            self.profiles[application.actor_ref] = StoredTutorProfile(
                tutor_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9991234"),
                application_id=application.application_id,
                actor_ref=application.actor_ref,
                application_status="approved",
                version=1,
                headline=application.headline,
                biography=application.biography,
                time_zone=application.time_zone,
                payout_ready=False,
                is_published=False,
                credential=None,
                offering=None,
            )
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
    repository.operator_capabilities.update(
        {
            (operator_ref, "review_tutor_applications"),
            (operator_ref, "manage_tutor_status"),
            (operator_ref, "verify_tutor_credentials"),
        }
    )
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
    assert not any(path.startswith("/v1/tutors") for path in schema["paths"])
    assert not any("payout" in path for path in schema["paths"])


def approve_tutor(client: TestClient) -> dict[str, object]:
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
    application_id = submitted.json()["application_id"]
    review = client.post(
        f"/v1/marketplace-operations/tutor-applications/{application_id}/review",
        json={"expected_version": submitted.json()["version"]},
        headers=authorization("operator-token"),
    )
    decision = client.post(
        f"/v1/marketplace-operations/tutor-applications/{application_id}/decision",
        json={
            "decision": "approved",
            "reason": "Application identity and teaching details passed review.",
            "expected_version": review.json()["version"],
        },
        headers=authorization("operator-token"),
    )
    assert decision.status_code == 200
    return cast(dict[str, object], decision.json())


def test_tutor_can_edit_only_their_current_application_draft() -> None:
    client, _repository = make_client()
    with client:
        created = client.post(
            "/v1/tutor-applications",
            json=application_payload(),
            headers=authorization("tutor-token"),
        )
        update_payload = {
            **application_payload(headline="Updated tutor headline"),
            "expected_version": created.json()["version"],
        }
        updated = client.post(
            "/v1/tutor-application/draft",
            json=update_payload,
            headers=authorization("tutor-token"),
        )
        retry = client.post(
            "/v1/tutor-application/draft",
            json=update_payload,
            headers=authorization("tutor-token"),
        )
        stale_change = client.post(
            "/v1/tutor-application/draft",
            json={**update_payload, "headline": "Conflicting stale headline"},
            headers=authorization("tutor-token"),
        )
        outsider = client.post(
            "/v1/tutor-application/draft",
            json=update_payload,
            headers=authorization("outsider-token"),
        )

    assert updated.status_code == 200
    assert updated.json()["version"] == created.json()["version"] + 1
    assert retry.json() == updated.json()
    assert stale_change.status_code == 409
    assert outsider.status_code == 403


def test_approved_tutor_can_prepare_private_supply_but_cannot_publish_without_payout() -> None:
    client, _repository = make_client()
    with client:
        approved = approve_tutor(client)
        profile = client.get(
            "/v1/tutor-profile",
            headers=authorization("tutor-token"),
        )
        edited = client.post(
            "/v1/tutor-profile/draft",
            json={
                "expected_version": profile.json()["version"],
                "headline": "Practical Greek conversation",
                "biography": (
                    "I help adult learners practice useful Greek conversation at a calm pace."
                ),
                "time_zone": "Europe/Athens",
            },
            headers=authorization("tutor-token"),
        )
        credential = client.post(
            "/v1/tutor-profile/credential",
            json={
                "expected_version": 0,
                "credential_type": "certificate",
                "title": "Adult language teaching certificate",
                "issuer": "Example Institute",
            },
            headers=authorization("tutor-token"),
        )
        credential_retry = client.post(
            "/v1/tutor-profile/credential",
            json={
                "expected_version": 0,
                "credential_type": "certificate",
                "title": "Adult language teaching certificate",
                "issuer": "Example Institute",
            },
            headers=authorization("tutor-token"),
        )
        offering = client.post(
            "/v1/tutor-profile/offering",
            json={
                "expected_version": 0,
                "title": "25-minute conversation lesson",
                "duration_minutes": 25,
                "amount_minor": 2500,
                "currency": "USD",
            },
            headers=authorization("tutor-token"),
        )
        offering_retry = client.post(
            "/v1/tutor-profile/offering",
            json={
                "expected_version": 0,
                "title": "25-minute conversation lesson",
                "duration_minutes": 25,
                "amount_minor": 2500,
                "currency": "USD",
            },
            headers=authorization("tutor-token"),
        )
        unsupported_currency = client.post(
            "/v1/tutor-profile/offering",
            json={
                "expected_version": 0,
                "title": "25-minute conversation lesson",
                "duration_minutes": 25,
                "amount_minor": 2500,
                "currency": "EUR",
            },
            headers=authorization("tutor-token"),
        )
        publication = client.post(
            "/v1/tutor-profile/publication",
            json={
                "expected_profile_version": offering.json()["version"],
                "expected_offering_version": offering.json()["offering"]["version"],
                "publish": True,
            },
            headers=authorization("tutor-token"),
        )
        operator_profile = client.get(
            f"/v1/marketplace-operations/tutor-applications/{approved['application_id']}/profile",
            headers=authorization("operator-token"),
        )
        tutor_cannot_use_operator_projection = client.get(
            f"/v1/marketplace-operations/tutor-applications/{approved['application_id']}/profile",
            headers=authorization("tutor-token"),
        )
        credential_decision = client.post(
            "/v1/marketplace-operations/tutor-credentials/"
            f"{credential.json()['credential']['credential_id']}/decision",
            json={
                "expected_version": credential.json()["credential"]["version"],
                "decision": "verified",
                "reason": "Credential issuer and certificate reference were verified.",
            },
            headers=authorization("operator-token"),
        )
        suspended = client.post(
            f"/v1/marketplace-operations/tutor-applications/{approved['application_id']}/status",
            json={
                "expected_version": approved["version"],
                "action": "suspend",
                "reason": "Temporary safety suspension while a report is reviewed.",
            },
            headers=authorization("operator-token"),
        )

    assert profile.status_code == 200
    assert profile.json()["is_published"] is False
    assert profile.json()["publication_blockers"] == ["payout_not_ready", "offering_missing"]
    assert edited.status_code == 200
    assert credential.status_code == 200
    assert credential_retry.json() == credential.json()
    assert offering.status_code == 200
    assert offering_retry.json() == offering.json()
    assert unsupported_currency.status_code == 422
    assert offering.json()["offering"]["state"] == "draft"
    assert offering.json()["offering"]["commission_policy"]["commission_basis_points"] == 2000
    assert publication.status_code == 409
    assert operator_profile.status_code == 200
    assert operator_profile.json()["credential"]["verification_status"] == "unverified"
    assert tutor_cannot_use_operator_projection.status_code == 403
    assert credential_decision.status_code == 200
    assert credential_decision.json()["credential"]["verification_status"] == "verified"
    assert suspended.status_code == 200
    assert suspended.json()["status"] == "suspended"


def test_unapproved_and_non_capable_actors_cannot_mutate_supply_or_status() -> None:
    client, _repository = make_client()
    with client:
        created = client.post(
            "/v1/tutor-applications",
            json=application_payload(),
            headers=authorization("tutor-token"),
        )
        no_profile = client.get(
            "/v1/tutor-profile",
            headers=authorization("tutor-token"),
        )
        forbidden_status = client.post(
            "/v1/marketplace-operations/tutor-applications/"
            f"{created.json()['application_id']}/status",
            json={
                "expected_version": created.json()["version"],
                "action": "suspend",
                "reason": "A tutor cannot suspend another marketplace tutor.",
            },
            headers=authorization("tutor-token"),
        )
        outsider_profile = client.get(
            "/v1/tutor-profile",
            headers=authorization("outsider-token"),
        )

    assert no_profile.status_code == 404
    assert forbidden_status.status_code == 403
    assert outsider_profile.status_code == 403
