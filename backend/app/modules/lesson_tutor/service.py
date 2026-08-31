"""Application operation for one bounded lesson tutor turn."""

import asyncio
import re
import unicodedata
from typing import Protocol
from uuid import UUID

from app.core.errors import LessonTutorTimeoutError, LessonTutorUnavailableError
from app.modules.lesson_tutor.context import LessonTutorContext, load_lesson_context
from app.modules.lesson_tutor.prompt import PROMPT_VERSION
from app.modules.lesson_tutor.schemas import (
    LessonTutorTurnRequest,
    LessonTutorTurnResponse,
    TutorHistoryMessage,
)

HINT_FALLBACK = (
    "Look back at the sound or contrast on this step and compare each choice with the examples "
    "you have already seen."
)


class LessonTutorAgent(Protocol):
    """SDK-free port implemented by the OpenAI integration adapter."""

    async def reply(
        self,
        *,
        context: LessonTutorContext,
        history: list[TutorHistoryMessage],
        message: str,
        conversation_id: UUID,
    ) -> str: ...


def _contains_answer(reply: str, answer: str) -> bool:
    normalized_reply = unicodedata.normalize("NFKC", reply).casefold()
    normalized_answer = unicodedata.normalize("NFKC", answer).casefold().strip()
    if not normalized_answer:
        return False
    if re.fullmatch(r"[\w-]+", normalized_answer, flags=re.UNICODE):
        pattern = rf"(?<!\w){re.escape(normalized_answer)}(?!\w)"
        return re.search(pattern, normalized_reply) is not None
    return normalized_answer in normalized_reply


class LessonTutorService:
    """Resolve trusted context, enforce deadline, and contain model output."""

    def __init__(
        self,
        *,
        enabled: bool,
        agent: LessonTutorAgent | None,
        deadline_seconds: float = 20,
    ) -> None:
        self._enabled = enabled
        self._agent = agent
        self._deadline_seconds = deadline_seconds

    async def turn(self, request: LessonTutorTurnRequest) -> LessonTutorTurnResponse:
        context = load_lesson_context(
            lesson_id=request.lesson_id,
            visible_step_index=request.visible_step_index,
            selected_choice=request.selected_choice,
        )
        if not self._enabled or self._agent is None:
            raise LessonTutorUnavailableError

        try:
            reply = await asyncio.wait_for(
                self._agent.reply(
                    context=context,
                    history=request.history,
                    message=request.message,
                    conversation_id=request.conversation_id,
                ),
                timeout=self._deadline_seconds,
            )
        except TimeoutError as error:
            raise LessonTutorTimeoutError from error
        except LessonTutorTimeoutError:
            raise
        except Exception as error:
            raise LessonTutorUnavailableError from error

        safe_reply = reply.strip()
        if not safe_reply:
            raise LessonTutorUnavailableError
        if (
            context.canonical_answer is not None
            and not context.answer_attempted
            and _contains_answer(safe_reply, context.canonical_answer)
        ):
            safe_reply = HINT_FALLBACK

        return LessonTutorTurnResponse(reply=safe_reply, prompt_version=PROMPT_VERSION)
