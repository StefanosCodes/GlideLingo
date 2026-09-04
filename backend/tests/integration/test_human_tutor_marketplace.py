import asyncio
import json
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from threading import Barrier
from time import sleep
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import DBAPIError

from app.core.config import Settings
from app.core.errors import MarketplaceMessageLimitedError, TutorApplicationConflictError
from app.db.engine import DatabaseUnavailableError, create_database_probe
from app.modules.human_tutor_marketplace.availability import TimeInterval
from app.modules.human_tutor_marketplace.booking import (
    BookingService,
    PostgresBookingRepository,
    StripeCheckout,
    StripeConnectAccount,
    StripeMarketplaceProvider,
    StripeMoneyResult,
)
from app.modules.human_tutor_marketplace.calendar import PostgresCalendarRepository
from app.modules.human_tutor_marketplace.discovery import (
    MarketplaceDiscoveryService,
    PostgresDiscoveryRepository,
)
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref
from app.modules.human_tutor_marketplace.learning_bridge import (
    FollowUpRecommendation,
    LearningBrief,
    PostgresLearningBridgeRepository,
)
from app.modules.human_tutor_marketplace.lifecycle import (
    PostgresLifecycleRepository,
    next_weekly_payout_at,
)
from app.modules.human_tutor_marketplace.messaging import (
    MessagingService,
    PostgresMessagingRepository,
)
from app.modules.human_tutor_marketplace.repository import (
    PostgresTutorApplicationRepository,
    StoredTutorProfile,
)
from app.modules.human_tutor_marketplace.schemas import (
    AvailabilityRuleInput,
    ChangeTutorStatusRequest,
    CreateTutorApplicationRequest,
    ReplaceManualAvailabilityRequest,
    SaveTutorCredentialRequest,
    SaveTutorOfferingRequest,
    UpdateTutorApplicationDraftRequest,
    UpdateTutorProfileDraftRequest,
)

MIGRATIONS = (
    Path(__file__).resolve().parents[2] / "migrations" / "006_human_tutor_marketplace_core.sql",
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "008_human_tutor_marketplace_discovery_availability.sql",
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "009_human_tutor_marketplace_google_calendar.sql",
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "010_human_tutor_marketplace_messaging.sql",
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "011_human_tutor_marketplace_booking_checkout.sql",
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "012_human_tutor_marketplace_lifecycle_money_reviews.sql",
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "013_human_tutor_marketplace_learning_bridge.sql",
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "014_human_tutor_marketplace_hardening.sql",
)
SAFE_SEARCH_PATH = "pg_catalog, public, pg_temp"
TUTOR_ACTOR = derive_marketplace_actor_ref(
    key=b"marketplace-integration-pseudonym-key-32-bytes",
    clerk_user_id="user_tutor_integration",
)
OPERATOR_ACTOR = derive_marketplace_actor_ref(
    key=b"marketplace-integration-pseudonym-key-32-bytes",
    clerk_user_id="user_operator_integration",
)
SECOND_OPERATOR_ACTOR = derive_marketplace_actor_ref(
    key=b"marketplace-integration-pseudonym-key-32-bytes",
    clerk_user_id="user_second_operator_integration",
)
LEARNER_ACTOR = derive_marketplace_actor_ref(
    key=b"marketplace-integration-pseudonym-key-32-bytes",
    clerk_user_id="user_learner_integration",
)
OUTSIDER_ACTOR = derive_marketplace_actor_ref(
    key=b"marketplace-integration-pseudonym-key-32-bytes",
    clerk_user_id="user_outsider_integration",
)


class FakeReconciliationStripe:
    def __init__(self) -> None:
        self.checkouts: dict[str, StripeCheckout] = {}
        self.checkouts_by_key: dict[str, StripeCheckout] = {}
        self.created_idempotency_keys: list[str] = []

    async def get_platform_account_id(self) -> str:
        return "acct_reviewed123"

    async def create_checkout(self, **kwargs: Any) -> StripeCheckout:
        booking_id = cast(UUID, kwargs["booking_id"])
        idempotency_key = cast(str, kwargs["idempotency_key"])
        self.created_idempotency_keys.append(idempotency_key)
        if idempotency_key in self.checkouts_by_key:
            return self.checkouts_by_key[idempotency_key]
        checkout = StripeCheckout(
            checkout_id=f"cs_test_{booking_id.hex[:12]}",
            url="https://checkout.stripe.com/c/pay/reconciled123",
            payment_intent_id=f"pi_{booking_id.hex[:12]}",
            status="open",
            payment_status="unpaid",
            livemode=False,
            booking_id=booking_id,
            platform_account_id="acct_reviewed123",
            amount_minor=cast(int, kwargs["amount_minor"]),
            currency=cast(str, kwargs["currency"]),
            created_at=datetime.now(UTC),
        )
        self.checkouts[checkout.checkout_id] = checkout
        self.checkouts_by_key[idempotency_key] = checkout
        return checkout

    async def retrieve_checkout(self, *, checkout_id: str) -> StripeCheckout:
        return self.checkouts[checkout_id]

    async def expire_checkout(self, *, checkout_id: str) -> StripeCheckout:
        expired = self.checkouts[checkout_id]
        expired = StripeCheckout(
            checkout_id=expired.checkout_id,
            url=None,
            payment_intent_id=expired.payment_intent_id,
            status="expired",
            payment_status="unpaid",
            livemode=expired.livemode,
            booking_id=expired.booking_id,
            platform_account_id=expired.platform_account_id,
            amount_minor=expired.amount_minor,
            currency=expired.currency,
            created_at=datetime.now(UTC),
        )
        self.checkouts[checkout_id] = expired
        return expired


@pytest.fixture
def marketplace_engine() -> Generator[Engine]:
    database_url = Settings().database_url.get_secret_value()
    operator = create_engine(database_url, pool_pre_ping=True)
    schema = f"marketplace_test_{uuid4().hex}"

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
        connection.exec_driver_sql("GRANT glidelingo_app TO cloudsqlsuperuser WITH ADMIN OPTION")
        connection.exec_driver_sql("GRANT cloudsqlsuperuser TO glidelingo")

    raw_connection = operator.raw_connection()
    try:
        driver_connection = cast(Any, raw_connection.driver_connection)
        driver_connection.autocommit = True
        cursor = driver_connection.cursor()
        try:
            cursor.execute("SET ROLE cloudsqlsuperuser")
            cursor.execute(f'SET search_path TO "{schema}", public')
            for migration in MIGRATIONS:
                migration_sql = migration.read_text(encoding="utf-8").replace(
                    f"SET search_path = {SAFE_SEARCH_PATH}",
                    f'SET search_path = pg_catalog, "{schema}", public, pg_temp',
                )
                cursor.execute(migration_sql)
            cursor.execute("RESET ROLE")
            cursor.execute(f'SET search_path TO "{schema}", public')
            cursor.executemany(
                """
                INSERT INTO marketplace_operator_capability (actor_ref, capability)
                VALUES (%s, %s)
                """,
                [
                    (OPERATOR_ACTOR, "review_tutor_applications"),
                    (OPERATOR_ACTOR, "manage_tutor_status"),
                    (OPERATOR_ACTOR, "verify_tutor_credentials"),
                    (OPERATOR_ACTOR, "review_message_reports"),
                    (OPERATOR_ACTOR, "manage_bookings"),
                    (OPERATOR_ACTOR, "moderate_reviews"),
                ],
            )
        finally:
            cursor.close()
    finally:
        raw_connection.close()

    engine = create_engine(
        database_url,
        connect_args={"options": f"-c search_path={schema},public -c statement_timeout=2000"},
    )
    try:
        yield engine
    finally:
        engine.dispose()
        with operator.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        operator.dispose()


@pytest.fixture
def marketplace_runtime_engines(
    marketplace_engine: Engine,
) -> Generator[tuple[Engine, Engine]]:
    with marketplace_engine.connect() as connection:
        schema = connection.execute(text("SELECT current_schema()")).scalar_one()
    database_url = Settings().database_url.get_secret_value()
    common = f"-c search_path={schema},public -c statement_timeout=2000"
    app_engine = create_engine(
        database_url,
        connect_args={"options": f"{common} -c role=glidelingo_app"},
    )
    payment_engine = create_engine(
        database_url,
        connect_args={"options": f"{common} -c role=glidelingo_marketplace_payment_worker"},
    )
    try:
        yield app_engine, payment_engine
    finally:
        payment_engine.dispose()
        app_engine.dispose()


def application_request() -> CreateTutorApplicationRequest:
    return CreateTutorApplicationRequest(
        headline="Practical conversation tutor",
        biography="I help adults practice calm, useful conversation for everyday situations.",
        time_zone="America/Chicago",
        languages=["en", "el-GR"],
        specialties=["Conversation", "Travel"],
    )


def create_approved_tutor(
    repository: PostgresTutorApplicationRepository,
) -> tuple[UUID, StoredTutorProfile]:
    application_id = uuid4()
    draft = repository.create_draft(
        application_id=application_id,
        actor_ref=TUTOR_ACTOR,
        request=application_request(),
    )
    submitted = repository.submit(actor_ref=TUTOR_ACTOR, expected_version=draft.version)
    assert submitted is not None
    review = repository.start_review(
        application_id=application_id,
        operator_actor_ref=OPERATOR_ACTOR,
        expected_version=submitted.version,
    )
    assert review is not None
    approved = repository.decide(
        application_id=application_id,
        operator_actor_ref=OPERATOR_ACTOR,
        decision="approved",
        reason="Identity and application review passed.",
        expected_version=review.version,
    )
    assert approved is not None
    profile = repository.get_profile_by_actor(actor_ref=TUTOR_ACTOR)
    assert profile is not None
    return application_id, profile


def create_bookable_tutor(
    marketplace_engine: Engine,
) -> tuple[PostgresTutorApplicationRepository, PostgresBookingRepository, StoredTutorProfile]:
    core = PostgresTutorApplicationRepository(engine=marketplace_engine)
    booking = PostgresBookingRepository(engine=marketplace_engine)
    _, profile = create_approved_tutor(core)
    connected = booking.store_connect_account(
        tutor_actor_ref=TUTOR_ACTOR,
        account=StripeConnectAccount(
            account_id="acct_reviewed123",
            livemode=False,
            details_submitted=True,
            charges_enabled=True,
            payouts_enabled=True,
            requirements_due=0,
            observed_at=datetime.now(UTC),
        ),
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert connected is not None and connected.payouts_enabled
    assert booking.save_meeting_url(
        tutor_actor_ref=TUTOR_ACTOR,
        url="https://meet.example.com/reviewed-room",
    )
    refreshed = core.get_profile_by_actor(actor_ref=TUTOR_ACTOR)
    assert refreshed is not None
    offered = core.save_offering(
        actor_ref=TUTOR_ACTOR,
        request=SaveTutorOfferingRequest(
            expected_version=0,
            title="Safe conversation lesson",
            duration_minutes=25,
            amount_minor=2500,
            currency="USD",
        ),
    )
    assert offered is not None and offered.offering is not None
    published = core.set_publication(
        actor_ref=TUTOR_ACTOR,
        expected_profile_version=offered.version,
        expected_offering_version=offered.offering.version,
        publish=True,
    )
    assert published is not None
    return core, booking, published


@pytest.mark.integration
def test_marketplace_functions_pin_a_trusted_search_path(
    marketplace_engine: Engine,
) -> None:
    with marketplace_engine.connect() as connection:
        expected_schema = cast(
            str, connection.execute(text("SELECT current_schema()")).scalar_one()
        )
        expected_setting = f"search_path=pg_catalog, {expected_schema}, public, pg_temp"
        functions = connection.execute(
            text(
                """
                SELECT routine.proname, routine.proconfig
                FROM pg_proc AS routine
                JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
                WHERE namespace.nspname = current_schema()
                  AND routine.proname LIKE 'marketplace_%'
                ORDER BY routine.proname
                """
            )
        ).all()

    assert {name for name, _ in functions} >= {
        "marketplace_enforce_booking_overlap",
        "marketplace_enforce_booking_transition",
        "marketplace_set_tutor_publication",
    }
    assert all(config == [expected_setting] for _, config in functions)


@pytest.mark.integration
def test_application_review_state_machine_is_transactional(
    marketplace_engine: Engine,
) -> None:
    repository = PostgresTutorApplicationRepository(engine=marketplace_engine)
    application_id = uuid4()

    draft = repository.create_draft(
        application_id=application_id,
        actor_ref=TUTOR_ACTOR,
        request=application_request(),
    )
    submitted = repository.submit(actor_ref=TUTOR_ACTOR, expected_version=draft.version)
    assert submitted is not None
    review = repository.start_review(
        application_id=application_id,
        operator_actor_ref=OPERATOR_ACTOR,
        expected_version=submitted.version,
    )
    assert review is not None
    approved = repository.decide(
        application_id=application_id,
        operator_actor_ref=OPERATOR_ACTOR,
        decision="approved",
        reason="Identity and application review passed.",
        expected_version=review.version,
    )

    assert approved is not None
    assert approved.status == "approved"
    assert approved.languages == ("en", "el-gr")
    assert repository.has_operator_capability(
        actor_ref=OPERATOR_ACTOR,
        capability="review_tutor_applications",
    )
    with marketplace_engine.connect() as connection:
        profile = connection.execute(
            text(
                "SELECT is_published FROM marketplace_tutor_profile "
                "WHERE application_id = :application_id"
            ),
            {"application_id": application_id},
        ).one()
        audit = connection.execute(
            text(
                "SELECT action, from_status, to_status FROM marketplace_audit_event "
                "WHERE application_id = :application_id ORDER BY occurred_at, audit_id"
            ),
            {"application_id": application_id},
        ).all()
        serialized = str(
            connection.execute(text("SELECT * FROM marketplace_tutor_application")).all()
        )
    assert profile.is_published is False
    assert [row.action for row in audit] == [
        "application_created",
        "application_submitted",
        "application_review_started",
        "application_decided",
    ]
    assert "user_tutor_integration" not in serialized


@pytest.mark.integration
def test_runtime_role_cannot_grant_capabilities_mutate_audit_or_run_ddl(
    marketplace_engine: Engine,
) -> None:
    denied = [
        "INSERT INTO marketplace_operator_capability (actor_ref, capability) "
        f"VALUES ('{TUTOR_ACTOR}', 'review_tutor_applications')",
        "UPDATE marketplace_audit_event SET reason = 'tampered audit reason'",
        "DELETE FROM marketplace_audit_event",
        "UPDATE marketplace_learning_context_audit SET event = 'revoked'",
        "DELETE FROM marketplace_learning_context_audit",
        "UPDATE marketplace_booking_transition_audit SET reason_code = 'tampered'",
        "DELETE FROM marketplace_booking_transition_audit",
        "UPDATE marketplace_message_report_access_audit SET action = 'resolved'",
        "DELETE FROM marketplace_message_report_access_audit",
        "UPDATE marketplace_stripe_webhook_event SET outcome = 'applied'",
        "DELETE FROM marketplace_stripe_webhook_event",
        "UPDATE marketplace_booking_schedule_revision SET reason = 'tampered'",
        "DELETE FROM marketplace_booking_schedule_revision",
        "UPDATE marketplace_money_ledger SET amount_minor = 0",
        "DELETE FROM marketplace_money_ledger",
        "INSERT INTO marketplace_money_ledger "
        "(entry_id, booking_id, kind, amount_minor, currency) "
        "VALUES (gen_random_uuid(), gen_random_uuid(), 'charge', 500, 'USD')",
        "INSERT INTO marketplace_money_operation "
        "(operation_id, booking_id, kind, amount_minor, currency, idempotency_key) "
        "VALUES (gen_random_uuid(), gen_random_uuid(), 'refund', 500, 'USD', "
        "'forbidden-runtime-operation')",
        "SELECT * FROM marketplace_confirm_booking_payment(gen_random_uuid(), "
        "'cs_test_forbidden', 'pi_forbidden123', now(), 'SANDBOX', "
        "'acct_forbidden123', 500, 'USD')",
        "ALTER TABLE marketplace_tutor_application ADD COLUMN forbidden text",
        "UPDATE marketplace_tutor_profile SET is_published = true",
    ]

    with marketplace_engine.connect() as connection:
        connection.execute(text("SET ROLE glidelingo_app"))
        assert connection.execute(
            text(
                "SELECT has_table_privilege(current_user, "
                "'marketplace_operator_capability', 'SELECT')"
            )
        ).scalar_one()
        assert not connection.execute(
            text("SELECT has_schema_privilege(current_user, current_schema(), 'CREATE')")
        ).scalar_one()
        for table_name in (
            "marketplace_audit_event",
            "marketplace_booking_transition_audit",
            "marketplace_learning_context_audit",
            "marketplace_message_report_access_audit",
            "marketplace_money_ledger",
            "marketplace_stripe_webhook_event",
        ):
            assert not connection.execute(
                text(
                    "SELECT has_table_privilege(current_user, :table_name, 'UPDATE') "
                    "OR has_table_privilege(current_user, :table_name, 'DELETE')"
                ),
                {"table_name": table_name},
            ).scalar_one()
        for statement in denied:
            nested = connection.begin_nested()
            with pytest.raises(DBAPIError):
                connection.execute(text(statement))
            nested.rollback()
        connection.execute(text("RESET ROLE"))


@pytest.mark.integration
def test_revoked_operator_cannot_mutate_and_active_operator_can_take_over_review(
    marketplace_engine: Engine,
) -> None:
    repository = PostgresTutorApplicationRepository(engine=marketplace_engine)
    application_id = uuid4()
    draft = repository.create_draft(
        application_id=application_id,
        actor_ref=TUTOR_ACTOR,
        request=application_request(),
    )
    submitted = repository.submit(actor_ref=TUTOR_ACTOR, expected_version=draft.version)
    assert submitted is not None

    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_operator_capability SET revoked_at = now() "
                "WHERE actor_ref = :actor_ref"
            ),
            {"actor_ref": OPERATOR_ACTOR},
        )
    assert (
        repository.start_review(
            application_id=application_id,
            operator_actor_ref=OPERATOR_ACTOR,
            expected_version=submitted.version,
        )
        is None
    )

    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO marketplace_operator_capability (actor_ref, capability) "
                "VALUES (:actor_ref, 'review_tutor_applications')"
            ),
            {"actor_ref": SECOND_OPERATOR_ACTOR},
        )
    review = repository.start_review(
        application_id=application_id,
        operator_actor_ref=SECOND_OPERATOR_ACTOR,
        expected_version=submitted.version,
    )
    assert review is not None

    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_operator_capability "
                "SET revoked_at = NULL WHERE actor_ref = :actor_ref"
            ),
            {"actor_ref": OPERATOR_ACTOR},
        )
    approved = repository.decide(
        application_id=application_id,
        operator_actor_ref=OPERATOR_ACTOR,
        decision="approved",
        reason="Takeover review confirmed all approval requirements.",
        expected_version=review.version,
    )
    assert approved is not None
    assert approved.reviewer_actor_ref == OPERATOR_ACTOR


