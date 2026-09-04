import asyncio
from dataclasses import replace
from datetime import UTC, datetime
from typing import Literal, cast
from uuid import UUID

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.clerk import ClerkPrincipal
from app.modules.human_tutor_marketplace.booking import BookingService
from app.modules.human_tutor_marketplace.lifecycle import (
    LifecycleService,
    PostgresLifecycleRepository,
    ReviewView,
    StoredReminderJob,
)
from app.modules.human_tutor_marketplace.messaging import MarketplaceNotificationProvider
from app.modules.human_tutor_marketplace.router import router


class ReminderRepository:
    def __init__(self) -> None:
        self.job: StoredReminderJob | None = StoredReminderJob(
            job_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9994567"),
            booking_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9995678"),
            kind="lesson_reminder",
            attempt=1,
            learner_actor_ref="mktusr_v1_" + "a" * 43,
            tutor_actor_ref="mktusr_v1_" + "b" * 43,
        )
        self.finished: tuple[UUID, str] | None = None

    def claim_reminder(self, **kwargs: object) -> StoredReminderJob | None:
        job, self.job = self.job, None
        return job

    def finish_reminder(self, *, job_id: UUID, outcome: str, **kwargs: object) -> bool:
        self.finished = (job_id, outcome)
        return True


class ReminderProvider:
    def __init__(self) -> None:
        self.deliveries: list[tuple[str, str, str]] = []

    async def deliver(
        self, *, recipient_actor_ref: str, template: str, idempotency_key: str
    ) -> str:
        self.deliveries.append((recipient_actor_ref, template, idempotency_key))
        return "completed" if len(self.deliveries) == 1 else "retryable"


class TokenVerifier:
    def verify(self, token: str) -> ClerkPrincipal:
        assert token == "operator-token"
        return ClerkPrincipal(user_id="user_operator", issuer="https://clerk.test")


class ReviewService:
    def __init__(self) -> None:
        self.review = ReviewView(
            review_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9991234"),
            booking_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9992345"),
            tutor_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9993456"),
            rating=5,
            body="A calm and useful lesson.",
            moderation_state="published",
            moderation_reason=None,
            moderated_at=None,
            created_at=datetime(2026, 9, 4, 12, tzinfo=UTC),
        )
        self.reason: str | None = None

    async def list_reviews(self, **kwargs: object) -> tuple[ReviewView, ...]:
        return (self.review,)

    async def moderate_review(
        self,
        *,
        moderation_state: Literal["published", "hidden"],
        reason: str,
        **kwargs: object,
    ) -> ReviewView:
        self.reason = reason
        self.review = replace(
            self.review,
            moderation_state=moderation_state,
            moderation_reason=reason,
            moderated_at=datetime(2026, 9, 4, 13, tzinfo=UTC),
        )
        return self.review


def test_reminder_processor_delivers_both_roles_with_stable_keys_and_retries_partial_failure() -> (
    None
):
    repository = ReminderRepository()
    provider = ReminderProvider()
    service = LifecycleService(
        enabled=True,
        repository=cast(PostgresLifecycleRepository, repository),
        booking_service=cast(BookingService, object()),
        provider=None,
        pseudonym_key=b"lifecycle-test-key-at-least-32-bytes",
        actor_allowlist=(),
        notification_provider=cast(MarketplaceNotificationProvider, provider),
    )

    assert asyncio.run(service.run_one_reminder_job(worker="worker-a"))
    assert provider.deliveries == [
        (
            "mktusr_v1_" + "a" * 43,
            "lesson_reminder",
            "marketplace-reminder:9948afe2-59ac-46f6-88cf-15c5f9994567:learner",
        ),
        (
            "mktusr_v1_" + "b" * 43,
            "lesson_reminder",
            "marketplace-reminder:9948afe2-59ac-46f6-88cf-15c5f9994567:tutor",
        ),
    ]
    assert repository.finished == (
        UUID("9948afe2-59ac-46f6-88cf-15c5f9994567"),
        "retryable",
    )


def test_review_moderation_router_validates_reason_and_returns_bounded_schema() -> None:
    application = FastAPI()
    application.include_router(router)
    service = ReviewService()
    application.state.clerk_token_verifier = TokenVerifier()
    application.state.marketplace_lifecycle_service = service
    client = TestClient(application)
    headers = {"Authorization": "Bearer operator-token"}

    listed = client.get("/v1/marketplace-operations/reviews", headers=headers)
    invalid = client.post(
        f"/v1/marketplace-operations/reviews/{service.review.review_id}/moderation",
        headers=headers,
        json={"moderation_state": "hidden", "reason": "short"},
    )
    assert invalid.status_code == 422 and service.reason is None
    moderated = client.post(
        f"/v1/marketplace-operations/reviews/{service.review.review_id}/moderation",
        headers=headers,
        json={"moderation_state": "hidden", "reason": "Contains prohibited contact details."},
    )

    assert listed.status_code == 200
    assert listed.json()["items"][0]["moderation_state"] == "published"
    assert moderated.status_code == 200
    assert moderated.json()["moderation_state"] == "hidden"
    assert service.reason == "Contains prohibited contact details."
