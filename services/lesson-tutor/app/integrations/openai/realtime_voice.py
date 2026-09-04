import asyncio
import re
from typing import Any

from app.modules.voice.schemas import VoiceSessionSpec
from openai import AsyncOpenAI, NotFoundError
from openai.types.realtime.realtime_audio_config_param import RealtimeAudioConfigParam
from openai.types.realtime.realtime_session_create_request_param import (
    RealtimeSessionCreateRequestParam,
)

_CALL_LOCATION = re.compile(r"(?:https://api\.openai\.com)?/v1/realtime/calls/([A-Za-z0-9_-]+)$")
_ACTOR_REF = re.compile(r"^vusr_v1_[A-Za-z0-9_-]{43}$")
_COMPENSATION_RETRY_DELAYS = (0.0, 0.05, 0.2)


class OpenAIRealtimeVoiceAdapter:
    """Create and stop direct OpenAI WebRTC calls with a server-held API key."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        provider_timeout_seconds: float,
    ) -> None:
        self._model = model
        self._cleanup_pending_call_ids: set[str] = set()
        self._client = AsyncOpenAI(
            api_key=api_key,
            max_retries=0,
            timeout=provider_timeout_seconds,
        )

    async def create_call(
        self,
        *,
        actor_ref: str,
        captions_enabled: bool,
        offer_sdp: str,
        spec: VoiceSessionSpec,
        instructions: str,
    ) -> tuple[str, str, VoiceSessionSpec]:
        if _ACTOR_REF.fullmatch(actor_ref) is None:
            raise ValueError("actor_ref must be a voice-scoped pseudonym")
        audio: RealtimeAudioConfigParam = {
            "input": {"turn_detection": None},
            "output": {"voice": spec.voice_id},
        }
        if captions_enabled:
            audio["input"]["transcription"] = {
                "model": "gpt-4o-mini-transcribe",
                "language": spec.target_locale.partition("-")[0],
            }
        session: RealtimeSessionCreateRequestParam = {
            "type": "realtime",
            "model": self._model,
            "instructions": instructions,
            "max_output_tokens": 1000,
            "output_modalities": ["audio"],
            "parallel_tool_calls": False,
            "tool_choice": "none",
            "tools": [],
            "audio": audio,
            "tracing": None,
        }
        create_task = asyncio.create_task(
            self._client.realtime.calls.create(
                sdp=offer_sdp,
                session=session,
                extra_headers={"OpenAI-Safety-Identifier": actor_ref},
            )
        )
        try:
            result = await asyncio.shield(create_task)
        except asyncio.CancelledError as cancelled:
            try:
                result = await asyncio.shield(create_task)
            except Exception as error:
                raise cancelled from error
            call_id = self._call_id(result)
            if call_id is not None:
                await self._compensating_hangup(call_id)
            raise cancelled

        call_id = self._call_id(result)
        answer_sdp = result.text
        if call_id is None or not answer_sdp.startswith("v=0") or len(answer_sdp) > 65536:
            if call_id is not None:
                await self._compensating_hangup(call_id)
            raise ValueError("OpenAI returned an invalid Realtime call response")
        return call_id, answer_sdp, spec

    @staticmethod
    def _call_id(result: Any) -> str | None:
        location = result.response.headers.get("location")
        match = _CALL_LOCATION.fullmatch(location or "")
        return match.group(1) if match is not None else None

    async def hangup(self, *, provider_call_id: str) -> None:
        try:
            await self._client.realtime.calls.hangup(provider_call_id)
        except NotFoundError:
            # A call already closed by its peer is terminally cleaned up.
            return

    async def _compensating_hangup(self, provider_call_id: str) -> bool:
        self._cleanup_pending_call_ids.add(provider_call_id)
        for delay in _COMPENSATION_RETRY_DELAYS:
            if delay > 0:
                await asyncio.sleep(delay)
            try:
                await asyncio.shield(self.hangup(provider_call_id=provider_call_id))
            except Exception:
                continue
            self._cleanup_pending_call_ids.discard(provider_call_id)
            return True
        return False

    async def close(self) -> None:
        for call_id in tuple(self._cleanup_pending_call_ids):
            await self._compensating_hangup(call_id)
        await self._client.close()
        if self._cleanup_pending_call_ids:
            raise RuntimeError("OpenAI Realtime call cleanup could not be confirmed")
