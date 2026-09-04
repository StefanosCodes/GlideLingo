import asyncio
from types import SimpleNamespace
from typing import Any, cast

import pytest

from app.integrations.openai.realtime_voice import OpenAIRealtimeVoiceAdapter
from app.modules.voice.schemas import VoiceSessionSpec

SPEC = VoiceSessionSpec(
    course_id="el-from-zero",
    course_version="greek-foundations-v1",
    scenario_id="el-greeting-introduction-v1",
    scenario_version="1.0.0",
    persona_id="greek-guide-v1",
    voice_id="configured-voice",
    learner_level="A0-A1",
    capability_ids=["el-introduce-self"],
    correction_policy_version="gentle-recast-v1",
    evidence_policy_version="conversation-observation-v1",
)
INSTRUCTIONS = "course-owned bounded prompt that never claims mastery"


class FakeCalls:
    def __init__(self) -> None:
        self.create_kwargs: dict[str, object] | None = None
        self.hangups: list[str] = []
        self.hangup_failures = 0

    async def create(self, **kwargs: object) -> object:
        self.create_kwargs = kwargs
        return SimpleNamespace(
            text="v=0\r\na=answer-data-for-private-test",
            response=SimpleNamespace(headers={"location": "/v1/realtime/calls/call_private_1"}),
        )

    async def hangup(self, call_id: str) -> None:
        self.hangups.append(call_id)
        if self.hangup_failures > 0:
            self.hangup_failures -= 1
            raise OSError("transient hangup failure")


class FakeClient:
    def __init__(self) -> None:
        self.calls = FakeCalls()
        self.realtime = SimpleNamespace(calls=self.calls)
        self.closed = False

    async def close(self) -> None:
        self.closed = True


def adapter() -> tuple[OpenAIRealtimeVoiceAdapter, FakeClient]:
    subject = object.__new__(OpenAIRealtimeVoiceAdapter)
    client = FakeClient()
    subject._model = "configured-realtime-model"
    subject._client = cast(Any, client)
    subject._cleanup_pending_call_ids = set()
    return subject, client


def test_creates_audio_only_call_and_retains_cleanup_reference() -> None:
    async def run() -> None:
        subject, client = adapter()
        call_id, answer, spec = await subject.create_call(
            offer_sdp="v=0\r\na=offer-data-for-private-test",
            spec=SPEC,
            instructions=INSTRUCTIONS,
        )
        assert call_id == "call_private_1"
        assert answer.startswith("v=0")
        assert spec.voice_id == "configured-voice"
        assert client.calls.create_kwargs is not None
        session = client.calls.create_kwargs["session"]
        assert isinstance(session, dict)
        assert session["model"] == "configured-realtime-model"
        assert session["output_modalities"] == ["audio"]
        assert session["tracing"] is None
        assert "extra_headers" not in client.calls.create_kwargs
        assert "vusr_v1_" not in str(client.calls.create_kwargs)
        assert "mastery" in str(session["instructions"])

    asyncio.run(run())


def test_rejects_call_response_without_a_cleanup_location() -> None:
    async def run() -> None:
        subject, client = adapter()
        original_create = client.calls.create

        async def missing_location(**kwargs: object) -> object:
            result = cast(SimpleNamespace, await original_create(**kwargs))
            result.response.headers = {}
            return result

        client.calls.create = missing_location  # type: ignore[method-assign]
        with pytest.raises(ValueError, match="invalid Realtime call response"):
            await subject.create_call(
                offer_sdp="v=0\r\na=offer-data-for-private-test",
                spec=SPEC,
                instructions=INSTRUCTIONS,
            )

    asyncio.run(run())


def test_malformed_answer_hangs_up_a_call_with_a_known_reference() -> None:
    async def run() -> None:
        subject, client = adapter()
        original_create = client.calls.create

        async def malformed_answer(**kwargs: object) -> object:
            result = cast(SimpleNamespace, await original_create(**kwargs))
            result.text = "not-an-sdp-answer"
            return result

        client.calls.create = malformed_answer  # type: ignore[method-assign]
        client.calls.hangup_failures = 1
        with pytest.raises(ValueError, match="invalid Realtime call response"):
            await subject.create_call(
                offer_sdp="v=0\r\na=offer-data-for-private-test",
                spec=SPEC,
                instructions=INSTRUCTIONS,
            )
        assert client.calls.hangups == ["call_private_1", "call_private_1"]

    asyncio.run(run())


def test_exhausted_compensation_is_retained_and_retried_on_close() -> None:
    async def run() -> None:
        subject, client = adapter()
        original_create = client.calls.create

        async def malformed_answer(**kwargs: object) -> object:
            result = cast(SimpleNamespace, await original_create(**kwargs))
            result.text = "not-an-sdp-answer"
            return result

        client.calls.create = malformed_answer  # type: ignore[method-assign]
        client.calls.hangup_failures = 3
        with pytest.raises(ValueError, match="invalid Realtime call response"):
            await subject.create_call(
                offer_sdp="v=0\r\na=offer-data-for-private-test",
                spec=SPEC,
                instructions=INSTRUCTIONS,
            )
        assert subject._cleanup_pending_call_ids == {"call_private_1"}

        await subject.close()
        assert subject._cleanup_pending_call_ids == set()
        assert client.closed is True

    asyncio.run(run())


def test_cancellation_after_provider_creation_performs_compensating_hangup() -> None:
    async def run() -> None:
        subject, client = adapter()
        started = asyncio.Event()
        release = asyncio.Event()

        class DeferredCalls(FakeCalls):
            async def create(self, **kwargs: object) -> object:
                self.create_kwargs = kwargs
                started.set()
                await release.wait()
                return SimpleNamespace(
                    text="v=0\r\na=answer-data-for-private-test",
                    response=SimpleNamespace(
                        headers={"location": "/v1/realtime/calls/call_cancelled_1"}
                    ),
                )

        calls = DeferredCalls()
        calls.hangup_failures = 1
        client.calls = calls
        client.realtime.calls = calls
        operation = asyncio.create_task(
            subject.create_call(
                offer_sdp="v=0\r\na=offer-data-for-private-test",
                spec=SPEC,
                instructions=INSTRUCTIONS,
            )
        )
        await started.wait()
        operation.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await operation
        assert calls.hangups == ["call_cancelled_1", "call_cancelled_1"]

    asyncio.run(run())


def test_hangup_uses_only_the_provider_call_reference() -> None:
    async def run() -> None:
        subject, client = adapter()
        await subject.hangup(provider_call_id="call_private_1")
        assert client.calls.hangups == ["call_private_1"]

    asyncio.run(run())


def test_close_reports_exhausted_pending_cleanup() -> None:
    async def run() -> None:
        subject, client = adapter()
        subject._cleanup_pending_call_ids.add("call_still_pending")
        client.calls.hangup_failures = 3

        with pytest.raises(RuntimeError, match="cleanup could not be confirmed"):
            await subject.close()
        assert subject._cleanup_pending_call_ids == {"call_still_pending"}
        assert client.closed is True

    asyncio.run(run())
