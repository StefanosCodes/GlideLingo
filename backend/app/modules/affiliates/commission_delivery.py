"""Billing-event delivery adapter for the disabled affiliate commission ledger."""

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime

from app.auth.clerk import ClerkPrincipal
from app.modules.affiliates.commission_domain import (
    CommissionPolicyUnavailableError,
    CommissionSourceUnavailableError,
)
from app.modules.affiliates.commission_repository import AffiliateCommissionRepository
from app.modules.affiliates.identity import derive_affiliate_principal_ref
from app.modules.billing_events.crypto import (
    InvalidProviderActorCiphertextError,
    ProviderActorCipher,
)
from app.modules.billing_events.delivery import RetryableDeliveryError, TerminalDeliveryError
from app.modules.billing_events.models import ClaimedBillingEventDelivery


class AffiliateCommissionDeliveryHandler:
    """Derive affiliate identity from verified server context and apply one event."""

    def __init__(
        self,
        *,
        repository: AffiliateCommissionRepository,
        actor_cipher: ProviderActorCipher,
        affiliate_principal_key: bytes,
        clerk_issuer: str,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._actor_cipher = actor_cipher
        self._affiliate_principal_key = affiliate_principal_key
        self._clerk_issuer = clerk_issuer
        self._now = now or (lambda: datetime.now(UTC))

    async def __call__(self, delivery: ClaimedBillingEventDelivery) -> None:
        if (
            delivery.consumer != "affiliate_finance"
            or delivery.provider != "revenuecat"
            or delivery.environment not in {"SANDBOX", "PRODUCTION"}
        ):
            raise TerminalDeliveryError("unsupported_delivery")
        principal_ref = None
        if delivery.event_type not in {"REFUND", "REFUND_REVERSED"}:
            if delivery.actor_ref is None or delivery.provider_actor_ciphertext is None:
                raise TerminalDeliveryError("unsupported_delivery")
            try:
                provider_actor_id = self._actor_cipher.decrypt(
                    ciphertext=delivery.provider_actor_ciphertext,
                    provider=delivery.provider,
                    environment=delivery.environment,
                    provider_account_ref=delivery.provider_account_ref,
                    actor_ref=delivery.actor_ref,
                )
            except InvalidProviderActorCiphertextError as error:
                raise TerminalDeliveryError("invalid_provider_actor") from error
            principal_ref = derive_affiliate_principal_ref(
                key=self._affiliate_principal_key,
                principal=ClerkPrincipal(user_id=provider_actor_id, issuer=self._clerk_issuer),
            )
        try:
            await asyncio.to_thread(
                self._repository.apply_billing_event,
                event_ref=delivery.event_ref,
                principal_ref=principal_ref,
                processed_at=self._now(),
            )
        except CommissionPolicyUnavailableError as error:
            raise RetryableDeliveryError("commission_policy_unavailable") from error
        except CommissionSourceUnavailableError as error:
            raise RetryableDeliveryError("commission_source_unavailable") from error
