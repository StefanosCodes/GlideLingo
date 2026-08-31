"""Composition root for the IAM-private tutor service."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.health import router as health_router
from app.core.config import Settings
from app.core.errors import (
    LessonContextNotFoundError,
    LessonTutorTimeoutError,
    LessonTutorUnavailableError,
    context_not_found,
    tutor_timeout,
    tutor_unavailable,
)
from app.core.request_id import RequestIdMiddleware
from app.integrations.openai.lesson_tutor_agent import OpenAILessonTutorAgent
from app.modules.lesson_tutor.router import router as lesson_tutor_router
from app.modules.lesson_tutor.service import LessonTutorService


def create_app(
    settings: Settings | None = None,
    *,
    lesson_tutor_service: LessonTutorService | None = None,
) -> FastAPI:
    settings = settings or Settings()
    lesson_tutor_agent = (
        OpenAILessonTutorAgent(
            api_key=settings.openai_api_key.get_secret_value(),
            model=settings.openai_model,
            provider_timeout_seconds=settings.model_deadline_seconds,
        )
        if lesson_tutor_service is None and settings.enabled and settings.openai_api_key is not None
        else None
    )

    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            if lesson_tutor_agent is not None:
                await lesson_tutor_agent.close()

    application = FastAPI(
        title="GlideLingo Private Lesson Tutor",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.lesson_tutor_service = lesson_tutor_service or LessonTutorService(
        enabled=settings.enabled,
        agent=lesson_tutor_agent,
        content_root=settings.content_root,
        deadline_seconds=settings.service_deadline_seconds,
    )
    application.add_exception_handler(LessonContextNotFoundError, context_not_found)
    application.add_exception_handler(LessonTutorUnavailableError, tutor_unavailable)
    application.add_exception_handler(LessonTutorTimeoutError, tutor_timeout)
    application.add_middleware(RequestIdMiddleware)
    application.include_router(health_router)
    application.include_router(lesson_tutor_router)
    return application


app = create_app()
