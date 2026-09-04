import hashlib
import json
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import DBAPIError

from app.auth.clerk import ClerkPrincipal
from app.core.config import Settings
from app.core.errors import (
    AffiliateConflictError,
    AffiliateForbiddenError,
    AffiliateReferralNotFoundError,
)
from app.modules.affiliates.domain import (
    BindStatus,
    CreatorMembershipRole,
    StaffCapability,
    StaffScopeKind,
)
from app.modules.affiliates.identity import derive_affiliate_principal_ref
from app.modules.affiliates.repository import PostgresAffiliateRepository
from app.modules.affiliates.service import AffiliateService

MIGRATION = (
    Path(__file__).resolve().parents[2] / "migrations" / "004_affiliate_identity_attribution.sql"
)
NOW = datetime(2026, 9, 2, 12, 0, tzinfo=UTC)
KEY = b"affiliate-integration-pseudonym-key-at-least-32-bytes"


@dataclass(frozen=True, slots=True)
class AffiliateDatabase:
    engine: Engine
    schema: str


@pytest.fixture
def affiliate_database() -> Generator[AffiliateDatabase]:
    database_url = Settings().database_url.get_secret_value()
    operator = create_engine(database_url, pool_pre_ping=True)
    schema = f"affiliate_test_{uuid4().hex}"

    with operator.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        connection.exec_driver_sql(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudsqlsuperuser') THEN
                CREATE ROLE cloudsqlsuperuser NOLOGIN CREATEROLE CREATEDB;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glidelingo_app') THEN
                CREATE ROLE glidelingo_app NOLOGIN;
              END IF;
            END
            $$
            """
        )
        connection.exec_driver_sql("ALTER ROLE cloudsqlsuperuser NOLOGIN CREATEROLE CREATEDB")
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'GRANT USAGE ON SCHEMA "{schema}" TO glidelingo_app')
        connection.exec_driver_sql(
            f'GRANT USAGE, CREATE ON SCHEMA "{schema}" TO cloudsqlsuperuser WITH GRANT OPTION'
        )
        connection.exec_driver_sql("GRANT cloudsqlsuperuser TO glidelingo")

    migration = MIGRATION.read_text(encoding="utf-8").replace(
        "public.affiliate_program_version",
        f'"{schema}".affiliate_program_version',
    )
    raw_connection = operator.raw_connection()
    try:
        driver_connection = cast(Any, raw_connection.driver_connection)
        driver_connection.autocommit = True
        cursor = driver_connection.cursor()
        try:
            cursor.execute("SET ROLE cloudsqlsuperuser")
            cursor.execute(f'SET search_path TO "{schema}", public')
            cursor.execute(migration)
            cursor.execute("RESET ROLE")
        finally:
            cursor.close()
    finally:
        raw_connection.close()

    engine = create_engine(
        database_url,
        connect_args={"options": f"-c search_path={schema},public -c statement_timeout=2000"},
    )
    try:
        yield AffiliateDatabase(engine=engine, schema=schema)
    finally:
        engine.dispose()
        with operator.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        operator.dispose()


def seed_referral(
    database: AffiliateDatabase,
    *,
    creator_id: UUID | None = None,
    creator_slug: str = "creator-one",
) -> dict[str, UUID]:
    ids = {
        "creator": creator_id or uuid4(),
        "program": uuid4(),
        "version": uuid4(),
        "campaign": uuid4(),
        "link": uuid4(),
    }
    policy: dict[str, dict[str, object]] = {
        "customer_offer": {},
        "attribution": {},
        "commission": {},
        "transfer": {},
        "external_payout": {},
    }
    policy_json = json.dumps(policy, separators=(",", ":"), sort_keys=True)
    with database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_creator (id, slug, display_name, status)
                VALUES (:id, :slug, 'Creator One', 'active')
                """
            ),
            {"id": ids["creator"], "slug": creator_slug},
        )
        connection.execute(
            text(
                """
                INSERT INTO affiliate_program (id, program_key, name, status)
                VALUES (:id, :key, 'Explicit Test Program', 'active')
                """
            ),
            {"id": ids["program"], "key": f"program_{ids['program'].hex}"},
        )
        connection.execute(
            text(
                """
                INSERT INTO affiliate_program_version
                  (id, program_id, version, status, policy_document, policy_hash,
                   effective_from, effective_until, published_at)
                VALUES
                  (:id, :program_id, 1, 'published', CAST(:policy AS jsonb), :policy_hash,
                   :effective_from, NULL, :published_at)
                """
            ),
            {
                "id": ids["version"],
                "program_id": ids["program"],
                "policy": policy_json,
                "policy_hash": hashlib.sha256(policy_json.encode()).hexdigest(),
                "effective_from": NOW - timedelta(days=1),
                "published_at": NOW - timedelta(days=2),
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO affiliate_campaign
                  (id, program_version_id, slug, name, status, starts_at)
                VALUES (:id, :version_id, 'campaign-one', 'Campaign One', 'active', :starts_at)
                """
            ),
            {
                "id": ids["campaign"],
                "version_id": ids["version"],
                "starts_at": NOW - timedelta(hours=1),
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO affiliate_link
                  (id, creator_id, campaign_id, slug, destination_key, status)
                VALUES (:id, :creator_id, :campaign_id, 'creator-link', 'offer', 'active')
                """
            ),
            {
                "id": ids["link"],
                "creator_id": ids["creator"],
                "campaign_id": ids["campaign"],
            },
        )
    return ids


