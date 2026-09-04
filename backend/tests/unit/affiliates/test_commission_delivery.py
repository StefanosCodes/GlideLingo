import asyncio
from datetime import UTC, datetime
from typing import Any, cast

import pytest

from app.auth.clerk import ClerkPrincipal
from app.modules.affiliates.commission_delivery import AffiliateCommissionDeliveryHandler
from app.modules.affiliates.commission_domain import (
    CommissionApplyResult,
    CommissionApplyStatus,
    CommissionPolicyUnavailableError,
)
from app.modules.affiliates.commission_repository import AffiliateCommissionRepository
from app.modules.affiliates.identity import derive_affiliate_principal_ref
from app.modules.billing_events.crypto import ProviderActorCipher
from app.modules.billing_events.delivery import RetryableDeliveryError, TerminalDeliveryError
from app.modules.billing_events.models import ClaimedBillingEventDelivery

NOW = datetime(2026, 9, 2, 12, 0, tzinfo=UTC)
ACTOR_KEY = b"billing-event-actor-key-at-least-32-bytes"
AFFILIATE_KEY = b"affiliate-principal-key-at-least-32-bytes"
ACTOR_REF = f"rcusr_v1_{'A' * 43}"


class CapturingCommissionRepository:
    def __init__(self, *, policy_available: bool = True) -> None:
        self.policy_available = policy_available
        self.applied: dict[str, Any] | None = None

    def apply_billing_event(self, **kwargs: Any) -> CommissionApplyResult:
        self.applied = kwargs
        if not self.policy_available:
            raise CommissionPolicyUnavailableError
        return CommissionApplyResult(status=CommissionApplyStatus.ACCRUED)


def claimed(
    *,
    cipher: ProviderActorCipher,
    consumer: str = "affiliate_finance",
    event_type: str = "INITIAL_PURCHASE",
    with_actor: bool = True,
) -> ClaimedBillingEventDelivery:
    from uuid import uuid4

    event_ref = uuid4()
    return ClaimedBillingEventDelivery(
        delivery_ref=uuid4(),
        lease_token=uuid4(),
        consumer=cast(Any, consumer),
        attempt_count=1,
        event_ref=event_ref,
        provider="revenuecat",
        environment="SANDBOX",
        provider_account_ref="app_test",
        provider_event_id="evt_test",
        event_type=event_type,
        occurred_at=NOW,
        actor_ref=ACTOR_REF if with_actor else None,
        provider_actor_ciphertext=(
            cipher.encrypt(
                provider_actor_id="user_test_123",
                provider="revenuecat",
                environment="SANDBOX",
                provider_account_ref="app_test",
                actor_ref=ACTOR_REF,
            )
            if with_actor
            else None
        ),
        object_refs={"product": "monthly", "transaction": "txn_test"},
    )


def handler(
    repository: CapturingCommissionRepository, cipher: ProviderActorCipher
) -> AffiliateCommissionDeliveryHandler:
    return AffiliateCommissionDeliveryHandler(
        repository=cast(AffiliateCommissionRepository, repository),
        actor_cipher=cipher,
        affiliate_principal_key=AFFILIATE_KEY,
        clerk_issuer="https://clerk.test",
        now=lambda: NOW,
    )


def test_delivery_derives_affiliate_identity_from_verified_provider_actor() -> None:
    cipher = ProviderActorCipher(secret=ACTOR_KEY)
    repository = CapturingCommissionRepository()
    delivery = claimed(cipher=cipher)

    asyncio.run(handler(repository, cipher)(delivery))

    assert repository.applied == {
        "event_ref": delivery.event_ref,
        "principal_ref": derive_affiliate_principal_ref(
            key=AFFILIATE_KEY,
            principal=ClerkPrincipal(
                user_id="user_test_123",
                issuer="https://clerk.test",
            ),
        ),
        "processed_at": NOW,
    }


def test_policy_gap_is_retryable_and_wrong_consumer_is_terminal() -> None:
    cipher = ProviderActorCipher(secret=ACTOR_KEY)
    unavailable = CapturingCommissionRepository(policy_available=False)
    with pytest.raises(RetryableDeliveryError) as retry:
        asyncio.run(handler(unavailable, cipher)(claimed(cipher=cipher)))
    assert retry.value.error_class == "commission_policy_unavailable"

    repository = CapturingCommissionRepository()
    with pytest.raises(TerminalDeliveryError) as terminal:
        asyncio.run(handler(repository, cipher)(claimed(cipher=cipher, consumer="pro_entitlement")))
    assert terminal.value.error_class == "unsupported_delivery"
    assert repository.applied is None


def test_actorless_refund_uses_only_immutable_transaction_source() -> None:
    cipher = ProviderActorCipher(secret=ACTOR_KEY)
    repository = CapturingCommissionRepository()
    delivery = claimed(cipher=cipher, event_type="REFUND", with_actor=False)

    asyncio.run(handler(repository, cipher)(delivery))

    assert repository.applied == {
        "event_ref": delivery.event_ref,
        "principal_ref": None,
        "processed_at": NOW,
    }
