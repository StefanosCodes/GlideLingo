"""FastAPI application composition root."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.auth.clerk import ClerkTokenVerifier
from app.auth.router import router as auth_router
from app.core.config import Settings
from app.core.errors import (
    AuthenticationUnavailableError,
    BillingUnavailableError,
    DependencyUnavailableError,
    InternalErrorMiddleware,
    LessonContextNotFoundError,
    LessonTutorConflictError,
    LessonTutorLimitedError,
    LessonTutorTimeoutError,
    LessonTutorUnavailableError,
    ProRequiredError,
    VoiceSessionConflictError,
    VoiceSessionNotFoundError,
    VoiceSessionTimeoutError,
    VoiceSessionUnavailableError,
    authentication_unavailable_handler,
    billing_unavailable_handler,
    dependency_unavailable_handler,
    lesson_context_not_found_handler,
    lesson_tutor_conflict_handler,
    lesson_tutor_limited_handler,
    lesson_tutor_timeout_handler,
    lesson_tutor_unavailable_handler,
    pro_required_handler,
    voice_session_conflict_handler,
    voice_session_not_found_handler,
    voice_session_timeout_handler,
    voice_session_unavailable_handler,
)
from app.core.logging import configure_logging
from app.core.request_id import REQUEST_ID_HEADER, RequestIdMiddleware
from app.db.engine import create_database_engine, create_database_probe
from app.integrations.lesson_tutor.client import GoogleIdentityTokenProvider, LessonTutorHttpClient
from app.integrations.revenuecat.client import RevenueCatHttpClient
from app.integrations.voice_realtime.client import VoiceRealtimeHttpClient
from app.modules.billing.repository import PostgresEntitlementRepository
from app.modules.billing.router import router as billing_router
from app.modules.billing.service import BillingService
from app.modules.lesson_tutor.guard import GuardLimits, PostgresLessonTutorGuard
from app.modules.lesson_tutor.router import router as lesson_tutor_router
from app.modules.lesson_tutor.service import LessonTutorService
from app.modules.voice_sessions.router import router as voice_sessions_router
from app.modules.voice_sessions.service import VoiceSessionService


def create_app(
    settings: Settings | None = None,
    *,
    lesson_tutor_service: LessonTutorService | None = None,
    billing_service: BillingService | None = None,
    voice_session_service: VoiceSessionService | None = None,
) -> FastAPI:
    settings = settings or Settings()
    configure_logging(settings.log_level)
    database_engine = create_database_engine(settings)
    lesson_tutor_gateway = (
        LessonTutorHttpClient(
            base_url=settings.lesson_tutor_service_url,
            token_provider=GoogleIdentityTokenProvider(
                audience=settings.lesson_tutor_service_audience
            ),
            timeout_seconds=settings.lesson_tutor_service_timeout_seconds,
        )
        if lesson_tutor_service is None
        and settings.lesson_tutor_enabled
        and settings.lesson_tutor_service_url is not None
        and settings.lesson_tutor_service_audience is not None
        else None
    )
    clerk_configuration = settings.clerk_configuration
    revenuecat_provider = (
        RevenueCatHttpClient(
            api_key=settings.revenuecat_api_key.get_secret_value(),
            timeout_seconds=settings.revenuecat_api_timeout_seconds,
        )
        if billing_service is None
        and settings.revenuecat_enabled
        and settings.revenuecat_api_key is not None
        else None
    )
    voice_gateway = (
        VoiceRealtimeHttpClient(
            base_url=settings.voice_service_url,
            token_provider=GoogleIdentityTokenProvider(audience=settings.voice_service_audience),
            timeout_seconds=settings.voice_service_timeout_seconds,
        )
        if voice_session_service is None
        and settings.voice_enabled
        and settings.voice_service_url is not None
        and settings.voice_service_audience is not None
        else None
    )
    voice_service = voice_session_service or VoiceSessionService(
        enabled=settings.voice_enabled,
        gateway=voice_gateway,
        pseudonym_key=(
            settings.voice_pseudonym_key.get_secret_value().encode()
            if settings.voice_pseudonym_key is not None
            else None
        ),
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            try:
                if lesson_tutor_gateway is not None:
                    await lesson_tutor_gateway.close()
            finally:
                try:
                    if revenuecat_provider is not None:
                        await revenuecat_provider.close()
                finally:
                    try:
                        await voice_service.close()
                    finally:
                        database_engine.dispose()

    application = FastAPI(
        title="GlideLingo API",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.database_probe = create_database_probe(database_engine)
    application.state.revenuecat_webhook_max_body_bytes = settings.revenuecat_webhook_max_body_bytes
    application.state.billing_service = billing_service or BillingService(
        enabled=settings.revenuecat_enabled,
        repository=PostgresEntitlementRepository(engine=database_engine),
        provider=revenuecat_provider,
        pseudonym_key=(
            settings.revenuecat_pseudonym_key.get_secret_value().encode()
            if settings.revenuecat_pseudonym_key is not None
            else None
        ),
        environment=settings.revenuecat_environment,
        freshness_seconds=settings.revenuecat_entitlement_freshness_seconds,
        webhook_authorization=(
            settings.revenuecat_webhook_authorization.get_secret_value()
            if settings.revenuecat_webhook_authorization is not None
            else None
        ),
        webhook_signing_secret=(
            settings.revenuecat_webhook_signing_secret.get_secret_value()
            if settings.revenuecat_webhook_signing_secret is not None
            else None
        ),
        webhook_signature_tolerance_seconds=(
            settings.revenuecat_webhook_signature_tolerance_seconds
        ),
    )
    application.state.lesson_tutor_service = lesson_tutor_service or LessonTutorService(
        enabled=settings.lesson_tutor_enabled,
        gateway=lesson_tutor_gateway,
        guard=PostgresLessonTutorGuard(
            engine=database_engine,
            limits=GuardLimits(
                burst=settings.lesson_tutor_burst_limit,
                burst_window_seconds=settings.lesson_tutor_burst_window_seconds,
                concurrency=settings.lesson_tutor_concurrency_limit,
                daily=settings.lesson_tutor_daily_limit,
                global_daily=settings.lesson_tutor_global_daily_turn_limit,
            ),
        ),
        pseudonym_key=(
            settings.lesson_tutor_pseudonym_key.get_secret_value().encode()
            if settings.lesson_tutor_pseudonym_key is not None
            else None
        ),
        operation_deadline_seconds=settings.lesson_tutor_operation_deadline_seconds,
    )
    application.state.voice_session_service = voice_service
    application.state.clerk_token_verifier = (
        ClerkTokenVerifier(
            issuer=clerk_configuration[0],
            jwks_url=clerk_configuration[1],
            audience=clerk_configuration[2],
            authorized_parties=clerk_configuration[3],
        )
        if clerk_configuration is not None
        else None
    )
    application.add_exception_handler(
        DependencyUnavailableError,
        dependency_unavailable_handler,
    )
    application.add_exception_handler(
        AuthenticationUnavailableError,
        authentication_unavailable_handler,
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
    application.add_exception_handler(LessonTutorConflictError, lesson_tutor_conflict_handler)
    application.add_exception_handler(LessonTutorLimitedError, lesson_tutor_limited_handler)
    application.add_exception_handler(ProRequiredError, pro_required_handler)
    application.add_exception_handler(BillingUnavailableError, billing_unavailable_handler)
    application.add_exception_handler(
        VoiceSessionUnavailableError, voice_session_unavailable_handler
    )
    application.add_exception_handler(VoiceSessionTimeoutError, voice_session_timeout_handler)
    application.add_exception_handler(VoiceSessionConflictError, voice_session_conflict_handler)
    application.add_exception_handler(VoiceSessionNotFoundError, voice_session_not_found_handler)
    application.add_middleware(InternalErrorMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.normalized_cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Accept", "Authorization", "Content-Type", "Idempotency-Key"],
        expose_headers=[REQUEST_ID_HEADER],
    )
    application.add_middleware(RequestIdMiddleware)
    application.include_router(health_router)
    application.include_router(lesson_tutor_router)
    application.include_router(billing_router)
    application.include_router(auth_router)
    application.include_router(voice_sessions_router)
    return application


app = create_app()
