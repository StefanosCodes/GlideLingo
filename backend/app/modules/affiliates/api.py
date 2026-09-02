"""FastAPI contracts for the disabled affiliate foundation."""

from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status

from app.auth.clerk import CurrentClerkPrincipal
from app.core.errors import ErrorResponse
from app.modules.affiliates.schemas import (
    BindAttributionRequest,
    BindAttributionResponse,
    CreatorMembershipResponse,
    GrantCreatorMembershipRequest,
    GrantStaffMembershipRequest,
    ResolveReferralRequest,
    ResolveReferralResponse,
    RevokedMembershipResponse,
    RevokeMembershipRequest,
    StaffMembershipResponse,
)
from app.modules.affiliates.service import AffiliateService

router = APIRouter(prefix="/v1/affiliates", tags=["affiliates"])
admin_router = APIRouter(prefix="/v1/admin/affiliates", tags=["admin-affiliates"])

AFFILIATE_ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"description": "The Clerk session token is missing or invalid."},
    403: {"model": ErrorResponse, "description": "The principal lacks the required capability."},
    404: {"model": ErrorResponse, "description": "The affiliate resource is unavailable."},
    409: {"model": ErrorResponse, "description": "The requested membership conflicts."},
    503: {
        "model": ErrorResponse,
        "description": "The affiliate feature is disabled or unavailable.",
    },
}


def get_affiliate_service(request: Request) -> AffiliateService:
    return cast(AffiliateService, request.app.state.affiliate_service)


AffiliateServiceDependency = Annotated[AffiliateService, Depends(get_affiliate_service)]


@router.post(
    "/referrals/resolve",
    operation_id="resolve_affiliate_referral",
    response_model=ResolveReferralResponse,
    responses={
        404: AFFILIATE_ERRORS[404],
        503: AFFILIATE_ERRORS[503],
    },
)
def resolve_referral(
    body: ResolveReferralRequest,
    service: AffiliateServiceDependency,
) -> ResolveReferralResponse:
    resolved = service.resolve_referral(
        link_slug=body.link_slug,
        campaign_slug=body.campaign_slug,
    )
    return ResolveReferralResponse(
        handoff_token=resolved.handoff_token,
        expires_at=resolved.expires_at,
    )


@router.post(
    "/attribution/bind",
    operation_id="bind_affiliate_attribution",
    response_model=BindAttributionResponse,
    responses={401: AFFILIATE_ERRORS[401], 503: AFFILIATE_ERRORS[503]},
)
def bind_attribution(
    body: BindAttributionRequest,
    principal: CurrentClerkPrincipal,
    service: AffiliateServiceDependency,
) -> BindAttributionResponse:
    result = service.bind_attribution(
        principal=principal,
        handoff_token=body.handoff_token,
    )
    return BindAttributionResponse(status=result.status)


@admin_router.post(
    "/creator-memberships",
    operation_id="grant_affiliate_creator_membership",
    response_model=CreatorMembershipResponse,
    status_code=status.HTTP_201_CREATED,
    responses=AFFILIATE_ERRORS,
)
def grant_creator_membership(
    body: GrantCreatorMembershipRequest,
    principal: CurrentClerkPrincipal,
    service: AffiliateServiceDependency,
) -> CreatorMembershipResponse:
    membership = service.grant_creator_membership(
        principal=principal,
        target_clerk_user_id=body.target_clerk_user_id,
        creator_id=body.creator_id,
        role=body.role,
        valid_from=body.valid_from,
        valid_until=body.valid_until,
        reason=body.reason,
    )
    return CreatorMembershipResponse(
        membership_id=membership.membership_id,
        creator_id=membership.creator_id,
        role=membership.role,
        valid_from=membership.valid_from,
        valid_until=membership.valid_until,
    )


@admin_router.post(
    "/staff-memberships",
    operation_id="grant_affiliate_staff_membership",
    response_model=StaffMembershipResponse,
    status_code=status.HTTP_201_CREATED,
    responses=AFFILIATE_ERRORS,
)
def grant_staff_membership(
    body: GrantStaffMembershipRequest,
    principal: CurrentClerkPrincipal,
    service: AffiliateServiceDependency,
) -> StaffMembershipResponse:
    membership = service.grant_staff_membership(
        principal=principal,
        target_clerk_user_id=body.target_clerk_user_id,
        capability=body.capability,
        scope_kind=body.scope_kind,
        scope_id=body.scope_id,
        valid_from=body.valid_from,
        valid_until=body.valid_until,
        reason=body.reason,
    )
    return StaffMembershipResponse(
        membership_id=membership.membership_id,
        capability=membership.capability,
        scope_kind=membership.scope_kind,
        scope_id=membership.scope_id,
        valid_from=membership.valid_from,
        valid_until=membership.valid_until,
    )


@admin_router.post(
    "/creator-memberships/{membership_id}/revoke",
    operation_id="revoke_affiliate_creator_membership",
    response_model=RevokedMembershipResponse,
    responses=AFFILIATE_ERRORS,
)
def revoke_creator_membership(
    membership_id: UUID,
    body: RevokeMembershipRequest,
    principal: CurrentClerkPrincipal,
    service: AffiliateServiceDependency,
) -> RevokedMembershipResponse:
    service.revoke_creator_membership(
        principal=principal,
        membership_id=membership_id,
        reason=body.reason,
    )
    return RevokedMembershipResponse(membership_id=membership_id)


@admin_router.post(
    "/staff-memberships/{membership_id}/revoke",
    operation_id="revoke_affiliate_staff_membership",
    response_model=RevokedMembershipResponse,
    responses=AFFILIATE_ERRORS,
)
def revoke_staff_membership(
    membership_id: UUID,
    body: RevokeMembershipRequest,
    principal: CurrentClerkPrincipal,
    service: AffiliateServiceDependency,
) -> RevokedMembershipResponse:
    service.revoke_staff_membership(
        principal=principal,
        membership_id=membership_id,
        reason=body.reason,
    )
    return RevokedMembershipResponse(membership_id=membership_id)