def service(
    database: AffiliateDatabase,
    *,
    clock: list[datetime],
    tokens: list[str],
) -> AffiliateService:
    token_iterator = iter(tokens)
    return AffiliateService(
        repository=PostgresAffiliateRepository(engine=database.engine),
        affiliates_enabled=True,
        referral_resolution_enabled=True,
        attribution_binding_enabled=True,
        membership_admin_enabled=True,
        principal_pseudonym_key=KEY,
        now=lambda: clock[0],
        token_factory=lambda: next(token_iterator),
    )


@pytest.mark.integration
def test_published_versions_are_immutable_non_overlapping_and_have_no_policy_defaults(
    affiliate_database: AffiliateDatabase,
) -> None:
    ids = seed_referral(affiliate_database)

    with affiliate_database.engine.connect() as connection:
        policy = connection.execute(
            text("SELECT policy_document FROM affiliate_program_version WHERE id = :id"),
            {"id": ids["version"]},
        ).scalar_one()
    assert policy == {
        "customer_offer": {},
        "attribution": {},
        "commission": {},
        "transfer": {},
        "external_payout": {},
    }

    with affiliate_database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_code
                  (id, creator_id, campaign_id, code, status)
                VALUES (:id, :creator_id, :campaign_id, 'CreatorCode', 'active')
                """
            ),
            {
                "id": uuid4(),
                "creator_id": ids["creator"],
                "campaign_id": ids["campaign"],
            },
        )
    with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_code
                  (id, creator_id, campaign_id, code, status)
                VALUES (:id, :creator_id, :campaign_id, 'creatorcode', 'active')
                """
            ),
            {
                "id": uuid4(),
                "creator_id": ids["creator"],
                "campaign_id": ids["campaign"],
            },
        )

    with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
        connection.execute(
            text("UPDATE affiliate_program_version SET policy_document = '{}' WHERE id = :id"),
            {"id": ids["version"]},
        )

    policy_json = json.dumps(
        {
            "customer_offer": {},
            "attribution": {},
            "commission": {},
            "transfer": {},
            "external_payout": {},
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_program_version
                  (id, program_id, version, status, policy_document, policy_hash,
                   effective_from, published_at)
                VALUES
                  (:id, :program_id, 2, 'published', CAST(:policy AS jsonb), :policy_hash,
                   :effective_from, :published_at)
                """
            ),
            {
                "id": uuid4(),
                "program_id": ids["program"],
                "policy": policy_json,
                "policy_hash": hashlib.sha256(policy_json.encode()).hexdigest(),
                "effective_from": NOW,
                "published_at": NOW,
            },
        )


@pytest.mark.integration
def test_handoff_is_minimized_single_use_expiring_and_cannot_replace_a_lock(
    affiliate_database: AffiliateDatabase,
) -> None:
    seed_referral(affiliate_database)
    clock = [NOW]
    tokens = ["A" * 43, "B" * 43, "C" * 43, "D" * 43]
    affiliate_service = service(affiliate_database, clock=clock, tokens=tokens)
    first_principal = ClerkPrincipal(user_id="user_first", issuer="https://clerk.test")
    second_principal = ClerkPrincipal(user_id="user_second", issuer="https://clerk.test")

    resolved = affiliate_service.resolve_referral(
        link_slug="creator-link", campaign_slug="campaign-one"
    )
    assert resolved.handoff_token == tokens[0]
    assert resolved.expires_at == NOW + timedelta(minutes=15)

    with affiliate_database.engine.connect() as connection:
        click_columns = {
            row.column_name
            for row in connection.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = 'affiliate_click'
                    """
                )
            )
        }
        handoff_row = connection.execute(
            text("SELECT token_digest, issued_at, expires_at FROM affiliate_handoff")
        ).one()
    assert click_columns == {
        "id",
        "creator_id",
        "campaign_id",
        "program_version_id",
        "link_id",
        "clicked_at",
        "anonymous_expires_at",
    }
    assert tokens[0] not in str(handoff_row)
    assert handoff_row.expires_at - handoff_row.issued_at == timedelta(minutes=15)

    assert (
        affiliate_service.bind_attribution(
            principal=first_principal, handoff_token=tokens[0]
        ).status
        is BindStatus.BOUND
    )
    assert (
        affiliate_service.bind_attribution(
            principal=second_principal, handoff_token=tokens[0]
        ).status
        is BindStatus.ALREADY_CONSUMED
    )

    repository = PostgresAffiliateRepository(engine=affiliate_database.engine)
    first_ref = derive_affiliate_principal_ref(key=KEY, principal=first_principal)
    assert repository.lock_current_attribution(
        principal_ref=first_ref,
        lock_reference="purchase_ref_opaque",
        now=NOW + timedelta(minutes=1),
    )
    affiliate_service.resolve_referral(link_slug="creator-link", campaign_slug=None)
    assert (
        affiliate_service.bind_attribution(
            principal=first_principal, handoff_token=tokens[1]
        ).status
        is BindStatus.LOCKED
    )

    affiliate_service.resolve_referral(link_slug="creator-link", campaign_slug=None)
    clock[0] = NOW + timedelta(minutes=16)
    assert (
        affiliate_service.bind_attribution(
            principal=second_principal, handoff_token=tokens[2]
        ).status
        is BindStatus.EXPIRED
    )
    assert (
        affiliate_service.bind_attribution(
            principal=second_principal, handoff_token="Z" * 43
        ).status
        is BindStatus.INVALID
    )

    with affiliate_database.engine.connect() as connection:
        locked = connection.execute(
            text(
                """
                SELECT creator_id, state, lock_reference
                FROM affiliate_attribution
                WHERE principal_ref = :principal_ref
                """
            ),
            {"principal_ref": first_ref},
        ).one()
        consumed_locked_token = connection.execute(
            text(
                "SELECT consumed_at IS NOT NULL FROM affiliate_handoff WHERE token_digest = :digest"
            ),
            {"digest": hashlib.sha256(tokens[1].encode()).hexdigest()},
        ).scalar_one()
    assert locked.state == "locked"
    assert locked.lock_reference == "purchase_ref_opaque"
    assert consumed_locked_token is True

    with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE affiliate_attribution SET creator_id = :creator_id "
                "WHERE principal_ref = :principal_ref"
            ),
            {"creator_id": uuid4(), "principal_ref": first_ref},
        )

    with affiliate_database.engine.begin() as connection:
        connection.execute(text("UPDATE affiliate_creator SET status = 'suspended'"))
    with pytest.raises(AffiliateReferralNotFoundError):
        affiliate_service.resolve_referral(link_slug="creator-link", campaign_slug=None)


