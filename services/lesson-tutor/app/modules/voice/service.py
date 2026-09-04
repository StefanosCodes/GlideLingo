import asyncio
from dataclasses import dataclass
from typing import Protocol

from app.core.errors import VoiceRealtimeTimeoutError, VoiceRealtimeUnavailableError
from app.modules.voice.schemas import (
    CreatePrivateVoiceSessionRequest,
    CreatePrivateVoiceSessionResponse,
    EndPrivateVoiceSessionRequest,
    EndPrivateVoiceSessionResponse,
    VoiceSessionSpec,
)


class VoiceRealtimeAdapter(Protocol):
    async def create_call(
        self,
        *,
        actor_ref: str,
        captions_enabled: bool,
        offer_sdp: str,
        spec: VoiceSessionSpec,
        instructions: str,
    ) -> tuple[str, str, VoiceSessionSpec]: ...

    async def hangup(self, *, provider_call_id: str) -> None: ...

    async def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class ResolvedVoiceScenario:
    spec: VoiceSessionSpec
    instructions: str


class VoiceScenarioResolver(Protocol):
    def resolve(
        self, request: CreatePrivateVoiceSessionRequest, *, voice_id: str
    ) -> ResolvedVoiceScenario: ...


class VoiceRealtimeService:
    def __init__(
        self,
        *,
        enabled: bool,
        adapter: VoiceRealtimeAdapter | None,
        scenario_resolver: VoiceScenarioResolver | None,
        voice_id: str | None,
        deadline_seconds: float,
    ) -> None:
        self._enabled = enabled
        self._adapter = adapter
        self._scenario_resolver = scenario_resolver
        self._voice_id = voice_id
        self._deadline_seconds = deadline_seconds

    def ensure_available(self) -> None:
        if (
            not self._enabled
            or self._adapter is None
            or self._scenario_resolver is None
            or self._voice_id is None
        ):
            raise VoiceRealtimeUnavailableError

    async def create(
        self, request: CreatePrivateVoiceSessionRequest
    ) -> CreatePrivateVoiceSessionResponse:
        self.ensure_available()
        assert self._adapter is not None
        assert self._scenario_resolver is not None
        assert self._voice_id is not None
        try:
            async with asyncio.timeout(self._deadline_seconds):
                resolved = self._scenario_resolver.resolve(request, voice_id=self._voice_id)
                self._validate_resolution(request, resolved)
                call_id, answer_sdp, spec = await self._adapter.create_call(
                    actor_ref=request.actor_ref,
                    captions_enabled=request.captions_enabled,
                    offer_sdp=request.offer_sdp,
                    spec=resolved.spec,
                    instructions=resolved.instructions,
                )
                if spec != resolved.spec:
                    await self._adapter.hangup(provider_call_id=call_id)
                    raise ValueError("The provider changed the resolved voice session spec")
        except TimeoutError as error:
            raise VoiceRealtimeTimeoutError from error
        except asyncio.CancelledError:
            raise
        except Exception as error:
            raise VoiceRealtimeUnavailableError from error
        return CreatePrivateVoiceSessionResponse(
            application_session_id=request.application_session_id,
            provider_call_id=call_id,
            answer_sdp=answer_sdp,
            spec=spec,
        )

    def _validate_resolution(
        self, request: CreatePrivateVoiceSessionRequest, resolved: ResolvedVoiceScenario
    ) -> None:
        spec = resolved.spec
        if (
            spec.course_id != request.course_id
            or spec.scenario_id != request.scenario_id
            or spec.source_locale != request.source_locale
            or spec.target_locale != request.target_locale
            or spec.conversation_mode != request.conversation_mode
            or spec.voice_id != self._voice_id
            or not resolved.instructions.strip()
            or len(resolved.instructions) > 12_000
        ):
            raise ValueError("The course-owned voice scenario resolution was invalid")

    async def end(self, request: EndPrivateVoiceSessionRequest) -> EndPrivateVoiceSessionResponse:
        self.ensure_available()
        assert self._adapter is not None
        try:
            async with asyncio.timeout(self._deadline_seconds):
                await self._adapter.hangup(provider_call_id=request.provider_call_id)
        except TimeoutError as error:
            raise VoiceRealtimeTimeoutError from error
        except asyncio.CancelledError:
            raise
        except Exception as error:
            raise VoiceRealtimeUnavailableError from error
        return EndPrivateVoiceSessionResponse()