@pytest.mark.integration
def test_repository_atomically_rejects_self_review(marketplace_engine: Engine) -> None:
    repository = PostgresTutorApplicationRepository(engine=marketplace_engine)
    application_id = uuid4()
    draft = repository.create_draft(
        application_id=application_id,
        actor_ref=OPERATOR_ACTOR,
        request=application_request(),
    )
    submitted = repository.submit(actor_ref=OPERATOR_ACTOR, expected_version=draft.version)
    assert submitted is not None

    assert (
        repository.start_review(
            application_id=application_id,
            operator_actor_ref=OPERATOR_ACTOR,
            expected_version=submitted.version,
        )
        is None
    )


@pytest.mark.integration
def test_private_supply_workspace_enforces_policy_and_publication_gates(
    marketplace_engine: Engine,
) -> None:
    repository = PostgresTutorApplicationRepository(engine=marketplace_engine)
    application_id = uuid4()
    created = repository.create_draft(
        application_id=application_id,
        actor_ref=TUTOR_ACTOR,
        request=application_request(),
    )
    edited = repository.update_draft(
        actor_ref=TUTOR_ACTOR,
        request=UpdateTutorApplicationDraftRequest(
            expected_version=created.version,
            headline="Focused conversation tutor",
            biography="I help adults build practical speaking confidence through focused practice.",
            time_zone="Europe/Athens",
            languages=["el", "en"],
            specialties=["Conversation"],
        ),
    )
    assert edited is not None

    assert (
        repository.update_draft(
            actor_ref=TUTOR_ACTOR,
            request=UpdateTutorApplicationDraftRequest(
                expected_version=created.version,
                headline="Stale change cannot win",
                biography=(
                    "This stale change is long enough but must not overwrite the current draft."
                ),
                time_zone="UTC",
                languages=["en"],
                specialties=["Travel"],
            ),
        )
        is None
    )
    submitted = repository.submit(actor_ref=TUTOR_ACTOR, expected_version=edited.version)
    assert submitted is not None
    review = repository.start_review(
        application_id=application_id,
        operator_actor_ref=OPERATOR_ACTOR,
        expected_version=submitted.version,
    )
    assert review is not None
    approved = repository.decide(
        application_id=application_id,
        operator_actor_ref=OPERATOR_ACTOR,
        decision="approved",
        reason="Application identity and teaching details passed review.",
        expected_version=review.version,
    )
    assert approved is not None

    profile = repository.get_profile_by_actor(actor_ref=TUTOR_ACTOR)
    assert profile is not None
    updated_profile = repository.update_profile_draft(
        actor_ref=TUTOR_ACTOR,
        request=UpdateTutorProfileDraftRequest(
            expected_version=profile.version,
            headline="Practical Greek conversation",
            biography="I help adult learners practice useful Greek conversations at a calm pace.",
            time_zone="Europe/Athens",
        ),
    )
    assert updated_profile is not None
    with_credential = repository.save_credential(
        actor_ref=TUTOR_ACTOR,
        request=SaveTutorCredentialRequest(
            expected_version=0,
            credential_type="certificate",
            title="Adult language teaching certificate",
            issuer="Example Institute",
        ),
    )
    assert with_credential is not None
    assert with_credential.credential is not None
    with_offering = repository.save_offering(
        actor_ref=TUTOR_ACTOR,
        request=SaveTutorOfferingRequest(
            expected_version=0,
            title="25-minute conversation lesson",
            duration_minutes=25,
            amount_minor=2500,
            currency="USD",
        ),
    )
    assert with_offering is not None
    assert with_offering.offering is not None
    assert with_offering.offering.commission_policy.commission_basis_points == 2000
    assert with_offering.offering.cancellation_policy.cancellation_cutoff_hours == 12
    assert with_offering.offering.cancellation_policy.dispute_window_hours == 24

    assert (
        repository.set_publication(
            actor_ref=TUTOR_ACTOR,
            expected_profile_version=with_offering.version,
            expected_offering_version=with_offering.offering.version,
            publish=True,
        )
        is None
    )
    after_denial = repository.get_profile_by_actor(actor_ref=TUTOR_ACTOR)
    assert after_denial is not None
    assert after_denial.payout_ready is False
    assert after_denial.is_published is False
    assert after_denial.offering is not None
    assert after_denial.offering.state == "draft"

    credential = after_denial.credential
    assert credential is not None
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO marketplace_operator_capability (actor_ref, capability) "
                "VALUES (:actor_ref, 'verify_tutor_credentials')"
            ),
            {"actor_ref": TUTOR_ACTOR},
        )
    assert (
        repository.decide_credential(
            credential_id=credential.credential_id,
            operator_actor_ref=TUTOR_ACTOR,
            request_version=credential.version,
            decision="verified",
            reason="A tutor must never be allowed to verify their own credential.",
        )
        is None
    )
    verified = repository.decide_credential(
        credential_id=credential.credential_id,
        operator_actor_ref=OPERATOR_ACTOR,
        request_version=credential.version,
        decision="verified",
        reason="Credential issuer and certificate reference were verified.",
    )
    assert verified is not None
    assert verified.credential is not None
    assert verified.credential.verification_status == "verified"

    suspended = repository.change_tutor_status(
        application_id=application_id,
        operator_actor_ref=OPERATOR_ACTOR,
        request=ChangeTutorStatusRequest(
            expected_version=approved.version,
            action="suspend",
            reason="Manual suspension test for marketplace safety controls.",
        ),
    )
    assert suspended is not None
    assert suspended.status == "suspended"
    suspended_profile = repository.get_profile_by_actor(actor_ref=TUTOR_ACTOR)
    assert suspended_profile is not None
    assert suspended_profile.is_published is False
    reinstated = repository.change_tutor_status(
        application_id=application_id,
        operator_actor_ref=OPERATOR_ACTOR,
        request=ChangeTutorStatusRequest(
            expected_version=suspended.version,
            action="reinstate",
            reason="Manual review cleared the suspension for this test tutor.",
        ),
    )
    assert reinstated is not None
    assert reinstated.status == "approved"

    with marketplace_engine.connect() as connection:
        audit_actions = (
            connection.execute(
                text(
                    "SELECT action FROM marketplace_audit_event "
                    "WHERE application_id = :application_id ORDER BY occurred_at, audit_id"
                ),
                {"application_id": application_id},
            )
            .scalars()
            .all()
        )
    assert "application_draft_updated" in audit_actions
    assert "profile_draft_updated" in audit_actions
    assert "credential_draft_saved" in audit_actions
    assert "credential_decided" in audit_actions
    assert "offering_draft_saved" in audit_actions
    assert "application_suspended" in audit_actions
    assert "application_reinstated" in audit_actions


@pytest.mark.integration
def test_discovery_availability_and_favorites_use_only_eligible_public_supply(
    marketplace_engine: Engine,
) -> None:
    core = PostgresTutorApplicationRepository(engine=marketplace_engine)
    discovery = PostgresDiscoveryRepository(engine=marketplace_engine)
    application_id, profile = create_approved_tutor(core)
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_tutor_profile SET payout_ready = true "
                "WHERE tutor_id = :tutor_id"
            ),
            {"tutor_id": profile.tutor_id},
        )
    offered = core.save_offering(
        actor_ref=TUTOR_ACTOR,
        request=SaveTutorOfferingRequest(
            expected_version=0,
            title="Practical Greek conversation",
            duration_minutes=25,
            amount_minor=2500,
            currency="USD",
        ),
    )

    assert offered is not None and offered.offering is not None
    published = core.set_publication(
        actor_ref=TUTOR_ACTOR,
        expected_profile_version=offered.version,
        expected_offering_version=offered.offering.version,
        publish=True,
    )
    assert published is not None
    schedule = discovery.replace_manual_availability(
        actor_ref=TUTOR_ACTOR,
        request=ReplaceManualAvailabilityRequest(
            expected_profile_version=published.version,
            lead_time_minutes=60,
            buffer_before_minutes=5,
            buffer_after_minutes=10,
            dialects=["el-cy"],
            rules=[
                AvailabilityRuleInput(
                    weekday=4,
                    start_local=time(9),
                    end_local=time(12),
                    effective_from=date(2026, 1, 1),
                )
            ],
            exceptions=[],
        ),
    )
    learner = derive_marketplace_actor_ref(
        key=b"marketplace-integration-pseudonym-key-32-bytes",
        clerk_user_id="user_learner_integration",
    )
    tutors = discovery.list_public_tutors(
        learner_actor_ref=learner,
        language="el-gr",
        dialect="el-cy",
        specialty="conversation",
        duration_minutes=25,
        maximum_amount_minor=3000,
        verified_credential=False,
    )
    assert schedule is not None
    assert schedule.dialects == ("el-cy",)
    assert [tutor.tutor_id for tutor in tutors] == [profile.tutor_id]
    assert tutors[0].rating is None
    assert discovery.set_favorite(
        learner_actor_ref=learner,
        tutor_id=profile.tutor_id,
        favorite=True,
    )
    favorite = discovery.get_public_tutor(
        learner_actor_ref=learner,
        tutor_id=profile.tutor_id,
    )
    assert favorite is not None and favorite.is_favorite

    application = core.get_by_id(application_id=application_id)
    assert application is not None
    suspended = core.change_tutor_status(
        application_id=application_id,
        operator_actor_ref=OPERATOR_ACTOR,
        request=ChangeTutorStatusRequest(
            expected_version=application.version,
            action="suspend",
            reason="Safety review requires the tutor to become private.",
        ),
    )
    assert suspended is not None
    assert (
        discovery.list_public_tutors(
            learner_actor_ref=learner,
            language=None,
            dialect=None,
            specialty=None,
            duration_minutes=None,
            maximum_amount_minor=None,
            verified_credential=False,
        )
        == []
    )


@pytest.mark.integration
def test_discovery_cursor_survives_unicode_headline_mutation(
    marketplace_engine: Engine,
) -> None:
    repository = PostgresDiscoveryRepository(engine=marketplace_engine)
    tutor_ids = [
        UUID("32000000-0000-4000-8000-000000000001"),
        UUID("32000000-0000-4000-8000-000000000002"),
        UUID("32000000-0000-4000-8000-000000000003"),
    ]
    headlines = ["İzmir conversation tutor", "Straße speaking tutor", "Zulu travel tutor"]
    now = datetime.now(UTC)
    with marketplace_engine.begin() as connection:
        for index, (tutor_id, headline) in enumerate(zip(tutor_ids, headlines, strict=True), 1):
            application_id = UUID(f"31000000-0000-4000-8000-{index:012d}")
            offering_id = UUID(f"33000000-0000-4000-8000-{index:012d}")
            actor_ref = derive_marketplace_actor_ref(
                key=b"marketplace-integration-pseudonym-key-32-bytes",
                clerk_user_id=f"user_discovery_cursor_{index}",
            )
            connection.execute(
                text(
                    """
                    INSERT INTO marketplace_tutor_application
                      (application_id, actor_ref, headline, biography, time_zone)
                    VALUES (:application_id, :actor_ref, :headline,
                            'A deliberately bounded profile used for stable discovery paging.',
                            'UTC')
                    """
                ),
                {
                    "application_id": application_id,
                    "actor_ref": actor_ref,
                    "headline": headline,
                },
            )
            connection.execute(
                text(
                    "UPDATE marketplace_tutor_application "
                    "SET status = 'submitted', version = version + 1, submitted_at = :now "
                    "WHERE application_id = :application_id"
                ),
                {"application_id": application_id, "now": now},
            )
            connection.execute(
                text(
                    "UPDATE marketplace_tutor_application "
                    "SET status = 'under_review', version = version + 1, "
                    "reviewer_actor_ref = :reviewer "
                    "WHERE application_id = :application_id"
                ),
                {"application_id": application_id, "reviewer": OPERATOR_ACTOR},
            )
            connection.execute(
                text(
                    "UPDATE marketplace_tutor_application "
                    "SET status = 'approved', version = version + 1, reviewed_at = :now, "
                    "decision_reason = 'Approved for cursor regression coverage.' "
                    "WHERE application_id = :application_id"
                ),
                {"application_id": application_id, "now": now},
            )
            connection.execute(
                text(
                    """
                    INSERT INTO marketplace_tutor_profile
                      (tutor_id, application_id, actor_ref, headline, biography, time_zone,
                       payout_ready, is_published)
                    VALUES (:tutor_id, :application_id, :actor_ref, :headline,
                            'A deliberately bounded profile used for stable discovery paging.',
                            'UTC', true, true)
                    """
                ),
                {
                    "tutor_id": tutor_id,
                    "application_id": application_id,
                    "actor_ref": actor_ref,
                    "headline": headline,
                },
            )
            connection.execute(
                text(
                    """
                    INSERT INTO marketplace_tutor_offering
                      (offering_id, application_id, tutor_id, title, duration_minutes,
                       amount_minor, currency, state, commission_policy_id,
                       cancellation_policy_id)
                    VALUES (:offering_id, :application_id, :tutor_id,
                            'Stable cursor conversation lesson', 25, 2500, 'USD', 'active',
                            '10000000-0000-4000-8000-000000000001',
                            '20000000-0000-4000-8000-000000000001')
                    """
                ),
                {
                    "offering_id": offering_id,
                    "application_id": application_id,
                    "tutor_id": tutor_id,
                },
            )

    first_page = repository.list_public_tutors(
        learner_actor_ref=LEARNER_ACTOR,
        language=None,
        dialect=None,
        specialty=None,
        duration_minutes=None,
        maximum_amount_minor=None,
        verified_credential=False,
        limit=2,
    )
    assert [tutor.tutor_id for tutor in first_page] == tutor_ids[:2]
    cursor = MarketplaceDiscoveryService._encode_cursor(first_page[-1])
    after_tutor_id = MarketplaceDiscoveryService._decode_cursor(cursor)
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_tutor_profile SET headline = CASE "
                "WHEN tutor_id = :first THEN 'Ωmega conversation tutor' "
                "ELSE 'Álpha speaking tutor' END "
                "WHERE tutor_id IN (:first, :second)"
            ),
            {"first": tutor_ids[0], "second": tutor_ids[1]},
        )
    second_page = repository.list_public_tutors(
        learner_actor_ref=LEARNER_ACTOR,
        language=None,
        dialect=None,
        specialty=None,
        duration_minutes=None,
        maximum_amount_minor=None,
        verified_credential=False,
        after_tutor_id=after_tutor_id,
        limit=2,
    )
    assert [tutor.tutor_id for tutor in second_page] == tutor_ids[2:]
    assert len({tutor.tutor_id for tutor in first_page + second_page}) == 3


