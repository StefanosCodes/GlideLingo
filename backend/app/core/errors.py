"""Stable public API errors and their FastAPI translation."""

import logging
from typing import Literal

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("glidelingo.request")


type ErrorCode = Literal[
    "dependency_unavailable",
    "authentication_unavailable",
    "internal_error",
    "lesson_context_not_found",
    "lesson_tutor_unavailable",
    "lesson_tutor_timeout",
    "lesson_tutor_conflict",
    "lesson_tutor_limited",
    "pro_required",
    "billing_unavailable",
]


class ErrorDetail(BaseModel):
    code: ErrorCode
    message: str
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class DependencyUnavailableError(Exception):
    """A required dependency cannot currently serve requests."""


class AuthenticationUnavailableError(Exception):
    """Server-side authentication is not configured or operational."""


class LessonContextNotFoundError(Exception):
    """The requested authored lesson context is unavailable."""


class LessonTutorUnavailableError(Exception):
    """The tutor is disabled or its provider cannot serve the request."""


class LessonTutorNotSentError(LessonTutorUnavailableError):
    """The private request definitively did not leave the public API."""


class LessonTutorTimeoutError(Exception):
    """The tutor exceeded its bounded request deadline."""


class LessonTutorConflictError(Exception):
    """An idempotency key conflicts or has an ambiguous prior outcome."""


class LessonTutorLimitedError(Exception):
    """A per-actor or global tutor safety limit rejected the request."""


class ProRequiredError(Exception):
    """The authenticated principal lacks fresh server-verified Pro access."""


class BillingUnavailableError(Exception):
    """Billing cannot currently establish a fresh authorization decision."""


def error_response(
    *,
    status_code: int,
    code: ErrorCode,
    message: str,
    request_id: str,
) -> JSONResponse:
    payload = ErrorResponse(error=ErrorDetail(code=code, message=message, request_id=request_id))
    return JSONResponse(status_code=status_code, content=payload.model_dump())


async def dependency_unavailable_handler(request: Request, _error: Exception) -> JSONResponse:
    return error_response(
        status_code=503,
        code="dependency_unavailable",
        message="A required dependency is unavailable.",
        request_id=request.state.request_id,
    )


async def authentication_unavailable_handler(request: Request, _error: Exception) -> JSONResponse:
    return error_response(
        status_code=503,
        code="authentication_unavailable",
        message="Authentication is unavailable.",
        request_id=request.state.request_id,
    )


async def lesson_context_not_found_handler(request: Request, _error: Exception) -> JSONResponse:
    return error_response(
        status_code=404,
        code="lesson_context_not_found",
        message="The lesson context could not be found.",
        request_id=request.state.request_id,
    )


async def lesson_tutor_unavailable_handler(request: Request, _error: Exception) -> JSONResponse:
    return error_response(
        status_code=503,
        code="lesson_tutor_unavailable",
        message="The lesson tutor is unavailable.",
        request_id=request.state.request_id,
    )


async def lesson_tutor_timeout_handler(request: Request, _error: Exception) -> JSONResponse:
    return error_response(
        status_code=504,
        code="lesson_tutor_timeout",
        message="The lesson tutor took too long to respond.",
        request_id=request.state.request_id,
    )


async def lesson_tutor_conflict_handler(request: Request, _error: Exception) -> JSONResponse:
    return error_response(
        status_code=409,
        code="lesson_tutor_conflict",
        message="This tutor turn conflicts with an earlier request.",
        request_id=request.state.request_id,
    )


async def lesson_tutor_limited_handler(request: Request, _error: Exception) -> JSONResponse:
    return error_response(
        status_code=429,
        code="lesson_tutor_limited",
        message="The lesson tutor limit has been reached. Try again later.",
        request_id=request.state.request_id,
    )


async def pro_required_handler(request: Request, _error: Exception) -> JSONResponse:
    return error_response(
        status_code=403,
        code="pro_required",
        message="An active Pro subscription is required.",
        request_id=request.state.request_id,
    )


async def billing_unavailable_handler(request: Request, _error: Exception) -> JSONResponse:
    return error_response(
        status_code=503,
        code="billing_unavailable",
        message="Billing authorization is unavailable.",
        request_id=request.state.request_id,
    )


class InternalErrorMiddleware:
    """Translate unexpected endpoint failures before CORS decorates the response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def track_response_start(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, track_response_start)
        except Exception as error:
            if response_started:
                raise
            request_id = scope["state"]["request_id"]
            logger.error(
                "unhandled request failure",
                extra={"request_id": request_id, "error_type": type(error).__name__},
            )
            response = error_response(
                status_code=500,
                code="internal_error",
                message="An unexpected error occurred.",
                request_id=request_id,
            )
            await response(scope, receive, send)