@pytest.mark.integration
def test_concurrent_handoffs_for_one_principal_serialize_attribution_replacement(
    affiliate_database: AffiliateDatabase,
) -> None:
    seed_referral(affiliate_database)
    tokens = ["E" * 43, "F" * 43]
    affiliate_service = service(affiliate_database, clock=[NOW], tokens=tokens)
    for _token in tokens:
        affiliate_service.resolve_referral(link_slug="creator-link", campaign_slug=None)

    repository = PostgresAffiliateRepository(engine=affiliate_database.engine)
    principal = ClerkPrincipal(user_id="user_concurrent", issuer="https://clerk.test")
    principal_ref = derive_affiliate_principal_ref(key=KEY, principal=principal)
    start = Barrier(2)

    def bind(token: str) -> BindStatus:
        start.wait()
        return repository.bind_attribution(
            token_digest=hashlib.sha256(token.encode()).hexdigest(),
            principal_ref=principal_ref,
            now=NOW,
        ).status

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(bind, tokens))

    assert statuses == [BindStatus.BOUND, BindStatus.BOUND]
    with affiliate_database.engine.connect() as connection:
        states = (
            connection.execute(
                text(
                    """
                SELECT state
                FROM affiliate_attribution
                WHERE principal_ref = :principal_ref
                ORDER BY state
                """
                ),
                {"principal_ref": principal_ref},
            )
            .scalars()
            .all()
        )
        consumed_count = connection.execute(
            text(
                """
                SELECT count(*)
                FROM affiliate_handoff
                WHERE consumed_by_principal_ref = :principal_ref
                """
            ),
            {"principal_ref": principal_ref},
        ).scalar_one()
    assert states == ["bound", "replaced"]
    assert consumed_count == 2


