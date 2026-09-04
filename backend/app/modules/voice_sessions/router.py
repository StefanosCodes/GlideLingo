from dataclasses import dataclass
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request

from app.auth.clerk import ClerkPrincipal, CurrentClerkPrincipal
from app.core.errors import ErrorResponse
from app.modules.billing.router import BillingServiceDependency
from app.modules.voice_sessions.schemas import (
    CreateVoiceSessionRequest,
    EndVoiceSessionRequest,
    IdempotencyKey,
    ReconnectVoiceSessionRequest,
    VoiceSessionAdmission,
    VoiceSessionRecap,
)
from app.modules.voice_sessions.service import VoiceSessionService

router = APIRouter(prefix="/v1/voice-sessions", tags=["voice-sessions"])


@dataclass(frozen=True, slots=True)
class AuthenticatedVoiceSessions:
    principal: ClerkPrincipal
    service: VoiceSessionService


async def authenticate_voice_sessions(
    request: Request,
    principal: CurrentClerkPrincipal,
) -> AuthenticatedVoiceSessions:
    service = cast(VoiceSessionService, request.app.state.voice_session_service)
    service.ensure_available()
    return AuthenticatedVoiceSessions(principal, service)


AuthenticatedVoiceSessionsDependency = Annotated[
    AuthenticatedVoiceSessions, Depends(authenticate_voice_sessions)
]


async def authorize_voice_admission(
    authentication: AuthenticatedVoiceSessionsDependency,
    billing_service: BillingServiceDependency,
) -> AuthenticatedVoiceSessions:
    await billing_service.require_pro(principal=authentication.principal)
    return authentication


AuthorizedVoiceAdmissionDependency = Annotated[
    AuthenticatedVoiceSessions, Depends(authorize_voice_admission)
]


@router.post("", response_model=VoiceSessionAdmission, responses={403: {"model": ErrorResponse}})
async def create_voice_session(
    payload: CreateVoiceSessionRequest,
    request: Request,
    authorization: AuthorizedVoiceAdmissionDependency,
    idempotency_key: Annotated[IdempotencyKey, Header(alias="Idempotency-Key")],
) -> VoiceSessionAdmission:
    return await authorization.service.create(
        payload,
        principal=authorization.principal,
        idempotency_key=idempotency_key,
        request_id=request.state.request_id,
    )


@router.post("/{session_id}/reconnect", response_model=VoiceSessionAdmission)
async def reconnect_voice_session(
    session_id: UUID,
    payload: ReconnectVoiceSessionRequest,
    request: Request,
    authorization: AuthorizedVoiceAdmissionDependency,
    idempotency_key: Annotated[IdempotencyKey, Header(alias="Idempotency-Key")],
) -> VoiceSessionAdmission:
    return await authorization.service.reconnect(
        session_id,
        payload.offer_sdp,
        principal=authorization.principal,
        idempotency_key=idempotency_key,
        request_id=request.state.request_id,
    )


@router.post("/{session_id}/end", response_model=VoiceSessionRecap)
async def end_voice_session(
    session_id: UUID,
    payload: EndVoiceSessionRequest,
    request: Request,
    authorization: AuthenticatedVoiceSessionsDependency,
    idempotency_key: Annotated[IdempotencyKey, Header(alias="Idempotency-Key")],
) -> VoiceSessionRecap:
    return await authorization.service.end(
        session_id,
        payload,
        principal=authorization.principal,
        idempotency_key=idempotency_key,
        request_id=request.state.request_id,
    )


@router.get("/{session_id}/recap", response_model=VoiceSessionRecap)
async def get_voice_session_recap(
    session_id: UUID,
    authorization: AuthenticatedVoiceSessionsDependency,
) -> VoiceSessionRecap:
    return await authorization.service.recap(session_id, principal=authorization.principal)