@pytest.mark.integration
def test_profile_timezone_change_invalidates_wall_clock_availability(
    marketplace_engine: Engine,
) -> None:
    core = PostgresTutorApplicationRepository(engine=marketplace_engine)
    discovery = PostgresDiscoveryRepository(engine=marketplace_engine)
    _, profile = create_approved_tutor(core)
    schedule = discovery.replace_manual_availability(
        actor_ref=TUTOR_ACTOR,
        request=ReplaceManualAvailabilityRequest(
            expected_profile_version=profile.version,
            lead_time_minutes=60,
            buffer_before_minutes=5,
            buffer_after_minutes=10,
            dialects=["el-cy"],
            rules=[
                AvailabilityRuleInput(
                    weekday=4,
                    start_local=time(9),
                    end_local=time(12),
                    effective_from=date(2026, 1, 1),
                )
            ],
            exceptions=[],
        ),
    )
    assert schedule is not None and len(schedule.rules) == 1

    updated = core.update_profile_draft(
        actor_ref=TUTOR_ACTOR,
        request=UpdateTutorProfileDraftRequest(
            expected_version=schedule.profile_version,
            headline=profile.headline,
            biography=profile.biography,
            time_zone="UTC",
        ),
    )

    assert updated is not None and updated.time_zone == "UTC"
    invalidated = discovery.get_manual_availability_by_actor(actor_ref=TUTOR_ACTOR)
    assert invalidated is not None
    assert invalidated.rules == ()
    assert invalidated.exceptions == ()


@pytest.mark.integration
def test_calendar_oauth_replay_cache_concurrency_and_encrypted_storage(
    marketplace_engine: Engine,
) -> None:
    core = PostgresTutorApplicationRepository(engine=marketplace_engine)
    calendar = PostgresCalendarRepository(engine=marketplace_engine)
    _, profile = create_approved_tutor(core)
    now = datetime.now(UTC)
    state_hash = b"s" * 32
    redirect = "https://app.glidelingo.test/tutor/availability"
    calendar.insert_oauth_state(
        state_hash=state_hash,
        tutor_id=profile.tutor_id,
        actor_ref=TUTOR_ACTOR,
        redirect_uri=redirect,
        expires_at=now + timedelta(minutes=10),
    )
    assert calendar.consume_oauth_state(
        state_hash=state_hash,
        tutor_id=profile.tutor_id,
        actor_ref=TUTOR_ACTOR,
        redirect_uri=redirect,
        now=now,
    )
    assert not calendar.consume_oauth_state(
        state_hash=state_hash,
        tutor_id=profile.tutor_id,
        actor_ref=TUTOR_ACTOR,
        redirect_uri=redirect,
        now=now,
    )

    ciphertext = b"encrypted-refresh-token-ciphertext" + b"x" * 16
    connected = calendar.upsert_connection(
        tutor_id=profile.tutor_id,
        actor_ref=TUTOR_ACTOR,
        encrypted_refresh_token=ciphertext,
        token_key_version=1,
    )
    busy = (TimeInterval(now + timedelta(hours=1), now + timedelta(hours=2)),)
    refreshed = calendar.replace_busy_cache(
        tutor_id=profile.tutor_id,
        expected_version=connected.version,
        intervals=busy,
        refreshed_at=now,
        expires_at=now + timedelta(minutes=10),
    )
    assert refreshed is not None
    assert (
        calendar.replace_busy_cache(
            tutor_id=profile.tutor_id,
            expected_version=connected.version,
            intervals=busy,
            refreshed_at=now,
            expires_at=now + timedelta(minutes=10),
        )
        is None
    )
    snapshot = calendar.get_busy_snapshot(tutor_id=profile.tutor_id, now=now)
    assert snapshot.freshness == "current"
    assert snapshot.intervals == busy

    with marketplace_engine.connect() as connection:
        serialized = str(
            connection.execute(
                text("SELECT encrypted_refresh_token FROM marketplace_calendar_connection")
            ).all()
        )
        columns = set(
            connection.execute(
                text(
                    """
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name IN ('marketplace_calendar_connection',
                                         'marketplace_calendar_busy_interval')
                    """
                )
            ).scalars()
        )
    assert "refresh-token-secret" not in serialized
    assert not {"summary", "description", "attendees", "location", "calendar_id"} & columns

    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_calendar_refresh_job SET status = 'dead', attempt = 8, "
                "safe_failure_code = 'provider_timeout' WHERE tutor_id = :tutor_id"
            ),
            {"tutor_id": profile.tutor_id},
        )
    calendar.recover_refresh(tutor_id=profile.tutor_id, now=now)
    recovered_job = calendar.claim_refresh(worker="calendar-recovered", now=now, lease_seconds=60)
    assert recovered_job is not None and recovered_job.attempt == 1
    assert calendar.finish_refresh(
        job_id=recovered_job.job_id,
        worker="calendar-recovered",
        now=now,
        outcome="completed",
        available_at=now + timedelta(minutes=10),
        failure_code=None,
    )

    reconnect = calendar.mark_failure(
        tutor_id=profile.tutor_id,
        expected_version=refreshed.version,
        code="revoked",
        reconnect_required=True,
    )
    assert reconnect is not None and reconnect.encrypted_refresh_token is None
    assert (
        calendar.get_busy_snapshot(tutor_id=profile.tutor_id, now=now).freshness
        == "reconnect_required"
    )


