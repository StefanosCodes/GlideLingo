"""Authenticated tutor application and capability-scoped review endpoints."""

from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status

from app.auth.clerk import CurrentClerkPrincipal
from app.core.errors import ErrorResponse
from app.modules.human_tutor_marketplace.schemas import (
    ApplicationVersionRequest,
    ChangeTutorStatusRequest,
    CreateTutorApplicationRequest,
    DecideTutorApplicationRequest,
    DecideTutorCredentialRequest,
    SaveTutorCredentialRequest,
    SaveTutorOfferingRequest,
    SetTutorPublicationRequest,
    TutorApplicationQueue,
    TutorApplicationResponse,
    TutorProfileResponse,
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
