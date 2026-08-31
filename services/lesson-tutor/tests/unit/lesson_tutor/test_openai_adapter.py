import asyncio
from typing import Any
from uuid import UUID

import pytest
from agents import Agent, RunConfig, Runner
from agents.models.openai_responses import OpenAIResponsesModel
from openai import Omit
from openai.resources.responses.responses import AsyncResponses
from openai.types.responses import Response

from app.integrations.openai.lesson_tutor_agent import (
    MAX_HISTORY_MESSAGES,
    MAX_OUTPUT_TOKENS,
    OpenAILessonTutorAgent,
)
from app.modules.lesson_tutor.context import LessonTutorContext
from app.modules.lesson_tutor.schemas import TutorHistoryMessage

ACTOR_REF = "tusr_v1_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG"
TURN_REF = UUID("6c9db024-5d8e-4df3-b35f-361701df6909")
PROVIDER_TIMEOUT_SECONDS = 4.25


class _RunResult:
    final_output = "Compare the sound with the example on this step."


def _provider_response() -> Response:
    return Response.model_validate(
        {
            "id": "resp_test",
            "created_at": 0,
            "model": "gpt-5.6-terra",
            "object": "response",
            "output": [
                {
                    "id": "msg_test",
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [
                        {
                            "type": "output_text",
                            "text": "Compare the sound with the example on this step.",
                            "annotations": [],
                        }
                    ],
                }
            ],
            "parallel_tool_calls": False,
            "tool_choice": "none",
            "tools": [],
        }
    )


def _context() -> LessonTutorContext:
    return LessonTutorContext(
        lesson_id="el-letters-1",
        lesson_title="Greek letters",
        module_title="First sounds",
        objective="Distinguish the visible letter sounds",
        visible_step_index=1,
        model_visible_context="Lesson: Greek letters\nStep 2 (current):\n- Activity: notice",
        canonical_answer=None,
        answer_disclosure_terms=(),
        answer_attempted=False,
    )


def test_reply_applies_exact_provider_and_privacy_controls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def fake_run(
        starting_agent: Agent[LessonTutorContext],
        input: object,
        **kwargs: Any,
    ) -> _RunResult:
        captured.update(starting_agent=starting_agent, input=input, **kwargs)
        return _RunResult()

    monkeypatch.setattr(Runner, "run", staticmethod(fake_run))
    adapter = OpenAILessonTutorAgent(
        api_key="test-only",
        model="gpt-5.6-terra",
        provider_timeout_seconds=PROVIDER_TIMEOUT_SECONDS,
    )
    history = [
        TutorHistoryMessage(role="user", content="How should I read this?"),
        TutorHistoryMessage(role="assistant", content="Look at the current example."),
    ]

    try:
        reply = asyncio.run(
            adapter.reply(
                context=_context(),
                history=history,
                message="Can you give me a hint?",
                actor_ref=ACTOR_REF,
                turn_ref=TURN_REF,
            )
        )

        assert reply == _RunResult.final_output
        assert captured["input"] == [
            {"role": "user", "content": "How should I read this?"},
            {"role": "assistant", "content": "Look at the current example."},
            {"role": "user", "content": "Can you give me a hint?"},
        ]
        assert captured["context"] == _context()
        assert captured["max_turns"] == 1

        starting_agent = captured["starting_agent"]
        run_config = captured["run_config"]
        assert isinstance(starting_agent, Agent)
        assert isinstance(run_config, RunConfig)
        assert isinstance(starting_agent.model, str)
        assert isinstance(
            run_config.model_provider.get_model(starting_agent.model), OpenAIResponsesModel
        )

        assert run_config.model_settings is not None
        assert run_config.model_settings.extra_args == {"safety_identifier": ACTOR_REF}
        effective_settings = starting_agent.model_settings.resolve(run_config.model_settings)
        assert effective_settings.extra_args == {"safety_identifier": ACTOR_REF}
        assert effective_settings.store is False
        assert effective_settings.max_tokens == MAX_OUTPUT_TOKENS
        assert effective_settings.retry is not None
        assert effective_settings.retry.max_retries == 0
        assert effective_settings.timeout == PROVIDER_TIMEOUT_SECONDS

        assert run_config.trace_include_sensitive_data is False
        assert run_config.group_id is None
        assert run_config.trace_metadata is None
        assert adapter._client.max_retries == 0
        assert adapter._client.timeout == PROVIDER_TIMEOUT_SECONDS

        assert ACTOR_REF not in repr(captured["input"])
        assert ACTOR_REF not in repr(captured["context"])
        assert str(TURN_REF) not in repr(captured)
    finally:
        asyncio.run(adapter.close())
    assert adapter._client.is_closed()


