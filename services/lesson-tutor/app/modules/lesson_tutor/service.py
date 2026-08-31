import asyncio
import re
import unicodedata
from pathlib import Path
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
    async def reply(
        self,
        *,
        context: LessonTutorContext,
        history: list[TutorHistoryMessage],
        message: str,
        actor_ref: str,
        turn_ref: UUID,
    ) -> str: ...


def _contains_term(reply: str, term: str) -> bool:
    normalized_reply = unicodedata.normalize("NFKC", reply).casefold()
    normalized_term = unicodedata.normalize("NFKC", term).casefold().strip()
    if not normalized_term:
        return False
    if re.fullmatch(r"[\w-]+", normalized_term, flags=re.UNICODE):
        return (
            re.search(rf"(?<!\w){re.escape(normalized_term)}(?!\w)", normalized_reply) is not None
        )
    return normalized_term in normalized_reply


class LessonTutorService:
    def __init__(
        self,
        *,
        enabled: bool,
        agent: LessonTutorAgent | None,
        content_root: Path,
        deadline_seconds: float,
    ) -> None:
        self._enabled = enabled
        self._agent = agent
        self._content_root = content_root
        self._deadline_seconds = deadline_seconds

    async def turn(self, request: LessonTutorTurnRequest) -> LessonTutorTurnResponse:
        if not self._enabled or self._agent is None:
            raise LessonTutorUnavailableError
        context = load_lesson_context(
            content_root=self._content_root,
            lesson_id=request.lesson_id,
            visible_step_index=request.visible_step_index,
            selected_choice=request.selected_choice,
        )
        try:
            reply = await asyncio.wait_for(
                self._agent.reply(
                    context=context,
                    history=request.history,
                    message=request.message,
                    actor_ref=request.actor_ref,
                    turn_ref=request.turn_ref,
                ),
                timeout=self._deadline_seconds,
            )
        except TimeoutError as error:
            raise LessonTutorTimeoutError from error
        except Exception as error:
            raise LessonTutorUnavailableError from error
        safe_reply = reply.strip()
        if not safe_reply:
            raise LessonTutorUnavailableError
        if not context.answer_attempted and any(
            _contains_term(safe_reply, term) for term in context.answer_disclosure_terms
        ):
            safe_reply = HINT_FALLBACK
        return LessonTutorTurnResponse(reply=safe_reply, prompt_version=PROMPT_VERSION)
