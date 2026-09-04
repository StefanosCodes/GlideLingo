"""Durable human-tutor marketplace maintenance worker.

This process claims database jobs with leases and delegates provider idempotency and
terminal recovery to ``LifecycleService``. It never logs actor, booking, provider, or
payment identifiers.
"""

import argparse
import asyncio
import logging
import signal
import socket
from collections.abc import Sequence
from contextlib import suppress
from datetime import UTC, datetime
from typing import Protocol, cast
from uuid import uuid4

from app.core.config import Settings
from app.modules.human_tutor_marketplace.booking import BookingService
from app.modules.human_tutor_marketplace.calendar import CalendarService
from app.modules.human_tutor_marketplace.lifecycle import LifecycleService
from app.modules.human_tutor_marketplace.messaging import MessagingService

LOGGER = logging.getLogger("glidelingo.marketplace.worker")


def _utc_now() -> datetime:
    return datetime.now(UTC)


class JobRunner(Protocol):
    async def run_one_job(self, *, worker: str) -> bool: ...


class MarketplaceJobProcessor:
    def __init__(
        self,
        *,
        booking: BookingService,
        lifecycle: LifecycleService,
        messaging: MessagingService,
        calendar: CalendarService,
        commerce_enabled: bool,
    ) -> None:
        self._booking = booking
        self._lifecycle = lifecycle
        self._messaging = messaging
        self._calendar = calendar
        self._commerce_enabled = commerce_enabled

    async def run_one_job(self, *, worker: str) -> bool:
        if self._commerce_enabled:
            if await self._booking.expire_holds(now=_utc_now(), limit=100):
                return True
            for process in (
                self._booking.run_one_reconciliation_job,
                self._lifecycle.run_one_money_job,
                self._lifecycle.run_one_reminder_job,
            ):
                if await process(worker=worker):
                    return True
        for process in (
            self._messaging.run_one_notification_job,
            self._calendar.run_one_refresh_job,
        ):
            if await process(worker=worker):
                return True
        return await self._messaging.run_retention_batch(now=_utc_now(), limit=1000)


async def run_worker(
    service: JobRunner,
    *,
    worker: str,
    once: bool,
    poll_seconds: float,
    stop: asyncio.Event,
) -> None:
    """Process claimed work until shutdown; one-shot mode is useful for probes."""

    while not stop.is_set():
        try:
            processed = await service.run_one_job(worker=worker)
        except asyncio.CancelledError:
            raise
        except Exception:
            LOGGER.exception(
                "marketplace job failed outside its durable retry boundary",
                extra={"event": "marketplace_money_worker_error", "outcome": "retrying"},
            )
            if once:
                raise
            processed = False
        else:
            LOGGER.info(
                "marketplace worker poll completed",
                extra={
                    "event": "marketplace_money_worker_poll",
                    "outcome": "processed" if processed else "idle",
                },
            )

        if once:
            return
        if not processed:
            with suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=poll_seconds)


def _arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process durable human tutor marketplace jobs")
    parser.add_argument("--once", action="store_true", help="Poll once, then exit")
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    arguments = parser.parse_args(argv)
    if arguments.poll_seconds <= 0 or arguments.poll_seconds > 60:
        parser.error("--poll-seconds must be greater than 0 and no more than 60")
    return arguments


async def _run(arguments: argparse.Namespace, settings: Settings) -> None:
    if not settings.human_tutor_marketplace_enabled:
        raise RuntimeError("the marketplace flag must be enabled for the marketplace worker")

    # Import after fail-closed configuration validation so a disabled worker does not
    # construct provider clients or database engines.
    from app.main import app

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for shutdown_signal in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):  # pragma: no cover - only relevant on Windows
            loop.add_signal_handler(shutdown_signal, stop.set)

    worker = f"{socket.gethostname()}-{uuid4().hex[:12]}"
    async with app.router.lifespan_context(app):
        service = MarketplaceJobProcessor(
            booking=cast(BookingService, app.state.marketplace_booking_service),
            lifecycle=cast(LifecycleService, app.state.marketplace_lifecycle_service),
            messaging=cast(MessagingService, app.state.marketplace_messaging_service),
            calendar=cast(CalendarService, app.state.marketplace_calendar_service),
            commerce_enabled=settings.human_tutor_commerce_enabled,
        )
        await run_worker(
            service,
            worker=worker,
            once=arguments.once,
            poll_seconds=arguments.poll_seconds,
            stop=stop,
        )


def main(argv: Sequence[str] | None = None) -> None:
    arguments = _arguments(argv)
    asyncio.run(_run(arguments, Settings()))


if __name__ == "__main__":
    main()
