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
    HumanTutorMarketplaceForbiddenError,
    HumanTutorMarketplaceUnavailableError,
    InternalErrorMiddleware,
    LessonContextNotFoundError,
    LessonTutorConflictError,
    LessonTutorLimitedError,
    LessonTutorTimeoutError,
    LessonTutorUnavailableError,
    MarketplaceMessageLimitedError,
    ProRequiredError,
    TutorApplicationConflictError,
    TutorApplicationNotFoundError,
    authentication_unavailable_handler,
    billing_unavailable_handler,
    dependency_unavailable_handler,
    human_tutor_marketplace_forbidden_handler,
    human_tutor_marketplace_unavailable_handler,
    lesson_context_not_found_handler,
    lesson_tutor_conflict_handler,
    lesson_tutor_limited_handler,
    lesson_tutor_timeout_handler,
    lesson_tutor_unavailable_handler,
    marketplace_message_limited_handler,
    pro_required_handler,
    tutor_application_conflict_handler,
    tutor_application_not_found_handler,
)
from app.core.logging import configure_logging
from app.core.request_id import REQUEST_ID_HEADER, RequestIdMiddleware
from app.db.engine import create_database_engine, create_database_probe
from app.integrations.lesson_tutor.client import GoogleIdentityTokenProvider, LessonTutorHttpClient
from app.integrations.revenuecat.client import RevenueCatHttpClient
from app.modules.billing.repository import PostgresEntitlementRepository
from app.modules.billing.router import router as billing_router
from app.modules.billing.service import BillingService
from app.modules.human_tutor_marketplace.booking import (
    BookingService,
    PostgresBookingRepository,
    StripeHttpMarketplaceProvider,
)
from app.modules.human_tutor_marketplace.calendar import (
    CalendarService,
    CalendarTokenCipher,
    GoogleCalendarHttpAdapter,
    PostgresCalendarRepository,
    decode_calendar_encryption_key,
)
from app.modules.human_tutor_marketplace.discovery import (
    MarketplaceDiscoveryService,
    PostgresDiscoveryRepository,
)
from app.modules.human_tutor_marketplace.learning_bridge import (
    LearningBridgeService,
    PostgresLearningBridgeRepository,
)
from app.modules.human_tutor_marketplace.lifecycle import (
    LifecycleService,
    PostgresLifecycleRepository,
)
from app.modules.human_tutor_marketplace.messaging import (
    MessagingService,
    PostgresMessagingRepository,
)
from app.modules.human_tutor_marketplace.repository import (
    PostgresTutorApplicationRepository,
)
from app.modules.human_tutor_marketplace.router import (
    router as human_tutor_marketplace_router,
)
from app.modules.human_tutor_marketplace.service import (
    HumanTutorMarketplaceService,
)
from app.modules.lesson_tutor.guard import GuardLimits, PostgresLessonTutorGuard
from app.modules.lesson_tutor.router import router as lesson_tutor_router
from app.modules.lesson_tutor.service import LessonTutorService


