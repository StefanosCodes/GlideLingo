"""Authenticated tutor application and capability-scoped review endpoints."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status

from app.auth.clerk import CurrentClerkPrincipal
from app.core.errors import ErrorResponse
from app.modules.human_tutor_marketplace.booking import BookingService
from app.modules.human_tutor_marketplace.calendar import CalendarService
from app.modules.human_tutor_marketplace.discovery import MarketplaceDiscoveryService
from app.modules.human_tutor_marketplace.learning_bridge import (
    FollowUpRecommendation,
    LearningBridgeService,
    LearningBrief,
)
from app.modules.human_tutor_marketplace.lifecycle import LifecycleService
from app.modules.human_tutor_marketplace.messaging import MessagingService
from app.modules.human_tutor_marketplace.schemas import (
    ApplicationVersionRequest,
    BookingListResponse,
    BookingResponse,
    BookingReviewListResponse,
    BookingReviewResponse,
    BookingTransitionRequest,
    CalendarConnectionResponse,
    CalendarOAuthCallbackRequest,
    CalendarOAuthStartRequest,
    CalendarOAuthStartResponse,
    ChangeTutorStatusRequest,
    ConversationListResponse,
    ConversationResponse,
    CreateBookingCheckoutRequest,
    CreateBookingReviewRequest,
    CreateConversationRequest,
    CreateMessageReportRequest,
    CreateTutorApplicationRequest,
    DecideTutorApplicationRequest,
    DecideTutorCredentialRequest,
    LearningContextResponse,
    ManualAvailabilityResponse,
    MarketplaceActionResponse,
    MarketplaceOperatorCapabilitiesResponse,
    MarketplaceStripeWebhookResponse,
    MessageNotificationPreferenceRequest,
    MessageNotificationPreferenceResponse,
    MessagePageResponse,
    MessageReportListResponse,
    MessageReportResponse,
    MessageResponse,
    ModerateBookingReviewRequest,
    PublicTutorResponse,
    RecoverMoneyOperationRequest,
    ReplaceManualAvailabilityRequest,
    ResolveMessageReportRequest,
    SaveLearningContextRequest,
    SaveTutorCredentialRequest,
    SaveTutorFollowUpRequest,
    SaveTutorMeetingUrlRequest,
    SaveTutorOfferingRequest,
    SendMessageRequest,
    SetTutorFavoriteRequest,
    SetTutorPublicationRequest,
    TutorApplicationQueue,
    TutorApplicationResponse,
    TutorConnectOnboardingResponse,
    TutorConnectStatusResponse,
    TutorEarningsResponse,
    TutorProfileResponse,
    TutorSearchResponse,
    TutorSlotsResponse,
    UpdateTutorApplicationDraftRequest,
    UpdateTutorProfileDraftRequest,
)
from app.modules.human_tutor_marketplace.service import HumanTutorMarketplaceService

router = APIRouter(prefix="/v1", tags=["human-tutor-marketplace"])


def get_human_tutor_marketplace_service(request: Request) -> HumanTutorMarketplaceService:
    return cast(
        HumanTutorMarketplaceService,
        request.app.state.human_tutor_marketplace_service,
    )


HumanTutorMarketplaceServiceDependency = Annotated[
    HumanTutorMarketplaceService,
    Depends(get_human_tutor_marketplace_service),
]


@router.get(
    "/marketplace/operator-capabilities",
    operation_id="get_marketplace_operator_capabilities",
    response_model=MarketplaceOperatorCapabilitiesResponse,
)
async def get_marketplace_operator_capabilities(
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> MarketplaceOperatorCapabilitiesResponse:
    capabilities = await service.operator_capabilities(principal=principal)
    return MarketplaceOperatorCapabilitiesResponse(capabilities=list(capabilities))


def get_marketplace_discovery_service(request: Request) -> MarketplaceDiscoveryService:
    return cast(MarketplaceDiscoveryService, request.app.state.marketplace_discovery_service)


MarketplaceDiscoveryServiceDependency = Annotated[
    MarketplaceDiscoveryService,
    Depends(get_marketplace_discovery_service),
]


def get_marketplace_calendar_service(request: Request) -> CalendarService:
    return cast(CalendarService, request.app.state.marketplace_calendar_service)


MarketplaceCalendarServiceDependency = Annotated[
    CalendarService,
    Depends(get_marketplace_calendar_service),
]


def get_marketplace_messaging_service(request: Request) -> MessagingService:
    return cast(MessagingService, request.app.state.marketplace_messaging_service)


MarketplaceMessagingServiceDependency = Annotated[
    MessagingService,
    Depends(get_marketplace_messaging_service),
]


def get_marketplace_booking_service(request: Request) -> BookingService:
    return cast(BookingService, request.app.state.marketplace_booking_service)


MarketplaceBookingServiceDependency = Annotated[
    BookingService,
    Depends(get_marketplace_booking_service),
]


def get_marketplace_lifecycle_service(request: Request) -> LifecycleService:
    return cast(LifecycleService, request.app.state.marketplace_lifecycle_service)


MarketplaceLifecycleServiceDependency = Annotated[
    LifecycleService,
    Depends(get_marketplace_lifecycle_service),
]


def get_marketplace_learning_bridge_service(request: Request) -> LearningBridgeService:
    return cast(LearningBridgeService, request.app.state.marketplace_learning_bridge_service)


MarketplaceLearningBridgeServiceDependency = Annotated[
    LearningBridgeService,
    Depends(get_marketplace_learning_bridge_service),
]


@router.get(
    "/tutor-connect",
    operation_id="get_tutor_connect_status",
    response_model=TutorConnectStatusResponse,
)
async def get_tutor_connect_status(
    principal: CurrentClerkPrincipal,
    service: MarketplaceBookingServiceDependency,
    refresh: bool = False,
) -> TutorConnectStatusResponse:
    account = await service.connect_status(principal=principal, refresh=refresh)
    status_value = (
        "not_started"
        if account.provider_account_id is None
        else "ready"
        if account.details_submitted and account.charges_enabled and account.payouts_enabled
        else "restricted"
        if account.details_submitted
        else "incomplete"
    )
    return TutorConnectStatusResponse(
        status=cast(Literal["not_started", "incomplete", "ready", "restricted"], status_value),
        requirements_due=account.requirements_due,
    )


@router.post(
    "/tutor-connect/onboarding",
    operation_id="create_tutor_connect_onboarding_link",
    response_model=TutorConnectOnboardingResponse,
)
async def create_tutor_connect_onboarding_link(
    principal: CurrentClerkPrincipal,
    service: MarketplaceBookingServiceDependency,
) -> TutorConnectOnboardingResponse:
    link = await service.onboarding_link(principal=principal)
    return TutorConnectOnboardingResponse(url=link.url, expires_at=link.expires_at)


@router.post(
    "/tutor-meeting",
    operation_id="save_tutor_meeting_url",
    response_model=MarketplaceActionResponse,
)
async def save_tutor_meeting_url(
    request: SaveTutorMeetingUrlRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceBookingServiceDependency,
) -> MarketplaceActionResponse:
    await service.save_meeting_url(principal=principal, url=request.url)
    return MarketplaceActionResponse()


@router.post(
    "/bookings/checkout",
    operation_id="create_booking_checkout",
    response_model=BookingResponse,
)
async def create_booking_checkout(
    request: CreateBookingCheckoutRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceBookingServiceDependency,
) -> BookingResponse:
    booking = await service.create_checkout(
        principal=principal,
        tutor_id=request.tutor_id,
        offering_id=request.offering_id,
        starts_at=request.starts_at,
        idempotency_key=request.idempotency_key,
    )
    return BookingResponse.model_validate(booking, from_attributes=True)


@router.get("/bookings", operation_id="list_bookings", response_model=BookingListResponse)
async def list_bookings(
    principal: CurrentClerkPrincipal,
    service: MarketplaceBookingServiceDependency,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> BookingListResponse:
    bookings, next_cursor = await service.list_bookings(
        principal=principal, cursor=cursor, limit=limit
    )
    return BookingListResponse(
        items=[BookingResponse.model_validate(item, from_attributes=True) for item in bookings],
        next_cursor=next_cursor,
    )


@router.get("/bookings/{booking_id}", operation_id="get_booking", response_model=BookingResponse)
async def get_booking(
    booking_id: UUID,
    principal: CurrentClerkPrincipal,
    service: MarketplaceBookingServiceDependency,
) -> BookingResponse:
    booking = await service.get_booking(principal=principal, booking_id=booking_id)
    return BookingResponse.model_validate(booking, from_attributes=True)


@router.post(
    "/bookings/{booking_id}/reconcile",
    operation_id="reconcile_booking_payment",
    response_model=BookingResponse,
)
async def reconcile_booking_payment(
    booking_id: UUID,
    principal: CurrentClerkPrincipal,
    service: MarketplaceBookingServiceDependency,
) -> BookingResponse:
    booking = await service.reconcile(principal=principal, booking_id=booking_id)
    return BookingResponse.model_validate(booking, from_attributes=True)


@router.post(
    "/bookings/{booking_id}/transition",
    operation_id="transition_marketplace_booking",
    response_model=BookingResponse,
)
async def transition_marketplace_booking(
    booking_id: UUID,
    request: BookingTransitionRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceLifecycleServiceDependency,
) -> BookingResponse:
    booking = await service.transition(
        principal=principal,
        booking_id=booking_id,
        action=request.action,
        reason=request.reason,
        new_starts_at=request.new_starts_at,
        operation_id=request.operation_id,
    )
    return BookingResponse.model_validate(booking, from_attributes=True)


@router.post(
    "/bookings/{booking_id}/review",
    operation_id="create_marketplace_booking_review",
    response_model=BookingReviewResponse,
)
async def create_marketplace_booking_review(
    booking_id: UUID,
    request: CreateBookingReviewRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceLifecycleServiceDependency,
) -> BookingReviewResponse:
    review = await service.create_review(
        principal=principal,
        booking_id=booking_id,
        rating=request.rating,
        body=request.body,
    )
    return BookingReviewResponse.model_validate(review, from_attributes=True)


@router.get(
    "/tutor-earnings",
    operation_id="get_marketplace_tutor_earnings",
    response_model=TutorEarningsResponse,
)
async def get_marketplace_tutor_earnings(
    principal: CurrentClerkPrincipal,
    service: MarketplaceLifecycleServiceDependency,
) -> TutorEarningsResponse:
    earnings = await service.earnings(principal=principal)
    return TutorEarningsResponse.model_validate(earnings, from_attributes=True)


@router.post(
    "/marketplace-operations/bookings/{booking_id}/money-recovery",
    operation_id="recover_marketplace_money_operation",
    response_model=BookingResponse,
)
async def recover_marketplace_money_operation(
    booking_id: UUID,
    request: RecoverMoneyOperationRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceLifecycleServiceDependency,
) -> BookingResponse:
    booking = await service.recover_money(
        principal=principal,
        booking_id=booking_id,
        reason=request.reason,
    )
    return BookingResponse.model_validate(booking, from_attributes=True)


@router.post(
    "/marketplace-operations/bookings/{booking_id}/reconciliation-recovery",
    operation_id="recover_marketplace_payment_reconciliation",
    response_model=BookingResponse,
)
async def recover_marketplace_payment_reconciliation(
    booking_id: UUID,
    request: RecoverMoneyOperationRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceBookingServiceDependency,
) -> BookingResponse:
    booking = await service.recover_reconciliation(
        principal=principal,
        booking_id=booking_id,
        reason=request.reason,
    )
    return BookingResponse.model_validate(booking, from_attributes=True)


@router.post(
    "/marketplace-operations/bookings/{booking_id}/delivery-recovery",
    operation_id="recover_marketplace_delivery_jobs",
    response_model=BookingResponse,
)
async def recover_marketplace_delivery_jobs(
    booking_id: UUID,
    request: RecoverMoneyOperationRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceLifecycleServiceDependency,
) -> BookingResponse:
    booking = await service.recover_delivery(
        principal=principal,
        booking_id=booking_id,
        reason=request.reason,
    )
    return BookingResponse.model_validate(booking, from_attributes=True)


@router.get(
    "/marketplace-operations/reviews",
    operation_id="list_marketplace_reviews_for_moderation",
    response_model=BookingReviewListResponse,
)
async def list_marketplace_reviews_for_moderation(
    principal: CurrentClerkPrincipal,
    service: MarketplaceLifecycleServiceDependency,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> BookingReviewListResponse:
    reviews, next_offset = await service.list_reviews(
        principal=principal, offset=offset, limit=limit
    )
    return BookingReviewListResponse(
        items=[
            BookingReviewResponse.model_validate(review, from_attributes=True) for review in reviews
        ],
        next_offset=next_offset,
    )


@router.post(
    "/marketplace-operations/reviews/{review_id}/moderation",
    operation_id="moderate_marketplace_booking_review",
    response_model=BookingReviewResponse,
)
async def moderate_marketplace_booking_review(
    review_id: UUID,
    request: ModerateBookingReviewRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceLifecycleServiceDependency,
) -> BookingReviewResponse:
    review = await service.moderate_review(
        principal=principal,
        review_id=review_id,
        moderation_state=request.moderation_state,
        reason=request.reason,
    )
    return BookingReviewResponse.model_validate(review, from_attributes=True)


@router.get(
    "/bookings/{booking_id}/learning-context",
    operation_id="get_marketplace_learning_context",
    response_model=LearningContextResponse,
)
async def get_marketplace_learning_context(
    booking_id: UUID,
    principal: CurrentClerkPrincipal,
    service: MarketplaceLearningBridgeServiceDependency,
) -> LearningContextResponse:
    view = await service.get_context(principal=principal, booking_id=booking_id)
    return LearningContextResponse.model_validate(view, from_attributes=True)


@router.post(
    "/bookings/{booking_id}/learning-context",
    operation_id="save_marketplace_learning_context",
    response_model=LearningContextResponse,
)
async def save_marketplace_learning_context(
    booking_id: UUID,
    request: SaveLearningContextRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceLearningBridgeServiceDependency,
) -> LearningContextResponse:
    view = await service.save_context(
        principal=principal,
        booking_id=booking_id,
        brief=LearningBrief(
            selected_goal=request.selected_goal,
            language_code=request.language_code,
            course_id=request.course_id,
            course_title=request.course_title,
            capabilities=tuple(request.capabilities),
            review_focus=tuple(request.review_focus),
        ),
    )
    return LearningContextResponse.model_validate(view, from_attributes=True)


@router.post(
    "/bookings/{booking_id}/learning-context/revoke",
    operation_id="revoke_marketplace_learning_context",
    response_model=LearningContextResponse,
)
async def revoke_marketplace_learning_context(
    booking_id: UUID,
    principal: CurrentClerkPrincipal,
    service: MarketplaceLearningBridgeServiceDependency,
) -> LearningContextResponse:
    view = await service.revoke_context(principal=principal, booking_id=booking_id)
    return LearningContextResponse.model_validate(view, from_attributes=True)


@router.post(
    "/bookings/{booking_id}/tutor-follow-up",
    operation_id="save_marketplace_tutor_follow_up",
    response_model=LearningContextResponse,
)
async def save_marketplace_tutor_follow_up(
    booking_id: UUID,
    request: SaveTutorFollowUpRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceLearningBridgeServiceDependency,
) -> LearningContextResponse:
    view = await service.save_follow_up(
        principal=principal,
        booking_id=booking_id,
        summary=request.summary,
        recommendations=tuple(
            FollowUpRecommendation(
                kind=item.kind,
                content_reference=item.content_reference,
                recommendation=item.recommendation,
            )
            for item in request.recommendations
        ),
    )
    return LearningContextResponse.model_validate(view, from_attributes=True)


@router.post(
    "/marketplace-stripe/webhook",
    operation_id="receive_marketplace_stripe_webhook",
    response_model=MarketplaceStripeWebhookResponse,
)
async def receive_marketplace_stripe_webhook(
    request: Request,
    service: MarketplaceBookingServiceDependency,
    stripe_signature: Annotated[str | None, Header(alias="Stripe-Signature")] = None,
) -> MarketplaceStripeWebhookResponse:
    maximum = request.app.state.marketplace_stripe_webhook_max_body_bytes
    raw_body = await _read_marketplace_webhook_body(request, maximum=maximum)
    secret = request.app.state.marketplace_stripe_webhook_secret
    if stripe_signature is None or secret is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")
    outcome = await service.apply_webhook(
        raw_body=raw_body,
        signature=stripe_signature,
        webhook_secret=secret,
        tolerance_seconds=request.app.state.marketplace_stripe_signature_tolerance_seconds,
    )
    return MarketplaceStripeWebhookResponse(status=outcome)


async def _read_marketplace_webhook_body(request: Request, *, maximum: int) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > maximum:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST) from None
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > maximum:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    return bytes(body)


@router.get(
    "/message-notification-preference",
    operation_id="get_marketplace_message_notification_preference",
    response_model=MessageNotificationPreferenceResponse,
)
async def get_marketplace_message_notification_preference(
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
) -> MessageNotificationPreferenceResponse:
    enabled = await service.get_notification_preference(principal=principal)
    return MessageNotificationPreferenceResponse(email_enabled=enabled)


@router.post(
    "/message-notification-preference",
    operation_id="set_marketplace_message_notification_preference",
    response_model=MessageNotificationPreferenceResponse,
)
async def set_marketplace_message_notification_preference(
    request: MessageNotificationPreferenceRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
) -> MessageNotificationPreferenceResponse:
    enabled = await service.set_notification_preference(
        principal=principal, email_enabled=request.email_enabled
    )
    return MessageNotificationPreferenceResponse(email_enabled=enabled)


@router.post(
    "/conversations",
    operation_id="create_marketplace_conversation",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_marketplace_conversation(
    request: CreateConversationRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
) -> ConversationResponse:
    result = await service.create_conversation(principal=principal, tutor_id=request.tutor_id)
    return ConversationResponse.model_validate(result, from_attributes=True)


@router.get(
    "/conversations",
    operation_id="list_marketplace_conversations",
    response_model=ConversationListResponse,
)
async def list_marketplace_conversations(
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> ConversationListResponse:
    result, next_cursor = await service.list_conversations(
        principal=principal, cursor=cursor, limit=limit
    )
    return ConversationListResponse(
        items=[ConversationResponse.model_validate(item, from_attributes=True) for item in result],
        next_cursor=next_cursor,
    )


@router.get(
    "/conversations/{conversation_id}/messages",
    operation_id="list_marketplace_messages",
    response_model=MessagePageResponse,
)
async def list_marketplace_messages(
    conversation_id: UUID,
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> MessagePageResponse:
    page = await service.list_messages(
        principal=principal, conversation_id=conversation_id, cursor=cursor, limit=limit
    )
    return MessagePageResponse.model_validate(page, from_attributes=True)


@router.post(
    "/conversations/{conversation_id}/messages",
    operation_id="send_marketplace_message",
    response_model=MessageResponse,
)
async def send_marketplace_message(
    conversation_id: UUID,
    request: SendMessageRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
) -> MessageResponse:
    message = await service.send_message(
        principal=principal,
        conversation_id=conversation_id,
        client_message_id=request.client_message_id,
        body=request.body,
    )
    return MessageResponse.model_validate(message, from_attributes=True)


@router.post(
    "/conversations/{conversation_id}/block",
    operation_id="block_marketplace_participant",
    response_model=MarketplaceActionResponse,
)
async def block_marketplace_participant(
    conversation_id: UUID,
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
) -> MarketplaceActionResponse:
    await service.block_other(principal=principal, conversation_id=conversation_id)
    return MarketplaceActionResponse()


@router.post(
    "/conversations/{conversation_id}/reports",
    operation_id="report_marketplace_message",
    response_model=MessageReportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def report_marketplace_message(
    conversation_id: UUID,
    request: CreateMessageReportRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
) -> MessageReportResponse:
    report = await service.report(
        principal=principal,
        conversation_id=conversation_id,
        message_id=request.message_id,
        reason=request.reason,
        details=request.details,
    )
    return MessageReportResponse.model_validate(report, from_attributes=True)


@router.get(
    "/marketplace-operations/message-reports",
    operation_id="list_marketplace_message_reports",
    response_model=MessageReportListResponse,
)
async def list_marketplace_message_reports(
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> MessageReportListResponse:
    reports, next_offset = await service.list_reports(
        principal=principal, offset=offset, limit=limit
    )
    return MessageReportListResponse(
        items=[
            MessageReportResponse.model_validate(item, from_attributes=True) for item in reports
        ],
        next_offset=next_offset,
    )


@router.get(
    "/marketplace-operations/message-reports/{report_id}",
    operation_id="get_marketplace_message_report",
    response_model=MessageReportResponse,
)
async def get_marketplace_message_report(
    report_id: UUID,
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
) -> MessageReportResponse:
    report = await service.get_report(principal=principal, report_id=report_id)
    return MessageReportResponse.model_validate(report, from_attributes=True)


@router.post(
    "/marketplace-operations/message-reports/{report_id}/resolve",
    operation_id="resolve_marketplace_message_report",
    response_model=MessageReportResponse,
)
async def resolve_marketplace_message_report(
    report_id: UUID,
    request: ResolveMessageReportRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
) -> MessageReportResponse:
    report = await service.resolve_report(
        principal=principal, report_id=report_id, reason=request.reason
    )
    return MessageReportResponse.model_validate(report, from_attributes=True)


@router.post(
    "/marketplace-operations/conversations/{conversation_id}/notification-recovery",
    operation_id="recover_marketplace_message_notifications",
    response_model=MarketplaceActionResponse,
)
async def recover_marketplace_message_notifications(
    conversation_id: UUID,
    request: RecoverMoneyOperationRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceMessagingServiceDependency,
) -> MarketplaceActionResponse:
    await service.recover_notifications(
        principal=principal,
        conversation_id=conversation_id,
        reason=request.reason,
    )
    return MarketplaceActionResponse(success=True)


def _calendar_response(view: object) -> CalendarConnectionResponse:
    return CalendarConnectionResponse.model_validate(view, from_attributes=True)


@router.get(
    "/tutor-calendar",
    operation_id="get_tutor_calendar_connection",
    response_model=CalendarConnectionResponse,
)
async def get_tutor_calendar_connection(
    principal: CurrentClerkPrincipal,
    service: MarketplaceCalendarServiceDependency,
) -> CalendarConnectionResponse:
    return _calendar_response(await service.status(principal=principal))


@router.post(
    "/tutor-calendar/oauth/start",
    operation_id="start_tutor_calendar_oauth",
    response_model=CalendarOAuthStartResponse,
)
async def start_tutor_calendar_oauth(
    request: CalendarOAuthStartRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceCalendarServiceDependency,
) -> CalendarOAuthStartResponse:
    result = await service.start_oauth(principal=principal, redirect_uri=request.redirect_uri)
    return CalendarOAuthStartResponse.model_validate(result, from_attributes=True)


@router.post(
    "/tutor-calendar/oauth/callback",
    operation_id="complete_tutor_calendar_oauth",
    response_model=CalendarConnectionResponse,
)
async def complete_tutor_calendar_oauth(
    request: CalendarOAuthCallbackRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceCalendarServiceDependency,
) -> CalendarConnectionResponse:
    return _calendar_response(
        await service.complete_oauth(
            principal=principal,
            state=request.state,
            code=request.code,
            redirect_uri=request.redirect_uri,
        )
    )


@router.post(
    "/tutor-calendar/refresh",
    operation_id="refresh_tutor_calendar",
    response_model=CalendarConnectionResponse,
)
async def refresh_tutor_calendar(
    principal: CurrentClerkPrincipal,
    service: MarketplaceCalendarServiceDependency,
) -> CalendarConnectionResponse:
    return _calendar_response(await service.refresh(principal=principal))


@router.post(
    "/tutor-calendar/revoke",
    operation_id="revoke_tutor_calendar",
    response_model=CalendarConnectionResponse,
)
async def revoke_tutor_calendar(
    principal: CurrentClerkPrincipal,
    service: MarketplaceCalendarServiceDependency,
) -> CalendarConnectionResponse:
    return _calendar_response(await service.revoke(principal=principal))


@router.get(
    "/tutor-availability",
    operation_id="get_own_tutor_availability",
    response_model=ManualAvailabilityResponse,
)
async def get_own_tutor_availability(
    principal: CurrentClerkPrincipal,
    service: MarketplaceDiscoveryServiceDependency,
) -> ManualAvailabilityResponse:
    return await service.get_own_availability(principal=principal)


@router.post(
    "/tutor-availability",
    operation_id="replace_own_tutor_availability",
    response_model=ManualAvailabilityResponse,
)
async def replace_own_tutor_availability(
    request: ReplaceManualAvailabilityRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceDiscoveryServiceDependency,
) -> ManualAvailabilityResponse:
    return await service.replace_own_availability(principal=principal, request=request)


@router.get(
    "/tutor-availability/preview",
    operation_id="preview_own_tutor_slots",
    response_model=TutorSlotsResponse,
)
async def preview_own_tutor_slots(
    starts_at: datetime,
    ends_at: datetime,
    principal: CurrentClerkPrincipal,
    service: MarketplaceDiscoveryServiceDependency,
    offering_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=256)] = 128,
) -> TutorSlotsResponse:
    _validate_slot_window(starts_at=starts_at, ends_at=ends_at)
    return await service.preview_own_slots(
        principal=principal,
        starts_at=starts_at,
        ends_at=ends_at,
        limit=limit,
        offering_id=offering_id,
    )


@router.get(
    "/tutors",
    operation_id="list_public_tutors",
    response_model=TutorSearchResponse,
)
async def list_public_tutors(
    principal: CurrentClerkPrincipal,
    service: MarketplaceDiscoveryServiceDependency,
    language: Annotated[str | None, Query(min_length=2, max_length=32)] = None,
    dialect: Annotated[str | None, Query(min_length=4, max_length=32)] = None,
    specialty: Annotated[str | None, Query(min_length=2, max_length=64)] = None,
    duration_minutes: Annotated[int | None, Query()] = None,
    maximum_amount_minor: Annotated[int | None, Query(ge=500, le=50_000)] = None,
    minimum_rating: Annotated[float | None, Query(ge=1, le=5)] = None,
    verified_credential: bool = False,
    favorite: bool = False,
    available_before: datetime | None = None,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> TutorSearchResponse:
    if duration_minutes not in {None, 25, 50}:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail="duration_minutes must be 25 or 50")
    if available_before is not None:
        _validate_slot_window(starts_at=datetime.now(UTC), ends_at=available_before)
    return await service.list_tutors(
        principal=principal,
        language=language,
        dialect=dialect,
        specialty=specialty,
        duration_minutes=duration_minutes,
        maximum_amount_minor=maximum_amount_minor,
        minimum_rating=minimum_rating,
        verified_credential=verified_credential,
        favorite=favorite,
        available_before=available_before,
        cursor=cursor,
        limit=limit,
    )


@router.get(
    "/tutors/{tutor_id}",
    operation_id="get_public_tutor",
    response_model=PublicTutorResponse,
)
async def get_public_tutor(
    tutor_id: UUID,
    principal: CurrentClerkPrincipal,
    service: MarketplaceDiscoveryServiceDependency,
) -> PublicTutorResponse:
    return await service.get_tutor(principal=principal, tutor_id=tutor_id)


@router.get(
    "/tutors/{tutor_id}/slots",
    operation_id="list_public_tutor_slots",
    response_model=TutorSlotsResponse,
)
async def list_public_tutor_slots(
    tutor_id: UUID,
    starts_at: datetime,
    ends_at: datetime,
    principal: CurrentClerkPrincipal,
    service: MarketplaceDiscoveryServiceDependency,
    offering_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=256)] = 128,
) -> TutorSlotsResponse:
    _validate_slot_window(starts_at=starts_at, ends_at=ends_at)
    return await service.list_slots(
        principal=principal,
        tutor_id=tutor_id,
        starts_at=starts_at,
        ends_at=ends_at,
        limit=limit,
        offering_id=offering_id,
    )


@router.post(
    "/tutors/{tutor_id}/favorite",
    operation_id="set_public_tutor_favorite",
    response_model=PublicTutorResponse,
)
async def set_public_tutor_favorite(
    tutor_id: UUID,
    request: SetTutorFavoriteRequest,
    principal: CurrentClerkPrincipal,
    service: MarketplaceDiscoveryServiceDependency,
) -> PublicTutorResponse:
    return await service.set_favorite(
        principal=principal,
        tutor_id=tutor_id,
        favorite=request.favorite,
    )


def _validate_slot_window(*, starts_at: datetime, ends_at: datetime) -> None:
    from fastapi import HTTPException

    if starts_at.tzinfo is None or ends_at.tzinfo is None:
        raise HTTPException(status_code=422, detail="slot window must use timezone-aware instants")
    if starts_at >= ends_at:
        raise HTTPException(status_code=422, detail="slot window must have positive duration")
    if ends_at - starts_at > timedelta(days=31):
        raise HTTPException(status_code=422, detail="slot window exceeds the 31-day horizon")


@router.post(
    "/tutor-applications",
    operation_id="create_tutor_application",
    response_model=TutorApplicationResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def create_tutor_application(
    request: CreateTutorApplicationRequest,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorApplicationResponse:
    return await service.create_application(principal=principal, request=request)


@router.get(
    "/tutor-application",
    operation_id="get_own_tutor_application",
    response_model=TutorApplicationResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def get_own_tutor_application(
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorApplicationResponse:
    return await service.get_own_application(principal=principal)


@router.post(
    "/tutor-application/draft",
    operation_id="update_tutor_application_draft",
    response_model=TutorApplicationResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def update_tutor_application_draft(
    request: UpdateTutorApplicationDraftRequest,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorApplicationResponse:
    return await service.update_application_draft(principal=principal, request=request)


@router.post(
    "/tutor-application/submit",
    operation_id="submit_tutor_application",
    response_model=TutorApplicationResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def submit_tutor_application(
    request: ApplicationVersionRequest,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorApplicationResponse:
    return await service.submit_application(
        principal=principal,
        expected_version=request.expected_version,
    )


@router.get(
    "/tutor-profile",
    operation_id="get_own_tutor_profile",
    response_model=TutorProfileResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def get_own_tutor_profile(
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorProfileResponse:
    return await service.get_own_profile(principal=principal)


@router.post(
    "/tutor-profile/draft",
    operation_id="update_tutor_profile_draft",
    response_model=TutorProfileResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def update_tutor_profile_draft(
    request: UpdateTutorProfileDraftRequest,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorProfileResponse:
    return await service.update_profile_draft(principal=principal, request=request)


@router.post(
    "/tutor-profile/credential",
    operation_id="save_tutor_credential",
    response_model=TutorProfileResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def save_tutor_credential(
    request: SaveTutorCredentialRequest,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorProfileResponse:
    return await service.save_credential(principal=principal, request=request)


@router.post(
    "/tutor-profile/offering",
    operation_id="save_tutor_offering",
    response_model=TutorProfileResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def save_tutor_offering(
    request: SaveTutorOfferingRequest,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorProfileResponse:
    return await service.save_offering(principal=principal, request=request)


@router.post(
    "/tutor-profile/publication",
    operation_id="set_tutor_profile_publication",
    response_model=TutorProfileResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def set_tutor_profile_publication(
    request: SetTutorPublicationRequest,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorProfileResponse:
    return await service.set_publication(principal=principal, request=request)


@router.get(
    "/marketplace-operations/tutor-applications",
    operation_id="list_tutor_applications_for_review",
    response_model=TutorApplicationQueue,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def list_tutor_applications_for_review(
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> TutorApplicationQueue:
    return await service.list_review_queue(
        principal=principal,
        offset=offset,
        limit=limit,
    )


@router.post(
    "/marketplace-operations/tutor-applications/{application_id}/review",
    operation_id="start_tutor_application_review",
    response_model=TutorApplicationResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def start_tutor_application_review(
    application_id: UUID,
    request: ApplicationVersionRequest,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorApplicationResponse:
    return await service.start_review(
        principal=principal,
        application_id=application_id,
        expected_version=request.expected_version,
    )


@router.get(
    "/marketplace-operations/tutor-applications/{application_id}/profile",
    operation_id="get_tutor_profile_for_operations",
    response_model=TutorProfileResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def get_tutor_profile_for_operations(
    application_id: UUID,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorProfileResponse:
    return await service.get_profile_for_operations(
        principal=principal,
        application_id=application_id,
    )


@router.post(
    "/marketplace-operations/tutor-applications/{application_id}/decision",
    operation_id="decide_tutor_application",
    response_model=TutorApplicationResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def decide_tutor_application(
    application_id: UUID,
    request: DecideTutorApplicationRequest,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorApplicationResponse:
    return await service.decide_application(
        principal=principal,
        application_id=application_id,
        request=request,
    )


@router.post(
    "/marketplace-operations/tutor-applications/{application_id}/status",
    operation_id="change_tutor_status",
    response_model=TutorApplicationResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def change_tutor_status(
    application_id: UUID,
    request: ChangeTutorStatusRequest,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorApplicationResponse:
    return await service.change_tutor_status(
        principal=principal,
        application_id=application_id,
        request=request,
    )


@router.post(
    "/marketplace-operations/tutor-credentials/{credential_id}/decision",
    operation_id="decide_tutor_credential",
    response_model=TutorProfileResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def decide_tutor_credential(
    credential_id: UUID,
    request: DecideTutorCredentialRequest,
    principal: CurrentClerkPrincipal,
    service: HumanTutorMarketplaceServiceDependency,
) -> TutorProfileResponse:
    return await service.decide_credential(
        principal=principal,
        credential_id=credential_id,
        request=request,
    )
