import asyncio
from pathlib import Path
from uuid import UUID

import pytest

from app.core.errors import LessonTutorTimeoutError, LessonTutorUnavailableError
from app.modules.lesson_tutor.context import LessonTutorContext
from app.modules.lesson_tutor.schemas import LessonTutorTurnRequest, TutorHistoryMessage
from app.modules.lesson_tutor.service import HINT_FALLBACK, LessonTutorService

CONTENT_ROOT = Path(__file__).resolve().parents[4] / "content"


class FakeAgent:
    def __init__(self, reply: str = "Iota sounds like the ee in see.") -> None:
        self.calls = 0
        self.context: LessonTutorContext | None = None
        self.reply_text = reply

    async def reply(
        self,
        *,
        context: LessonTutorContext,
        history: list[TutorHistoryMessage],
        message: str,
        conversation_id: UUID,
    ) -> str:
        self.calls += 1
        self.context = context
        return self.reply_text


class SlowAgent(FakeAgent):
    async def reply(
        self,
        *,
        context: LessonTutorContext,
        history: list[TutorHistoryMessage],
        message: str,
        conversation_id: UUID,
    ) -> str:
        await asyncio.sleep(0.05)
        return "late"


class FailingAgent(FakeAgent):
    async def reply(
        self,
        *,
        context: LessonTutorContext,
        history: list[TutorHistoryMessage],
        message: str,
        conversation_id: UUID,
    ) -> str:
        raise RuntimeError("provider secret must not escape")


def request(*, step: int = 2, selected_choice: str | None = None) -> LessonTutorTurnRequest:
    return LessonTutorTurnRequest(
        conversation_id="00000000-0000-4000-8000-000000000001",
        lesson_id="el-letters-1",
        visible_step_index=step,
        selected_choice=selected_choice,
        message="Why does this sound like ee?",
        history=[],
    )


def test_disabled_service_never_loads_content_or_invokes_agent() -> None:
    agent = FakeAgent()
    service = LessonTutorService(
        enabled=False,
        agent=agent,
        content_root=Path("/content-must-not-be-loaded-while-disabled"),
    )

    with pytest.raises(LessonTutorUnavailableError):
        asyncio.run(service.turn(request()))

    assert agent.calls == 0


def test_success_returns_owned_contract() -> None:
    agent = FakeAgent()
    result = asyncio.run(
        LessonTutorService(enabled=True, agent=agent, content_root=CONTENT_ROOT).turn(request())
    )

    assert result.model_dump() == {
        "reply": "Iota sounds like the ee in see.",
        "prompt_version": "lesson-tutor-v1",
    }
    assert agent.calls == 1


def test_pre_attempt_answer_leak_uses_hint_without_second_call() -> None:
    agent = FakeAgent("The answer is α because it has the open sound.")
    result = asyncio.run(
        LessonTutorService(enabled=True, agent=agent, content_root=CONTENT_ROOT).turn(
            request(step=5)
        )
    )

    assert result.reply == HINT_FALLBACK
    assert agent.calls == 1


def test_attempt_allows_direct_answer_explanation() -> None:
    agent = FakeAgent("The answer is α because it has the open sound.")
    result = asyncio.run(
        LessonTutorService(enabled=True, agent=agent, content_root=CONTENT_ROOT).turn(
            request(step=5, selected_choice="ε")
        )
    )

    assert result.reply.startswith("The answer is α")


def test_timeout_has_stable_domain_failure() -> None:
    service = LessonTutorService(
        enabled=True,
        agent=SlowAgent(),
        content_root=CONTENT_ROOT,
        deadline_seconds=0.001,
    )

    with pytest.raises(LessonTutorTimeoutError):
        asyncio.run(service.turn(request()))


def test_provider_failure_has_secret_safe_domain_failure() -> None:
    with pytest.raises(LessonTutorUnavailableError) as caught:
        asyncio.run(
            LessonTutorService(
                enabled=True,
                agent=FailingAgent(),
                content_root=CONTENT_ROOT,
            ).turn(request())
        )

    assert "secret" not in str(caught.value)


def test_pre_attempt_answer_alias_uses_hint() -> None:
    agent = FakeAgent("Choose alpha because it has the open sound.")

    result = asyncio.run(
        LessonTutorService(enabled=True, agent=agent, content_root=CONTENT_ROOT).turn(
            request(step=5)
        )
    )

    assert result.reply == HINT_FALLBACK
