import asyncio
from pathlib import Path
from uuid import UUID

import pytest

from app.core.errors import LessonTutorUnavailableError
from app.modules.lesson_tutor.context import LessonTutorContext
from app.modules.lesson_tutor.schemas import LessonTutorTurnRequest, TutorHistoryMessage
from app.modules.lesson_tutor.service import HINT_FALLBACK, LessonTutorService

CONTENT_ROOT = Path(__file__).resolve().parents[4] / "content"


class FakeAgent:
    def __init__(self, reply: str = "Iota sounds like the ee in see.") -> None:
        self.reply_text = reply
        self.calls = 0
        self.actor_ref: str | None = None

    async def reply(
        self,
        *,
        context: LessonTutorContext,
        history: list[TutorHistoryMessage],
        message: str,
        actor_ref: str,
        turn_ref: UUID,
    ) -> str:
        self.calls += 1
        self.actor_ref = actor_ref
        return self.reply_text


def request(*, step: int = 2) -> LessonTutorTurnRequest:
    return LessonTutorTurnRequest(
        actor_ref="tusr_v1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        turn_ref="00000000-0000-4000-8000-000000000001",
        lesson_id="el-letters-1",
        visible_step_index=step,
        selected_choice=None,
        message="Why?",
        history=[],
    )


def test_disabled_service_never_loads_content_or_calls_agent() -> None:
    agent = FakeAgent()
    service = LessonTutorService(
        enabled=False,
        agent=agent,
        content_root=Path("/must-not-load"),
        deadline_seconds=5,
    )
    with pytest.raises(LessonTutorUnavailableError):
        asyncio.run(service.turn(request()))
    assert agent.calls == 0


def test_actor_ref_reaches_only_agent_safety_boundary() -> None:
    agent = FakeAgent()
    response = asyncio.run(
        LessonTutorService(
            enabled=True,
            agent=agent,
            content_root=CONTENT_ROOT,
            deadline_seconds=5,
        ).turn(request())
    )
    assert response.prompt_version == "lesson-tutor-v1"
    assert agent.actor_ref == request().actor_ref


def test_pre_attempt_answer_alias_is_contained() -> None:
    agent = FakeAgent("Choose alpha because it has the open sound.")
    response = asyncio.run(
        LessonTutorService(
            enabled=True,
            agent=agent,
            content_root=CONTENT_ROOT,
            deadline_seconds=5,
        ).turn(request(step=5))
    )
    assert response.reply == HINT_FALLBACK
