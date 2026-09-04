from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID, uuid4

import pytest

from app.auth.clerk import ClerkPrincipal
from app.core.errors import AffiliateForbiddenError, AffiliateUnavailableError
from app.modules.affiliates.domain import (
    BindStatus,
    BoundAttribution,
    CreatorMembership,
    CreatorMembershipRole,
    StaffCapability,
    StaffMembership,
    StaffScopeKind,
    require_separate_transfer_actors,
)
from app.modules.affiliates.identity import derive_affiliate_principal_ref, digest_handoff_token
from app.modules.affiliates.repository import AffiliateRepository
from app.modules.affiliates.service import HANDOFF_TTL, AffiliateService

NOW = datetime(2026, 9, 2, 12, 0, tzinfo=UTC)
KEY = b"affiliate-unit-pseudonym-key-at-least-32-bytes"
TOKEN = "A" * 43
PRINCIPAL = ClerkPrincipal(user_id="user_verified", issuer="https://clerk.test")


class MemoryAffiliateRepository:
    def __init__(self) -> None:
        self.referral_exists = True
        self.bind_status = BindStatus.BOUND
        self.staff_allowed = False
        self.creator_allowed = False
        self.resolve_values: dict[str, Any] | None = None
        self.bind_values: dict[str, Any] | None = None
        self.grant_values: dict[str, Any] | None = None
        self.denied: list[dict[str, Any]] = []
        self.principals: list[str] = []
        self.revoked = True

    def resolve_referral(self, **kwargs: Any) -> bool:
        self.resolve_values = kwargs
        return self.referral_exists

    def bind_attribution(self, **kwargs: Any) -> BoundAttribution:
        self.bind_values = kwargs
        return BoundAttribution(status=self.bind_status)

    def ensure_principal(self, *, principal_ref: str, **_kwargs: Any) -> None:
        self.principals.append(principal_ref)

    def has_creator_role(self, **_kwargs: Any) -> bool:
        return self.creator_allowed

    def has_staff_capability(self, **_kwargs: Any) -> bool:
        return self.staff_allowed

    def record_denied_access(self, **kwargs: Any) -> None:
        self.denied.append(kwargs)

    def grant_creator_membership(self, **kwargs: Any) -> CreatorMembership:
        self.grant_values = kwargs
        return CreatorMembership(
            membership_id=uuid4(),
            creator_id=cast(UUID, kwargs["creator_id"]),
            role=cast(CreatorMembershipRole, kwargs["role"]),
            valid_from=cast(datetime, kwargs["valid_from"]),
            valid_until=cast(datetime | None, kwargs["valid_until"]),
        )

    def grant_staff_membership(self, **kwargs: Any) -> StaffMembership:
        self.grant_values = kwargs
        return StaffMembership(
            membership_id=uuid4(),
            capability=cast(StaffCapability, kwargs["capability"]),
            scope_kind=cast(StaffScopeKind, kwargs["scope_kind"]),
            scope_id=cast(UUID | None, kwargs["scope_id"]),
            valid_from=cast(datetime, kwargs["valid_from"]),
            valid_until=cast(datetime | None, kwargs["valid_until"]),
        )

    def revoke_creator_membership(self, **_kwargs: Any) -> bool:
        return self.revoked

    def revoke_staff_membership(self, **_kwargs: Any) -> bool:
        return self.revoked

    def lock_current_attribution(self, **_kwargs: Any) -> bool:
        return True


def make_service(repository: MemoryAffiliateRepository, **overrides: Any) -> AffiliateService:
    values: dict[str, Any] = {
        "repository": cast(AffiliateRepository, repository),
        "affiliates_enabled": True,
        "referral_resolution_enabled": True,
        "attribution_binding_enabled": True,
        "membership_admin_enabled": True,
        "principal_pseudonym_key": KEY,
        "now": lambda: NOW,
        "token_factory": lambda: TOKEN,
    }
    values.update(overrides)
    return AffiliateService(**values)


