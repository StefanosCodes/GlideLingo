import asyncio
from typing import cast
from uuid import UUID

from agents import Agent, RunConfig, Runner
from pytest import MonkeyPatch

from app.integrations.openai.lesson_tutor_agent import OpenAILessonTutorAgent
from app.modules.lesson_tutor.context import LessonTutorContext


class FakeRunResult:
    final_output = "A compact tutor reply."


def test_adapter_runs_one_non_sensitive_bounded_turn(monkeypatch: MonkeyPatch) -> None:
    captured_args: tuple[object, ...] = ()
    captured_kwargs: dict[str, object] = {}

    async def fake_run(*args: object, **kwargs: object) -> FakeRunResult:
        nonlocal captured_args, captured_kwargs
        captured_args = args
        captured_kwargs = kwargs
        return FakeRunResult()

    monkeypatch.setattr(Runner, "run", staticmethod(fake_run))
    adapter = OpenAILessonTutorAgent(api_key="test-key", model="gpt-5.6-terra")
    context = LessonTutorContext(
        lesson_id="el-letters-1",
        lesson_title="The Greek sound map",
        module_title="First sounds",
        objective="Recognize three vowels.",
        visible_step_index=0,
        model_visible_context="Step 1 (current): hear α",
        canonical_answer=None,
        answer_disclosure_terms=(),
        answer_attempted=False,
    )

    reply = asyncio.run(
        adapter.reply(
            context=context,
            history=[],
            message="What is this?",
            conversation_id=UUID("00000000-0000-4000-8000-000000000001"),
        )
    )

    run_config = cast(RunConfig, captured_kwargs["run_config"])
    sdk_agent = cast(Agent[LessonTutorContext], captured_args[0])
    assert reply == "A compact tutor reply."
    assert captured_kwargs["max_turns"] == 1
    assert run_config.workflow_name == "lesson_tutor_turn"
    assert run_config.trace_include_sensitive_data is False
    assert run_config.trace_metadata == {
        "prompt_version": "lesson-tutor-v1",
        "model": "gpt-5.6-terra",
        "lesson_id": "el-letters-1",
    }
    assert sdk_agent.model_settings is not None
    assert sdk_agent.model_settings.max_tokens == 400
    assert sdk_agent.model_settings.reasoning is not None
    assert sdk_agent.model_settings.reasoning.effort == "none"
    assert sdk_agent.model_settings.timeout == 10
    assert sdk_agent.model_settings.store is False
