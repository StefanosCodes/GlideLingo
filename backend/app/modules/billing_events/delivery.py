"""Crash-safe delivery dispatch with independent bounded retries."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Literal, cast

from app.core.errors import DependencyUnavailableError
from app.integrations.revenuecat.client import RevenueCatProvider, RevenueCatUnavailableError
from app.modules.billing.repository import EntitlementRepository
from app.modules.billing.schemas import RevenueCatEnvironment
from app.modules.billing_events.crypto import (
    InvalidProviderActorCiphertextError,
    ProviderActorCipher,
)
from app.modules.billing_events.models import (
    BillingEventConsumer,
    ClaimedBillingEventDelivery,
)
from app.modules.billing_events.repository import BillingEventRepository

logger = logging.getLogger("glidelingo.billing_events")

type DeliveryErrorClass = Literal[
    "commission_policy_unavailable",
    "commission_source_unavailable",
    "consumer_not_implemented",
    "database_unavailable",
    "invalid_provider_actor",
    "provider_unavailable",
    "unsupported_delivery",
    "unexpected_failure",
]
type DeliveryHandler = Callable[[ClaimedBillingEventDelivery], Awaitable[None]]


class RetryableDeliveryError(Exception):
    def __init__(self, error_class: DeliveryErrorClass) -> None:
        self.error_class = error_class
        super().__init__(error_class)


class TerminalDeliveryError(Exception):
    def __init__(self, error_class: DeliveryErrorClass) -> None:
        self.error_class = error_class
        super().__init__(error_class)


class ProEntitlementDeliveryHandler:
    """Converge exact Pro state from a fresh RevenueCat subscriber read."""

    def __init__(
        self,
        *,
        provider: RevenueCatProvider,
        repository: EntitlementRepository,
        actor_cipher: ProviderActorCipher,
    ) -> None:
        self._provider = provider
        self._repository = repository
        self._actor_cipher = actor_cipher

    async def __call__(self, delivery: ClaimedBillingEventDelivery) -> None:
        if (
            delivery.provider != "revenuecat"
            or delivery.environment not in {"SANDBOX", "PRODUCTION"}
            or delivery.actor_ref is None
            or delivery.provider_actor_ciphertext is None
        ):
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
        environment = cast(RevenueCatEnvironment, delivery.environment)
        snapshot = await self._provider.fetch_pro_entitlement(
            app_user_id=provider_actor_id,
            environment=environment,
        )
        if snapshot.environment != environment:
            raise RetryableDeliveryError("provider_unavailable")
        await asyncio.to_thread(
            self._repository.store_reconciliation,
            actor_ref=delivery.actor_ref,
            environment=environment,
            is_active=snapshot.is_active,
            expires_at=snapshot.expires_at,
            observed_at=snapshot.observed_at,
        )


async def placeholder_affiliate_finance_handler(
    _delivery: ClaimedBillingEventDelivery,
) -> None:
    """Retain and retry finance signals until a reviewed consumer is supplied."""

    raise RetryableDeliveryError("consumer_not_implemented")


class BillingEventWorker:
    def __init__(
        self,
        *,
        repository: BillingEventRepository,
        handlers: dict[BillingEventConsumer, DeliveryHandler],
        lease_seconds: int,
        maximum_attempts: int,
        retry_base_seconds: int,
        retry_max_seconds: int,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._handlers = handlers
        self._lease = timedelta(seconds=lease_seconds)
        self._maximum_attempts = maximum_attempts
        self._retry_base_seconds = retry_base_seconds
        self._retry_max_seconds = retry_max_seconds
        self._now = now or (lambda: datetime.now(UTC))

    async def run_once(self) -> bool:
        claimed_at = self._now()
        delivery = await asyncio.to_thread(
            self._repository.claim_next,
            claimed_at=claimed_at,
            lease_expires_at=claimed_at + self._lease,
        )
        if delivery is None:
            return False
        handler = self._handlers.get(delivery.consumer)
        if handler is None:
            await self._record_failure(
                delivery=delivery,
                error_class="unsupported_delivery",
                force_terminal=True,
            )
            return True
        try:
            await handler(delivery)
        except TerminalDeliveryError as error:
            await self._record_failure(
                delivery=delivery,
                error_class=error.error_class,
                force_terminal=True,
            )
        except RetryableDeliveryError as error:
            await self._record_failure(delivery=delivery, error_class=error.error_class)
        except RevenueCatUnavailableError:
            await self._record_failure(delivery=delivery, error_class="provider_unavailable")
        except DependencyUnavailableError:
            await self._record_failure(delivery=delivery, error_class="database_unavailable")
        except Exception as error:
            logger.error(
                "billing event delivery failed unexpectedly",
                extra={"error_type": type(error).__name__},
            )
            await self._record_failure(delivery=delivery, error_class="unexpected_failure")
        else:
            completed_at = self._now()
            completed = await asyncio.to_thread(
                self._repository.complete,
                delivery_ref=delivery.delivery_ref,
                lease_token=delivery.lease_token,
                completed_at=completed_at,
            )
            if not completed:
                logger.warning("billing event delivery completion lost its lease")
        return True

    async def _record_failure(
        self,
        *,
        delivery: ClaimedBillingEventDelivery,
        error_class: DeliveryErrorClass,
        force_terminal: bool = False,
    ) -> None:
        failed_at = self._now()
        terminal = force_terminal or delivery.attempt_count >= self._maximum_attempts
        delay_seconds = min(
            self._retry_base_seconds * (2 ** max(delivery.attempt_count - 1, 0)),
            self._retry_max_seconds,
        )
        recorded = await asyncio.to_thread(
            self._repository.fail,
            delivery_ref=delivery.delivery_ref,
            lease_token=delivery.lease_token,
            failed_at=failed_at,
            next_attempt_at=failed_at + timedelta(seconds=delay_seconds),
            error_class=error_class,
            terminal=terminal,
        )
        if not recorded:
            logger.warning("billing event delivery failure lost its lease")
