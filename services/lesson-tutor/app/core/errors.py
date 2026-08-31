"""Minimal error responses for the private contract."""

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class ErrorResponse(BaseModel):
    code: str
    request_id: str


class LessonContextNotFoundError(Exception):
    pass


class LessonTutorUnavailableError(Exception):
    pass


class LessonTutorTimeoutError(Exception):
    pass


def _response(request: Request, status: int, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content=ErrorResponse(code=code, request_id=request.state.request_id).model_dump(),
    )


async def context_not_found(request: Request, _error: Exception) -> JSONResponse:
    return _response(request, 404, "lesson_context_not_found")


async def tutor_unavailable(request: Request, _error: Exception) -> JSONResponse:
    return _response(request, 503, "lesson_tutor_unavailable")


async def tutor_timeout(request: Request, _error: Exception) -> JSONResponse:
    return _response(request, 504, "lesson_tutor_timeout")
