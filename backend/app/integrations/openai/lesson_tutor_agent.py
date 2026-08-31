"""OpenAI Agents SDK adapter for the page-aware lesson tutor."""

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
from app.modules.lesson_tutor.prompt import PROMPT_VERSION, build_instructions
from app.modules.lesson_tutor.schemas import TutorHistoryMessage
from openai import AsyncOpenAI


def _dynamic_instructions(
    wrapper: RunContextWrapper[LessonTutorContext],
    _agent: Agent[LessonTutorContext],
) -> str:
    return build_instructions(wrapper.context)


class OpenAILessonTutorAgent:
    """Keep all Agents SDK objects behind the application-owned agent port."""

    def __init__(self, *, api_key: str, model: str) -> None:
        self._model = model
        self._client = AsyncOpenAI(api_key=api_key, max_retries=0, timeout=20)
        self._provider = OpenAIProvider(openai_client=self._client, use_responses=True)
        self._agent = Agent[LessonTutorContext](
            name="GlideLingo lesson tutor",
            instructions=_dynamic_instructions,
            model=model,
            model_settings=ModelSettings(
                max_tokens=400,
                verbosity="low",
                timeout=20,
                store=False,
                retry=ModelRetrySettings(max_retries=0),
            ),
        )

    async def reply(
        self,
        *,
        context: LessonTutorContext,
        history: list[TutorHistoryMessage],
        message: str,
        conversation_id: UUID,
    ) -> str:
        input_items = cast(
            list[TResponseInputItem],
            [item.model_dump() for item in history] + [{"role": "user", "content": message}],
        )
        result = await Runner.run(
            self._agent,
            input_items,
            context=context,
            max_turns=1,
            run_config=RunConfig(
                model_provider=self._provider,
                workflow_name="lesson_tutor_turn",
                group_id=str(conversation_id),
                trace_include_sensitive_data=False,
                trace_metadata={
                    "prompt_version": PROMPT_VERSION,
                    "model": self._model,
                    "lesson_id": context.lesson_id,
                },
            ),
        )
        if not isinstance(result.final_output, str):
            raise TypeError("Lesson tutor output was not text")
        return result.final_output

    async def close(self) -> None:
        """Release the shared provider HTTP client during application shutdown."""

        await self._client.close()
