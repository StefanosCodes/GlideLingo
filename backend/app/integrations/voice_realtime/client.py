import asyncio
from typing import Annotated
from uuid import UUID

import httpx
from google.auth.exceptions import GoogleAuthError
from pydantic import BaseModel, ConfigDict, StringConstraints, ValidationError

from app.core.errors import (
    VoiceSessionNotSentError,
    VoiceSessionTimeoutError,
    VoiceSessionUnavailableError,
)
from app.core.request_id import REQUEST_ID_HEADER
from app.integrations.lesson_tutor.client import IdentityTokenProvider
from app.modules.voice_sessions.schemas import VoiceSessionSpec

CREATE_PATH = "/internal/v1/voice-sessions"
END_PATH = "/internal/v1/voice-sessions/end"
ActorRef = Annotated[str, StringConstraints(pattern=r"^vusr_v1_[A-Za-z0-9_-]{43}$")]
ProviderCallId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,200}$")]


class PrivateVoiceSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actor_ref: ActorRef
    application_session_id: UUID
    course_id: str
    scenario_id: str
    source_locale: str
    target_locale: str
    conversation_mode: str
    captions_enabled: bool
    offer_sdp: str


class PrivateVoiceSessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    application_session_id: UUID
    provider_call_id: ProviderCallId
    answer_sdp: str
    spec: VoiceSessionSpec


class PrivateVoiceEndRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actor_ref: ActorRef
    application_session_id: UUID
    provider_call_id: ProviderCallId


class VoiceRealtimeHttpClient:
    def __init__(
        self,
        *,
        base_url: str,
        token_provider: IdentityTokenProvider,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._token_provider = token_provider
        self._timeout_seconds = timeout_seconds
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
        )

    async def create(
        self, request: PrivateVoiceSessionRequest, *, request_id: str
    ) -> PrivateVoiceSessionResponse:
        response = await self._post(CREATE_PATH, request.model_dump(mode="json"), request_id)
        try:
            return PrivateVoiceSessionResponse.model_validate_json(response.content)
        except ValidationError as error:
            raise VoiceSessionUnavailableError from error

    async def end(self, request: PrivateVoiceEndRequest, *, request_id: str) -> None:
        await self._post(END_PATH, request.model_dump(mode="json"), request_id)

    async def _post(self, path: str, body: dict[str, object], request_id: str) -> httpx.Response:
        try:
            async with asyncio.timeout(self._timeout_seconds):
                token = await self._token_provider.token()
                response = await self._client.post(
                    path,
                    json=body,
                    headers={
                        "Authorization": f"Bearer {token}",
                        REQUEST_ID_HEADER: request_id,
                    },
                )
        except (TimeoutError, httpx.TimeoutException) as error:
            raise VoiceSessionTimeoutError from error
        except (GoogleAuthError, OSError, ValueError) as error:
            raise VoiceSessionNotSentError from error
        except httpx.HTTPError as error:
            raise VoiceSessionUnavailableError from error
        if response.status_code == 504:
            raise VoiceSessionTimeoutError
        if response.status_code != 200:
            raise VoiceSessionUnavailableError
        return response

    async def close(self) -> None:
        await self._client.aclose()