@pytest.mark.integration
def test_pending_booking_calendar_conflict_notifies_on_confirmation_and_resolves(
    marketplace_engine: Engine,
) -> None:
    _, booking, profile = create_bookable_tutor(marketplace_engine)
    calendar = PostgresCalendarRepository(engine=marketplace_engine)
    now = datetime.now(UTC)
    connected = calendar.upsert_connection(
        tutor_id=profile.tutor_id,
        actor_ref=TUTOR_ACTOR,
        encrypted_refresh_token=b"encrypted-refresh-token" + b"x" * 32,
        token_key_version=1,
    )
    initial_cache = calendar.replace_busy_cache(
        tutor_id=profile.tutor_id,
        expected_version=connected.version,
        intervals=(),
        refreshed_at=now,
        expires_at=now + timedelta(minutes=10),
    )
    assert initial_cache is not None
    starts_at = now + timedelta(days=3)
    held = booking.create_hold(
        learner_actor_ref=LEARNER_ACTOR,
        tutor_id=profile.tutor_id,
        starts_at=starts_at,
        idempotency_key=uuid4(),
        now=now,
        hold_seconds=600,
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert held is not None
    suffix = held.booking_id.hex[:12]
    open_checkout = StripeCheckout(
        checkout_id=f"cs_test_{suffix}",
        url="https://checkout.stripe.com/c/pay/calendarconflict123",
        payment_intent_id=f"pi_{suffix}",
        status="open",
        payment_status="unpaid",
        livemode=False,
        booking_id=held.booking_id,
        platform_account_id="acct_reviewed123",
        amount_minor=held.amount_minor,
        currency=held.currency,
        created_at=now,
    )
    assert (
        booking.attach_checkout(
            booking_id=held.booking_id,
            learner_actor_ref=LEARNER_ACTOR,
            checkout=open_checkout,
        )
        is not None
    )
    conflicted_cache = calendar.replace_busy_cache(
        tutor_id=profile.tutor_id,
        expected_version=initial_cache.version,
        intervals=(TimeInterval(held.starts_at, held.ends_at),),
        refreshed_at=now + timedelta(seconds=1),
        expires_at=now + timedelta(minutes=10),
    )
    assert conflicted_cache is not None
    outcome, confirmed = booking.apply_checkout_observation(
        checkout=replace(open_checkout, url=None, status="complete", payment_status="paid"),
        payload_sha256=suffix.ljust(64, "a"),
        event_id=f"evt_{suffix}",
        event_type="checkout.session.completed",
        source="provider_webhook",
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert outcome == "applied"
    assert confirmed is not None and confirmed.has_calendar_conflict
    duplicate_outcome, _ = booking.apply_checkout_observation(
        checkout=replace(open_checkout, url=None, status="complete", payment_status="paid"),
        payload_sha256=suffix.ljust(64, "a"),
        event_id=f"evt_{suffix}",
        event_type="checkout.session.completed",
        source="provider_webhook",
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert duplicate_outcome == "duplicate"
    with marketplace_engine.connect() as connection:
        conflict_message_count = connection.execute(
            text(
                "SELECT count(*) FROM marketplace_message AS message "
                "JOIN marketplace_conversation AS conversation USING (conversation_id) "
                "WHERE conversation.booking_id = :id "
                "AND message.body LIKE 'A newly detected calendar conflict%'"
            ),
            {"id": held.booking_id},
        ).scalar_one()
        conflict_notification_count = connection.execute(
            text(
                "SELECT count(*) FROM marketplace_message_notification_job AS job "
                "JOIN marketplace_message AS message USING (message_id) "
                "JOIN marketplace_conversation AS conversation USING (conversation_id) "
                "WHERE conversation.booking_id = :id AND job.template = 'calendar_conflict'"
            ),
            {"id": held.booking_id},
        ).scalar_one()
    assert conflict_message_count == 1
    assert conflict_notification_count == 1

    lifecycle = PostgresLifecycleRepository(engine=marketplace_engine)
    assert lifecycle.transition(
        booking_id=held.booking_id,
        actor_ref=LEARNER_ACTOR,
        action="reschedule",
        reason="Participants moved the lesson away from the calendar conflict.",
        new_starts_at=starts_at + timedelta(days=1),
        now=now,
        expected_profile_version=profile.version,
    )
    with marketplace_engine.connect() as connection:
        resolution = connection.execute(
            text(
                "SELECT resolution_reason FROM marketplace_calendar_booking_conflict "
                "WHERE booking_id = :id"
            ),
            {"id": held.booking_id},
        ).scalar_one()
    assert resolution == "rescheduled"


@pytest.mark.integration
def test_conversation_and_booking_keysets_do_not_skip_after_mutable_fields_change(
    marketplace_engine: Engine,
) -> None:
    _, booking, profile = create_bookable_tutor(marketplace_engine)
    messaging = PostgresMessagingRepository(engine=marketplace_engine)
    now = datetime.now(UTC)
    conversation_ids = [uuid4(), uuid4(), uuid4()]
    learners = [LEARNER_ACTOR, OUTSIDER_ACTOR, OPERATOR_ACTOR]
    with marketplace_engine.begin() as connection:
        for index, (conversation_id, learner) in enumerate(
            zip(conversation_ids, learners, strict=True)
        ):
            created_at = now - timedelta(minutes=3 - index)
            connection.execute(
                text(
                    "INSERT INTO marketplace_conversation "
                    "(conversation_id, learner_actor_ref, tutor_id, tutor_actor_ref, "
                    "created_at, updated_at) VALUES "
                    "(:id, :learner, :tutor_id, :tutor, :created_at, :created_at)"
                ),
                {
                    "id": conversation_id,
                    "learner": learner,
                    "tutor_id": profile.tutor_id,
                    "tutor": TUTOR_ACTOR,
                    "created_at": created_at,
                },
            )
    first_conversations, has_more = messaging.list_conversations(
        actor_ref=TUTOR_ACTOR,
        before_created_at=None,
        before_conversation_id=None,
        limit=1,
    )
    assert has_more and len(first_conversations) == 1
    cursor = MessagingService._encode_conversation_cursor(first_conversations[-1])
    before_created_at, before_conversation_id = MessagingService._decode_conversation_cursor(cursor)
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_conversation SET updated_at = :updated_at "
                "WHERE conversation_id = :id"
            ),
            {"updated_at": now + timedelta(hours=1), "id": conversation_ids[0]},
        )
    second_conversations, second_has_more = messaging.list_conversations(
        actor_ref=TUTOR_ACTOR,
        before_created_at=before_created_at,
        before_conversation_id=before_conversation_id,
        limit=2,
    )
    assert not second_has_more
    assert {item.conversation_id for item in first_conversations + second_conversations} == set(
        conversation_ids
    )

    confirmed = []
    for day in (2, 3, 4):
        held = booking.create_hold(
            learner_actor_ref=LEARNER_ACTOR,
            tutor_id=profile.tutor_id,
            starts_at=now + timedelta(days=day),
            idempotency_key=uuid4(),
            now=now,
            hold_seconds=600,
            environment="SANDBOX",
            platform_account_id="acct_reviewed123",
        )
        assert held is not None
        suffix = held.booking_id.hex[:12]
        open_checkout = StripeCheckout(
            checkout_id=f"cs_test_{suffix}",
            url="https://checkout.stripe.com/c/pay/keyset123",
            payment_intent_id=f"pi_{suffix}",
            status="open",
            payment_status="unpaid",
            livemode=False,
            booking_id=held.booking_id,
            platform_account_id="acct_reviewed123",
            amount_minor=held.amount_minor,
            currency=held.currency,
            created_at=now,
        )
        assert (
            booking.attach_checkout(
                booking_id=held.booking_id,
                learner_actor_ref=LEARNER_ACTOR,
                checkout=open_checkout,
            )
            is not None
        )
        outcome, value = booking.apply_checkout_observation(
            checkout=replace(open_checkout, url=None, status="complete", payment_status="paid"),
            payload_sha256=suffix.ljust(64, "a"),
            event_id=f"evt_{suffix}",
            event_type="checkout.session.completed",
            source="provider_webhook",
            environment="SANDBOX",
            platform_account_id="acct_reviewed123",
        )
        assert outcome == "applied" and value is not None
        confirmed.append(value)
        sleep(0.01)
    first_bookings, has_more = booking.list_bookings(
        actor_ref=LEARNER_ACTOR,
        before_created_at=None,
        before_booking_id=None,
        limit=1,
    )
    assert has_more and len(first_bookings) == 1
    cursor = BookingService._encode_cursor(first_bookings[-1])
    before_created_at, before_booking_id = BookingService._decode_cursor(cursor)
    lifecycle = PostgresLifecycleRepository(engine=marketplace_engine)
    assert lifecycle.transition(
        booking_id=confirmed[0].booking_id,
        actor_ref=LEARNER_ACTOR,
        action="reschedule",
        reason="Move the older booking across the previous start-time page boundary.",
        new_starts_at=now + timedelta(days=10),
        now=now,
        expected_profile_version=profile.version,
    )
    remaining_bookings, remaining_has_more = booking.list_bookings(
        actor_ref=LEARNER_ACTOR,
        before_created_at=before_created_at,
        before_booking_id=before_booking_id,
        limit=3,
    )
    assert not remaining_has_more
    assert {item.booking_id for item in first_bookings + remaining_bookings} == {
        item.booking_id for item in confirmed
    }


@pytest.mark.integration
def test_messaging_participant_safety_reports_rate_limits_and_jobs(
    marketplace_engine: Engine,
) -> None:
    core = PostgresTutorApplicationRepository(engine=marketplace_engine)
    messaging = PostgresMessagingRepository(engine=marketplace_engine)
    _, profile = create_approved_tutor(core)
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_tutor_profile SET payout_ready = true "
                "WHERE tutor_id = :tutor_id"
            ),
            {"tutor_id": profile.tutor_id},
        )
    offered = core.save_offering(
        actor_ref=TUTOR_ACTOR,
        request=SaveTutorOfferingRequest(
            expected_version=0,
            title="Safe conversation lesson",
            duration_minutes=25,
            amount_minor=2500,
            currency="USD",
        ),
    )
    assert offered is not None and offered.offering is not None
    published = core.set_publication(
        actor_ref=TUTOR_ACTOR,
        expected_profile_version=offered.version,
        expected_offering_version=offered.offering.version,
        publish=True,
    )
    assert published is not None

    conversation = messaging.create_prebooking_conversation(
        learner_actor_ref=LEARNER_ACTOR, tutor_id=profile.tutor_id
    )
    assert conversation is not None
    repeated = messaging.create_prebooking_conversation(
        learner_actor_ref=LEARNER_ACTOR, tutor_id=profile.tutor_id
    )
    assert repeated is not None and repeated.conversation_id == conversation.conversation_id
    assert (
        messaging.get_conversation(
            conversation_id=conversation.conversation_id, actor_ref=OUTSIDER_ACTOR
        )
        is None
    )
    assert messaging.list_messages(
        conversation_id=conversation.conversation_id,
        actor_ref=OUTSIDER_ACTOR,
        before_created_at=None,
        before_message_id=None,
        limit=50,
    ) == ((), False)

    now = datetime.now(UTC)
    learner_client_id = uuid4()
    state, learner_message = messaging.send_message(
        conversation_id=conversation.conversation_id,
        actor_ref=LEARNER_ACTOR,
        client_message_id=learner_client_id,
        body='<script>alert("plain text")</script>',
        now=now,
    )
    assert state == "created" and learner_message is not None
    duplicate_state, duplicate = messaging.send_message(
        conversation_id=conversation.conversation_id,
        actor_ref=LEARNER_ACTOR,
        client_message_id=learner_client_id,
        body=learner_message.body,
        now=now,
    )
    assert duplicate_state == "duplicate"
    assert duplicate is not None and duplicate.message_id == learner_message.message_id
    assert messaging.get_notification_preference(actor_ref=LEARNER_ACTOR)
    assert not messaging.set_notification_preference(actor_ref=LEARNER_ACTOR, email_enabled=False)
    tutor_client_id = uuid4()
    tutor_state, tutor_message = messaging.send_message(
        conversation_id=conversation.conversation_id,
        actor_ref=TUTOR_ACTOR,
        client_message_id=tutor_client_id,
        body="Welcome to the conversation.",
        now=now,
    )
    assert tutor_state == "created" and tutor_message is not None
    with marketplace_engine.connect() as connection:
        suppressed_job = connection.execute(
            text(
                "SELECT 1 FROM marketplace_message_notification_job "
                "WHERE message_id = :message_id AND recipient_actor_ref = :recipient"
            ),
            {"message_id": tutor_message.message_id, "recipient": LEARNER_ACTOR},
        ).scalar_one_or_none()
    assert suppressed_job is None
    report = messaging.create_report(
        report_id=uuid4(),
        conversation_id=conversation.conversation_id,
        message_id=tutor_message.message_id,
        reporter_actor_ref=LEARNER_ACTOR,
        reason="unsafe",
        details="This message needs a safety review.",
        now=now,
    )
    assert report is not None
    assert (
        messaging.get_report_for_operator(
            operator_actor_ref=SECOND_OPERATOR_ACTOR, report_id=report.report_id
        )
        is None
    )
    scoped_report = messaging.get_report_for_operator(
        operator_actor_ref=OPERATOR_ACTOR, report_id=report.report_id
    )
    assert scoped_report is not None
    assert {message.conversation_id for message in scoped_report[2]} == {
        conversation.conversation_id
    }
    assert (
        messaging.create_report(
            report_id=uuid4(),
            conversation_id=conversation.conversation_id,
            message_id=learner_message.message_id,
            reporter_actor_ref=LEARNER_ACTOR,
            reason="unsafe",
            details="A participant cannot report their own message as the other participant.",
            now=now,
        )
        is None
    )
    general_report = messaging.create_report(
        report_id=uuid4(),
        conversation_id=conversation.conversation_id,
        message_id=None,
        reporter_actor_ref=LEARNER_ACTOR,
        reason="other",
        details="General conversation-level safety concern.",
        now=now,
    )
    assert general_report is not None and general_report.message_id is None
    _, concurrent_message = messaging.send_message(
        conversation_id=conversation.conversation_id,
        actor_ref=TUTOR_ACTOR,
        client_message_id=uuid4(),
        body="A second message for concurrent report deduplication.",
        now=now,
    )
    assert concurrent_message is not None

    def concurrent_report(report_id: UUID) -> Any:
        return messaging.create_report(
            report_id=report_id,
            conversation_id=conversation.conversation_id,
            message_id=concurrent_message.message_id,
            reporter_actor_ref=LEARNER_ACTOR,
            reason="unsafe",
            details="Concurrent report deduplication evidence.",
            now=now,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        concurrent_reports = list(executor.map(concurrent_report, (uuid4(), uuid4())))
    assert all(item is not None for item in concurrent_reports)
    assert len({item.report_id for item in concurrent_reports if item is not None}) == 1
    with marketplace_engine.begin() as connection:
        for _ in range(7):
            connection.execute(
                text(
                    "INSERT INTO marketplace_message_report_rate_event "
                    "(event_id, reporter_actor_ref, subject_actor_ref, occurred_at) "
                    "VALUES (:id, :reporter, :subject, :now)"
                ),
                {
                    "id": uuid4(),
                    "reporter": LEARNER_ACTOR,
                    "subject": TUTOR_ACTOR,
                    "now": now,
                },
            )
    duplicate_report = messaging.create_report(
        report_id=uuid4(),
        conversation_id=conversation.conversation_id,
        message_id=tutor_message.message_id,
        reporter_actor_ref=LEARNER_ACTOR,
        reason="spam",
        details="A duplicate request must return the original durable report.",
        now=now,
    )
    assert duplicate_report == report
    _, rate_limited_report_message = messaging.send_message(
        conversation_id=conversation.conversation_id,
        actor_ref=TUTOR_ACTOR,
        client_message_id=uuid4(),
        body="A third message for bounded report-rate verification.",
        now=now,
    )
    assert rate_limited_report_message is not None
    with pytest.raises(MarketplaceMessageLimitedError):
        messaging.create_report(
            report_id=uuid4(),
            conversation_id=conversation.conversation_id,
            message_id=rate_limited_report_message.message_id,
            reporter_actor_ref=LEARNER_ACTOR,
            reason="unsafe",
            details="This request exceeds the bounded report rate.",
            now=now,
        )

    assert messaging.block_other(
        conversation_id=conversation.conversation_id, actor_ref=LEARNER_ACTOR
    )
    retry_after_block, retried_message = messaging.send_message(
        conversation_id=conversation.conversation_id,
        actor_ref=TUTOR_ACTOR,
        client_message_id=tutor_client_id,
        body="Welcome to the conversation.",
        now=now,
    )
    assert retry_after_block == "duplicate"
    assert retried_message is not None and retried_message.message_id == tutor_message.message_id
    blocked, _ = messaging.send_message(
        conversation_id=conversation.conversation_id,
        actor_ref=TUTOR_ACTOR,
        client_message_id=uuid4(),
        body="This must not be delivered.",
        now=now,
    )
    assert blocked == "blocked"

    rate_conversation = messaging.create_prebooking_conversation(
        learner_actor_ref=OUTSIDER_ACTOR, tutor_id=profile.tutor_id
    )
    assert rate_conversation is not None
    first_rate_message_id = uuid4()
    first_rate_message = None
    for index in range(10):
        result, _ = messaging.send_message(
            conversation_id=rate_conversation.conversation_id,
            actor_ref=OUTSIDER_ACTOR,
            client_message_id=first_rate_message_id if index == 0 else uuid4(),
            body=f"Bounded message {index}",
            now=now,
        )
        assert result == "created"
        if index == 0:
            _, first_rate_message = messaging.send_message(
                conversation_id=rate_conversation.conversation_id,
                actor_ref=OUTSIDER_ACTOR,
                client_message_id=first_rate_message_id,
                body="Bounded message 0",
                now=now,
            )
            assert first_rate_message is not None
    retry_after_limit, retry_after_limit_message = messaging.send_message(
        conversation_id=rate_conversation.conversation_id,
        actor_ref=OUTSIDER_ACTOR,
        client_message_id=first_rate_message_id,
        body="Bounded message 0",
        now=now,
    )
    assert retry_after_limit == "duplicate"
    assert retry_after_limit_message == first_rate_message
    first_page, has_more = messaging.list_messages(
        conversation_id=rate_conversation.conversation_id,
        actor_ref=OUTSIDER_ACTOR,
        before_created_at=None,
        before_message_id=None,
        limit=3,
    )
    assert has_more and len(first_page) == 3
    second_page, second_has_more = messaging.list_messages(
        conversation_id=rate_conversation.conversation_id,
        actor_ref=OUTSIDER_ACTOR,
        before_created_at=first_page[0].created_at,
        before_message_id=first_page[0].message_id,
        limit=3,
    )
    assert second_has_more and len(second_page) == 3
    assert {message.message_id for message in first_page}.isdisjoint(
        message.message_id for message in second_page
    )
    limited, _ = messaging.send_message(
        conversation_id=rate_conversation.conversation_id,
        actor_ref=OUTSIDER_ACTOR,
        client_message_id=uuid4(),
        body="This message exceeds the bounded minute rate.",
        now=now,
    )
    assert limited == "limited"

    job = messaging.claim_notification(lease_owner="worker-a", now=now, lease_seconds=30)
    assert job is not None
    assert not messaging.finish_notification(
        job_id=job.job_id,
        lease_owner="worker-b",
        now=now,
        outcome="completed",
    )
    assert messaging.finish_notification(
        job_id=job.job_id,
        lease_owner="worker-a",
        now=now,
        outcome="retryable",
    )
    with marketplace_engine.connect() as connection:
        job_status = connection.execute(
            text(
                "SELECT status, safe_failure_code FROM marketplace_message_notification_job "
                "WHERE job_id = :job_id"
            ),
            {"job_id": job.job_id},
        ).one()
    assert job_status == ("retryable", "unavailable")
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_message_notification_job "
                "SET attempt = 7, available_at = :now WHERE job_id = :job_id"
            ),
            {"now": now, "job_id": job.job_id},
        )
    exhausted = messaging.claim_notification(lease_owner="worker-a", now=now, lease_seconds=30)
    assert exhausted is not None and exhausted.attempt == 8
    assert messaging.finish_notification(
        job_id=exhausted.job_id,
        lease_owner="worker-a",
        now=now,
        outcome="retryable",
    )
    with marketplace_engine.connect() as connection:
        exhausted_status = connection.execute(
            text("SELECT status FROM marketplace_message_notification_job WHERE job_id = :job_id"),
            {"job_id": job.job_id},
        ).scalar_one()
        exhausted_conversation_id = connection.execute(
            text(
                "SELECT message.conversation_id "
                "FROM marketplace_message_notification_job AS notification "
                "JOIN marketplace_message AS message USING (message_id) "
                "WHERE notification.job_id = :job_id"
            ),
            {"job_id": job.job_id},
        ).scalar_one()
    assert exhausted_status == "dead"
    recovery_reason = "Delivery provider recovered after the terminal retry."
    assert not messaging.recover_notifications(
        conversation_id=exhausted_conversation_id,
        operator_actor_ref=SECOND_OPERATOR_ACTOR,
        reason=recovery_reason,
        now=now,
    )
    assert messaging.recover_notifications(
        conversation_id=exhausted_conversation_id,
        operator_actor_ref=OPERATOR_ACTOR,
        reason=recovery_reason,
        now=now,
    )
    assert messaging.recover_notifications(
        conversation_id=exhausted_conversation_id,
        operator_actor_ref=OPERATOR_ACTOR,
        reason=recovery_reason,
        now=now,
    )
    assert not messaging.recover_notifications(
        conversation_id=exhausted_conversation_id,
        operator_actor_ref=OPERATOR_ACTOR,
        reason="A materially different recovery request.",
        now=now,
    )
    with marketplace_engine.connect() as connection:
        recovered_status = connection.execute(
            text("SELECT status FROM marketplace_message_notification_job WHERE job_id = :job_id"),
            {"job_id": job.job_id},
        ).scalar_one()
        recovery_audits = connection.execute(
            text(
                "SELECT count(*) FROM marketplace_notification_recovery_audit "
                "WHERE conversation_id = :conversation_id"
            ),
            {"conversation_id": exhausted_conversation_id},
        ).scalar_one()
    assert recovered_status == "queued"
    assert recovery_audits == 1

    old = now - timedelta(days=100)
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_message SET created_at = :old "
                "WHERE message_id IN (:learner_message_id, :reported_message_id)"
            ),
            {
                "old": old,
                "learner_message_id": learner_message.message_id,
                "reported_message_id": tutor_message.message_id,
            },
        )
    assert messaging.purge_expired_messages(cutoff=now - timedelta(days=90), limit=100) >= 1
    with marketplace_engine.connect() as connection:
        retained_reported_message = connection.execute(
            text("SELECT 1 FROM marketplace_message WHERE message_id = :message_id"),
            {"message_id": tutor_message.message_id},
        ).scalar_one_or_none()
    assert retained_reported_message == 1

    resolved = messaging.resolve_report(
        operator_actor_ref=OPERATOR_ACTOR,
        report_id=report.report_id,
        reason="Reviewed and applied the documented safety policy.",
        now=now,
    )
    assert resolved is not None and resolved.status == "resolved"
    replayed_resolution = messaging.resolve_report(
        operator_actor_ref=OPERATOR_ACTOR,
        report_id=report.report_id,
        reason="Reviewed and applied the documented safety policy.",
        now=now,
    )
    assert replayed_resolution == resolved
    with pytest.raises(TutorApplicationConflictError):
        messaging.resolve_report(
            operator_actor_ref=OPERATOR_ACTOR,
            report_id=report.report_id,
            reason="A different resolution must not replay.",
            now=now,
        )
    with marketplace_engine.connect() as connection:
        audit_actions = (
            connection.execute(
                text(
                    "SELECT action FROM marketplace_message_report_access_audit "
                    "WHERE report_id = :report_id ORDER BY occurred_at, audit_id"
                ),
                {"report_id": report.report_id},
            )
            .scalars()
            .all()
        )
    assert audit_actions == ["viewed", "resolved"]


@pytest.mark.integration
def test_policy_snapshots_and_payout_readiness_are_not_runtime_mutable(
    marketplace_engine: Engine,
) -> None:
    denied = [
        "UPDATE marketplace_policy_version SET commission_basis_points = 2500 "
        "WHERE policy_type = 'commission'",
        "DELETE FROM marketplace_policy_version",
        "UPDATE marketplace_tutor_profile SET payout_ready = true",
        "UPDATE marketplace_tutor_offering SET state = 'active'",
    ]
    with marketplace_engine.connect() as connection:
        connection.execute(text("SET ROLE glidelingo_app"))
        for statement in denied:
            nested = connection.begin_nested()
            with pytest.raises(DBAPIError):
                connection.execute(text(statement))
            nested.rollback()
        connection.execute(text("RESET ROLE"))


