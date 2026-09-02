"""Validated public contracts for affiliate identity and attribution."""

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, StringConstraints, model_validator

from app.modules.affiliates.domain import (
    BindStatus,
    CreatorMembershipRole,
    StaffCapability,
    StaffScopeKind,
)

Slug = Annotated[
    str,
    StringConstraints(
        min_length=1,
        max_length=80,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    ),
]
HandoffToken = Annotated[
    str,
    StringConstraints(min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]{43}$"),
]
ClerkUserId = Annotated[str, StringConstraints(min_length=1, max_length=100, strip_whitespace=True)]
Reason = Annotated[str, StringConstraints(min_length=3, max_length=500, strip_whitespace=True)]


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ResolveReferralRequest(StrictRequest):
    link_slug: Slug
    campaign_slug: Slug | None = None


class ResolveReferralResponse(BaseModel):
    status: Literal["resolved"] = "resolved"
    handoff_token: str
    expires_at: datetime


class BindAttributionRequest(StrictRequest):
    handoff_token: HandoffToken


class BindAttributionResponse(BaseModel):
    status: BindStatus


class GrantCreatorMembershipRequest(StrictRequest):
    target_clerk_user_id: ClerkUserId
    creator_id: UUID
    role: CreatorMembershipRole
    valid_from: AwareDatetime | None = None
    valid_until: AwareDatetime | None = None
    reason: Reason

    @model_validator(mode="after")
    def validate_interval(self) -> Self:
        if (
            self.valid_from is not None
            and self.valid_until is not None
            and self.valid_until <= self.valid_from
        ):
            raise ValueError("valid_until must be after valid_from")
        return self


class GrantStaffMembershipRequest(StrictRequest):
    target_clerk_user_id: ClerkUserId
    capability: StaffCapability
    scope_kind: StaffScopeKind
    scope_id: UUID | None = None
    valid_from: AwareDatetime | None = None
    valid_until: AwareDatetime | None = None
    reason: Reason

    @model_validator(mode="after")
    def validate_scope_and_interval(self) -> Self:
        if self.scope_kind is StaffScopeKind.PLATFORM and self.scope_id is not None:
            raise ValueError("platform scope cannot include scope_id")
        if self.scope_kind is not StaffScopeKind.PLATFORM and self.scope_id is None:
            raise ValueError("program and creator scopes require scope_id")
        if (
            self.valid_from is not None
            and self.valid_until is not None
            and self.valid_until <= self.valid_from
        ):
            raise ValueError("valid_until must be after valid_from")
        return self


class RevokeMembershipRequest(StrictRequest):
    reason: Reason


class CreatorMembershipResponse(BaseModel):
    membership_id: UUID
    creator_id: UUID
    role: CreatorMembershipRole
    status: Literal["active"] = "active"
    valid_from: datetime
    valid_until: datetime | None


class StaffMembershipResponse(BaseModel):
    membership_id: UUID
    capability: StaffCapability
    scope_kind: StaffScopeKind
    scope_id: UUID | None
    status: Literal["active"] = "active"
    valid_from: datetime
    valid_until: datetime | None


class RevokedMembershipResponse(BaseModel):
    membership_id: UUID
    status: Literal["revoked"] = "revoked"