def create_app(
    settings: Settings | None = None,
    *,
    lesson_tutor_service: LessonTutorService | None = None,
    billing_service: BillingService | None = None,
    human_tutor_marketplace_service: HumanTutorMarketplaceService | None = None,
    marketplace_discovery_service: MarketplaceDiscoveryService | None = None,
    marketplace_calendar_service: CalendarService | None = None,
    marketplace_messaging_service: MessagingService | None = None,
    marketplace_booking_service: BookingService | None = None,
    marketplace_lifecycle_service: LifecycleService | None = None,
    marketplace_learning_bridge_service: LearningBridgeService | None = None,
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
    marketplace_service = human_tutor_marketplace_service
    if marketplace_service is None and settings.human_tutor_marketplace_enabled:
        marketplace_service = HumanTutorMarketplaceService(
            enabled=True,
            repository=PostgresTutorApplicationRepository(engine=database_engine),
            pseudonym_key=(
                settings.human_tutor_marketplace_pseudonym_key.get_secret_value().encode()
                if settings.human_tutor_marketplace_pseudonym_key is not None
                else None
            ),
            actor_allowlist=settings.human_tutor_marketplace_actor_allowlist,
        )
    calendar_repository = PostgresCalendarRepository(engine=database_engine)
    calendar_provider = (
        GoogleCalendarHttpAdapter(
            client_id=settings.human_tutor_google_calendar_client_id,
            client_secret=settings.human_tutor_google_calendar_client_secret.get_secret_value(),
            timeout_seconds=settings.human_tutor_google_calendar_timeout_seconds,
        )
        if marketplace_calendar_service is None
        and settings.human_tutor_google_calendar_enabled
        and settings.human_tutor_google_calendar_client_id is not None
        and settings.human_tutor_google_calendar_client_secret is not None
        else None
    )
    calendar_runtime = marketplace_calendar_service or CalendarService(
        enabled=settings.human_tutor_google_calendar_enabled,
        repository=calendar_repository,
        provider=calendar_provider,
        cipher=(
            CalendarTokenCipher(
                key=decode_calendar_encryption_key(
                    settings.human_tutor_google_calendar_token_key.get_secret_value()
                )
            )
            if settings.human_tutor_google_calendar_enabled
            and settings.human_tutor_google_calendar_token_key is not None
            else None
        ),
        state_key=(
            settings.human_tutor_google_calendar_state_key.get_secret_value().encode()
            if settings.human_tutor_google_calendar_state_key is not None
            else None
        ),
        pseudonym_key=(
            settings.human_tutor_marketplace_pseudonym_key.get_secret_value().encode()
            if settings.human_tutor_marketplace_pseudonym_key is not None
            else None
        ),
        actor_allowlist=settings.human_tutor_marketplace_actor_allowlist,
        redirect_allowlist=settings.human_tutor_google_calendar_redirect_allowlist,
    )
    messaging_runtime = marketplace_messaging_service or MessagingService(
        enabled=settings.human_tutor_messaging_enabled,
        repository=PostgresMessagingRepository(engine=database_engine),
        pseudonym_key=(
            settings.human_tutor_marketplace_pseudonym_key.get_secret_value().encode()
            if settings.human_tutor_marketplace_pseudonym_key is not None
            else None
        ),
        actor_allowlist=settings.human_tutor_marketplace_actor_allowlist,
        retention_days=settings.human_tutor_message_retention_days,
        accepting_new_conversations=settings.human_tutor_marketplace_acquisition_enabled,
    )
    discovery_service = marketplace_discovery_service
    if discovery_service is None and settings.human_tutor_marketplace_enabled:
        discovery_repository = PostgresDiscoveryRepository(engine=database_engine)
        discovery_service = MarketplaceDiscoveryService(
            repository=discovery_repository,
            calendar_busy_reader=(
                calendar_repository if settings.human_tutor_google_calendar_enabled else None
            ),
            booking_busy_reader=(
                discovery_repository if settings.human_tutor_commerce_enabled else None
            ),
            pseudonym_key=(
                settings.human_tutor_marketplace_pseudonym_key.get_secret_value().encode()
                if settings.human_tutor_marketplace_pseudonym_key is not None
                else None
            ),
            actor_allowlist=settings.human_tutor_marketplace_actor_allowlist,
            acquisition_enabled=settings.human_tutor_marketplace_acquisition_enabled,
        )
    stripe_marketplace_provider = (
        StripeHttpMarketplaceProvider(
            secret_key=settings.human_tutor_stripe_secret_key.get_secret_value(),
            api_version=settings.human_tutor_stripe_api_version,
            timeout_seconds=settings.human_tutor_stripe_timeout_seconds,
        )
        if marketplace_booking_service is None
        and settings.human_tutor_commerce_enabled
        and settings.human_tutor_stripe_secret_key is not None
        else None
    )
    assert discovery_service is not None or not settings.human_tutor_marketplace_enabled
    booking_runtime = marketplace_booking_service or BookingService(
        enabled=settings.human_tutor_commerce_enabled,
        repository=PostgresBookingRepository(engine=database_engine),
        provider=stripe_marketplace_provider,
        discovery=discovery_service
        or MarketplaceDiscoveryService(
            repository=PostgresDiscoveryRepository(engine=database_engine),
            pseudonym_key=None,
            actor_allowlist=(),
        ),
        pseudonym_key=(
            settings.human_tutor_marketplace_pseudonym_key.get_secret_value().encode()
            if settings.human_tutor_marketplace_pseudonym_key is not None
            else None
        ),
        actor_allowlist=settings.human_tutor_marketplace_actor_allowlist,
        environment=settings.human_tutor_stripe_environment,
        platform_account_id=settings.human_tutor_stripe_platform_account_id,
        connect_refresh_url=settings.human_tutor_stripe_connect_refresh_url,
        connect_return_url=settings.human_tutor_stripe_connect_return_url,
        checkout_success_url=settings.human_tutor_checkout_success_url,
        checkout_cancel_url=settings.human_tutor_checkout_cancel_url,
        meeting_hosts=settings.human_tutor_approved_meeting_hosts,
        hold_seconds=settings.human_tutor_booking_hold_seconds,
        accepting_new_bookings=settings.human_tutor_marketplace_acquisition_enabled,
    )
    lifecycle_runtime = marketplace_lifecycle_service or LifecycleService(
        enabled=settings.human_tutor_commerce_enabled,
        repository=PostgresLifecycleRepository(engine=database_engine),
        booking_service=booking_runtime,
        provider=stripe_marketplace_provider,
        pseudonym_key=(
            settings.human_tutor_marketplace_pseudonym_key.get_secret_value().encode()
            if settings.human_tutor_marketplace_pseudonym_key is not None
            else None
        ),
        actor_allowlist=settings.human_tutor_marketplace_actor_allowlist,
    )
    learning_bridge_runtime = marketplace_learning_bridge_service or LearningBridgeService(
        enabled=settings.human_tutor_learning_bridge_enabled,
        repository=PostgresLearningBridgeRepository(engine=database_engine),
        pseudonym_key=(
            settings.human_tutor_marketplace_pseudonym_key.get_secret_value().encode()
            if settings.human_tutor_marketplace_pseudonym_key is not None
            else None
        ),
        actor_allowlist=settings.human_tutor_marketplace_actor_allowlist,
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
                        if calendar_provider is not None:
                            await calendar_provider.close()
                    finally:
                        try:
                            if stripe_marketplace_provider is not None:
                                await stripe_marketplace_provider.close()
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
    if marketplace_service is not None:
        application.state.human_tutor_marketplace_service = marketplace_service
    if discovery_service is not None:
        application.state.marketplace_discovery_service = discovery_service
    if marketplace_service is not None:
        application.state.marketplace_calendar_service = calendar_runtime
    application.state.marketplace_messaging_service = messaging_runtime
    application.state.marketplace_booking_service = booking_runtime
    application.state.marketplace_lifecycle_service = lifecycle_runtime
    application.state.marketplace_learning_bridge_service = learning_bridge_runtime
    application.state.marketplace_stripe_webhook_max_body_bytes = (
        settings.human_tutor_stripe_webhook_max_body_bytes
    )
    application.state.marketplace_stripe_webhook_secret = (
        settings.human_tutor_stripe_webhook_secret.get_secret_value().encode()
        if settings.human_tutor_stripe_webhook_secret is not None
        else None
    )
    application.state.marketplace_stripe_signature_tolerance_seconds = (
        settings.human_tutor_stripe_signature_tolerance_seconds
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
    application.add_exception_handler(
        MarketplaceMessageLimitedError, marketplace_message_limited_handler
    )
    application.add_exception_handler(ProRequiredError, pro_required_handler)
    application.add_exception_handler(BillingUnavailableError, billing_unavailable_handler)
    application.add_exception_handler(
        HumanTutorMarketplaceUnavailableError,
        human_tutor_marketplace_unavailable_handler,
    )
    application.add_exception_handler(
        HumanTutorMarketplaceForbiddenError,
        human_tutor_marketplace_forbidden_handler,
    )
    application.add_exception_handler(
        TutorApplicationNotFoundError,
        tutor_application_not_found_handler,
    )
    application.add_exception_handler(
        TutorApplicationConflictError,
        tutor_application_conflict_handler,
    )
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
    if marketplace_service is not None:
        application.include_router(human_tutor_marketplace_router)
    return application


app = create_app()