@pytest.mark.integration
def test_database_prevents_active_offering_bypass_and_preserves_runtime_draft_insert(
    marketplace_engine: Engine,
) -> None:
    repository = PostgresTutorApplicationRepository(engine=marketplace_engine)
    application_id, profile = create_approved_tutor(repository)
    parameters = {
        "offering_id": uuid4(),
        "application_id": application_id,
        "tutor_id": profile.tutor_id,
        "title": "25-minute conversation lesson",
        "duration_minutes": 25,
        "amount_minor": 2500,
        "currency": "USD",
        "commission_policy_id": UUID("10000000-0000-4000-8000-000000000001"),
        "cancellation_policy_id": UUID("20000000-0000-4000-8000-000000000001"),
    }
    verified_credential_parameters = {
        "credential_id": uuid4(),
        "application_id": application_id,
        "tutor_id": profile.tutor_id,
        "operator_actor_ref": OPERATOR_ACTOR,
    }
    verified_credential_insert = text(
        """
        INSERT INTO marketplace_tutor_credential
          (credential_id, application_id, tutor_id, credential_type, title, issuer,
           verification_status, verified_by_actor_ref, verification_reason, reviewed_at)
        VALUES
          (:credential_id, :application_id, :tutor_id, 'certificate',
           'Adult language teaching certificate', 'Example Institute', 'verified',
           :operator_actor_ref, 'Unauthorized verified credential insert.', now())
        """
    )
    active_insert = text(
        """
        INSERT INTO marketplace_tutor_offering
          (offering_id, application_id, tutor_id, title, duration_minutes, amount_minor,
           currency, state, commission_policy_id, cancellation_policy_id)
        VALUES
          (:offering_id, :application_id, :tutor_id, :title, :duration_minutes, :amount_minor,
           :currency, 'active', :commission_policy_id, :cancellation_policy_id)
        """
    )

    with marketplace_engine.connect() as connection:
        connection.execute(text("SET ROLE glidelingo_app"))
        with pytest.raises(DBAPIError):
            connection.execute(active_insert, parameters)
        connection.rollback()
        connection.execute(text("RESET ROLE"))
        connection.commit()

    with marketplace_engine.connect() as connection:
        connection.execute(text("SET ROLE glidelingo_app"))
        with pytest.raises(DBAPIError):
            connection.execute(verified_credential_insert, verified_credential_parameters)
        connection.rollback()
        connection.execute(text("RESET ROLE"))
        connection.commit()

    with marketplace_engine.connect() as connection:
        with pytest.raises(DBAPIError):
            connection.execute(verified_credential_insert, verified_credential_parameters)
        connection.rollback()

    with marketplace_engine.connect() as connection:
        with pytest.raises(DBAPIError):
            connection.execute(active_insert, parameters)
        connection.rollback()

    unsupported_currency_parameters = {**parameters, "currency": "EUR"}
    with marketplace_engine.connect() as connection:
        with pytest.raises(DBAPIError):
            connection.execute(
                text(
                    """
                    INSERT INTO marketplace_tutor_offering
                      (offering_id, application_id, tutor_id, title, duration_minutes,
                       amount_minor, currency, commission_policy_id, cancellation_policy_id)
                    VALUES
                      (:offering_id, :application_id, :tutor_id, :title, :duration_minutes,
                       :amount_minor, :currency, :commission_policy_id,
                       :cancellation_policy_id)
                    """
                ),
                unsupported_currency_parameters,
            )
        connection.rollback()

    with marketplace_engine.begin() as connection:
        connection.execute(text("SET ROLE glidelingo_app"))
        state = connection.execute(
            text(
                """
                INSERT INTO marketplace_tutor_offering
                  (offering_id, application_id, tutor_id, title, duration_minutes, amount_minor,
                   currency, commission_policy_id, cancellation_policy_id)
                VALUES
                  (:offering_id, :application_id, :tutor_id, :title, :duration_minutes,
                   :amount_minor, :currency, :commission_policy_id, :cancellation_policy_id)
                RETURNING state
                """
            ),
            parameters,
        ).scalar_one()
        connection.execute(text("RESET ROLE"))
    assert state == "draft"


@pytest.mark.integration
def test_database_rejects_status_profile_and_currency_insert_bypasses(
    marketplace_engine: Engine,
) -> None:
    repository = PostgresTutorApplicationRepository(engine=marketplace_engine)
    draft = repository.create_draft(
        application_id=uuid4(),
        actor_ref=TUTOR_ACTOR,
        request=application_request(),
    )

    runtime_denied = [
        text(
            """
            INSERT INTO marketplace_tutor_application
              (application_id, actor_ref, status, headline, biography, time_zone,
               reviewer_actor_ref, submitted_at, reviewed_at, decision_reason)
            VALUES
              (:new_application_id, :new_actor_ref, 'approved', 'Unauthorized tutor profile',
               'This application must never begin in an approved marketplace state.', 'UTC',
               :operator_actor_ref, now(), now(), 'Unauthorized direct approval attempt.')
            """
        ),
        text(
            """
            INSERT INTO marketplace_tutor_profile
              (tutor_id, application_id, actor_ref, headline, biography, time_zone, is_published)
            VALUES
              (:tutor_id, :application_id, :actor_ref, 'Unauthorized tutor profile',
               'This profile must never be published through a direct runtime insert.', 'UTC', true)
            """
        ),
    ]
    parameters = {
        "new_application_id": uuid4(),
        "new_actor_ref": derive_marketplace_actor_ref(
            key=b"marketplace-integration-pseudonym-key-32-bytes",
            clerk_user_id="unauthorized_direct_insert",
        ),
        "operator_actor_ref": OPERATOR_ACTOR,
        "tutor_id": uuid4(),
        "application_id": draft.application_id,
        "actor_ref": TUTOR_ACTOR,
    }
    with marketplace_engine.connect() as connection:
        connection.execute(text("SET ROLE glidelingo_app"))
        for statement in runtime_denied:
            nested = connection.begin_nested()
            with pytest.raises(DBAPIError):
                connection.execute(statement, parameters)
            nested.rollback()

        nested = connection.begin_nested()
        with pytest.raises(DBAPIError):
            connection.execute(
                text(
                    """
                    UPDATE marketplace_tutor_application
                    SET status = 'approved', reviewer_actor_ref = :operator_actor_ref,
                        submitted_at = now(), reviewed_at = now(),
                        decision_reason = 'Unauthorized direct approval attempt.',
                        version = version + 1, updated_at = now()
                    WHERE application_id = :application_id
                    """
                ),
                parameters,
            )
        nested.rollback()
        connection.execute(text("RESET ROLE"))

    with marketplace_engine.connect() as connection:
        with pytest.raises(DBAPIError):
            connection.execute(
                text(
                    """
                    INSERT INTO marketplace_tutor_profile
                      (tutor_id, application_id, actor_ref, headline, biography, time_zone)
                    VALUES
                      (:tutor_id, :application_id, :actor_ref, 'Unauthorized tutor profile',
                       'A draft application must not create an approved tutor profile.', 'UTC')
                    """
                ),
                parameters,
            )
        connection.rollback()


@pytest.mark.integration
def test_first_credential_and_offering_writes_serialize_without_dependency_failures(
    marketplace_engine: Engine,
) -> None:
    repository = PostgresTutorApplicationRepository(engine=marketplace_engine)
    create_approved_tutor(repository)

    credential_request = SaveTutorCredentialRequest(
        expected_version=0,
        credential_type="certificate",
        title="Adult language teaching certificate",
        issuer="Example Institute",
    )
    credential_barrier = Barrier(2)

    def save_first_credential() -> StoredTutorProfile | None:
        credential_barrier.wait()
        return repository.save_credential(actor_ref=TUTOR_ACTOR, request=credential_request)

    with ThreadPoolExecutor(max_workers=2) as executor:
        credential_results = list(executor.map(lambda _: save_first_credential(), range(2)))
    assert sum(result is not None for result in credential_results) == 1

    offering_request = SaveTutorOfferingRequest(
        expected_version=0,
        title="25-minute conversation lesson",
        duration_minutes=25,
        amount_minor=2500,
        currency="USD",
    )
    offering_barrier = Barrier(2)

    def save_first_offering() -> StoredTutorProfile | None:
        offering_barrier.wait()
        return repository.save_offering(actor_ref=TUTOR_ACTOR, request=offering_request)

    with ThreadPoolExecutor(max_workers=2) as executor:
        offering_results = list(executor.map(lambda _: save_first_offering(), range(2)))
    assert sum(result is not None for result in offering_results) == 1


@pytest.mark.integration
def test_suspension_lock_prevents_concurrent_publication(
    marketplace_engine: Engine,
) -> None:
    repository = PostgresTutorApplicationRepository(engine=marketplace_engine)
    application_id, profile = create_approved_tutor(repository)
    with_offering = repository.save_offering(
        actor_ref=TUTOR_ACTOR,
        request=SaveTutorOfferingRequest(
            expected_version=0,
            title="25-minute conversation lesson",
            duration_minutes=25,
            amount_minor=2500,
            currency="USD",
        ),
    )
    assert with_offering is not None
    assert with_offering.offering is not None
    offering_version = with_offering.offering.version
    offering_id = with_offering.offering.offering_id
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_tutor_profile SET payout_ready = true "
                "WHERE application_id = :application_id"
            ),
            {"application_id": application_id},
        )

    suspension_connection = marketplace_engine.connect()
    suspension_transaction = suspension_connection.begin()
    executor = ThreadPoolExecutor(max_workers=1)
    try:
        suspension_connection.execute(
            text(
                """
                UPDATE marketplace_tutor_application
                SET status = 'suspended', reviewer_actor_ref = :operator_actor_ref,
                    reviewed_at = now(), decision_reason = :reason,
                    version = version + 1, updated_at = now()
                WHERE application_id = :application_id
                """
            ),
            {
                "application_id": application_id,
                "operator_actor_ref": OPERATOR_ACTOR,
                "reason": "Concurrent publication was stopped by a safety suspension.",
            },
        )

        def publish_as_runtime() -> UUID | None:
            with marketplace_engine.begin() as connection:
                connection.execute(text("SET ROLE glidelingo_app"))
                result = cast(
                    UUID | None,
                    connection.execute(
                        text(
                            "SELECT marketplace_set_tutor_publication_v2(:actor_ref, "
                            ":profile_version, CAST(:expected_offerings AS jsonb), true)"
                        ),
                        {
                            "actor_ref": TUTOR_ACTOR,
                            "profile_version": profile.version,
                            "expected_offerings": json.dumps(
                                [
                                    {
                                        "offering_id": str(offering_id),
                                        "expected_version": offering_version,
                                    }
                                ]
                            ),
                        },
                    ).scalar_one(),
                )
                connection.execute(text("RESET ROLE"))
                return result

        publication = executor.submit(publish_as_runtime)
        with pytest.raises(FutureTimeoutError):
            publication.result(timeout=0.2)
        suspension_transaction.commit()
        assert publication.result(timeout=2) is None
    finally:
        if suspension_transaction.is_active:
            suspension_transaction.rollback()
        suspension_connection.close()
        executor.shutdown(wait=True)

    final_profile = repository.get_profile_by_actor(actor_ref=TUTOR_ACTOR)
    assert final_profile is not None
    assert final_profile.application_status == "suspended"
    assert final_profile.is_published is False
    assert final_profile.offering is not None
    assert final_profile.offering.state == "draft"


@pytest.mark.integration
def test_published_workspace_requires_explicit_unpublish_before_editing(
    marketplace_engine: Engine,
) -> None:
    repository = PostgresTutorApplicationRepository(engine=marketplace_engine)
    application_id, profile = create_approved_tutor(repository)
    with_offering = repository.save_offering(
        actor_ref=TUTOR_ACTOR,
        request=SaveTutorOfferingRequest(
            expected_version=0,
            title="25-minute conversation lesson",
            duration_minutes=25,
            amount_minor=2500,
            currency="USD",
        ),
    )
    assert with_offering is not None
    assert with_offering.offering is not None
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_tutor_profile SET payout_ready = true "
                "WHERE application_id = :application_id"
            ),
            {"application_id": application_id},
        )

    published = repository.set_publication(
        actor_ref=TUTOR_ACTOR,
        expected_profile_version=profile.version,
        expected_offering_version=with_offering.offering.version,
        publish=True,
    )
    assert published is not None
    assert published.is_published is True
    assert published.offering is not None
    assert published.offering.state == "active"
    assert (
        repository.update_profile_draft(
            actor_ref=TUTOR_ACTOR,
            request=UpdateTutorProfileDraftRequest(
                expected_version=published.version,
                headline="A live edit must not leak",
                biography="This content must remain private until an explicit republish cycle.",
                time_zone="UTC",
            ),
        )
        is None
    )

    unpublished = repository.set_publication(
        actor_ref=TUTOR_ACTOR,
        expected_profile_version=published.version,
        expected_offering_version=published.offering.version,
        publish=False,
    )
    assert unpublished is not None
    edited = repository.update_profile_draft(
        actor_ref=TUTOR_ACTOR,
        request=UpdateTutorProfileDraftRequest(
            expected_version=unpublished.version,
            headline="A private edit is safe",
            biography="This content remains private until another explicit publication action.",
            time_zone="UTC",
        ),
    )
    assert edited is not None