@pytest.mark.integration
def test_memberships_are_resource_scoped_audited_and_revoked_on_next_check(
    affiliate_database: AffiliateDatabase,
) -> None:
    ids = seed_referral(affiliate_database)
    other_creator = uuid4()
    with affiliate_database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_creator (id, slug, display_name, status)
                VALUES (:id, 'creator-two', 'Creator Two', 'active')
                """
            ),
            {"id": other_creator},
        )

    admin = ClerkPrincipal(user_id="user_admin", issuer="https://clerk.test")
    target = ClerkPrincipal(user_id="user_target", issuer="https://clerk.test")
    admin_ref = derive_affiliate_principal_ref(key=KEY, principal=admin)
    admin_membership_id = uuid4()
    with affiliate_database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_principal (principal_ref, first_seen_at, last_seen_at)
                VALUES (:principal_ref, :now, :now)
                """
            ),
            {"principal_ref": admin_ref, "now": NOW},
        )
        connection.execute(
            text(
                """
                INSERT INTO affiliate_staff_membership
                  (id, principal_ref, capability, scope_kind, scope_id, status,
                   granted_by_principal_ref, grant_reason, valid_from)
                VALUES
                  (:id, :principal_ref, 'membership_admin', 'platform', NULL, 'active',
                   :principal_ref, 'Reviewed test bootstrap.', :now)
                """
            ),
            {"id": admin_membership_id, "principal_ref": admin_ref, "now": NOW},
        )

    affiliate_service = service(
        affiliate_database,
        clock=[NOW + timedelta(minutes=1)],
        tokens=["A" * 43],
    )
    creator_membership = affiliate_service.grant_creator_membership(
        principal=admin,
        target_clerk_user_id=target.user_id,
        creator_id=ids["creator"],
        role=CreatorMembershipRole.MANAGER,
        valid_from=None,
        valid_until=None,
        reason="Approved creator management access.",
    )
    with pytest.raises(AffiliateConflictError):
        affiliate_service.grant_creator_membership(
            principal=admin,
            target_clerk_user_id=target.user_id,
            creator_id=ids["creator"],
            role=CreatorMembershipRole.ANALYST,
            valid_from=None,
            valid_until=None,
            reason="A second active role must not create ambiguous access.",
        )
    affiliate_service.grant_staff_membership(
        principal=admin,
        target_clerk_user_id=target.user_id,
        capability=StaffCapability.CREATOR_MANAGE,
        scope_kind=StaffScopeKind.CREATOR,
        scope_id=ids["creator"],
        valid_from=None,
        valid_until=None,
        reason="Approved scoped staff access.",
    )

    affiliate_service.authorize_creator(
        principal=target,
        creator_id=ids["creator"],
        allowed_roles=frozenset({CreatorMembershipRole.MANAGER}),
    )
    affiliate_service.authorize_staff(
        principal=target,
        capability=StaffCapability.CREATOR_MANAGE,
        scope_kind=StaffScopeKind.CREATOR,
        scope_id=ids["creator"],
    )
    with pytest.raises(AffiliateForbiddenError):
        affiliate_service.authorize_creator(
            principal=target,
            creator_id=other_creator,
            allowed_roles=frozenset({CreatorMembershipRole.MANAGER}),
        )
    with pytest.raises(AffiliateForbiddenError):
        affiliate_service.authorize_staff(
            principal=target,
            capability=StaffCapability.CREATOR_MANAGE,
            scope_kind=StaffScopeKind.CREATOR,
            scope_id=other_creator,
        )

    affiliate_service.revoke_creator_membership(
        principal=admin,
        membership_id=creator_membership.membership_id,
        reason="Access no longer required.",
    )
    with pytest.raises(AffiliateForbiddenError):
        affiliate_service.authorize_creator(
            principal=target,
            creator_id=ids["creator"],
            allowed_roles=frozenset({CreatorMembershipRole.MANAGER}),
        )

    affiliate_service.revoke_staff_membership(
        principal=admin,
        membership_id=admin_membership_id,
        reason="Bootstrap administrator rotated.",
    )
    with pytest.raises(AffiliateForbiddenError):
        affiliate_service.grant_creator_membership(
            principal=admin,
            target_clerk_user_id="user_after_revoke",
            creator_id=ids["creator"],
            role=CreatorMembershipRole.ANALYST,
            valid_from=None,
            valid_until=None,
            reason="This grant must be denied.",
        )

    with affiliate_database.engine.connect() as connection:
        serialized = str(
            connection.execute(
                text(
                    """
                    SELECT principal_ref, granted_by_principal_ref
                    FROM affiliate_principal_membership
                    """
                )
            ).all()
        )
        outcomes = connection.execute(
            text("SELECT action, outcome FROM affiliate_audit_event ORDER BY occurred_at, action")
        ).all()
    assert target.user_id not in serialized
    assert admin.user_id not in serialized
    assert ("creator.authorize", "denied") in outcomes
    assert ("membership.admin", "denied") in outcomes
    assert ("creator_membership.revoke", "succeeded") in outcomes


