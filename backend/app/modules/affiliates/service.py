"""Flag-gated affiliate identity, authorization, and attribution operations."""

import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    AffiliateConflictError,
    AffiliateForbiddenError,
    AffiliateReferralNotFoundError,
    AffiliateResourceNotFoundError,
    AffiliateUnavailableError,
)
from app.modules.affiliates.domain import (
    AffiliateRepositoryConflictError,
    AffiliateRepositoryNotFoundError,
    BoundAttribution,
    CreatorMembership,
    CreatorMembershipRole,
    ResolvedReferral,
    StaffCapability,
    StaffMembership,
    StaffScopeKind,
)
from app.modules.affiliates.identity import derive_affiliate_principal_ref, digest_handoff_token
from app.modules.affiliates.repository import AffiliateRepository

HANDOFF_TTL = timedelta(minutes=15)


class AffiliateService:
    def __init__(
        self,
        *,
        repository: AffiliateRepository,
        affiliates_enabled: bool,
        referral_resolution_enabled: bool,
        attribution_binding_enabled: bool,
        membership_admin_enabled: bool,
        principal_pseudonym_key: bytes | None,
        now: Callable[[], datetime] | None = None,
        token_factory: Callable[[], str] | None = None,
    ) -> None:
        self._repository = repository
        self._affiliates_enabled = affiliates_enabled
        self._referral_resolution_enabled = referral_resolution_enabled
        self._attribution_binding_enabled = attribution_binding_enabled
        self._membership_admin_enabled = membership_admin_enabled
        self._principal_pseudonym_key = principal_pseudonym_key
        self._now = now or (lambda: datetime.now(UTC))
        self._token_factory = token_factory or (lambda: secrets.token_urlsafe(32))

    def resolve_referral(self, *, link_slug: str, campaign_slug: str | None) -> ResolvedReferral:
        if not self._affiliates_enabled or not self._referral_resolution_enabled:
            raise AffiliateUnavailableError
        now = self._now()
        expires_at = now + HANDOFF_TTL
        token = self._token_factory()
        if len(token) != 43:
            raise RuntimeError("The handoff token factory must return 256-bit base64url tokens")
        resolved = self._repository.resolve_referral(
            link_slug=link_slug,
            campaign_slug=campaign_slug,
            token_digest=digest_handoff_token(token),
            now=now,
            expires_at=expires_at,
        )
        if not resolved:
            raise AffiliateReferralNotFoundError
        return ResolvedReferral(handoff_token=token, expires_at=expires_at)

    def bind_attribution(
        self, *, principal: ClerkPrincipal, handoff_token: str
    ) -> BoundAttribution:
        if not self._affiliates_enabled or not self._attribution_binding_enabled:
            raise AffiliateUnavailableError
        principal_ref = self._principal_ref(principal)
        return self._repository.bind_attribution(
            token_digest=digest_handoff_token(handoff_token),
            principal_ref=principal_ref,
            now=self._now(),
        )

    def authorize_creator(
        self,
        *,
        principal: ClerkPrincipal,
        creator_id: UUID,
        allowed_roles: frozenset[CreatorMembershipRole],
    ) -> None:
        if not self._affiliates_enabled:
            raise AffiliateUnavailableError
        now = self._now()
        actor_ref = self._principal_ref(principal)
        self._repository.ensure_principal(principal_ref=actor_ref, now=now)
        if self._repository.has_creator_role(
            principal_ref=actor_ref,
            creator_id=creator_id,
            allowed_roles=allowed_roles,
            now=now,
        ):
            return
        self._repository.record_denied_access(
            actor_ref=actor_ref,
            action="creator.authorize",
            scope_kind=StaffScopeKind.CREATOR,
            scope_id=creator_id,
            now=now,
        )
        raise AffiliateForbiddenError

    def authorize_staff(
        self,
        *,
        principal: ClerkPrincipal,
        capability: StaffCapability,
        scope_kind: StaffScopeKind,
        scope_id: UUID | None,
    ) -> None:
        if not self._affiliates_enabled:
            raise AffiliateUnavailableError
        now = self._now()
        actor_ref = self._principal_ref(principal)
        self._repository.ensure_principal(principal_ref=actor_ref, now=now)
        if self._repository.has_staff_capability(
            principal_ref=actor_ref,
            capability=capability,
            scope_kind=scope_kind,
            scope_id=scope_id,
            now=now,
        ):
            return
        self._repository.record_denied_access(
            actor_ref=actor_ref,
            action=f"staff.authorize.{capability.value}",
            scope_kind=scope_kind,
            scope_id=scope_id,
            now=now,
        )
        raise AffiliateForbiddenError

    def grant_creator_membership(
        self,
        *,
        principal: ClerkPrincipal,
        target_clerk_user_id: str,
        creator_id: UUID,
        role: CreatorMembershipRole,
        valid_from: datetime | None,
        valid_until: datetime | None,
        reason: str,
    ) -> CreatorMembership:
        actor_ref, now = self._authorize_membership_admin(principal)
        target_ref = self._principal_ref(
            ClerkPrincipal(user_id=target_clerk_user_id, issuer=principal.issuer)
        )
        try:
            return self._repository.grant_creator_membership(
                actor_ref=actor_ref,
                target_ref=target_ref,
                creator_id=creator_id,
                role=role,
                valid_from=valid_from or now,
                valid_until=valid_until,
                reason=reason,
                now=now,
            )
        except AffiliateRepositoryNotFoundError:
            raise AffiliateResourceNotFoundError from None
        except AffiliateRepositoryConflictError:
            raise AffiliateConflictError from None

    def grant_staff_membership(
        self,
        *,
        principal: ClerkPrincipal,
        target_clerk_user_id: str,
        capability: StaffCapability,
        scope_kind: StaffScopeKind,
        scope_id: UUID | None,
        valid_from: datetime | None,
        valid_until: datetime | None,
        reason: str,
    ) -> StaffMembership:
        actor_ref, now = self._authorize_membership_admin(principal)
        target_ref = self._principal_ref(
            ClerkPrincipal(user_id=target_clerk_user_id, issuer=principal.issuer)
        )
        try:
            return self._repository.grant_staff_membership(
                actor_ref=actor_ref,
                target_ref=target_ref,
                capability=capability,
                scope_kind=scope_kind,
                scope_id=scope_id,
                valid_from=valid_from or now,
                valid_until=valid_until,
                reason=reason,
                now=now,
            )
        except AffiliateRepositoryNotFoundError:
            raise AffiliateResourceNotFoundError from None
        except AffiliateRepositoryConflictError:
            raise AffiliateConflictError from None

    def revoke_creator_membership(
        self,
        *,
        principal: ClerkPrincipal,
        membership_id: UUID,
        reason: str,
    ) -> None:
        actor_ref, now = self._authorize_membership_admin(principal)
        if not self._repository.revoke_creator_membership(
            actor_ref=actor_ref,
            membership_id=membership_id,
            reason=reason,
            now=now,
        ):
            raise AffiliateResourceNotFoundError

    def revoke_staff_membership(
        self,
        *,
        principal: ClerkPrincipal,
        membership_id: UUID,
        reason: str,
    ) -> None:
        actor_ref, now = self._authorize_membership_admin(principal)
        if not self._repository.revoke_staff_membership(
            actor_ref=actor_ref,
            membership_id=membership_id,
            reason=reason,
            now=now,
        ):
            raise AffiliateResourceNotFoundError

    def _authorize_membership_admin(self, principal: ClerkPrincipal) -> tuple[str, datetime]:
        if not self._affiliates_enabled or not self._membership_admin_enabled:
            raise AffiliateUnavailableError
        now = self._now()
        actor_ref = self._principal_ref(principal)
        self._repository.ensure_principal(principal_ref=actor_ref, now=now)
        if self._repository.has_staff_capability(
            principal_ref=actor_ref,
            capability=StaffCapability.MEMBERSHIP_ADMIN,
            scope_kind=StaffScopeKind.PLATFORM,
            scope_id=None,
            now=now,
        ):
            return actor_ref, now
        self._repository.record_denied_access(
            actor_ref=actor_ref,
            action="membership.admin",
            scope_kind=StaffScopeKind.PLATFORM,
            scope_id=None,
            now=now,
        )
        raise AffiliateForbiddenError

    def _principal_ref(self, principal: ClerkPrincipal) -> str:
        if self._principal_pseudonym_key is None:
            raise AffiliateUnavailableError
        return derive_affiliate_principal_ref(
            key=self._principal_pseudonym_key,
            principal=principal,
        )