@pytest.mark.integration
def test_booking_holds_overlap_webhooks_money_and_participant_scope(
    marketplace_engine: Engine,
) -> None:
    _, booking, profile = create_bookable_tutor(marketplace_engine)
    now = datetime.now(UTC)
    starts_at = now + timedelta(days=2)
    platform_account = "acct_reviewed123"
    barrier = Barrier(2)

    def attempt_hold(learner_actor_ref: str) -> object:
        barrier.wait(timeout=2)
        try:
            return booking.create_hold(
                learner_actor_ref=learner_actor_ref,
                tutor_id=profile.tutor_id,
                starts_at=starts_at,
                idempotency_key=uuid4(),
                now=now,
                hold_seconds=600,
                environment="SANDBOX",
                platform_account_id=platform_account,
            )
        except TutorApplicationConflictError:
            return "overlap_rejected"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt_hold, (LEARNER_ACTOR, OUTSIDER_ACTOR)))
    assert sum(result == "overlap_rejected" for result in results) == 1
    held = cast(Any, next(result for result in results if result != "overlap_rejected"))
    assert held is not None
    owner = held.learner_actor_ref
    other = OUTSIDER_ACTOR if owner == LEARNER_ACTOR else LEARNER_ACTOR
    assert booking.get_booking(booking_id=held.booking_id, actor_ref=other) is None

    idempotency_key = uuid4()
    idempotent_start = starts_at + timedelta(days=1)
    first = booking.create_hold(
        learner_actor_ref=owner,
        tutor_id=profile.tutor_id,
        starts_at=idempotent_start,
        idempotency_key=idempotency_key,
        now=now,
        hold_seconds=600,
        environment="SANDBOX",
        platform_account_id=platform_account,
    )
    repeated = booking.create_hold(
        learner_actor_ref=owner,
        tutor_id=profile.tutor_id,
        starts_at=idempotent_start,
        idempotency_key=idempotency_key,
        now=now,
        hold_seconds=600,
        environment="SANDBOX",
        platform_account_id=platform_account,
    )
    assert first is not None and repeated is not None
    assert repeated.booking_id == first.booking_id
    with pytest.raises(TutorApplicationConflictError):
        booking.create_hold(
            learner_actor_ref=owner,
            tutor_id=profile.tutor_id,
            starts_at=idempotent_start + timedelta(hours=1),
            idempotency_key=idempotency_key,
            now=now,
            hold_seconds=600,
            environment="SANDBOX",
            platform_account_id=platform_account,
        )

    checkout = StripeCheckout(
        checkout_id="cs_test_reviewed123",
        url="https://checkout.stripe.com/c/pay/reviewed123",
        payment_intent_id="pi_reviewed123",
        status="open",
        payment_status="unpaid",
        livemode=False,
        booking_id=held.booking_id,
        platform_account_id=platform_account,
        amount_minor=held.amount_minor,
        currency=held.currency,
        created_at=now,
    )
    checkout_attach_barrier = Barrier(2)

    def attach_checkout_from_request_or_worker(_: int) -> Any:
        checkout_attach_barrier.wait()
        return booking.attach_checkout(
            booking_id=held.booking_id,
            learner_actor_ref=owner,
            checkout=checkout,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        checkout_attachments = list(pool.map(attach_checkout_from_request_or_worker, range(2)))
    assert all(
        item is not None and item.state == "payment_pending" for item in checkout_attachments
    )
    assert (
        booking.attach_checkout(
            booking_id=held.booking_id,
            learner_actor_ref=owner,
            checkout=replace(checkout, checkout_id="cs_test_mismatched"),
        )
        is None
    )
    pending = checkout_attachments[0]
    assert pending.amount_minor == pending.commission_amount_minor + pending.tutor_amount_minor
    assert pending.commission_basis_points == 2000
    with marketplace_engine.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT count(*) FROM marketplace_booking_transition_audit "
                    "WHERE booking_id = :booking_id AND reason_code = 'checkout_created'"
                ),
                {"booking_id": held.booking_id},
            ).scalar_one()
            == 1
        )
        assert (
            connection.execute(
                text(
                    "SELECT count(*) FROM marketplace_message "
                    "JOIN marketplace_conversation USING (conversation_id) "
                    "WHERE marketplace_conversation.booking_id = :booking_id "
                    "AND body = 'Checkout started. The booking confirms only after "
                    "verified payment.'"
                ),
                {"booking_id": held.booking_id},
            ).scalar_one()
            == 1
        )

    invalid_paid = (
        replace(
            checkout,
            url=None,
            status="complete",
            payment_status="paid",
            amount_minor=2400,
            created_at=now + timedelta(seconds=10),
        ),
        replace(
            checkout,
            url=None,
            status="complete",
            payment_status="paid",
            currency="EUR",
            created_at=now + timedelta(seconds=11),
        ),
        replace(
            checkout,
            url=None,
            payment_intent_id=None,
            status="complete",
            payment_status="paid",
            created_at=now + timedelta(seconds=12),
        ),
    )
    for index, observation in enumerate(invalid_paid):
        ignored, unchanged = booking.apply_checkout_observation(
            checkout=observation,
            payload_sha256=str(index).ljust(64, "0"),
            event_id=f"evt_invalid{index:08d}",
            event_type="checkout.session.completed",
            source="provider_webhook",
            environment="SANDBOX",
            platform_account_id=platform_account,
        )
        assert ignored == "ignored"
        assert unchanged is not None and unchanged.state == "payment_pending"

    confirmed_checkout = StripeCheckout(
        checkout_id=checkout.checkout_id,
        url=None,
        payment_intent_id=checkout.payment_intent_id,
        status="complete",
        payment_status="paid",
        livemode=False,
        booking_id=held.booking_id,
        platform_account_id=platform_account,
        amount_minor=held.amount_minor,
        currency=held.currency,
        created_at=now + timedelta(minutes=1),
    )
    outcome, confirmed = booking.apply_checkout_observation(
        checkout=confirmed_checkout,
        payload_sha256="a" * 64,
        event_id="evt_reviewed123",
        event_type="checkout.session.completed",
        source="provider_webhook",
        environment="SANDBOX",
        platform_account_id=platform_account,
    )
    assert outcome == "applied"
    assert confirmed is not None and confirmed.state == "confirmed"
    duplicate, _ = booking.apply_checkout_observation(
        checkout=confirmed_checkout,
        payload_sha256="a" * 64,
        event_id="evt_reviewed123",
        event_type="checkout.session.completed",
        source="provider_webhook",
        environment="SANDBOX",
        platform_account_id=platform_account,
    )
    assert duplicate == "duplicate"

    older = StripeCheckout(
        checkout_id=checkout.checkout_id,
        url=None,
        payment_intent_id=checkout.payment_intent_id,
        status="expired",
        payment_status="unpaid",
        livemode=False,
        booking_id=held.booking_id,
        platform_account_id=platform_account,
        amount_minor=held.amount_minor,
        currency=held.currency,
        created_at=now,
    )
    stale, _ = booking.apply_checkout_observation(
        checkout=older,
        payload_sha256="b" * 64,
        event_id="evt_reviewed456",
        event_type="checkout.session.expired",
        source="provider_webhook",
        environment="SANDBOX",
        platform_account_id=platform_account,
    )
    assert stale == "out_of_order"

    wrong_account = StripeCheckout(
        checkout_id=checkout.checkout_id,
        url=None,
        payment_intent_id=checkout.payment_intent_id,
        status="complete",
        payment_status="paid",
        livemode=False,
        booking_id=held.booking_id,
        platform_account_id="acct_wrong12345",
        amount_minor=held.amount_minor,
        currency=held.currency,
        created_at=now + timedelta(minutes=2),
    )
    ignored, _ = booking.apply_checkout_observation(
        checkout=wrong_account,
        payload_sha256="c" * 64,
        event_id="evt_reviewed789",
        event_type="checkout.session.completed",
        source="provider_webhook",
        environment="SANDBOX",
        platform_account_id=platform_account,
    )
    assert ignored == "ignored"

    with marketplace_engine.connect() as connection:
        system_messages = connection.execute(
            text(
                "SELECT count(*) FROM marketplace_message AS message "
                "JOIN marketplace_conversation AS conversation USING (conversation_id) "
                "WHERE conversation.booking_id = :booking_id AND message.kind = 'system'"
            ),
            {"booking_id": held.booking_id},
        ).scalar_one()
    assert system_messages == 3


@pytest.mark.integration
def test_buffers_and_provider_checkout_terminal_state_guard_inventory(
    marketplace_engine: Engine,
) -> None:
    _, booking, profile = create_bookable_tutor(marketplace_engine)
    now = datetime.now(UTC)
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_tutor_profile SET buffer_before_minutes = 5, "
                "buffer_after_minutes = 10 WHERE tutor_id = :id"
            ),
            {"id": profile.tutor_id},
        )
    first = booking.create_hold(
        learner_actor_ref=LEARNER_ACTOR,
        tutor_id=profile.tutor_id,
        starts_at=now + timedelta(days=2),
        idempotency_key=uuid4(),
        now=now,
        hold_seconds=600,
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert first is not None
    assert first.buffer_before_minutes == 5 and first.buffer_after_minutes == 10
    busy = PostgresDiscoveryRepository(engine=marketplace_engine).list_internal_busy(
        tutor_id=profile.tutor_id,
        starts_at=first.ends_at,
        ends_at=first.ends_at + timedelta(minutes=25),
    )
    assert busy == (
        TimeInterval(
            starts_at=first.starts_at - timedelta(minutes=5),
            ends_at=first.ends_at + timedelta(minutes=10),
        ),
    )
    with pytest.raises(TutorApplicationConflictError):
        booking.create_hold(
            learner_actor_ref=OUTSIDER_ACTOR,
            tutor_id=profile.tutor_id,
            starts_at=first.ends_at,
            idempotency_key=uuid4(),
            now=now,
            hold_seconds=600,
            environment="SANDBOX",
            platform_account_id="acct_reviewed123",
        )
    pending = booking.attach_checkout(
        booking_id=first.booking_id,
        learner_actor_ref=LEARNER_ACTOR,
        checkout=StripeCheckout(
            checkout_id=f"cs_test_{first.booking_id.hex[:12]}",
            url="https://checkout.stripe.com/c/pay/buffered123",
            payment_intent_id=f"pi_{first.booking_id.hex[:12]}",
            status="open",
            payment_status="unpaid",
            livemode=False,
            booking_id=first.booking_id,
            platform_account_id="acct_reviewed123",
            amount_minor=first.amount_minor,
            currency=first.currency,
            created_at=now,
        ),
    )
    assert pending is not None
    with marketplace_engine.connect() as connection:
        connection.execute(text("SET ROLE glidelingo_app"))
        nested = connection.begin_nested()
        with pytest.raises(DBAPIError):
            connection.execute(
                text(
                    "INSERT INTO marketplace_money_ledger "
                    "(entry_id, booking_id, kind, amount_minor, currency) "
                    "VALUES (:entry_id, :booking_id, 'charge', :amount, :currency)"
                ),
                {
                    "entry_id": uuid4(),
                    "booking_id": pending.booking_id,
                    "amount": pending.amount_minor,
                    "currency": pending.currency,
                },
            )
        nested.rollback()
        nested = connection.begin_nested()
        with pytest.raises(DBAPIError):
            connection.execute(
                text(
                    "SELECT * FROM marketplace_confirm_booking_payment("
                    ":booking_id, :checkout_id, :payment_intent_id, :event_at, "
                    "'SANDBOX', 'acct_reviewed123', :amount, 'USD')"
                ),
                {
                    "booking_id": pending.booking_id,
                    "checkout_id": pending.provider_checkout_id,
                    "payment_intent_id": f"pi_{first.booking_id.hex[:12]}",
                    "event_at": now,
                    "amount": pending.amount_minor,
                },
            )
        nested.rollback()
        connection.execute(text("RESET ROLE"))
    assert booking.expire_holds(now=now + timedelta(minutes=20), limit=10) == 0
    pending_after_expiry = booking.get_booking(booking_id=first.booking_id, actor_ref=LEARNER_ACTOR)
    assert pending_after_expiry is not None and pending_after_expiry.state == "payment_pending"

    ambiguous = booking.create_hold(
        learner_actor_ref=OUTSIDER_ACTOR,
        tutor_id=profile.tutor_id,
        starts_at=now + timedelta(days=3),
        idempotency_key=uuid4(),
        now=now,
        hold_seconds=600,
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert ambiguous is not None
    ambiguous = booking.mark_checkout_ambiguous(
        booking_id=ambiguous.booking_id,
        learner_actor_ref=OUTSIDER_ACTOR,
        reason_code="provider_timeout",
    )
    assert ambiguous is not None and ambiguous.provider_checkout_id is None
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_payment_reconciliation_job "
                "SET status = 'dead', attempt = 8, safe_failure_code = 'attempts_exhausted' "
                "WHERE booking_id = :booking_id"
            ),
            {"booking_id": ambiguous.booking_id},
        )
    assert (
        booking.recover_reconciliation(
            booking_id=ambiguous.booking_id,
            operator_actor_ref=OUTSIDER_ACTOR,
            reason="An unauthorized actor must not recover this job.",
            now=now,
        )
        is None
    )
    recovered = booking.recover_reconciliation(
        booking_id=ambiguous.booking_id,
        operator_actor_ref=OPERATOR_ACTOR,
        reason="Provider state was checked and the exhausted job may safely retry.",
        now=now,
    )
    assert recovered is not None and recovered.state == "payment_ambiguous"
    with marketplace_engine.connect() as connection:
        job = connection.execute(
            text(
                "SELECT status, attempt, safe_failure_code "
                "FROM marketplace_payment_reconciliation_job WHERE booking_id = :booking_id"
            ),
            {"booking_id": ambiguous.booking_id},
        ).one()
        audit_reason = connection.execute(
            text(
                "SELECT reason FROM marketplace_reconciliation_recovery_audit "
                "WHERE booking_id = :booking_id"
            ),
            {"booking_id": ambiguous.booking_id},
        ).scalar_one()
    assert job == ("retryable", 0, "operator_reconciled")
    assert audit_reason == "Provider state was checked and the exhausted job may safely retry."

    plain = booking.create_hold(
        learner_actor_ref=LEARNER_ACTOR,
        tutor_id=profile.tutor_id,
        starts_at=now + timedelta(days=4),
        idempotency_key=uuid4(),
        now=now,
        hold_seconds=600,
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert plain is not None
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_payment_reconciliation_job SET status = 'dead' "
                "WHERE booking_id = :booking_id"
            ),
            {"booking_id": plain.booking_id},
        )
    assert booking.expire_holds(now=now + timedelta(minutes=20), limit=10) == 1
    plain_after_expiry = booking.get_booking(booking_id=plain.booking_id, actor_ref=LEARNER_ACTOR)
    assert plain_after_expiry is not None and plain_after_expiry.state == "expired"

    # A verified provider success after the local hold deadline must not win the
    # worker race and resurrect inventory that the marketplace can sell again.
    outcome, late = booking.apply_checkout_observation(
        checkout=StripeCheckout(
            checkout_id=pending.provider_checkout_id or "",
            url=None,
            payment_intent_id=f"pi_{first.booking_id.hex[:12]}",
            status="complete",
            payment_status="paid",
            livemode=False,
            booking_id=first.booking_id,
            platform_account_id="acct_reviewed123",
            amount_minor=first.amount_minor,
            currency=first.currency,
            created_at=now + timedelta(minutes=21),
        ),
        payload_sha256="f" * 64,
        event_id=f"evt_{first.booking_id.hex[:12]}",
        event_type="checkout.session.completed",
        source="provider_webhook",
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert outcome == "applied" and late is not None
    assert late.state == "expired" and late.money_state == "refund_pending"
    with marketplace_engine.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT amount_minor FROM marketplace_money_operation "
                    "WHERE booking_id = :id AND kind = 'refund'"
                ),
                {"id": first.booking_id},
            ).scalar_one()
            == first.amount_minor
        )


