"""Lesson tutor HTTP contract and stable error translation."""

from typing import Annotated

from fastapi import APIRouter, Header, Request

from app.auth.clerk import CurrentClerkPrincipal
from app.core.errors import ErrorResponse
from app.modules.lesson_tutor.schemas import (
    IdempotencyKey,
    LessonTutorTurnRequest,
    LessonTutorTurnResponse,
)
from app.modules.lesson_tutor.service import LessonTutorService

router = APIRouter(prefix="/v1/lesson-tutor", tags=["lesson-tutor"])


@router.post(
    "/turns",
    operation_id="create_lesson_tutor_turn",
    response_model=LessonTutorTurnResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        409: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
)
async def create_lesson_tutor_turn(
    turn: LessonTutorTurnRequest,
    request: Request,
    principal: CurrentClerkPrincipal,
    idempotency_key: Annotated[IdempotencyKey, Header(alias="Idempotency-Key")],
) -> LessonTutorTurnResponse:
    service: LessonTutorService = request.app.state.lesson_tutor_service
    return await service.turn(
        turn,
        principal=principal,
        idempotency_key=idempotency_key,
        request_id=request.state.request_id,
    )
