from fastapi import APIRouter, Request

from app.core.errors import ErrorResponse
from app.modules.voice.schemas import (
    CreatePrivateVoiceSessionRequest,
    CreatePrivateVoiceSessionResponse,
    EndPrivateVoiceSessionRequest,
    EndPrivateVoiceSessionResponse,
)
from app.modules.voice.service import VoiceRealtimeService

router = APIRouter(prefix="/internal/v1/voice-sessions", tags=["voice-sessions"])


@router.post(
    "",
    response_model=CreatePrivateVoiceSessionResponse,
    responses={503: {"model": ErrorResponse}, 504: {"model": ErrorResponse}},
)
async def create_voice_session(
    payload: CreatePrivateVoiceSessionRequest, request: Request
) -> CreatePrivateVoiceSessionResponse:
    service: VoiceRealtimeService = request.app.state.voice_realtime_service
    return await service.create(payload)


@router.post(
    "/end",
    response_model=EndPrivateVoiceSessionResponse,
    responses={503: {"model": ErrorResponse}, 504: {"model": ErrorResponse}},
)
async def end_voice_session(
    payload: EndPrivateVoiceSessionRequest, request: Request
) -> EndPrivateVoiceSessionResponse:
    service: VoiceRealtimeService = request.app.state.voice_realtime_service
    return await service.end(payload)