@pytest.mark.integration
def test_reconciliation_recovers_crash_after_provider_effect_before_inventory_release(
    marketplace_engine: Engine,
) -> None:
    _, repository, profile = create_bookable_tutor(marketplace_engine)
    provider = FakeReconciliationStripe()
    service = BookingService(
        enabled=True,
        repository=repository,
        provider=cast(StripeMarketplaceProvider, provider),
        discovery=cast(MarketplaceDiscoveryService, object()),
        pseudonym_key=b"marketplace-integration-pseudonym-key-32-bytes",
        actor_allowlist=("user_learner_integration",),
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
        connect_refresh_url=None,
        connect_return_url=None,
        checkout_success_url="https://app.example.test/success",
        checkout_cancel_url="https://app.example.test/cancel",
        meeting_hosts=("meet.example.com",),
    )
    old_now = datetime.now(UTC)
    held = repository.create_hold(
        learner_actor_ref=LEARNER_ACTOR,
        tutor_id=profile.tutor_id,
        starts_at=datetime.now(UTC) + timedelta(days=3),
        idempotency_key=uuid4(),
        now=old_now,
        hold_seconds=1,
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert held is not None
    idempotency_key = f"booking:{held.booking_id}:checkout"
    provider_effect = asyncio.run(
        provider.create_checkout(
            booking_id=held.booking_id,
            amount_minor=held.amount_minor,
            currency=held.currency,
            idempotency_key=idempotency_key,
        )
    )
    assert provider_effect.status == "open"
    sleep(1.05)

    assert asyncio.run(service.run_one_reconciliation_job(worker="reconcile-a"))
    reconciled = repository.get_booking(booking_id=held.booking_id, actor_ref=LEARNER_ACTOR)
    assert reconciled is not None and reconciled.state == "expired"
    assert provider.created_idempotency_keys == [idempotency_key, idempotency_key]
    assert not asyncio.run(service.run_one_reconciliation_job(worker="reconcile-b"))


@pytest.mark.integration
def test_payment_authority_roles_confirm_and_reject_forged_general_role_evidence(
    marketplace_engine: Engine,
    marketplace_runtime_engines: tuple[Engine, Engine],
) -> None:
    _, booking, profile = create_bookable_tutor(marketplace_engine)
    app_engine, payment_engine = marketplace_runtime_engines
    create_database_probe(app_engine, payment_engine=payment_engine)()
    with pytest.raises(DatabaseUnavailableError):
        create_database_probe(app_engine, payment_engine=app_engine)()
    with pytest.raises(DatabaseUnavailableError):
        create_database_probe(marketplace_engine, payment_engine=payment_engine)()
    now = datetime.now(UTC)
    held = booking.create_hold(
        learner_actor_ref=LEARNER_ACTOR,
        tutor_id=profile.tutor_id,
        starts_at=now + timedelta(days=2),
        idempotency_key=uuid4(),
        now=now,
        hold_seconds=600,
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert held is not None
    checkout = StripeCheckout(
        checkout_id=f"cs_test_{held.booking_id.hex[:12]}",
        url="https://checkout.stripe.com/c/pay/authority123",
        payment_intent_id=f"pi_{held.booking_id.hex[:12]}",
        status="complete",
        payment_status="paid",
        livemode=False,
        booking_id=held.booking_id,
        platform_account_id="acct_reviewed123",
        amount_minor=held.amount_minor,
        currency=held.currency,
        created_at=now,
    )
    assert (
        booking.attach_checkout(
            booking_id=held.booking_id,
            learner_actor_ref=LEARNER_ACTOR,
            checkout=replace(checkout, status="open", payment_status="unpaid"),
        )
        is not None
    )
    runtime_booking = PostgresBookingRepository(
        engine=app_engine,
        payment_engine=payment_engine,
    )
    outcome, confirmed = runtime_booking.apply_checkout_observation(
        checkout=checkout,
        payload_sha256="1" * 64,
        event_id="evt_authorityrole1234567890",
        event_type="checkout.session.completed",
        source="provider_webhook",
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert outcome == "applied"
    assert confirmed is not None and confirmed.state == "confirmed"

    with pytest.raises(DBAPIError), app_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO marketplace_booking_transition_operation "
                "(operation_id, booking_id, actor_ref, action, request_fingerprint) "
                "VALUES (:operation_id, :booking_id, :actor, 'tutor_no_show', :fingerprint)"
            ),
            {
                "operation_id": uuid4(),
                "booking_id": held.booking_id,
                "actor": LEARNER_ACTOR,
                "fingerprint": "a" * 64,
            },
        )
    with pytest.raises(DBAPIError), app_engine.begin() as connection:
        connection.execute(
            text(
                "SELECT marketplace_queue_booking_money("
                ":booking_id, 'refund', transaction_timestamp())"
            ),
            {"booking_id": held.booking_id},
        )

    lifecycle = PostgresLifecycleRepository(
        engine=app_engine,
        payment_engine=payment_engine,
    )
    assert lifecycle.transition(
        booking_id=held.booking_id,
        actor_ref=TUTOR_ACTOR,
        action="cancel",
        reason="Tutor cancelled with a full learner refund.",
        new_starts_at=None,
        now=now,
    )
    operation = lifecycle.claim_money_operation(
        worker="authority-worker", now=now, lease_seconds=60
    )
    assert operation is not None and operation.kind == "refund"
    assert lifecycle.finish_money_operation(
        operation=operation,
        result=StripeMoneyResult("re_authority123", False, held.amount_minor, held.currency),
        worker="authority-worker",
    )


@pytest.mark.integration
def test_lifecycle_cutoffs_disputes_money_jobs_earnings_and_verified_reviews(
    marketplace_engine: Engine,
    marketplace_runtime_engines: tuple[Engine, Engine],
) -> None:
    _, booking, profile = create_bookable_tutor(marketplace_engine)
    app_engine, payment_engine = marketplace_runtime_engines
    lifecycle = PostgresLifecycleRepository(
        engine=app_engine,
        payment_engine=payment_engine,
    )
    now = datetime.now(UTC)

    def confirmed(starts_at: datetime, learner: str = LEARNER_ACTOR) -> Any:
        held = booking.create_hold(
            learner_actor_ref=learner,
            tutor_id=profile.tutor_id,
            starts_at=starts_at,
            idempotency_key=uuid4(),
            now=now,
            hold_seconds=600,
            environment="SANDBOX",
            platform_account_id="acct_reviewed123",
        )
        assert held is not None
        suffix = held.booking_id.hex[:12]
        pending = booking.attach_checkout(
            booking_id=held.booking_id,
            learner_actor_ref=learner,
            checkout=StripeCheckout(
                checkout_id=f"cs_test_{suffix}",
                url="https://checkout.stripe.com/c/pay/reviewed123",
                payment_intent_id=f"pi_{suffix}",
                status="open",
                payment_status="unpaid",
                livemode=False,
                booking_id=held.booking_id,
                platform_account_id="acct_reviewed123",
                amount_minor=held.amount_minor,
                currency=held.currency,
                created_at=now,
            ),
        )
        assert pending is not None
        outcome, value = booking.apply_checkout_observation(
            checkout=StripeCheckout(
                checkout_id=f"cs_test_{suffix}",
                url=None,
                payment_intent_id=f"pi_{suffix}",
                status="complete",
                payment_status="paid",
                livemode=False,
                booking_id=held.booking_id,
                platform_account_id="acct_reviewed123",
                amount_minor=held.amount_minor,
                currency=held.currency,
                created_at=now,
            ),
            payload_sha256=suffix.ljust(64, "a"),
            event_id=f"evt_{suffix}",
            event_type="checkout.session.completed",
            source="provider_webhook",
            environment="SANDBOX",
            platform_account_id="acct_reviewed123",
        )
        assert outcome == "applied" and value is not None
        return value

    rescheduled = confirmed(now + timedelta(days=5))
    new_start = now + timedelta(days=6)
    reschedule_operation_id = uuid4()
    assert lifecycle.transition(
        booking_id=rescheduled.booking_id,
        actor_ref=LEARNER_ACTOR,
        action="reschedule",
        reason="Learner and tutor agreed to a later lesson time.",
        new_starts_at=new_start,
        now=now,
        expected_profile_version=profile.version,
        operation_id=reschedule_operation_id,
    )
    assert lifecycle.transition(
        booking_id=rescheduled.booking_id,
        actor_ref=LEARNER_ACTOR,
        action="reschedule",
        reason="Learner and tutor agreed to a later lesson time.",
        new_starts_at=new_start,
        now=now,
        expected_profile_version=profile.version,
        operation_id=reschedule_operation_id,
    )
    with pytest.raises(TutorApplicationConflictError):
        lifecycle.transition(
            booking_id=rescheduled.booking_id,
            actor_ref=LEARNER_ACTOR,
            action="reschedule",
            reason="Changed retry input must conflict.",
            new_starts_at=new_start,
            now=now,
            expected_profile_version=profile.version,
            operation_id=reschedule_operation_id,
        )
    with marketplace_engine.connect() as connection:
        revision = connection.execute(
            text(
                "SELECT version, prior_starts_at, starts_at "
                "FROM marketplace_booking_schedule_revision WHERE booking_id = :id"
            ),
            {"id": rescheduled.booking_id},
        ).one()
        reminders = connection.execute(
            text(
                "SELECT kind, state FROM marketplace_booking_reminder_job "
                "WHERE booking_id = :id ORDER BY kind"
            ),
            {"id": rescheduled.booking_id},
        ).all()
    assert revision == (2, rescheduled.starts_at, new_start)
    assert [tuple(row) for row in reminders] == [
        ("completion_prompt", "queued"),
        ("lesson_reminder", "queued"),
    ]

    delivery = confirmed(now + timedelta(days=20))
    with marketplace_engine.connect() as connection:
        delivery_conversation_id = connection.execute(
            text("SELECT conversation_id FROM marketplace_conversation WHERE booking_id = :id"),
            {"id": delivery.booking_id},
        ).scalar_one()
    delivery_messaging = PostgresMessagingRepository(engine=marketplace_engine)
    sent, delivery_message = delivery_messaging.send_message(
        conversation_id=delivery_conversation_id,
        actor_ref=LEARNER_ACTOR,
        client_message_id=uuid4(),
        body="Please confirm the lesson preparation details.",
        now=now,
    )
    assert sent == "created" and delivery_message is not None
    with marketplace_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE marketplace_booking_reminder_job SET state = 'dead', attempt = 8, "
                "safe_failure_code = 'attempts_exhausted' WHERE booking_id = :id"
            ),
            {"id": delivery.booking_id},
        )
        connection.execute(
            text(
                "UPDATE marketplace_message_notification_job SET status = 'dead', attempt = 8, "
                "safe_failure_code = 'unavailable' WHERE message_id = :message_id"
            ),
            {"message_id": delivery_message.message_id},
        )
    delivery_reason = "Delivery provider and worker health were restored."
    assert not lifecycle.recover_delivery_jobs(
        booking_id=delivery.booking_id,
        operator_actor_ref=SECOND_OPERATOR_ACTOR,
        reason=delivery_reason,
        now=now,
    )
    assert lifecycle.recover_delivery_jobs(
        booking_id=delivery.booking_id,
        operator_actor_ref=OPERATOR_ACTOR,
        reason=delivery_reason,
        now=now,
    )
    assert lifecycle.recover_delivery_jobs(
        booking_id=delivery.booking_id,
        operator_actor_ref=OPERATOR_ACTOR,
        reason=delivery_reason,
        now=now,
    )
    assert not lifecycle.recover_delivery_jobs(
        booking_id=delivery.booking_id,
        operator_actor_ref=OPERATOR_ACTOR,
        reason="A different recovery must not be treated as a replay.",
        now=now,
    )
    with marketplace_engine.connect() as connection:
        reminder_states = set(
            connection.execute(
                text("SELECT state FROM marketplace_booking_reminder_job WHERE booking_id = :id"),
                {"id": delivery.booking_id},
            ).scalars()
        )
        notification_state = connection.execute(
            text(
                "SELECT status FROM marketplace_message_notification_job "
                "WHERE message_id = :message_id"
            ),
            {"message_id": delivery_message.message_id},
        ).scalar_one()
        delivery_audits = connection.execute(
            text("SELECT count(*) FROM marketplace_delivery_recovery_audit WHERE booking_id = :id"),
            {"id": delivery.booking_id},
        ).scalar_one()
    assert reminder_states == {"queued"}
    assert notification_state == "queued"
    assert delivery_audits == 1

    refundable = confirmed(now + timedelta(hours=13))
    with marketplace_engine.connect() as connection:
        connection.execute(text("SET ROLE glidelingo_app"))
        for statement, values in (
            (
                "UPDATE marketplace_booking SET state = 'completed', completed_at = :now, "
                "dispute_deadline_at = :deadline, updated_at = :now WHERE booking_id = :id",
                {"id": refundable.booking_id, "now": now, "deadline": now + timedelta(hours=24)},
            ),
            (
                "UPDATE marketplace_booking SET money_state = 'transferred', updated_at = :now "
                "WHERE booking_id = :id",
                {"id": refundable.booking_id, "now": now},
            ),
            (
                "INSERT INTO marketplace_booking_review "
                "(review_id, booking_id, learner_actor_ref, tutor_id, rating) "
                "VALUES (:review_id, :id, :learner, :tutor_id, 5)",
                {
                    "review_id": uuid4(),
                    "id": refundable.booking_id,
                    "learner": LEARNER_ACTOR,
                    "tutor_id": profile.tutor_id,
                },
            ),
        ):
            nested = connection.begin_nested()
            with pytest.raises(DBAPIError):
                connection.execute(text(statement), values)
            nested.rollback()
        connection.execute(text("RESET ROLE"))
    assert lifecycle.transition(
        booking_id=refundable.booking_id,
        actor_ref=LEARNER_ACTOR,
        action="cancel",
        reason="Learner cancelled before cutoff.",
        new_starts_at=None,
        now=now,
    )
    refund = lifecycle.claim_money_operation(worker="money-worker", now=now, lease_seconds=60)
    assert refund is not None and refund.kind == "refund" and refund.amount_minor == 2500
    assert lifecycle.finish_money_operation(
        operation=refund,
        result=StripeMoneyResult("re_reviewed123", False, 2500, "USD"),
        worker="money-worker",
    )

    late = confirmed(now + timedelta(hours=11))
    assert lifecycle.transition(
        booking_id=late.booking_id,
        actor_ref=LEARNER_ACTOR,
        action="cancel",
        reason="Learner cancelled after cutoff.",
        new_starts_at=None,
        now=now,
    )
    payout_at = next_weekly_payout_at(late.ends_at + timedelta(hours=24, microseconds=1))
    assert (
        lifecycle.claim_money_operation(
            worker="money-worker", now=payout_at - timedelta(microseconds=1), lease_seconds=60
        )
        is None
    )
    transfer = lifecycle.claim_money_operation(
        worker="money-worker", now=payout_at, lease_seconds=60
    )
    assert transfer is not None and transfer.kind == "transfer" and transfer.amount_minor == 2000
    lifecycle.fail_money_operation(
        operation_id=transfer.operation_id,
        worker="money-worker",
        code="provider_timeout",
        ambiguous=True,
        now=now,
    )
    assert lifecycle.recover_money_operation(
        booking_id=late.booking_id,
        operator_actor_ref=OPERATOR_ACTOR,
        reason="Provider dashboard and idempotency result reconciled.",
        now=now,
    )
    retried = lifecycle.claim_money_operation(
        worker="money-worker-2", now=payout_at, lease_seconds=60
    )
    assert retried is not None and retried.idempotency_key == transfer.idempotency_key
    assert lifecycle.finish_money_operation(
        operation=retried,
        result=StripeMoneyResult("tr_reviewed123", False, 2000, "USD"),
        worker="money-worker-2",
    )
    assert lifecycle.earnings(tutor_actor_ref=TUTOR_ACTOR).transferred_minor == 2000

    tutor_absent = confirmed(now - timedelta(days=5))
    assert lifecycle.transition(
        booking_id=tutor_absent.booking_id,
        actor_ref=LEARNER_ACTOR,
        action="tutor_no_show",
        reason="Learner reported the tutor did not attend.",
        new_starts_at=None,
        now=now,
    )
    no_show_refund = lifecycle.claim_money_operation(
        worker="money-worker-tutor-no-show", now=now, lease_seconds=60
    )
    assert no_show_refund is not None and no_show_refund.kind == "refund"
    assert lifecycle.finish_money_operation(
        operation=no_show_refund,
        result=StripeMoneyResult("re_tutornoshow1", False, 2500, "USD"),
        worker="money-worker-tutor-no-show",
    )

    learner_absent = confirmed(now - timedelta(days=6))
    assert lifecycle.transition(
        booking_id=learner_absent.booking_id,
        actor_ref=TUTOR_ACTOR,
        action="learner_no_show",
        reason="Tutor reported the learner did not attend.",
        new_starts_at=None,
        now=now,
    )
    no_show_transfer = lifecycle.claim_money_operation(
        worker="money-worker-learner-no-show", now=now, lease_seconds=60
    )
    assert no_show_transfer is None
    assert lifecycle.transition(
        booking_id=learner_absent.booking_id,
        actor_ref=LEARNER_ACTOR,
        action="dispute",
        reason="Learner disputed the no-show at the protected deadline.",
        new_starts_at=None,
        now=now + timedelta(hours=24),
    )
    assert (
        lifecycle.claim_money_operation(
            worker="money-worker-learner-no-show", now=now + timedelta(days=14), lease_seconds=60
        )
        is None
    )

    leased = confirmed(now - timedelta(days=7))
    assert lifecycle.transition(
        booking_id=leased.booking_id,
        actor_ref=TUTOR_ACTOR,
        action="learner_no_show",
        reason="Tutor reported a second learner no-show.",
        new_starts_at=None,
        now=now,
    )
    payout_at = next_weekly_payout_at(now + timedelta(hours=24, microseconds=1))
    assert (
        lifecycle.claim_money_operation(
            worker="too-early-worker", now=payout_at - timedelta(microseconds=1), lease_seconds=60
        )
        is None
    )
    abandoned = lifecycle.claim_money_operation(
        worker="crashed-worker", now=payout_at, lease_seconds=60
    )
    assert abandoned is not None and abandoned.booking_id == leased.booking_id
    reclaimed = lifecycle.claim_money_operation(
        worker="restart-worker", now=payout_at + timedelta(seconds=61), lease_seconds=60
    )
    assert reclaimed is not None
    assert reclaimed.operation_id == abandoned.operation_id
    assert reclaimed.idempotency_key == abandoned.idempotency_key
    assert lifecycle.finish_money_operation(
        operation=reclaimed,
        result=StripeMoneyResult("tr_restartedjob1", False, 2000, "USD"),
        worker="restart-worker",
    )
    assert not lifecycle.finish_money_operation(
        operation=reclaimed,
        result=StripeMoneyResult("tr_restartedjob1", False, 2000, "USD"),
        worker="restart-worker",
    )

    exhausted = confirmed(now - timedelta(days=8))
    assert lifecycle.transition(
        booking_id=exhausted.booking_id,
        actor_ref=TUTOR_ACTOR,
        action="learner_no_show",
        reason="Tutor reported a third learner no-show.",
        new_starts_at=None,
        now=now,
    )
    retry_at = next_weekly_payout_at(now + timedelta(hours=24, microseconds=1))
    exhausted_operation = None
    for attempt in range(8):
        exhausted_operation = lifecycle.claim_money_operation(
            worker=f"failing-worker-{attempt}", now=retry_at, lease_seconds=60
        )
        assert exhausted_operation is not None
        lifecycle.fail_money_operation(
            operation_id=exhausted_operation.operation_id,
            worker=f"failing-worker-{attempt}",
            code="provider_declined_transfer",
            ambiguous=False,
            now=retry_at,
        )
        retry_at += timedelta(minutes=2)
    assert exhausted_operation is not None
    assert (
        lifecycle.claim_money_operation(worker="automatic-worker", now=retry_at, lease_seconds=60)
        is None
    )
    assert lifecycle.recover_money_operation(
        booking_id=exhausted.booking_id,
        operator_actor_ref=OPERATOR_ACTOR,
        reason="Operator confirmed the provider account is ready for a bounded retry.",
        now=retry_at,
    )
    recovered_dead = lifecycle.claim_money_operation(
        worker="operator-recovery-worker", now=retry_at, lease_seconds=60
    )
    assert recovered_dead is not None
    assert recovered_dead.idempotency_key == exhausted_operation.idempotency_key
    assert lifecycle.finish_money_operation(
        operation=recovered_dead,
        result=StripeMoneyResult("tr_recovereddead1", False, 2000, "USD"),
        worker="operator-recovery-worker",
    )

    disputed = confirmed(now - timedelta(days=1))
    assert lifecycle.transition(
        booking_id=disputed.booking_id,
        actor_ref=LEARNER_ACTOR,
        action="complete",
        reason="Lesson completed as scheduled.",
        new_starts_at=None,
        now=now,
    )
    assert lifecycle.claim_money_operation(worker="too-early", now=now, lease_seconds=60) is None
    assert lifecycle.transition(
        booking_id=disputed.booking_id,
        actor_ref=LEARNER_ACTOR,
        action="dispute",
        reason="Learner disputed within the review window.",
        new_starts_at=None,
        now=now,
    )
    assert lifecycle.transition(
        booking_id=disputed.booking_id,
        actor_ref=OPERATOR_ACTOR,
        action="resolve_refund",
        reason="Operator approved a full learner refund.",
        new_starts_at=None,
        now=now,
    )
    with pytest.raises(TutorApplicationConflictError):
        lifecycle.create_review(
            review_id=uuid4(),
            booking_id=disputed.booking_id,
            learner_actor_ref=LEARNER_ACTOR,
            rating=5,
            body="This disputed booking is not review eligible.",
        )
    dispute_refund = lifecycle.claim_money_operation(
        worker="money-worker-dispute", now=now, lease_seconds=60
    )
    assert dispute_refund is not None and dispute_refund.booking_id == disputed.booking_id
    assert lifecycle.finish_money_operation(
        operation=dispute_refund,
        result=StripeMoneyResult("re_reviewed456", False, 2500, "USD"),
        worker="money-worker-dispute",
    )

    eligible = confirmed(now - timedelta(days=3))
    completed_at = now - timedelta(hours=25)
    assert lifecycle.transition(
        booking_id=eligible.booking_id,
        actor_ref=TUTOR_ACTOR,
        action="complete",
        reason="Tutor marked the finished lesson complete.",
        new_starts_at=None,
        now=completed_at,
    )
    eligible_transfer = lifecycle.claim_money_operation(
        worker="money-worker-3",
        now=next_weekly_payout_at(completed_at + timedelta(hours=24)),
        lease_seconds=60,
    )
    assert eligible_transfer is not None and eligible_transfer.booking_id == eligible.booking_id
    assert lifecycle.finish_money_operation(
        operation=eligible_transfer,
        result=StripeMoneyResult("tr_reviewed789", False, 2000, "USD"),
        worker="money-worker-3",
    )
    review = lifecycle.create_review(
        review_id=uuid4(),
        booking_id=eligible.booking_id,
        learner_actor_ref=LEARNER_ACTOR,
        rating=5,
        body="A calm and useful verified lesson review.",
    )
    assert review is not None and review.moderation_state == "published"
    public_tutor = PostgresDiscoveryRepository(engine=marketplace_engine).get_public_tutor(
        learner_actor_ref=LEARNER_ACTOR,
        tutor_id=profile.tutor_id,
    )
    assert public_tutor is not None
    assert public_tutor.rating == 5.0 and public_tutor.rating_count == 1
    assert (
        lifecycle.list_reviews_for_operator(operator_actor_ref=OUTSIDER_ACTOR, offset=0, limit=10)
        is None
    )
    moderated = lifecycle.moderate_review(
        operator_actor_ref=OPERATOR_ACTOR,
        review_id=review.review_id,
        moderation_state="hidden",
        reason="Operator hid unsafe review content after documented moderation.",
        now=now,
    )
    assert moderated is not None and moderated.moderation_state == "hidden"

    payout_window = next_weekly_payout_at(now + timedelta(days=15))
    race_completed_at = payout_window - timedelta(hours=24)
    reversal_booking = confirmed(race_completed_at - timedelta(hours=2))
    assert lifecycle.transition(
        booking_id=reversal_booking.booking_id,
        actor_ref=TUTOR_ACTOR,
        action="complete",
        reason="Tutor marked the future-shaped fixture complete.",
        new_starts_at=None,
        now=race_completed_at,
    )
    assert (
        lifecycle.claim_money_operation(
            worker="money-worker-race", now=payout_window, lease_seconds=60
        )
        is None
    )
    assert lifecycle.transition(
        booking_id=reversal_booking.booking_id,
        actor_ref=LEARNER_ACTOR,
        action="dispute",
        reason="Learner disputed exactly at the documented deadline.",
        new_starts_at=None,
        now=payout_window,
    )
    assert lifecycle.transition(
        booking_id=reversal_booking.booking_id,
        actor_ref=OPERATOR_ACTOR,
        action="resolve_refund",
        reason="Operator approved refund after the deadline dispute won the boundary.",
        new_starts_at=None,
        now=payout_window,
    )
    final_refund = lifecycle.claim_money_operation(
        worker="money-worker-after-reversal",
        now=payout_window + timedelta(seconds=1),
        lease_seconds=60,
    )
    assert final_refund is not None and final_refund.kind == "refund"
    assert lifecycle.finish_money_operation(
        operation=final_refund,
        result=StripeMoneyResult("re_afterreversal1", False, 2500, "USD"),
        worker="money-worker-after-reversal",
    )

    with marketplace_engine.connect() as connection:
        ledger = connection.execute(
            text(
                "SELECT kind, amount_minor FROM marketplace_money_ledger "
                "WHERE booking_id = :id ORDER BY created_at, entry_id"
            ),
            {"id": refundable.booking_id},
        ).all()
        reversal_ledger = connection.execute(
            text(
                "SELECT kind, amount_minor FROM marketplace_money_ledger "
                "WHERE booking_id = :id ORDER BY created_at, entry_id"
            ),
            {"id": reversal_booking.booking_id},
        ).all()
    assert [tuple(row) for row in ledger] == [("charge", 2500), ("refund", 2500)]
    assert [tuple(row) for row in reversal_ledger] == [("charge", 2500), ("refund", 2500)]

    reverse_order = confirmed(race_completed_at - timedelta(days=1))
    assert lifecycle.transition(
        booking_id=reverse_order.booking_id,
        actor_ref=TUTOR_ACTOR,
        action="complete",
        reason="Tutor completed the reverse-order race fixture.",
        new_starts_at=None,
        now=race_completed_at,
    )
    assert (
        lifecycle.claim_money_operation(
            worker="payout-paused",
            now=payout_window,
            lease_seconds=60,
            include_transfers=False,
        )
        is None
    )
    transfer_eligible_at = next_weekly_payout_at(payout_window + timedelta(microseconds=1))
    transfer_first = lifecycle.claim_money_operation(
        worker="transfer-first", now=transfer_eligible_at, lease_seconds=60
    )
    assert transfer_first is not None and transfer_first.booking_id == reverse_order.booking_id
    assert lifecycle.finish_money_operation(
        operation=transfer_first,
        result=StripeMoneyResult("tr_transferfirst1", False, 2000, "USD"),
        worker="transfer-first",
    )
    with pytest.raises(TutorApplicationConflictError):
        lifecycle.transition(
            booking_id=reverse_order.booking_id,
            actor_ref=LEARNER_ACTOR,
            action="dispute",
            reason="Learner tried to dispute after the protected window closed.",
            new_starts_at=None,
            now=transfer_eligible_at,
        )


