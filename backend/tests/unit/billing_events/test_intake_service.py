import asyncio
import hashlib
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import cast

import pytest

from app.core.errors import DependencyUnavailableError
from app.modules.billing.repository import EntitlementRepository
from app.modules.billing.service import BillingService, RevenueCatWebhookPayload
from app.modules.billing_events.crypto import ProviderActorCipher
from app.modules.billing_events.models import (
    BillingEventConsumer,
    IntakeReceipt,
    IntakeStatus,
    NormalizedBillingEvent,
)
from app.modules.billing_events.repository import BillingEventRepository

NOW = datetime(2026, 9, 2, 12, 0, tzinfo=UTC)
KEY = b"billing-event-intake-test-key-at-least-32-bytes"


class UnusedEntitlementRepository:
    pass


class CapturingIntakeRepository:
    def __init__(self, status: IntakeStatus = "accepted") -> None:
        self.status = status
        self.accepted: list[tuple[NormalizedBillingEvent, tuple[BillingEventConsumer, ...]]] = []
        self.raise_unavailable = False

    def accept(
        self,
        *,
        event: NormalizedBillingEvent,
        consumers: Sequence[BillingEventConsumer],
    ) -> IntakeReceipt:
        if self.raise_unavailable:
            raise DependencyUnavailableError
        self.accepted.append((event, tuple(consumers)))
        return IntakeReceipt(status=self.status)


def intake_service(repository: CapturingIntakeRepository) -> BillingService:
    return BillingService(
        enabled=True,
        repository=cast(EntitlementRepository, UnusedEntitlementRepository()),
        provider=None,
        pseudonym_key=KEY,
        environment="SANDBOX",
        freshness_seconds=900,
        webhook_authorization="Bearer test",
        webhook_signing_secret="s" * 32,
        webhook_signature_tolerance_seconds=300,
        event_intake_enabled=True,
        event_repository=cast(BillingEventRepository, repository),
        event_provider_account_ref="app_test",
        provider_actor_cipher=ProviderActorCipher(secret=KEY),
        now=lambda: NOW,
    )


def payload(
    *,
    event_type: str = "INITIAL_PURCHASE",
    app_id: str = "app_test",
    app_user_id: str | None = "user_test_123",
) -> RevenueCatWebhookPayload:
    return RevenueCatWebhookPayload.model_validate(
        {
            "api_version": "1.0",
            "event": {
                "id": "evt_test",
                "type": event_type,
                "event_timestamp_ms": int(NOW.timestamp() * 1000),
                "environment": "SANDBOX",
                "app_id": app_id,
                "app_user_id": app_user_id,
                "product_id": "monthly",
                "transaction_id": "txn_test_123",
            },
        }
    )


def test_durable_intake_acknowledges_only_after_repository_accepts() -> None:
    repository = CapturingIntakeRepository()
    raw_body = b'{"verified":"raw-body"}'

    response = asyncio.run(intake_service(repository).process_webhook(payload(), raw_body=raw_body))

    assert response.status == "accepted"
    event, consumers = repository.accepted[0]
    assert consumers == ("pro_entitlement", "affiliate_finance")
    assert event.payload_sha256 == hashlib.sha256(raw_body).hexdigest()
    assert event.provider == "revenuecat"
    assert event.environment == "SANDBOX"
    assert event.provider_account_ref == "app_test"
    assert event.actor_ref is not None
    assert event.provider_actor_ciphertext is not None
    assert event.object_refs == {"product": "monthly", "transaction": "txn_test_123"}
    assert b"user_test_123" not in event.provider_actor_ciphertext


def test_unknown_event_is_retained_without_delivery_or_reversible_actor() -> None:
    repository = CapturingIntakeRepository()

    response = asyncio.run(
        intake_service(repository).process_webhook(
            payload(event_type="FUTURE_EVENT"), raw_body=b"{}"
        )
    )

    assert response.status == "accepted"
    event, consumers = repository.accepted[0]
    assert consumers == ()
    assert event.actor_ref is not None
    assert event.provider_actor_ciphertext is None


def test_actorless_refund_is_retained_for_transaction_scoped_reversal() -> None:
    repository = CapturingIntakeRepository()

    response = asyncio.run(
        intake_service(repository).process_webhook(
            payload(event_type="REFUND", app_user_id=None), raw_body=b"{}"
        )
    )

    assert response.status == "accepted"
    event, consumers = repository.accepted[0]
    assert consumers == ("affiliate_finance",)
    assert event.actor_ref is None
    assert event.provider_actor_ciphertext is None


def test_duplicate_intake_returns_duplicate_acknowledgement() -> None:
    repository = CapturingIntakeRepository(status="duplicate")

    response = asyncio.run(intake_service(repository).process_webhook(payload(), raw_body=b"{}"))

    assert response.status == "duplicate"


def test_wrong_account_is_ignored_before_persistence() -> None:
    repository = CapturingIntakeRepository()

    response = asyncio.run(
        intake_service(repository).process_webhook(payload(app_id="app_other"), raw_body=b"{}")
    )

    assert response.status == "ignored"
    assert repository.accepted == []


def test_database_failure_prevents_provider_acknowledgement() -> None:
    repository = CapturingIntakeRepository()
    repository.raise_unavailable = True

    with pytest.raises(DependencyUnavailableError):
        asyncio.run(intake_service(repository).process_webhook(payload(), raw_body=b"{}"))
