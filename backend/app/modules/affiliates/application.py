"""Public application-layer exports for future affiliate slices."""

from app.modules.affiliates.domain import (
    CreatorMembershipRole,
    StaffCapability,
    StaffScopeKind,
    require_separate_transfer_actors,
)
from app.modules.affiliates.service import AffiliateService

__all__ = [
    "AffiliateService",
    "CreatorMembershipRole",
    "StaffCapability",
    "StaffScopeKind",
    "require_separate_transfer_actors",
]
