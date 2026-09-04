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
from app.modules.affiliates.commission_domain import (
    AuthenticatedFinancialFact,
    CommissionApplyStatus,
    CommissionFactConflictError,
    CommissionPolicyUnavailableError,
    CommissionReversalConflictError,
    CommissionSourceUnavailableError,
    FinancialFactKind,
    decode_commission_cursor,
)
from app.modules.affiliates.commission_repository import PostgresAffiliateCommissionRepository
from app.modules.affiliates.domain import (
    BindStatus,
    CreatorMembershipRole,
    StaffCapability,
    StaffScopeKind,
)
from app.modules.affiliates.identity import derive_affiliate_principal_ref, digest_handoff_token
from app.modules.affiliates.repository import PostgresAffiliateRepository
from app.modules.affiliates.service import AffiliateService

AFFILIATE_MIGRATION = (
    Path(__file__).resolve().parents[2] / "migrations" / "004_affiliate_identity_attribution.sql"
)
BILLING_EVENT_MIGRATION = (
    Path(__file__).resolve().parents[2] / "migrations" / "005_billing_event_intake.sql"
)
COMMISSION_MIGRATION = (
    Path(__file__).resolve().parents[2] / "migrations" / "007_affiliate_commission_ledger.sql"
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

    raw_connection = operator.raw_connection()
    try:
        driver_connection = cast(Any, raw_connection.driver_connection)
        driver_connection.autocommit = True
        cursor = driver_connection.cursor()
        try:
            cursor.execute("SET ROLE cloudsqlsuperuser")
            cursor.execute(f'SET search_path TO "{schema}", public')
            for migration_file in (
                AFFILIATE_MIGRATION,
                BILLING_EVENT_MIGRATION,
                COMMISSION_MIGRATION,
            ):
                migration = migration_file.read_text(encoding="utf-8").replace(
                    "public.", f'"{schema}".'
                )
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


def seed_commission_policy(
    database: AffiliateDatabase,
    *,
    program_version_id: UUID,
    rate_basis_points: int = 1250,
) -> tuple[UUID, UUID]:
    policy_id = uuid4()
    rule_id = uuid4()
    with database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_commission_policy
                  (id, program_version_id, policy_version, status)
                VALUES (:id, :program_version_id, 1, 'draft')
                """
            ),
            {"id": policy_id, "program_version_id": program_version_id},
        )
        connection.execute(
            text(
                """
                INSERT INTO affiliate_commission_rule
                  (id, policy_id, product_ref, commission_rate_basis_points, rounding_mode)
                VALUES
                  (:id, :policy_id, 'monthly', :rate_basis_points, 'half_up')
                """
            ),
            {
                "id": rule_id,
                "policy_id": policy_id,
                "rate_basis_points": rate_basis_points,
            },
        )
        connection.execute(
            text(
                """
                UPDATE affiliate_commission_policy
                SET status = 'active', effective_from = :effective_from,
                    activated_at = :activated_at
                WHERE id = :id
                """
            ),
            {
                "id": policy_id,
                "effective_from": NOW - timedelta(days=1),
                "activated_at": NOW - timedelta(days=1),
            },
        )
    return policy_id, rule_id


def financial_fact(
    *,
    event_id: str,
    transaction_ref: str,
    kind: FinancialFactKind = FinancialFactKind.PURCHASE,
    occurred_at: datetime = NOW,
    principal_ref: str | None = None,
    amount_minor: int = 1999,
    reverses_transaction_ref: str | None = None,
    payload_sha256: str | None = None,
) -> AuthenticatedFinancialFact:
    return AuthenticatedFinancialFact(
        environment="TEST",
        provider_account_ref="acct_test",
        provider_event_id=event_id,
        provider_transaction_ref=transaction_ref,
        kind=kind,
        occurred_at=occurred_at,
        principal_ref=principal_ref if kind is FinancialFactKind.PURCHASE else None,
        product_ref="monthly" if kind is FinancialFactKind.PURCHASE else None,
        currency_code="USD",
        gross_amount_minor=amount_minor,
        reverses_provider_transaction_ref=reverses_transaction_ref,
        payload_sha256=payload_sha256 or hashlib.sha256(event_id.encode()).hexdigest(),
    )


def insert_billing_event(
    database: AffiliateDatabase,
    *,
    event_type: str,
    transaction_ref: str,
    occurred_at: datetime = NOW,
) -> UUID:
    event_ref = uuid4()
    with database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO billing_event_inbox
                  (event_ref, provider, environment, provider_account_ref,
                   provider_event_id, event_type, occurred_at, received_at,
                   object_refs, schema_version, payload_sha256)
                VALUES
                  (:event_ref, 'revenuecat', 'SANDBOX', 'app_test',
                   :provider_event_id, :event_type, :occurred_at, :received_at,
                   CAST(:object_refs AS jsonb), 1, :payload_sha256)
                """
            ),
            {
                "event_ref": event_ref,
                "provider_event_id": f"evt_{event_ref.hex}",
                "event_type": event_type,
                "occurred_at": occurred_at,
                "received_at": max(occurred_at, NOW),
                "object_refs": json.dumps(
                    {"product": "monthly", "transaction": transaction_ref},
                    separators=(",", ":"),
                ),
                "payload_sha256": hashlib.sha256(event_ref.bytes).hexdigest(),
            },
        )
    return event_ref


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
def test_attribution_replacement_and_purchase_accrual_share_one_principal_boundary(
    affiliate_database: AffiliateDatabase,
) -> None:
    ids = seed_referral(affiliate_database)
    principal = ClerkPrincipal(user_id="user_bind_purchase_race", issuer="https://clerk.test")
    affiliate_service = service(
        affiliate_database,
        clock=[NOW],
        tokens=["I" * 43, "J" * 43],
    )
    affiliate_service.resolve_referral(link_slug="creator-link", campaign_slug=None)
    affiliate_service.bind_attribution(principal=principal, handoff_token="I" * 43)

    replacement_creator_id = uuid4()
    with affiliate_database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_creator (id, slug, display_name, status)
                VALUES (:id, 'creator-two', 'Creator Two', 'active')
                """
            ),
            {"id": replacement_creator_id},
        )
        connection.execute(
            text(
                """
                INSERT INTO affiliate_link
                  (id, creator_id, campaign_id, slug, destination_key, status)
                VALUES (:id, :creator_id, :campaign_id, 'creator-link-two', 'offer', 'active')
                """
            ),
            {
                "id": uuid4(),
                "creator_id": replacement_creator_id,
                "campaign_id": ids["campaign"],
            },
        )
    affiliate_service.resolve_referral(link_slug="creator-link-two", campaign_slug=None)
    seed_commission_policy(affiliate_database, program_version_id=ids["version"])

    principal_ref = derive_affiliate_principal_ref(key=KEY, principal=principal)
    affiliate_repository = PostgresAffiliateRepository(engine=affiliate_database.engine)
    commission_repository = PostgresAffiliateCommissionRepository(engine=affiliate_database.engine)
    race_at = NOW + timedelta(seconds=1)
    purchase = financial_fact(
        event_id="evt_bind_purchase_race",
        transaction_ref="ch_bind_purchase_race",
        occurred_at=race_at,
        principal_ref=principal_ref,
    )
    start = Barrier(2)

    def replace_attribution() -> BindStatus:
        start.wait()
        return affiliate_repository.bind_attribution(
            token_digest=digest_handoff_token("J" * 43),
            principal_ref=principal_ref,
            now=race_at,
        ).status

    def accrue_purchase() -> CommissionApplyStatus:
        start.wait()
        return commission_repository.accept_financial_fact(
            fact=purchase,
            processed_at=race_at,
        ).status

    with ThreadPoolExecutor(max_workers=2) as pool:
        bind_future = pool.submit(replace_attribution)
        accrual_future = pool.submit(accrue_purchase)
        bind_status = bind_future.result()
        accrual_status = accrual_future.result()

    assert accrual_status is CommissionApplyStatus.ACCRUED
    assert bind_status in {BindStatus.BOUND, BindStatus.LOCKED}
    with affiliate_database.engine.connect() as connection:
        accrued_creator_id = connection.execute(
            text(
                "SELECT creator_id FROM affiliate_commission_entry "
                "WHERE provider_transaction_ref = 'ch_bind_purchase_race'"
            )
        ).scalar_one()
    assert accrued_creator_id == (
        replacement_creator_id if bind_status is BindStatus.BOUND else ids["creator"]
    )


@pytest.mark.integration
def test_commission_ledger_is_concurrent_idempotent_and_conserves_refunds(
    affiliate_database: AffiliateDatabase,
) -> None:
    ids = seed_referral(affiliate_database)
    principal = ClerkPrincipal(user_id="user_commission", issuer="https://clerk.test")
    affiliate_service = service(
        affiliate_database,
        clock=[NOW],
        tokens=["G" * 43],
    )
    affiliate_service.resolve_referral(link_slug="creator-link", campaign_slug=None)
    assert (
        affiliate_service.bind_attribution(principal=principal, handoff_token="G" * 43).status
        is BindStatus.BOUND
    )
    seed_commission_policy(
        affiliate_database,
        program_version_id=ids["version"],
    )
    repository = PostgresAffiliateCommissionRepository(engine=affiliate_database.engine)
    principal_ref = derive_affiliate_principal_ref(key=KEY, principal=principal)
    purchase = financial_fact(
        event_id="evt_purchase_1",
        transaction_ref="ch_commission_1",
        principal_ref=principal_ref,
    )
    start = Barrier(2)

    def accrue(_: int) -> CommissionApplyStatus:
        start.wait()
        return repository.accept_financial_fact(fact=purchase, processed_at=NOW).status

    with ThreadPoolExecutor(max_workers=2) as pool:
        accrual_results = list(pool.map(accrue, range(2)))
    assert sorted(accrual_results) == [
        CommissionApplyStatus.ACCRUED,
        CommissionApplyStatus.DUPLICATE,
    ]

    refund = financial_fact(
        event_id="evt_refund_1",
        transaction_ref="re_commission_1",
        kind=FinancialFactKind.REFUND,
        occurred_at=NOW + timedelta(minutes=1),
        reverses_transaction_ref="ch_commission_1",
    )
    assert (
        repository.accept_financial_fact(
            fact=refund, processed_at=NOW + timedelta(minutes=1)
        ).status
        is CommissionApplyStatus.REFUNDED
    )
    assert (
        repository.accept_financial_fact(
            fact=refund, processed_at=NOW + timedelta(minutes=1)
        ).status
        is CommissionApplyStatus.DUPLICATE
    )

    reinstatement = financial_fact(
        event_id="evt_refund_reversal_1",
        transaction_ref="rr_commission_1",
        kind=FinancialFactKind.REFUND_REVERSAL,
        occurred_at=NOW + timedelta(minutes=2),
        reverses_transaction_ref="re_commission_1",
    )
    assert (
        repository.accept_financial_fact(
            fact=reinstatement, processed_at=NOW + timedelta(minutes=2)
        ).status
        is CommissionApplyStatus.REINSTATED
    )

    with affiliate_database.engine.connect() as connection:
        entries = connection.execute(
            text(
                """
                SELECT entry_kind, basis_amount_minor, commission_amount_minor
                FROM affiliate_commission_entry
                ORDER BY occurred_at
                """
            )
        ).all()
        attribution = connection.execute(
            text(
                """
                SELECT state, lock_reference
                FROM affiliate_attribution
                WHERE principal_ref = :principal_ref
                """
            ),
            {"principal_ref": principal_ref},
        ).one()
    assert [tuple(entry) for entry in entries] == [
        ("accrual", 1999, 250),
        ("refund", -1999, -250),
        ("reinstatement", 1999, 250),
    ]
    assert sum(entry.commission_amount_minor for entry in entries) == 250
    assert attribution.state == "locked"
    assert attribution.lock_reference.startswith("financial_fact:")

    with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
        connection.execute(
            text("UPDATE affiliate_commission_entry SET commission_amount_minor = 999")
        )
    for statement in (
        "UPDATE affiliate_financial_fact SET gross_amount_minor = 1",
        "DELETE FROM affiliate_financial_fact",
    ):
        with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
            connection.execute(text(statement))


@pytest.mark.integration
def test_commission_conflicts_and_reversal_chronology_fail_for_manual_review(
    affiliate_database: AffiliateDatabase,
) -> None:
    ids = seed_referral(affiliate_database)
    principal = ClerkPrincipal(user_id="user_conflict", issuer="https://clerk.test")
    affiliate_service = service(affiliate_database, clock=[NOW], tokens=["H" * 43])
    affiliate_service.resolve_referral(link_slug="creator-link", campaign_slug=None)
    affiliate_service.bind_attribution(principal=principal, handoff_token="H" * 43)
    principal_ref = derive_affiliate_principal_ref(key=KEY, principal=principal)
    seed_commission_policy(affiliate_database, program_version_id=ids["version"])
    repository = PostgresAffiliateCommissionRepository(engine=affiliate_database.engine)
    purchase = financial_fact(
        event_id="evt_conflict_purchase",
        transaction_ref="ch_conflict",
        principal_ref=principal_ref,
    )
    assert (
        repository.accept_financial_fact(fact=purchase, processed_at=NOW).status
        is CommissionApplyStatus.ACCRUED
    )

    chronological_fact_id = uuid4()
    with affiliate_database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_financial_fact
                  (id, provider, environment, provider_account_ref, provider_event_id,
                   provider_transaction_ref, fact_kind, occurred_at, currency_code,
                   gross_amount_minor, reverses_provider_transaction_ref, payload_sha256,
                   recorded_at)
                VALUES
                  (:id, 'stripe', 'TEST', 'acct_test', 'evt_db_chronology',
                   're_db_chronology', 'refund', :occurred_at, 'USD', 1999,
                   'ch_conflict', :payload_sha256, :recorded_at)
                """
            ),
            {
                "id": chronological_fact_id,
                "occurred_at": NOW - timedelta(seconds=1),
                "payload_sha256": "d" * 64,
                "recorded_at": NOW,
            },
        )
    with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_commission_entry
                  (id, source_fact_ref, attribution_id, creator_id, program_version_id,
                   policy_id, rule_id, provider, environment, provider_account_ref,
                   provider_transaction_ref, entry_kind, currency_code, basis_amount_minor,
                   commission_rate_basis_points, commission_amount_minor, reverses_entry_id,
                   occurred_at, recorded_at)
                SELECT
                  :id, :source_fact_ref, attribution_id, creator_id, program_version_id,
                  policy_id, rule_id, provider, environment, provider_account_ref,
                  're_db_chronology', 'refund', currency_code, -basis_amount_minor,
                  commission_rate_basis_points, -commission_amount_minor, id,
                  :occurred_at, :recorded_at
                FROM affiliate_commission_entry
                WHERE provider_transaction_ref = 'ch_conflict'
                """
            ),
            {
                "id": uuid4(),
                "source_fact_ref": chronological_fact_id,
                "occurred_at": NOW - timedelta(seconds=1),
                "recorded_at": NOW,
            },
        )

    with pytest.raises(CommissionFactConflictError):
        repository.accept_financial_fact(
            fact=financial_fact(
                event_id="evt_conflict_purchase",
                transaction_ref="ch_conflict",
                principal_ref=principal_ref,
                payload_sha256="f" * 64,
            ),
            processed_at=NOW,
        )
    with pytest.raises(CommissionFactConflictError):
        repository.accept_financial_fact(
            fact=financial_fact(
                event_id="evt_other_for_same_transaction",
                transaction_ref="ch_conflict",
                principal_ref=principal_ref,
            ),
            processed_at=NOW,
        )

    for event_id, occurred_at, amount_minor in (
        ("evt_refund_too_early", NOW - timedelta(seconds=1), 1999),
        ("evt_refund_wrong_amount", NOW + timedelta(seconds=1), 1000),
    ):
        with pytest.raises(CommissionReversalConflictError):
            repository.accept_financial_fact(
                fact=financial_fact(
                    event_id=event_id,
                    transaction_ref=f"re_{event_id}",
                    kind=FinancialFactKind.REFUND,
                    occurred_at=occurred_at,
                    amount_minor=amount_minor,
                    reverses_transaction_ref="ch_conflict",
                ),
                processed_at=NOW + timedelta(minutes=1),
            )

    accepted_refund = financial_fact(
        event_id="evt_accepted_refund",
        transaction_ref="re_accepted",
        kind=FinancialFactKind.REFUND,
        occurred_at=NOW + timedelta(minutes=1),
        reverses_transaction_ref="ch_conflict",
    )
    repository.accept_financial_fact(fact=accepted_refund, processed_at=NOW + timedelta(minutes=1))
    with pytest.raises(CommissionReversalConflictError):
        repository.accept_financial_fact(
            fact=financial_fact(
                event_id="evt_invalid_refund_sequence",
                transaction_ref="re_invalid_sequence",
                kind=FinancialFactKind.REFUND,
                occurred_at=NOW + timedelta(minutes=2),
                reverses_transaction_ref="re_accepted",
            ),
            processed_at=NOW + timedelta(minutes=2),
        )
    with pytest.raises(CommissionReversalConflictError):
        repository.accept_financial_fact(
            fact=financial_fact(
                event_id="evt_contradictory_second_refund",
                transaction_ref="re_second",
                kind=FinancialFactKind.REFUND,
                occurred_at=NOW + timedelta(minutes=2),
                reverses_transaction_ref="ch_conflict",
            ),
            processed_at=NOW + timedelta(minutes=2),
        )
    with pytest.raises(CommissionSourceUnavailableError):
        repository.accept_financial_fact(
            fact=financial_fact(
                event_id="evt_missing_source",
                transaction_ref="re_missing",
                kind=FinancialFactKind.REFUND,
                reverses_transaction_ref="ch_missing",
            ),
            processed_at=NOW,
        )


@pytest.mark.integration
def test_commission_processing_fails_closed_before_attribution_or_without_policy(
    affiliate_database: AffiliateDatabase,
) -> None:
    seed_referral(affiliate_database)
    principal = ClerkPrincipal(user_id="user_unconfigured", issuer="https://clerk.test")
    affiliate_service = service(affiliate_database, clock=[NOW], tokens=["U" * 43])
    affiliate_service.resolve_referral(link_slug="creator-link", campaign_slug=None)
    affiliate_service.bind_attribution(principal=principal, handoff_token="U" * 43)
    principal_ref = derive_affiliate_principal_ref(key=KEY, principal=principal)
    repository = PostgresAffiliateCommissionRepository(engine=affiliate_database.engine)

    before_attribution = financial_fact(
        event_id="evt_before_attribution",
        transaction_ref="ch_before_attribution",
        occurred_at=NOW - timedelta(minutes=1),
        principal_ref=principal_ref,
    )
    assert (
        repository.accept_financial_fact(
            fact=before_attribution,
            processed_at=NOW,
        ).status
        is CommissionApplyStatus.INELIGIBLE
    )
    assert (
        repository.accept_financial_fact(
            fact=before_attribution,
            processed_at=NOW,
        ).status
        is CommissionApplyStatus.DUPLICATE
    )
    with pytest.raises(CommissionPolicyUnavailableError):
        repository.accept_financial_fact(
            fact=financial_fact(
                event_id="evt_without_policy",
                transaction_ref="ch_without_policy",
                principal_ref=principal_ref,
            ),
            processed_at=NOW,
        )


@pytest.mark.integration
def test_commission_policy_rule_cannot_reparent_away_from_active_policy(
    affiliate_database: AffiliateDatabase,
) -> None:
    ids = seed_referral(affiliate_database)
    active_policy_id, active_rule_id = seed_commission_policy(
        affiliate_database, program_version_id=ids["version"]
    )
    draft_policy_id = uuid4()
    draft_rule_id = uuid4()
    with affiliate_database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_commission_policy
                  (id, program_version_id, policy_version, status)
                VALUES (:id, :program_version_id, 2, 'draft')
                """
            ),
            {"id": draft_policy_id, "program_version_id": ids["version"]},
        )
        connection.execute(
            text(
                """
                INSERT INTO affiliate_commission_rule
                  (id, policy_id, product_ref, commission_rate_basis_points, rounding_mode)
                VALUES (:id, :policy_id, 'annual', 1250, 'half_up')
                """
            ),
            {"id": draft_rule_id, "policy_id": draft_policy_id},
        )
    with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
        connection.execute(
            text("UPDATE affiliate_commission_rule SET policy_id = :draft WHERE id = :rule"),
            {"draft": draft_policy_id, "rule": active_rule_id},
        )
    with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
        connection.execute(
            text("UPDATE affiliate_commission_rule SET policy_id = :active WHERE id = :rule"),
            {"active": active_policy_id, "rule": draft_rule_id},
        )


