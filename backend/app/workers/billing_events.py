"""Run the disabled-by-default durable billing-event worker."""

import asyncio
import logging
import signal
from contextlib import suppress

from app.core.config import Settings
from app.core.errors import DependencyUnavailableError
from app.core.logging import configure_logging
from app.db.engine import create_database_engine
from app.integrations.revenuecat.client import RevenueCatHttpClient
from app.modules.affiliates.commission_delivery import AffiliateCommissionDeliveryHandler
from app.modules.affiliates.commission_repository import PostgresAffiliateCommissionRepository
from app.modules.billing.repository import PostgresEntitlementRepository
from app.modules.billing_events.crypto import ProviderActorCipher
from app.modules.billing_events.delivery import (
    BillingEventWorker,
    DeliveryHandler,
    ProEntitlementDeliveryHandler,
    placeholder_affiliate_finance_handler,
)
from app.modules.billing_events.repository import PostgresBillingEventRepository

logger = logging.getLogger("glidelingo.billing_events.worker")


async def run_worker(settings: Settings) -> int:
    configure_logging(settings.log_level)
    if not settings.billing_event_intake_enabled:
        logger.info("billing event worker is disabled")
        return 0

    assert settings.revenuecat_api_key is not None
    assert settings.revenuecat_pseudonym_key is not None
    engine = create_database_engine(settings)
    provider = RevenueCatHttpClient(
        api_key=settings.revenuecat_api_key.get_secret_value(),
        timeout_seconds=settings.revenuecat_api_timeout_seconds,
    )
    repository = PostgresBillingEventRepository(engine=engine)
    affiliate_handler: DeliveryHandler = placeholder_affiliate_finance_handler
    if settings.affiliate_commissions_enabled:
        assert settings.affiliate_principal_pseudonym_key is not None
        assert settings.clerk_issuer is not None
        affiliate_handler = AffiliateCommissionDeliveryHandler(
            repository=PostgresAffiliateCommissionRepository(engine=engine),
            actor_cipher=ProviderActorCipher(
                secret=settings.revenuecat_pseudonym_key.get_secret_value().encode()
            ),
            affiliate_principal_key=(
                settings.affiliate_principal_pseudonym_key.get_secret_value().encode()
            ),
            clerk_issuer=settings.clerk_issuer,
        )
    worker = BillingEventWorker(
        repository=repository,
        handlers={
            "pro_entitlement": ProEntitlementDeliveryHandler(
                provider=provider,
                repository=PostgresEntitlementRepository(engine=engine),
                actor_cipher=ProviderActorCipher(
                    secret=settings.revenuecat_pseudonym_key.get_secret_value().encode()
                ),
            ),
            "affiliate_finance": affiliate_handler,
        },
        lease_seconds=settings.billing_event_worker_lease_seconds,
        maximum_attempts=settings.billing_event_worker_maximum_attempts,
        retry_base_seconds=settings.billing_event_worker_retry_base_seconds,
        retry_max_seconds=settings.billing_event_worker_retry_max_seconds,
    )
    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signal_number in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(signal_number, stopping.set)
    try:
        while not stopping.is_set():
            try:
                processed = await worker.run_once()
            except DependencyUnavailableError:
                logger.error("billing event worker database is unavailable")
                processed = False
            if not processed:
                with suppress(TimeoutError):
                    await asyncio.wait_for(
                        stopping.wait(),
                        timeout=settings.billing_event_worker_poll_seconds,
                    )
    finally:
        await provider.close()
        engine.dispose()
    return 0


def main() -> int:
    return asyncio.run(run_worker(Settings()))


if __name__ == "__main__":
    raise SystemExit(main())
