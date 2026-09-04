"""PostgreSQL persistence and transactional authorization for affiliates."""

import json
from datetime import datetime
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import Connection, Engine, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.errors import DependencyUnavailableError
from app.modules.affiliates.domain import (
    AffiliateRepositoryConflictError,
    AffiliateRepositoryNotFoundError,
    BindStatus,
    BoundAttribution,
    CreatorMembership,
    CreatorMembershipRole,
    StaffCapability,
    StaffMembership,
    StaffScopeKind,
)


class AffiliateRepository(Protocol):
    def resolve_referral(
        self,
        *,
        link_slug: str,
        campaign_slug: str | None,
        token_digest: str,
        now: datetime,
        expires_at: datetime,
    ) -> bool: ...

    def bind_attribution(
        self, *, token_digest: str, principal_ref: str, now: datetime
    ) -> BoundAttribution: ...

    def ensure_principal(self, *, principal_ref: str, now: datetime) -> None: ...

    def has_creator_role(
        self,
        *,
        principal_ref: str,
        creator_id: UUID,
        allowed_roles: frozenset[CreatorMembershipRole],
        now: datetime,
    ) -> bool: ...

    def has_staff_capability(
        self,
        *,
        principal_ref: str,
        capability: StaffCapability,
        scope_kind: StaffScopeKind,
        scope_id: UUID | None,
        now: datetime,
    ) -> bool: ...

    def record_denied_access(
        self,
        *,
        actor_ref: str,
        action: str,
        scope_kind: StaffScopeKind,
        scope_id: UUID | None,
        now: datetime,
    ) -> None: ...

    def grant_creator_membership(
        self,
        *,
        actor_ref: str,
        target_ref: str,
        creator_id: UUID,
        role: CreatorMembershipRole,
        valid_from: datetime,
        valid_until: datetime | None,
        reason: str,
        now: datetime,
    ) -> CreatorMembership: ...

    def grant_staff_membership(
        self,
        *,
        actor_ref: str,
        target_ref: str,
        capability: StaffCapability,
        scope_kind: StaffScopeKind,
        scope_id: UUID | None,
        valid_from: datetime,
        valid_until: datetime | None,
        reason: str,
        now: datetime,
    ) -> StaffMembership: ...

    def revoke_creator_membership(
        self, *, actor_ref: str, membership_id: UUID, reason: str, now: datetime
    ) -> bool: ...

    def revoke_staff_membership(
        self, *, actor_ref: str, membership_id: UUID, reason: str, now: datetime
    ) -> bool: ...

    def lock_current_attribution(
        self, *, principal_ref: str, lock_reference: str, now: datetime
    ) -> bool: ...


class PostgresAffiliateRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def resolve_referral(
        self,
        *,
        link_slug: str,
        campaign_slug: str | None,
        token_digest: str,
        now: datetime,
        expires_at: datetime,
    ) -> bool:
        click_id = uuid4()
        handoff_id = uuid4()
        try:
            with self._engine.begin() as connection:
                referral = (
                    connection.execute(
                        text(
                            """
                            SELECT link.id AS link_id,
                                   link.creator_id,
                                   link.campaign_id,
                                   campaign.program_version_id
                            FROM affiliate_link AS link
                            JOIN affiliate_creator AS creator ON creator.id = link.creator_id
                            JOIN affiliate_campaign AS campaign ON campaign.id = link.campaign_id
                            JOIN affiliate_program_version AS version
                              ON version.id = campaign.program_version_id
                            JOIN affiliate_program AS program ON program.id = version.program_id
                            WHERE link.slug = :link_slug
                              AND (
                                CAST(:campaign_slug AS text) IS NULL
                                OR campaign.slug = :campaign_slug
                              )
                              AND link.status = 'active'
                              AND creator.status = 'active'
                              AND campaign.status = 'active'
                              AND campaign.starts_at <= :now
                              AND (campaign.ends_at IS NULL OR campaign.ends_at > :now)
                              AND version.status = 'published'
                              AND version.effective_from <= :now
                              AND (
                                version.effective_until IS NULL
                                OR version.effective_until > :now
                              )
                              AND program.status = 'active'
                            FOR SHARE OF link, creator, campaign, version, program
                            """
                        ),
                        {
                            "link_slug": link_slug,
                            "campaign_slug": campaign_slug,
                            "now": now,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if referral is None:
                    return False
                connection.execute(
                    text(
                        """
                        INSERT INTO affiliate_click
                          (id, creator_id, campaign_id, program_version_id, link_id,
                           clicked_at, anonymous_expires_at)
                        VALUES
                          (:id, :creator_id, :campaign_id, :program_version_id, :link_id,
                           :clicked_at, :anonymous_expires_at)
                        """
                    ),
                    {
                        "id": click_id,
                        "creator_id": referral["creator_id"],
                        "campaign_id": referral["campaign_id"],
                        "program_version_id": referral["program_version_id"],
                        "link_id": referral["link_id"],
                        "clicked_at": now,
                        "anonymous_expires_at": expires_at,
                    },
                )
                connection.execute(
                    text(
                        """
                        INSERT INTO affiliate_handoff
                          (id, click_id, token_digest, issued_at, expires_at)
                        VALUES (:id, :click_id, :token_digest, :issued_at, :expires_at)
                        """
                    ),
                    {
                        "id": handoff_id,
                        "click_id": click_id,
                        "token_digest": token_digest,
                        "issued_at": now,
                        "expires_at": expires_at,
                    },
                )
            return True
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def bind_attribution(
        self, *, token_digest: str, principal_ref: str, now: datetime
    ) -> BoundAttribution:
        try:
            with self._engine.begin() as connection:
                handoff = (
                    connection.execute(
                        text(
                            """
                            SELECT handoff.id, handoff.consumed_at,
                                   handoff.consumed_by_principal_ref,
                                   handoff.bind_status, handoff.expires_at,
                                   click.id AS click_id, click.creator_id, click.campaign_id,
                                   click.program_version_id, click.link_id
                            FROM affiliate_handoff AS handoff
                            JOIN affiliate_click AS click ON click.id = handoff.click_id
                            WHERE handoff.token_digest = :token_digest
                            FOR UPDATE OF handoff
                            """
                        ),
                        {"token_digest": token_digest},
                    )
                    .mappings()
                    .one_or_none()
                )
                if handoff is None:
                    return BoundAttribution(status=BindStatus.INVALID)
                if handoff["consumed_at"] is not None:
                    if handoff["consumed_by_principal_ref"] == principal_ref:
                        return BoundAttribution(status=BindStatus(handoff["bind_status"]))
                    return BoundAttribution(status=BindStatus.ALREADY_CONSUMED)
                if handoff["expires_at"] <= now:
                    return BoundAttribution(status=BindStatus.EXPIRED)

                # Two valid handoffs can target the same principal concurrently. Serialize that
                # principal's attribution transition before observing or replacing current state;
                # otherwise both transactions can observe no current row and race the partial
                # unique index, leaking an infrastructure-shaped 503 to one caller.
                connection.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:principal_ref, 0))"),
                    {"principal_ref": principal_ref},
                )
                self._upsert_principal(connection, principal_ref=principal_ref, now=now)
                current = (
                    connection.execute(
                        text(
                            """
                            SELECT id, state, locked_at
                            FROM affiliate_attribution
                            WHERE principal_ref = :principal_ref
                              AND state IN ('bound', 'locked', 'corrected')
                            FOR UPDATE
                            """
                        ),
                        {"principal_ref": principal_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                if current is not None and current["locked_at"] is not None:
                    self._record_handoff_outcome(
                        connection,
                        handoff_id=handoff["id"],
                        principal_ref=principal_ref,
                        status=BindStatus.LOCKED,
                        now=now,
                    )
                    self._insert_audit(
                        connection,
                        event_id=uuid4(),
                        actor_ref=principal_ref,
                        action="attribution.bind",
                        outcome="denied",
                        scope_kind="principal",
                        scope_ref=principal_ref,
                        reason="Attribution is already locked.",
                        details={"denial": "locked"},
                        now=now,
                    )
                    return BoundAttribution(status=BindStatus.LOCKED)

                if current is not None:
                    connection.execute(
                        text(
                            """
                            UPDATE affiliate_attribution
                            SET state = 'replaced', replaced_at = :now, updated_at = :now
                            WHERE id = :attribution_id
                            """
                        ),
                        {"now": now, "attribution_id": current["id"]},
                    )

                attribution_id = uuid4()
                connection.execute(
                    text(
                        """
                        INSERT INTO affiliate_attribution
                          (id, principal_ref, creator_id, campaign_id, program_version_id,
                           link_id, click_id, state, bound_at)
                        VALUES
                          (:id, :principal_ref, :creator_id, :campaign_id, :program_version_id,
                           :link_id, :click_id, 'bound', :bound_at)
                        """
                    ),
                    {
                        "id": attribution_id,
                        "principal_ref": principal_ref,
                        "creator_id": handoff["creator_id"],
                        "campaign_id": handoff["campaign_id"],
                        "program_version_id": handoff["program_version_id"],
                        "link_id": handoff["link_id"],
                        "click_id": handoff["click_id"],
                        "bound_at": now,
                    },
                )
                self._record_handoff_outcome(
                    connection,
                    handoff_id=handoff["id"],
                    principal_ref=principal_ref,
                    status=BindStatus.BOUND,
                    now=now,
                )
                self._insert_audit(
                    connection,
                    event_id=uuid4(),
                    actor_ref=principal_ref,
                    action="attribution.bind",
                    outcome="succeeded",
                    scope_kind="principal",
                    scope_ref=principal_ref,
                    reason=None,
                    details={"attribution_id": str(attribution_id)},
                    now=now,
                )
                return BoundAttribution(status=BindStatus.BOUND)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    @staticmethod
    def _record_handoff_outcome(
        connection: Connection,
        *,
        handoff_id: UUID,
        principal_ref: str,
        status: BindStatus,
        now: datetime,
    ) -> None:
        connection.execute(
            text(
                """
                UPDATE affiliate_handoff
                SET consumed_at = :now,
                    consumed_by_principal_ref = :principal_ref,
                    bind_status = :bind_status
                WHERE id = :handoff_id
                  AND consumed_at IS NULL
                """
            ),
            {
                "now": now,
                "principal_ref": principal_ref,
                "bind_status": status.value,
                "handoff_id": handoff_id,
            },
        )

    def ensure_principal(self, *, principal_ref: str, now: datetime) -> None:
        try:
            with self._engine.begin() as connection:
                self._upsert_principal(connection, principal_ref=principal_ref, now=now)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def has_creator_role(
        self,
        *,
        principal_ref: str,
        creator_id: UUID,
        allowed_roles: frozenset[CreatorMembershipRole],
        now: datetime,
    ) -> bool:
        if not allowed_roles:
            return False
        try:
            with self._engine.connect() as connection:
                return bool(
                    connection.execute(
                        text(
                            """
                            SELECT EXISTS (
                              SELECT 1
                              FROM affiliate_principal_membership
                              WHERE principal_ref = :principal_ref
                                AND creator_id = :creator_id
                                AND role = ANY(CAST(:roles AS text[]))
                                AND status = 'active'
                                AND revoked_at IS NULL
                                AND valid_from <= :now
                                AND (valid_until IS NULL OR valid_until > :now)
                            )
                            """
                        ),
                        {
                            "principal_ref": principal_ref,
                            "creator_id": creator_id,
                            "roles": [role.value for role in allowed_roles],
                            "now": now,
                        },
                    ).scalar_one()
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def has_staff_capability(
        self,
        *,
        principal_ref: str,
        capability: StaffCapability,
        scope_kind: StaffScopeKind,
        scope_id: UUID | None,
        now: datetime,
    ) -> bool:
        try:
            with self._engine.connect() as connection:
                return bool(
                    connection.execute(
                        text(
                            """
                            SELECT EXISTS (
                              SELECT 1
                              FROM affiliate_staff_membership
                              WHERE principal_ref = :principal_ref
                                AND capability = :capability
                                AND status = 'active'
                                AND revoked_at IS NULL
                                AND valid_from <= :now
                                AND (valid_until IS NULL OR valid_until > :now)
                                AND (
                                  scope_kind = 'platform'
                                  OR (scope_kind = :scope_kind AND scope_id = :scope_id)
                                )
                            )
                            """
                        ),
                        {
                            "principal_ref": principal_ref,
                            "capability": capability.value,
                            "scope_kind": scope_kind.value,
                            "scope_id": scope_id,
                            "now": now,
                        },
                    ).scalar_one()
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def record_denied_access(
        self,
        *,
        actor_ref: str,
        action: str,
        scope_kind: StaffScopeKind,
        scope_id: UUID | None,
        now: datetime,
    ) -> None:
        try:
            with self._engine.begin() as connection:
                self._insert_audit(
                    connection,
                    event_id=uuid4(),
                    actor_ref=actor_ref,
                    action=action,
                    outcome="denied",
                    scope_kind=scope_kind.value,
                    scope_ref=str(scope_id) if scope_id is not None else None,
                    reason="Required server-owned capability is absent or inactive.",
                    details={},
                    now=now,
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def grant_creator_membership(
        self,
        *,
        actor_ref: str,
        target_ref: str,
        creator_id: UUID,
        role: CreatorMembershipRole,
        valid_from: datetime,
        valid_until: datetime | None,
        reason: str,
        now: datetime,
    ) -> CreatorMembership:
        membership_id = uuid4()
        try:
            with self._engine.begin() as connection:
                self._upsert_principal(connection, principal_ref=target_ref, now=now)
                if not connection.execute(
                    text("SELECT EXISTS (SELECT 1 FROM affiliate_creator WHERE id = :id)"),
                    {"id": creator_id},
                ).scalar_one():
                    raise AffiliateRepositoryNotFoundError
                connection.execute(
                    text(
                        """
                        INSERT INTO affiliate_principal_membership
                          (id, principal_ref, creator_id, role, status, granted_by_principal_ref,
                           grant_reason, valid_from, valid_until)
                        VALUES
                          (:id, :principal_ref, :creator_id, :role, 'active', :granted_by,
                           :reason, :valid_from, :valid_until)
                        """
                    ),
                    {
                        "id": membership_id,
                        "principal_ref": target_ref,
                        "creator_id": creator_id,
                        "role": role.value,
                        "granted_by": actor_ref,
                        "reason": reason,
                        "valid_from": valid_from,
                        "valid_until": valid_until,
                    },
                )
                self._insert_audit(
                    connection,
                    event_id=uuid4(),
                    actor_ref=actor_ref,
                    action="creator_membership.grant",
                    outcome="succeeded",
                    scope_kind="creator",
                    scope_ref=str(creator_id),
                    reason=reason,
                    details={
                        "membership_id": str(membership_id),
                        "target_principal_ref": target_ref,
                        "role": role.value,
                    },
                    now=now,
                )
        except AffiliateRepositoryNotFoundError:
            raise
        except IntegrityError as error:
            raise AffiliateRepositoryConflictError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
        return CreatorMembership(
            membership_id=membership_id,
            creator_id=creator_id,
            role=role,
            valid_from=valid_from,
            valid_until=valid_until,
        )

    def grant_staff_membership(
        self,
        *,
        actor_ref: str,
        target_ref: str,
        capability: StaffCapability,
        scope_kind: StaffScopeKind,
        scope_id: UUID | None,
        valid_from: datetime,
        valid_until: datetime | None,
        reason: str,
        now: datetime,
    ) -> StaffMembership:
        membership_id = uuid4()
        try:
            with self._engine.begin() as connection:
                self._upsert_principal(connection, principal_ref=target_ref, now=now)
                self._assert_staff_scope_exists(
                    connection, scope_kind=scope_kind, scope_id=scope_id
                )
                connection.execute(
                    text(
                        """
                        INSERT INTO affiliate_staff_membership
                          (id, principal_ref, capability, scope_kind, scope_id, status,
                           granted_by_principal_ref, grant_reason, valid_from, valid_until)
                        VALUES
                          (:id, :principal_ref, :capability, :scope_kind, :scope_id, 'active',
                           :granted_by, :reason, :valid_from, :valid_until)
                        """
                    ),
                    {
                        "id": membership_id,
                        "principal_ref": target_ref,
                        "capability": capability.value,
                        "scope_kind": scope_kind.value,
                        "scope_id": scope_id,
                        "granted_by": actor_ref,
                        "reason": reason,
                        "valid_from": valid_from,
                        "valid_until": valid_until,
                    },
                )
                self._insert_audit(
                    connection,
                    event_id=uuid4(),
                    actor_ref=actor_ref,
                    action="staff_membership.grant",
                    outcome="succeeded",
                    scope_kind=scope_kind.value,
                    scope_ref=str(scope_id) if scope_id is not None else None,
                    reason=reason,
                    details={
                        "membership_id": str(membership_id),
                        "target_principal_ref": target_ref,
                        "capability": capability.value,
                    },
                    now=now,
                )
        except AffiliateRepositoryNotFoundError:
            raise
        except IntegrityError as error:
            raise AffiliateRepositoryConflictError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
        return StaffMembership(
            membership_id=membership_id,
            capability=capability,
            scope_kind=scope_kind,
            scope_id=scope_id,
            valid_from=valid_from,
            valid_until=valid_until,
        )

    def revoke_creator_membership(
        self, *, actor_ref: str, membership_id: UUID, reason: str, now: datetime
    ) -> bool:
        return self._revoke_membership(
            table="affiliate_principal_membership",
            audit_action="creator_membership.revoke",
            actor_ref=actor_ref,
            membership_id=membership_id,
            reason=reason,
            now=now,
        )

    def revoke_staff_membership(
        self, *, actor_ref: str, membership_id: UUID, reason: str, now: datetime
    ) -> bool:
        return self._revoke_membership(
            table="affiliate_staff_membership",
            audit_action="staff_membership.revoke",
            actor_ref=actor_ref,
            membership_id=membership_id,
            reason=reason,
            now=now,
        )

    def lock_current_attribution(
        self, *, principal_ref: str, lock_reference: str, now: datetime
    ) -> bool:
        try:
            with self._engine.begin() as connection:
                result = connection.execute(
                    text(
                        """
                        UPDATE affiliate_attribution
                        SET state = 'locked', locked_at = :now,
                            lock_reference = :lock_reference, updated_at = :now
                        WHERE principal_ref = :principal_ref
                          AND state = 'bound'
                          AND locked_at IS NULL
                        """
                    ),
                    {
                        "principal_ref": principal_ref,
                        "lock_reference": lock_reference,
                        "now": now,
                    },
                )
                return result.rowcount == 1
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def _revoke_membership(
        self,
        *,
        table: str,
        audit_action: str,
        actor_ref: str,
        membership_id: UUID,
        reason: str,
        now: datetime,
    ) -> bool:
        if table not in {"affiliate_principal_membership", "affiliate_staff_membership"}:
            raise ValueError("Unsupported membership table")
        try:
            with self._engine.begin() as connection:
                revoked = (
                    connection.execute(
                        text(
                            f"""
                            UPDATE {table}
                            SET status = 'revoked', revoked_at = :now,
                                revoked_by_principal_ref = :actor_ref,
                                revoke_reason = :reason
                            WHERE id = :membership_id
                              AND status = 'active'
                              AND revoked_at IS NULL
                            RETURNING principal_ref
                            """
                        ),
                        {
                            "now": now,
                            "actor_ref": actor_ref,
                            "reason": reason,
                            "membership_id": membership_id,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if revoked is None:
                    return False
                self._insert_audit(
                    connection,
                    event_id=uuid4(),
                    actor_ref=actor_ref,
                    action=audit_action,
                    outcome="succeeded",
                    scope_kind="membership",
                    scope_ref=str(membership_id),
                    reason=reason,
                    details={"target_principal_ref": revoked["principal_ref"]},
                    now=now,
                )
                return True
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    @staticmethod
    def _upsert_principal(connection: Connection, *, principal_ref: str, now: datetime) -> None:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_principal (principal_ref, first_seen_at, last_seen_at)
                VALUES (:principal_ref, :now, :now)
                ON CONFLICT (principal_ref) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
                """
            ),
            {"principal_ref": principal_ref, "now": now},
        )

    @staticmethod
    def _assert_staff_scope_exists(
        connection: Connection, *, scope_kind: StaffScopeKind, scope_id: UUID | None
    ) -> None:
        if scope_kind is StaffScopeKind.PLATFORM:
            return
        table = "affiliate_program" if scope_kind is StaffScopeKind.PROGRAM else "affiliate_creator"
        exists = connection.execute(
            text(f"SELECT EXISTS (SELECT 1 FROM {table} WHERE id = :scope_id)"),
            {"scope_id": scope_id},
        ).scalar_one()
        if not exists:
            raise AffiliateRepositoryNotFoundError

    @staticmethod
    def _insert_audit(
        connection: Connection,
        *,
        event_id: UUID,
        actor_ref: str,
        action: str,
        outcome: str,
        scope_kind: str,
        scope_ref: str | None,
        reason: str | None,
        details: dict[str, str],
        now: datetime,
    ) -> None:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_audit_event
                  (id, actor_principal_ref, action, outcome, scope_kind, scope_ref,
                   reason, details, occurred_at)
                VALUES
                  (:id, :actor_ref, :action, :outcome, :scope_kind, :scope_ref,
                   :reason, CAST(:details AS jsonb), :occurred_at)
                """
            ),
            {
                "id": event_id,
                "actor_ref": actor_ref,
                "action": action,
                "outcome": outcome,
                "scope_kind": scope_kind,
                "scope_ref": scope_ref,
                "reason": reason,
                "details": json.dumps(details, separators=(",", ":"), sort_keys=True),
                "occurred_at": now,
            },
        )