@pytest.mark.integration
def test_active_commission_policy_and_rules_are_immutable(
    affiliate_database: AffiliateDatabase,
) -> None:
    ids = seed_referral(affiliate_database)
    policy_id, rule_id = seed_commission_policy(
        affiliate_database,
        program_version_id=ids["version"],
    )

    attempts = (
        ("UPDATE affiliate_commission_policy SET effective_until = :now WHERE id = :id", policy_id),
        ("DELETE FROM affiliate_commission_policy WHERE id = :id", policy_id),
        (
            "UPDATE affiliate_commission_rule SET commission_rate_basis_points = 1 WHERE id = :id",
            rule_id,
        ),
        ("DELETE FROM affiliate_commission_rule WHERE id = :id", rule_id),
    )
    for statement, identifier in attempts:
        with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
            connection.execute(text(statement), {"id": identifier, "now": NOW})

    with pytest.raises(DBAPIError), affiliate_database.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO affiliate_commission_rule
                  (id, policy_id, product_ref, commission_rate_basis_points, rounding_mode)
                VALUES (:id, :policy_id, 'annual', 1250, 'half_up')
                """
            ),
            {"id": uuid4(), "policy_id": policy_id},
        )


@pytest.mark.integration
def test_concurrent_overlapping_commission_policy_activation_has_one_winner(
    affiliate_database: AffiliateDatabase,
) -> None:
    ids = seed_referral(affiliate_database)
    policy_ids = [uuid4(), uuid4()]
    with affiliate_database.engine.begin() as connection:
        for version, policy_id in enumerate(policy_ids, start=1):
            connection.execute(
                text(
                    """
                    INSERT INTO affiliate_commission_policy
                      (id, program_version_id, policy_version, status)
                    VALUES (:id, :program_version_id, :version, 'draft')
                    """
                ),
                {
                    "id": policy_id,
                    "program_version_id": ids["version"],
                    "version": version,
                },
            )

    start = Barrier(2)

    def activate(policy_id: UUID) -> str:
        start.wait()
        try:
            with affiliate_database.engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        UPDATE affiliate_commission_policy
                        SET status = 'active', effective_from = :effective_from,
                            activated_at = :activated_at
                        WHERE id = :id
                        """
                    ),
                    {
                        "id": policy_id,
                        "effective_from": NOW - timedelta(days=1),
                        "activated_at": NOW,
                    },
                )
            return "active"
        except DBAPIError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(activate, policy_ids))

    assert sorted(outcomes) == ["active", "conflict"]
    with affiliate_database.engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT count(*) FROM affiliate_commission_policy WHERE status = 'active'")
            ).scalar_one()
            == 1
        )


