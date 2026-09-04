"""Affiliate domain types with no embedded commercial policy defaults."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID


class CreatorMembershipRole(StrEnum):
    OWNER = "owner"
    MANAGER = "manager"
    ANALYST = "analyst"


class StaffCapability(StrEnum):
    MEMBERSHIP_ADMIN = "membership_admin"
    CREATOR_MANAGE = "creator_manage"
    PROGRAM_MANAGE = "program_manage"
    ATTRIBUTION_CORRECT = "attribution_correct"
    FINANCE_REVIEW = "finance_review"
    TRANSFER_PREPARE = "transfer_prepare"
    TRANSFER_APPROVE = "transfer_approve"
    TRANSFER_EXECUTE = "transfer_execute"
    AUDIT_READ = "audit_read"


class StaffScopeKind(StrEnum):
    PLATFORM = "platform"
    PROGRAM = "program"
    CREATOR = "creator"


class BindStatus(StrEnum):
    BOUND = "bound"
    INVALID = "invalid"
    EXPIRED = "expired"
    ALREADY_CONSUMED = "already_consumed"
    LOCKED = "locked"


@dataclass(frozen=True, slots=True)
class ResolvedReferral:
    handoff_token: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class BoundAttribution:
    status: BindStatus


@dataclass(frozen=True, slots=True)
class CreatorMembership:
    membership_id: UUID
    creator_id: UUID
    role: CreatorMembershipRole
    valid_from: datetime
    valid_until: datetime | None


@dataclass(frozen=True, slots=True)
class StaffMembership:
    membership_id: UUID
    capability: StaffCapability
    scope_kind: StaffScopeKind
    scope_id: UUID | None
    valid_from: datetime
    valid_until: datetime | None


class AffiliateRepositoryConflictError(Exception):
    """An active membership or other unique affiliate fact already exists."""


class AffiliateRepositoryNotFoundError(Exception):
    """A referenced affiliate resource does not exist."""


def require_separate_transfer_actors(
    *, preparer_ref: str, approver_ref: str, executor_ref: str
) -> None:
    """Protect the future transfer workflow from one-actor approval/execution."""

    if len({preparer_ref, approver_ref, executor_ref}) != 3:
        raise ValueError("Transfer preparation, approval, and execution require separate actors")
