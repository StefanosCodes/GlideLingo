"""Lesson tutor HTTP contract and stable error translation."""

from dataclasses import dataclass
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, Request

from app.auth.clerk import ClerkPrincipal, CurrentClerkPrincipal
from app.core.errors import ErrorResponse
from app.modules.billing.router import BillingServiceDependency
from app.modules.lesson_tutor.schemas import (
    IdempotencyKey,
    LessonTutorTurnRequest,
    LessonTutorTurnResponse,
)
from app.modules.lesson_tutor.service import LessonTutorService

router = APIRouter(prefix="/v1/lesson-tutor", tags=["lesson-tutor"])


@dataclass(frozen=True, slots=True)
class AuthorizedLessonTutor:
    principal: ClerkPrincipal
    service: LessonTutorService


async def authorize_lesson_tutor(
    request: Request,
    principal: CurrentClerkPrincipal,
    billing_service: BillingServiceDependency,
) -> AuthorizedLessonTutor:
    service = cast(LessonTutorService, request.app.state.lesson_tutor_service)
    service.ensure_available()
    await billing_service.require_pro(principal=principal)
    return AuthorizedLessonTutor(principal=principal, service=service)


AuthorizedLessonTutorDependency = Annotated[
    AuthorizedLessonTutor,
    Depends(authorize_lesson_tutor),
]


@router.post(
    "/turns",
    operation_id="create_lesson_tutor_turn",
    response_model=LessonTutorTurnResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
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
    authorization: AuthorizedLessonTutorDependency,
    idempotency_key: Annotated[IdempotencyKey, Header(alias="Idempotency-Key")],
) -> LessonTutorTurnResponse:
    return await authorization.service.turn(
        turn,
        principal=authorization.principal,
        idempotency_key=idempotency_key,
        request_id=request.state.request_id,
    )
