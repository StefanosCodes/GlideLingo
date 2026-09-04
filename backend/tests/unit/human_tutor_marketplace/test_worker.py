import asyncio
from typing import Any, cast

import pytest

from app.modules.human_tutor_marketplace.booking import BookingService
from app.modules.human_tutor_marketplace.calendar import CalendarService
from app.modules.human_tutor_marketplace.lifecycle import LifecycleService
from app.modules.human_tutor_marketplace.messaging import MessagingService
from app.workers.marketplace import MarketplaceJobProcessor, _arguments, run_worker


class Runner:
    def __init__(self, outcomes: list[bool]) -> None:
        self.outcomes = outcomes
        self.workers: list[str] = []

    async def run_one_job(self, *, worker: str) -> bool:
        self.workers.append(worker)
        return self.outcomes.pop(0)


class JobComponents:
    def __init__(self, completed: str | None) -> None:
        self.completed = completed
        self.calls: list[str] = []

    async def expire_holds(self, **kwargs: Any) -> int:
        self.calls.append("expiry")
        return int(self.completed == "expiry")

    async def run_one_reconciliation_job(self, **kwargs: Any) -> bool:
        self.calls.append("reconciliation")
        return self.completed == "reconciliation"

    async def run_one_money_job(self, **kwargs: Any) -> bool:
        self.calls.append("money")
        return self.completed == "money"

    async def run_one_reminder_job(self, **kwargs: Any) -> bool:
        self.calls.append("reminder")
        return self.completed == "reminder"

    async def run_one_notification_job(self, **kwargs: Any) -> bool:
        self.calls.append("notification")
        return self.completed == "notification"

    async def run_one_refresh_job(self, **kwargs: Any) -> bool:
        self.calls.append("calendar")
        return self.completed == "calendar"

    async def run_retention_batch(self, **kwargs: Any) -> bool:
        self.calls.append("retention")
        return self.completed == "retention"


def processor(components: JobComponents) -> MarketplaceJobProcessor:
    return MarketplaceJobProcessor(
        booking=cast(BookingService, components),
        lifecycle=cast(LifecycleService, components),
        messaging=cast(MessagingService, components),
        calendar=cast(CalendarService, components),
    )


def test_one_shot_worker_processes_at_most_one_claim() -> None:
    runner = Runner([True, True])

    asyncio.run(
        run_worker(
            runner,
            worker="test-worker",
            once=True,
            poll_seconds=0.01,
            stop=asyncio.Event(),
        )
    )

    assert runner.outcomes == [True]
    assert runner.workers == ["test-worker"]


def test_worker_honors_shutdown_while_idle() -> None:
    runner = Runner([False])
    stop = asyncio.Event()

    async def exercise() -> None:
        task = asyncio.create_task(
            run_worker(
                runner,
                worker="test-worker",
                once=False,
                poll_seconds=30,
                stop=stop,
            )
        )
        await asyncio.sleep(0)
        stop.set()
        await asyncio.wait_for(task, timeout=1)

    asyncio.run(exercise())
    assert runner.workers == ["test-worker"]


def test_worker_arguments_bound_poll_interval() -> None:
    assert _arguments(["--once", "--poll-seconds", "0.5"]).once is True
    with pytest.raises(SystemExit):
        _arguments(["--poll-seconds", "61"])


def test_processor_claims_each_durable_queue_in_recovery_order() -> None:
    components = JobComponents("reminder")

    assert asyncio.run(processor(components).run_one_job(worker="worker-a")) is True
    assert components.calls == ["expiry", "reconciliation", "money", "reminder"]


def test_processor_reaches_calendar_and_retention_when_earlier_queues_are_idle() -> None:
    components = JobComponents(None)

    assert asyncio.run(processor(components).run_one_job(worker="worker-a")) is False
    assert components.calls == [
        "expiry",
        "reconciliation",
        "money",
        "reminder",
        "notification",
        "calendar",
        "retention",
    ]
