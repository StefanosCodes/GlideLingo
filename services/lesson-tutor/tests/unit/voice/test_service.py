import asyncio
from uuid import UUID

import pytest

from app.core.errors import VoiceRealtimeTimeoutError, VoiceRealtimeUnavailableError
from app.modules.voice.schemas import (
    CreatePrivateVoiceSessionRequest,
    EndPrivateVoiceSessionRequest,
    VoiceSessionSpec,
)
from app.modules.voice.service import ResolvedVoiceScenario, VoiceRealtimeService


def request() -> CreatePrivateVoiceSessionRequest:
    return CreatePrivateVoiceSessionRequest(
        actor_ref="vusr_v1_" + "a" * 43,
        application_session_id=UUID("00000000-0000-4000-8000-000000000001"),
        course_id="el-from-zero",
        scenario_id="el-greeting-introduction-v1",
        source_locale="en",
        target_locale="el-GR",
        conversation_mode="guided",
        captions_enabled=True,
        offer_sdp="v=0\r\na=offer-data-for-service-test",
    )


class Adapter:
    def __init__(self) -> None:
        self.hangups: list[str] = []

    async def create_call(
        self,
        *,
        actor_ref: str,
        captions_enabled: bool,
        offer_sdp: str,
        spec: VoiceSessionSpec,
        instructions: str,
    ) -> tuple[str, str, VoiceSessionSpec]:
        assert actor_ref == request().actor_ref
        assert captions_enabled is True
        assert offer_sdp.startswith("v=0")
        assert instructions == "course-owned bounded Greek prompt"
        return "call_service_1", "v=0\r\na=answer-data-for-service-test", spec

    async def hangup(self, *, provider_call_id: str) -> None:
        self.hangups.append(provider_call_id)

    async def close(self) -> None:
        return None


class Resolver:
    def resolve(
        self, payload: CreatePrivateVoiceSessionRequest, *, voice_id: str
    ) -> ResolvedVoiceScenario:
        return ResolvedVoiceScenario(
            spec=VoiceSessionSpec(
                course_id=payload.course_id,
                course_version="greek-foundations-v1",
                course_content_hash="sha256:" + "a" * 64,
                scenario_id=payload.scenario_id,
                scenario_version="1.0.0",
                conversation_mode=payload.conversation_mode,
                source_locale=payload.source_locale,
                target_locale=payload.target_locale,
                persona_id="greek-guide-v1",
                voice_id=voice_id,
                learner_level="A0-A1",
                capability_ids=["el-introduce-self"],
                correction_policy_version="gentle-recast-v1",
                evidence_policy_version="conversation-observation-v1",
            ),
            instructions="course-owned bounded Greek prompt",
        )


def service(*, enabled: bool = True, adapter: Adapter | None = None) -> VoiceRealtimeService:
    return VoiceRealtimeService(
        enabled=enabled,
        adapter=adapter or Adapter(),
        scenario_resolver=Resolver(),
        voice_id="configured-voice",
        deadline_seconds=1,
    )


def test_disabled_voice_runtime_fails_closed() -> None:
    subject = service(enabled=False)
    with pytest.raises(VoiceRealtimeUnavailableError):
        asyncio.run(subject.create(request()))


def test_enabled_runtime_without_course_owned_resolver_fails_closed() -> None:
    subject = VoiceRealtimeService(
        enabled=True,
        adapter=Adapter(),
        scenario_resolver=None,
        voice_id="configured-voice",
        deadline_seconds=1,
    )
    with pytest.raises(VoiceRealtimeUnavailableError):
        asyncio.run(subject.create(request()))


def test_create_and_end_preserve_application_scope() -> None:
    async def run() -> None:
        adapter = Adapter()
        subject = service(adapter=adapter)
        created = await subject.create(request())
        assert created.application_session_id == request().application_session_id
        assert created.provider_call_id == "call_service_1"
        ended = await subject.end(
            EndPrivateVoiceSessionRequest(
                actor_ref=request().actor_ref,
                application_session_id=request().application_session_id,
                provider_call_id=created.provider_call_id,
            )
        )
        assert ended.status == "stopped"
        assert adapter.hangups == ["call_service_1"]

    asyncio.run(run())


def test_request_rejects_malformed_sdp() -> None:
    with pytest.raises(ValueError, match="bounded WebRTC"):
        CreatePrivateVoiceSessionRequest(**{**request().model_dump(), "offer_sdp": "x" * 20})


def test_provider_cancellation_is_not_reclassified_or_retried() -> None:
    class CancelledAdapter(Adapter):
        async def create_call(
            self,
            *,
            actor_ref: str,
            captions_enabled: bool,
            offer_sdp: str,
            spec: VoiceSessionSpec,
            instructions: str,
        ) -> tuple[str, str, VoiceSessionSpec]:
            raise asyncio.CancelledError

    async def run() -> None:
        subject = service(adapter=CancelledAdapter())
        with pytest.raises(asyncio.CancelledError):
            await subject.create(request())

    asyncio.run(run())


def test_private_service_deadline_bounds_a_stalled_provider() -> None:
    class StalledAdapter(Adapter):
        async def create_call(
            self,
            *,
            actor_ref: str,
            captions_enabled: bool,
            offer_sdp: str,
            spec: VoiceSessionSpec,
            instructions: str,
        ) -> tuple[str, str, VoiceSessionSpec]:
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

    async def run() -> None:
        subject = VoiceRealtimeService(
            enabled=True,
            adapter=StalledAdapter(),
            scenario_resolver=Resolver(),
            voice_id="configured-voice",
            deadline_seconds=0.01,
        )
        with pytest.raises(VoiceRealtimeTimeoutError):
            await subject.create(request())

    asyncio.run(run())