@pytest.mark.integration
def test_runtime_role_has_only_the_required_affiliate_dml(
    affiliate_database: AffiliateDatabase,
) -> None:
    expected = {
        "affiliate_principal": {"SELECT", "INSERT", "UPDATE"},
        "affiliate_creator": {"SELECT"},
        "affiliate_program": {"SELECT"},
        "affiliate_program_version": {"SELECT"},
        "affiliate_campaign": {"SELECT"},
        "affiliate_link": {"SELECT"},
        "affiliate_code": {"SELECT"},
        "affiliate_principal_membership": {"SELECT", "INSERT", "UPDATE"},
        "affiliate_staff_membership": {"SELECT", "INSERT", "UPDATE"},
        "affiliate_click": {"SELECT", "INSERT"},
        "affiliate_handoff": {"SELECT", "INSERT", "UPDATE"},
        "affiliate_attribution": {"SELECT", "INSERT", "UPDATE"},
        "affiliate_audit_event": {"INSERT"},
    }
    with affiliate_database.engine.connect() as connection:
        for table, privileges in expected.items():
            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                actual = connection.execute(
                    text("SELECT has_table_privilege('glidelingo_app', :table, :privilege)"),
                    {"table": table, "privilege": privilege},
                ).scalar_one()
                assert actual is (privilege in privileges), (table, privilege)

    with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL ROLE glidelingo_app")
        connection.execute(text("DELETE FROM affiliate_click"))

    with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL ROLE glidelingo_app")
        connection.execute(text("ALTER TABLE affiliate_principal ADD COLUMN forbidden text"))