@pytest.mark.integration
def test_commission_cursor_pages_all_equal_timestamp_entries(
    affiliate_database: AffiliateDatabase,
) -> None:
    ids = seed_referral(affiliate_database)
    principal = ClerkPrincipal(user_id="user_paging", issuer="https://clerk.test")
    affiliate_service = service(affiliate_database, clock=[NOW], tokens=["P" * 43])
    affiliate_service.resolve_referral(link_slug="creator-link", campaign_slug=None)
    affiliate_service.bind_attribution(principal=principal, handoff_token="P" * 43)
    principal_ref = derive_affiliate_principal_ref(key=KEY, principal=principal)
    seed_commission_policy(affiliate_database, program_version_id=ids["version"])
    repository = PostgresAffiliateCommissionRepository(engine=affiliate_database.engine)
    for number in range(3):
        repository.accept_financial_fact(
            fact=financial_fact(
                event_id=f"evt_page_{number}",
                transaction_ref=f"ch_page_{number}",
                principal_ref=principal_ref,
            ),
            processed_at=NOW,
        )

    first = repository.list_creator_entries(creator_id=ids["creator"], cursor=None, limit=2)
    assert first.next_cursor is not None
    second = repository.list_creator_entries(
        creator_id=ids["creator"],
        cursor=decode_commission_cursor(first.next_cursor),
        limit=2,
    )

    combined_ids = [entry.entry_id for entry in (*first.entries, *second.entries)]
    assert len(combined_ids) == 3
    assert len(set(combined_ids)) == 3
    assert second.next_cursor is None


@pytest.mark.integration
def test_revenuecat_billing_event_cannot_append_commission_entry(
    affiliate_database: AffiliateDatabase,
) -> None:
    insert_billing_event(
        affiliate_database,
        event_type="INITIAL_PURCHASE",
        transaction_ref="revenuecat_transaction_only",
    )
    with affiliate_database.engine.connect() as connection:
        assert (
            connection.execute(text("SELECT count(*) FROM affiliate_financial_fact")).scalar_one()
            == 0
        )
        assert (
            connection.execute(text("SELECT count(*) FROM affiliate_commission_entry")).scalar_one()
            == 0
        )


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
        "affiliate_financial_fact": set(),
        "affiliate_commission_policy": set(),
        "affiliate_commission_rule": set(),
        "affiliate_commission_entry": {"SELECT"},
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
