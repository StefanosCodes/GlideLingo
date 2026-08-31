"""IAM-authenticated, data-minimized client for the private tutor service."""

import asyncio
from typing import Annotated, Protocol
from uuid import UUID

import httpx
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.id_token import fetch_id_token
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from app.core.errors import (
    LessonContextNotFoundError,
    LessonTutorNotSentError,
    LessonTutorTimeoutError,
    LessonTutorUnavailableError,
)
from app.core.request_id import REQUEST_ID_HEADER
from app.modules.lesson_tutor.schemas import (
    LessonTutorTurnRequest,
    LessonTutorTurnResponse,
    TutorHistoryMessage,
)

TURN_PATH = "/internal/v1/lesson-tutor/turns"
ActorRef = Annotated[str, StringConstraints(pattern=r"^tusr_v1_[A-Za-z0-9_-]{43}$")]


class PrivateLessonTutorTurn(BaseModel):
    """The complete allowlist of data permitted across the private boundary."""

    model_config = ConfigDict(extra="forbid")
    actor_ref: ActorRef
    turn_ref: UUID
    lesson_id: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    visible_step_index: int
    selected_choice: Annotated[str, StringConstraints(min_length=1, max_length=200)] | None
    message: Annotated[str, StringConstraints(min_length=1, max_length=2000)]
    history: Annotated[list[TutorHistoryMessage], Field(max_length=8)]

    @classmethod
    def from_public(
        cls, *, actor_ref: str, turn_ref: UUID, request: LessonTutorTurnRequest
    ) -> "PrivateLessonTutorTurn":
        return cls(
            actor_ref=actor_ref,
            turn_ref=turn_ref,
            lesson_id=request.lesson_id,
            visible_step_index=request.visible_step_index,
            selected_choice=request.selected_choice,
            message=request.message,
            history=request.history,
        )


class IdentityTokenProvider(Protocol):
    async def token(self) -> str: ...


class GoogleIdentityTokenProvider:
    def __init__(self, *, audience: str) -> None:
        self._audience = audience

    async def token(self) -> str:
        return await asyncio.to_thread(fetch_id_token, GoogleAuthRequest(), self._audience)


class LessonTutorHttpClient:
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

    async def turn(
        self, request: PrivateLessonTutorTurn, *, request_id: str
    ) -> LessonTutorTurnResponse:
        try:
            async with asyncio.timeout(self._timeout_seconds):
                identity_token = await self._token_provider.token()
                response = await self._client.post(
                    TURN_PATH,
                    json=request.model_dump(mode="json"),
                    headers={
                        "Authorization": f"Bearer {identity_token}",
                        REQUEST_ID_HEADER: request_id,
                    },
                )
        except (TimeoutError, httpx.TimeoutException) as error:
            raise LessonTutorTimeoutError from error
        except (GoogleAuthError, OSError, ValueError) as error:
            raise LessonTutorNotSentError from error
        except httpx.HTTPError as error:
            raise LessonTutorUnavailableError from error
        if response.status_code == 404:
            raise LessonContextNotFoundError
        if response.status_code == 504:
            raise LessonTutorTimeoutError
        if response.status_code != 200:
            raise LessonTutorUnavailableError
        try:
            return LessonTutorTurnResponse.model_validate_json(response.content)
        except ValidationError as error:
            raise LessonTutorUnavailableError from error

    async def close(self) -> None:
        await self._client.aclose()
