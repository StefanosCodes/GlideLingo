"""Durable human-tutor money-operation worker.

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
from typing import Protocol, cast
from uuid import uuid4

from app.core.config import Settings
from app.modules.human_tutor_marketplace.lifecycle import LifecycleService

LOGGER = logging.getLogger("glidelingo.marketplace.worker")


class MoneyJobRunner(Protocol):
    async def run_one_money_job(self, *, worker: str) -> bool: ...


async def run_worker(
    service: MoneyJobRunner,
    *,
    worker: str,
    once: bool,
    poll_seconds: float,
    stop: asyncio.Event,
) -> None:
    """Process claimed work until shutdown; one-shot mode is useful for probes."""

    while not stop.is_set():
        try:
            processed = await service.run_one_money_job(worker=worker)
        except asyncio.CancelledError:
            raise
        except Exception:
            LOGGER.exception(
                "marketplace money job failed outside its durable retry boundary",
                extra={"event": "marketplace_money_worker_error", "outcome": "retrying"},
            )
            if once:
                raise
            processed = False
        else:
            LOGGER.info(
                "marketplace money worker poll completed",
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
    parser = argparse.ArgumentParser(description="Process human tutor marketplace money jobs")
    parser.add_argument("--once", action="store_true", help="Poll once, then exit")
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    arguments = parser.parse_args(argv)
    if arguments.poll_seconds <= 0 or arguments.poll_seconds > 60:
        parser.error("--poll-seconds must be greater than 0 and no more than 60")
    return arguments


async def _run(arguments: argparse.Namespace, settings: Settings) -> None:
    if not settings.human_tutor_marketplace_enabled or not settings.human_tutor_commerce_enabled:
        raise RuntimeError("marketplace and commerce flags must be enabled for the money worker")

    # Import after fail-closed configuration validation so a disabled worker does not
    # construct provider clients or database engines.
    from app.main import app

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for shutdown_signal in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):  # pragma: no cover - only relevant on Windows
            loop.add_signal_handler(shutdown_signal, stop.set)

    worker = f"{socket.gethostname()}-{uuid4().hex[:12]}"
    service = cast(LifecycleService, app.state.marketplace_lifecycle_service)
    async with app.router.lifespan_context(app):
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