def test_responses_wire_request_omits_cross_request_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    async def fake_create(_responses: AsyncResponses, **kwargs: Any) -> Response:
        calls.append(kwargs)
        return _provider_response()

    # The provider call is intercepted below. Disabling trace export as well makes the test's
    # no-network guarantee independent of developer-machine environment configuration.
    monkeypatch.setenv("OPENAI_AGENTS_DISABLE_TRACING", "1")
    monkeypatch.setattr(AsyncResponses, "create", fake_create)
    adapter = OpenAILessonTutorAgent(
        api_key="test-only",
        model="gpt-5.6-terra",
        provider_timeout_seconds=PROVIDER_TIMEOUT_SECONDS,
    )

    async def exercise() -> str:
        try:
            return await adapter.reply(
                context=_context(),
                history=[TutorHistoryMessage(role="user", content="What should I notice?")],
                message="Give me one hint.",
                actor_ref=ACTOR_REF,
                turn_ref=TURN_REF,
            )
        finally:
            await adapter.close()

    assert asyncio.run(exercise()) == _RunResult.final_output
    assert len(calls) == 1
    wire_kwargs = calls[0]
    assert wire_kwargs["safety_identifier"] == ACTOR_REF
    assert wire_kwargs["store"] is False
    assert wire_kwargs["max_output_tokens"] == MAX_OUTPUT_TOKENS

    # The installed SDK represents absent optional request fields with its Omit sentinel before
    # serialization; these values do not cross the HTTP boundary.
    assert isinstance(wire_kwargs["conversation"], Omit)
    assert isinstance(wire_kwargs["previous_response_id"], Omit)
    assert isinstance(wire_kwargs["metadata"], Omit)
    assert "group_id" not in wire_kwargs
    assert str(TURN_REF) not in repr(wire_kwargs)


def test_reply_rejects_more_than_eight_history_messages() -> None:
    adapter = OpenAILessonTutorAgent(
        api_key="test-only",
        model="gpt-5.6-terra",
        provider_timeout_seconds=PROVIDER_TIMEOUT_SECONDS,
    )
    history = [TutorHistoryMessage(role="user", content=f"message {index}") for index in range(9)]

    try:
        with pytest.raises(ValueError, match="history exceeds"):
            asyncio.run(
                adapter.reply(
                    context=_context(),
                    history=history,
                    message="Help me",
                    actor_ref=ACTOR_REF,
                    turn_ref=TURN_REF,
                )
            )
    finally:
        asyncio.run(adapter.close())

    assert len(history) > MAX_HISTORY_MESSAGES


def test_reply_rejects_non_pseudonymous_actor_reference() -> None:
    adapter = OpenAILessonTutorAgent(
        api_key="test-only",
        model="gpt-5.6-terra",
        provider_timeout_seconds=PROVIDER_TIMEOUT_SECONDS,
    )

    try:
        with pytest.raises(ValueError, match="tutor-scoped pseudonym"):
            asyncio.run(
                adapter.reply(
                    context=_context(),
                    history=[],
                    message="Help me",
                    actor_ref="user@example.com",
                    turn_ref=TURN_REF,
                )
            )
    finally:
        asyncio.run(adapter.close())
