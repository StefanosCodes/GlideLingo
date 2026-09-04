import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from app.modules.billing_events.delivery import (
    BillingEventWorker,
    RetryableDeliveryError,
)
from app.modules.billing_events.models import (
    BillingEventConsumer,
    ClaimedBillingEventDelivery,
)
from app.modules.billing_events.repository import BillingEventRepository

NOW = datetime(2026, 9, 2, 12, 0, tzinfo=UTC)


def claimed(
    consumer: BillingEventConsumer, *, attempt_count: int = 1
) -> ClaimedBillingEventDelivery:
    return ClaimedBillingEventDelivery(
        delivery_ref=uuid4(),
        lease_token=uuid4(),
        consumer=consumer,
        attempt_count=attempt_count,
        event_ref=uuid4(),
        provider="revenuecat",
        environment="SANDBOX",
        provider_account_ref="app_test",
        provider_event_id="evt_test",
        event_type="INITIAL_PURCHASE",
        occurred_at=NOW,
        actor_ref=f"rcusr_v1_{'A' * 43}",
        provider_actor_ciphertext=b"encrypted",
        object_refs={},
    )


class MemoryDeliveryRepository:
    def __init__(self, deliveries: list[ClaimedBillingEventDelivery]) -> None:
        self.deliveries = deliveries
        self.completed: list[ClaimedBillingEventDelivery] = []
        self.failures: list[tuple[ClaimedBillingEventDelivery, str, bool, int]] = []
        self.claimed: ClaimedBillingEventDelivery | None = None

    def claim_next(self, **_kwargs: object) -> ClaimedBillingEventDelivery | None:
        if not self.deliveries:
            return None
        self.claimed = self.deliveries.pop(0)
        return self.claimed

    def complete(self, **_kwargs: object) -> bool:
        assert self.claimed is not None
        self.completed.append(self.claimed)
        return True

    def fail(self, *, error_class: str, terminal: bool, **kwargs: object) -> bool:
        assert self.claimed is not None
        next_attempt_at = kwargs["next_attempt_at"]
        assert isinstance(next_attempt_at, datetime)
        delay = int((next_attempt_at - NOW).total_seconds())
        self.failures.append((self.claimed, error_class, terminal, delay))
        return True


async def succeeds(_delivery: ClaimedBillingEventDelivery) -> None:
    return None


async def retries(_delivery: ClaimedBillingEventDelivery) -> None:
    raise RetryableDeliveryError("consumer_not_implemented")


def worker(
    repository: MemoryDeliveryRepository,
    handlers: dict[
        BillingEventConsumer,
        Callable[[ClaimedBillingEventDelivery], Awaitable[None]],
    ],
) -> BillingEventWorker:
    return BillingEventWorker(
        repository=cast(BillingEventRepository, repository),
        handlers=handlers,
        lease_seconds=30,
        maximum_attempts=3,
        retry_base_seconds=5,
        retry_max_seconds=20,
        now=lambda: NOW,
    )


def test_consumers_complete_and_retry_independently() -> None:
    pro = claimed("pro_entitlement")
    affiliate = claimed("affiliate_finance")
    repository = MemoryDeliveryRepository([pro, affiliate])
    event_worker = worker(
        repository,
        {"pro_entitlement": succeeds, "affiliate_finance": retries},
    )

    assert asyncio.run(event_worker.run_once()) is True
    assert asyncio.run(event_worker.run_once()) is True

    assert repository.completed == [pro]
    assert repository.failures == [(affiliate, "consumer_not_implemented", False, 5)]


def test_retry_becomes_manual_review_at_bounded_attempt() -> None:
    affiliate = claimed("affiliate_finance", attempt_count=3)
    repository = MemoryDeliveryRepository([affiliate])

    assert asyncio.run(worker(repository, {"affiliate_finance": retries}).run_once()) is True

    assert repository.failures == [(affiliate, "consumer_not_implemented", True, 20)]