@pytest.mark.integration
def test_learning_context_consent_expiry_and_non_authoritative_follow_up(
    marketplace_engine: Engine,
) -> None:
    _, booking, profile = create_bookable_tutor(marketplace_engine)
    bridge = PostgresLearningBridgeRepository(engine=marketplace_engine)
    lifecycle = PostgresLifecycleRepository(engine=marketplace_engine)
    now = datetime.now(UTC)
    starts_at = now + timedelta(days=2)
    held = booking.create_hold(
        learner_actor_ref=LEARNER_ACTOR,
        tutor_id=profile.tutor_id,
        starts_at=starts_at,
        idempotency_key=uuid4(),
        now=now,
        hold_seconds=600,
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert held is not None
    suffix = held.booking_id.hex[:12]
    assert (
        booking.attach_checkout(
            booking_id=held.booking_id,
            learner_actor_ref=LEARNER_ACTOR,
            checkout=StripeCheckout(
                checkout_id=f"cs_test_{suffix}",
                url="https://checkout.stripe.com/c/pay/learning123",
                payment_intent_id=f"pi_{suffix}",
                status="open",
                payment_status="unpaid",
                livemode=False,
                booking_id=held.booking_id,
                platform_account_id="acct_reviewed123",
                amount_minor=held.amount_minor,
                currency=held.currency,
                created_at=now,
            ),
        )
        is not None
    )
    outcome, confirmed = booking.apply_checkout_observation(
        checkout=StripeCheckout(
            checkout_id=f"cs_test_{suffix}",
            url=None,
            payment_intent_id=f"pi_{suffix}",
            status="complete",
            payment_status="paid",
            livemode=False,
            booking_id=held.booking_id,
            platform_account_id="acct_reviewed123",
            amount_minor=held.amount_minor,
            currency=held.currency,
            created_at=now,
        ),
        payload_sha256=suffix.ljust(64, "d"),
        event_id=f"evt_{suffix}",
        event_type="checkout.session.completed",
        source="provider_webhook",
        environment="SANDBOX",
        platform_account_id="acct_reviewed123",
    )
    assert outcome == "applied" and confirmed is not None

    learner_empty = bridge.get_context(booking_id=held.booking_id, actor_ref=LEARNER_ACTOR, now=now)
    tutor_empty = bridge.get_context(booking_id=held.booking_id, actor_ref=TUTOR_ACTOR, now=now)
    assert learner_empty is not None and learner_empty.consent_state == "not_shared"
    assert tutor_empty is not None and tutor_empty.brief is None
    assert bridge.get_context(booking_id=held.booking_id, actor_ref=OUTSIDER_ACTOR, now=now) is None

    no_course_brief = LearningBrief(
        selected_goal="Speak confidently during a family introduction",
        language_code="el",
        course_id=None,
        course_title=None,
        capabilities=("Introduce myself", "Ask a follow-up question"),
        review_focus=("Family vocabulary",),
    )
    assert bridge.save_context(
        booking_id=held.booking_id,
        learner_actor_ref=LEARNER_ACTOR,
        brief=no_course_brief,
        now=now,
    )
    tutor_shared = bridge.get_context(booking_id=held.booking_id, actor_ref=TUTOR_ACTOR, now=now)
    assert tutor_shared is not None and tutor_shared.brief == no_course_brief
    assert tutor_shared.access_expires_at == confirmed.ends_at + timedelta(days=7)

    assert bridge.revoke_context(
        booking_id=held.booking_id,
        learner_actor_ref=LEARNER_ACTOR,
        now=now + timedelta(minutes=1),
    )
    tutor_revoked = bridge.get_context(
        booking_id=held.booking_id,
        actor_ref=TUTOR_ACTOR,
        now=now + timedelta(minutes=1),
    )
    assert tutor_revoked is not None
    assert tutor_revoked.consent_state == "revoked" and tutor_revoked.brief is None
    assert bridge.revoke_context(
        booking_id=held.booking_id,
        learner_actor_ref=LEARNER_ACTOR,
        now=now + timedelta(minutes=1),
    )
    with marketplace_engine.connect() as connection:
        preserved_goal = connection.execute(
            text("SELECT selected_goal FROM marketplace_learning_context WHERE booking_id = :id"),
            {"id": held.booking_id},
        ).scalar_one()
        audit_events = (
            connection.execute(
                text(
                    "SELECT event FROM marketplace_learning_context_audit "
                    "WHERE booking_id = :id ORDER BY version"
                ),
                {"id": held.booking_id},
            )
            .scalars()
            .all()
        )
    assert preserved_goal == no_course_brief.selected_goal
    assert audit_events == ["granted", "revoked"]

    assert bridge.save_context(
        booking_id=held.booking_id,
        learner_actor_ref=LEARNER_ACTOR,
        brief=no_course_brief,
        now=now + timedelta(minutes=2),
    )
    new_start = starts_at + timedelta(days=1)
    assert lifecycle.transition(
        booking_id=held.booking_id,
        actor_ref=LEARNER_ACTOR,
        action="reschedule",
        reason="Participants agreed to move the context-enabled booking.",
        new_starts_at=new_start,
        now=now,
        expected_profile_version=profile.version,
    )
    after_reschedule = bridge.get_context(
        booking_id=held.booking_id, actor_ref=TUTOR_ACTOR, now=now
    )
    assert after_reschedule is not None
    assert after_reschedule.access_expires_at == new_start + timedelta(minutes=25, days=7)

    completed_at = new_start + timedelta(hours=1)
    assert lifecycle.transition(
        booking_id=held.booking_id,
        actor_ref=TUTOR_ACTOR,
        action="complete",
        reason="Tutor completed the context-enabled lesson.",
        new_starts_at=None,
        now=completed_at,
    )
    recommendation = FollowUpRecommendation(
        kind="free_text",
        content_reference=None,
        recommendation="Practice the family introduction aloud twice this week.",
    )
    assert bridge.save_follow_up(
        booking_id=held.booking_id,
        tutor_actor_ref=TUTOR_ACTOR,
        summary="The learner introduced family members and asked follow-up questions.",
        recommendations=(recommendation,),
        now=completed_at,
    )
    learner_follow_up = bridge.get_context(
        booking_id=held.booking_id, actor_ref=LEARNER_ACTOR, now=completed_at
    )
    assert learner_follow_up is not None and learner_follow_up.follow_up is not None
    assert learner_follow_up.follow_up.recommendations == (recommendation,)

    expired = bridge.get_context(
        booking_id=held.booking_id,
        actor_ref=TUTOR_ACTOR,
        now=new_start + timedelta(days=8),
    )
    assert expired is not None
    assert expired.consent_state == "expired" and expired.brief is None
    with pytest.raises(TutorApplicationConflictError):
        bridge.save_follow_up(
            booking_id=held.booking_id,
            tutor_actor_ref=TUTOR_ACTOR,
            summary="This update is outside the documented tutor access window.",
            recommendations=(recommendation,),
            now=new_start + timedelta(days=8),
        )

    with marketplace_engine.connect() as connection:
        learning_tables = (
            connection.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = current_schema() "
                    "AND table_name LIKE 'marketplace_%learning%' ORDER BY table_name"
                )
            )
            .scalars()
            .all()
        )
    assert learning_tables == [
        "marketplace_learning_context",
        "marketplace_learning_context_audit",
        "marketplace_learning_context_capability",
        "marketplace_learning_context_review_focus",
    ]
