"""Privacy-bounded OpenAI Agents SDK adapter for the lesson tutor."""

import re
from typing import cast
from uuid import UUID

from agents import (
    Agent,
    ModelRetrySettings,
    ModelSettings,
    OpenAIProvider,
    RunConfig,
    RunContextWrapper,
    Runner,
    TResponseInputItem,
)

from app.modules.lesson_tutor.context import LessonTutorContext
from app.modules.lesson_tutor.prompt import build_instructions
from app.modules.lesson_tutor.schemas import TutorHistoryMessage
from openai import AsyncOpenAI
from openai.types.shared import Reasoning

MAX_HISTORY_MESSAGES = 8
MAX_OUTPUT_TOKENS = 400
_ACTOR_REF_PATTERN = re.compile(r"^tusr_v1_[A-Za-z0-9_-]{43}$")


def _dynamic_instructions(
    wrapper: RunContextWrapper[LessonTutorContext],
    _agent: Agent[LessonTutorContext],
) -> str:
    return build_instructions(wrapper.context)


class OpenAILessonTutorAgent:
    """Keep OpenAI and Agents SDK objects behind the application-owned agent port."""

    def __init__(self, *, api_key: str, model: str, provider_timeout_seconds: float) -> None:
        if provider_timeout_seconds <= 0:
            raise ValueError("The OpenAI provider timeout must be positive")
        self._client = AsyncOpenAI(
            api_key=api_key,
            max_retries=0,
            timeout=provider_timeout_seconds,
        )
        self._provider = OpenAIProvider(openai_client=self._client, use_responses=True)
        self._agent = Agent[LessonTutorContext](
            name="GlideLingo lesson tutor",
            instructions=_dynamic_instructions,
            model=model,
            model_settings=ModelSettings(
                max_tokens=MAX_OUTPUT_TOKENS,
                reasoning=Reasoning(effort="none"),
                verbosity="low",
                store=False,
                retry=ModelRetrySettings(max_retries=0),
                timeout=provider_timeout_seconds,
            ),
        )

    async def reply(
        self,
        *,
        context: LessonTutorContext,
        history: list[TutorHistoryMessage],
        message: str,
        actor_ref: str,
        turn_ref: UUID,
    ) -> str:
        if _ACTOR_REF_PATTERN.fullmatch(actor_ref) is None:
            raise ValueError("actor_ref must be a tutor-scoped pseudonym")
        if len(history) > MAX_HISTORY_MESSAGES:
            raise ValueError("Tutor history exceeds its model-visible bound")
        if type(message) is not str or not message.strip():
            raise TypeError("Tutor input must be non-empty text")
        if any(type(item.content) is not str for item in history):
            raise TypeError("Tutor history must contain text only")

        # turn_ref is deliberately accepted for the application port but excluded from the
        # provider input, conversation state, grouping, metadata, and traces.
        del turn_ref
        input_items = cast(
            list[TResponseInputItem],
            [item.model_dump(mode="json") for item in history]
            + [{"role": "user", "content": message}],
        )
        result = await Runner.run(
            self._agent,
            input_items,
            context=context,
            max_turns=1,
            run_config=RunConfig(
                model_provider=self._provider,
                model_settings=ModelSettings(
                    store=False,
                    extra_args={"safety_identifier": actor_ref},
                ),
                workflow_name="lesson_tutor_turn",
                trace_include_sensitive_data=False,
            ),
        )
        if type(result.final_output) is not str:
            raise TypeError("Lesson tutor output was not text")
        return result.final_output

    async def close(self) -> None:
        """Release the provider HTTP client during application shutdown."""

        await self._client.close()
