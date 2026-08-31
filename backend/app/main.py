"""FastAPI application composition root."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.core.config import Settings
from app.core.errors import (
    DependencyUnavailableError,
    InternalErrorMiddleware,
    LessonContextNotFoundError,
    LessonTutorTimeoutError,
    LessonTutorUnavailableError,
    dependency_unavailable_handler,
    lesson_context_not_found_handler,
    lesson_tutor_timeout_handler,
    lesson_tutor_unavailable_handler,
)
from app.core.logging import configure_logging
from app.core.request_id import REQUEST_ID_HEADER, RequestIdMiddleware
from app.db.engine import create_database_engine, create_database_probe
from app.integrations.openai.lesson_tutor_agent import OpenAILessonTutorAgent
from app.modules.lesson_tutor.router import router as lesson_tutor_router
from app.modules.lesson_tutor.service import LessonTutorService


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    database_engine = create_database_engine(settings)
    lesson_tutor_agent = (
        OpenAILessonTutorAgent(
            api_key=settings.openai_api_key.get_secret_value(),
            model=settings.openai_model,
        )
        if settings.lesson_tutor_enabled and settings.openai_api_key is not None
        else None
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        database_engine.dispose()

    application = FastAPI(
        title="GlideLingo API",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.database_probe = create_database_probe(database_engine)
    application.state.lesson_tutor_service = LessonTutorService(
        enabled=settings.lesson_tutor_enabled,
        agent=lesson_tutor_agent,
    )
    application.add_exception_handler(
        DependencyUnavailableError,
        dependency_unavailable_handler,
    )
    application.add_exception_handler(
        LessonContextNotFoundError,
        lesson_context_not_found_handler,
    )
    application.add_exception_handler(
        LessonTutorUnavailableError,
        lesson_tutor_unavailable_handler,
    )
    application.add_exception_handler(
        LessonTutorTimeoutError,
        lesson_tutor_timeout_handler,
    )
    application.add_middleware(InternalErrorMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.normalized_cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Accept", "Content-Type"],
        expose_headers=[REQUEST_ID_HEADER],
    )
    application.add_middleware(RequestIdMiddleware)
    application.include_router(health_router)
    application.include_router(lesson_tutor_router)
    return application


app = create_app()
