from fastapi import APIRouter, Request

from app.core.errors import ErrorResponse
from app.modules.lesson_tutor.schemas import LessonTutorTurnRequest, LessonTutorTurnResponse
from app.modules.lesson_tutor.service import LessonTutorService

router = APIRouter(prefix="/internal/v1/lesson-tutor", tags=["lesson-tutor"])


@router.post(
    "/turns",
    operation_id="create_internal_lesson_tutor_turn",
    response_model=LessonTutorTurnResponse,
    responses={
        404: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
)
async def create_turn(turn: LessonTutorTurnRequest, request: Request) -> LessonTutorTurnResponse:
    service: LessonTutorService = request.app.state.lesson_tutor_service
    return await service.turn(turn)