def test_resolve_issues_exact_256_bit_token_digest_for_fifteen_minutes() -> None:
    repository = MemoryAffiliateRepository()

    result = make_service(repository).resolve_referral(
        link_slug="creator-link", campaign_slug="campaign-one"
    )

    assert result.handoff_token == TOKEN
    assert result.expires_at == NOW + HANDOFF_TTL
    assert repository.resolve_values == {
        "link_slug": "creator-link",
        "campaign_slug": "campaign-one",
        "token_digest": digest_handoff_token(TOKEN),
        "now": NOW,
        "expires_at": NOW + timedelta(minutes=15),
    }
    assert TOKEN not in str(repository.resolve_values)


def test_bind_derives_authority_only_from_verified_clerk_principal() -> None:
    repository = MemoryAffiliateRepository()

    result = make_service(repository).bind_attribution(
        principal=PRINCIPAL,
        handoff_token=TOKEN,
    )

    assert result.status is BindStatus.BOUND
    assert repository.bind_values == {
        "token_digest": digest_handoff_token(TOKEN),
        "principal_ref": derive_affiliate_principal_ref(key=KEY, principal=PRINCIPAL),
        "now": NOW,
    }
    assert PRINCIPAL.user_id not in str(repository.bind_values)
    assert PRINCIPAL.issuer not in str(repository.bind_values)


def test_admin_capability_is_checked_from_repository_and_denials_are_audited() -> None:
    repository = MemoryAffiliateRepository()
    creator_id = uuid4()

    with pytest.raises(AffiliateForbiddenError):
        make_service(repository).grant_creator_membership(
            principal=PRINCIPAL,
            target_clerk_user_id="user_target",
            creator_id=creator_id,
            role=CreatorMembershipRole.MANAGER,
            valid_from=None,
            valid_until=None,
            reason="Approved creator operator access.",
        )

    actor_ref = derive_affiliate_principal_ref(key=KEY, principal=PRINCIPAL)
    assert repository.principals == [actor_ref]
    assert repository.denied[0]["action"] == "membership.admin"
    assert repository.grant_values is None


def test_admin_grant_persists_only_a_pseudonymous_target_reference() -> None:
    repository = MemoryAffiliateRepository()
    repository.staff_allowed = True
    creator_id = uuid4()

    make_service(repository).grant_creator_membership(
        principal=PRINCIPAL,
        target_clerk_user_id="user_target",
        creator_id=creator_id,
        role=CreatorMembershipRole.ANALYST,
        valid_from=None,
        valid_until=NOW + timedelta(days=1),
        reason="Approved read-only creator access.",
    )

    assert repository.grant_values is not None
    assert repository.grant_values["target_ref"] == derive_affiliate_principal_ref(
        key=KEY,
        principal=ClerkPrincipal(user_id="user_target", issuer=PRINCIPAL.issuer),
    )
    assert "user_target" not in str(repository.grant_values)


def test_all_routes_fail_closed_when_master_flag_is_off() -> None:
    repository = MemoryAffiliateRepository()
    service = make_service(repository, affiliates_enabled=False)

    with pytest.raises(AffiliateUnavailableError):
        service.resolve_referral(link_slug="creator-link", campaign_slug=None)
    with pytest.raises(AffiliateUnavailableError):
        service.bind_attribution(principal=PRINCIPAL, handoff_token=TOKEN)


def test_transfer_capabilities_still_require_three_distinct_action_actors() -> None:
    require_separate_transfer_actors(
        preparer_ref="actor_prepare",
        approver_ref="actor_approve",
        executor_ref="actor_execute",
    )

    with pytest.raises(ValueError, match="separate actors"):
        require_separate_transfer_actors(
            preparer_ref="actor_same",
            approver_ref="actor_other",
            executor_ref="actor_same",
        )
