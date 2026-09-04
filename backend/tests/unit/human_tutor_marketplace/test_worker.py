import asyncio

import pytest

from app.workers.marketplace import _arguments, run_worker


class Runner:
    def __init__(self, outcomes: list[bool]) -> None:
        self.outcomes = outcomes
        self.workers: list[str] = []

    async def run_one_money_job(self, *, worker: str) -> bool:
        self.workers.append(worker)
        return self.outcomes.pop(0)


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
