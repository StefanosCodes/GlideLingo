"""Authenticated tutor application and capability-scoped review endpoints."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status

from app.auth.clerk import CurrentClerkPrincipal
from app.core.errors import ErrorResponse
from app.modules.human_tutor_marketplace.calendar import CalendarService
from app.modules.human_tutor_marketplace.discovery import MarketplaceDiscoveryService
from app.modules.human_tutor_marketplace.schemas import (
    ApplicationVersionRequest,
    CalendarConnectionResponse,
    CalendarOAuthCallbackRequest,
    CalendarOAuthStartRequest,
    CalendarOAuthStartResponse,
    ChangeTutorStatusRequest,
    CreateTutorApplicationRequest,
    DecideTutorApplicationRequest,
    DecideTutorCredentialRequest,
    ManualAvailabilityResponse,
    PublicTutorResponse,
    ReplaceManualAvailabilityRequest,
    SaveTutorCredentialRequest,
    SaveTutorOfferingRequest,
    SetTutorFavoriteRequest,
    SetTutorPublicationRequest,
    TutorApplicationQueue,
    TutorApplicationResponse,
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
    limit: Annotated[int, Query(ge=1, le=256)] = 128,
) -> TutorSlotsResponse:
    _validate_slot_window(starts_at=starts_at, ends_at=ends_at)
    return await service.preview_own_slots(
        principal=principal,
        starts_at=starts_at,
        ends_at=ends_at,
        limit=limit,
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
    limit: Annotated[int, Query(ge=1, le=256)] = 128,
) -> TutorSlotsResponse:
    _validate_slot_window(starts_at=starts_at, ends_at=ends_at)
    return await service.list_slots(
        principal=principal,
        tutor_id=tutor_id,
        starts_at=starts_at,
        ends_at=ends_at,
        limit=limit,
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
