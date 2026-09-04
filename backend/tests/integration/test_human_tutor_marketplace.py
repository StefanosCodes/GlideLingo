from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from threading import Barrier
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import DBAPIError

from app.core.config import Settings
from app.core.errors import TutorApplicationConflictError
from app.modules.human_tutor_marketplace.availability import TimeInterval
from app.modules.human_tutor_marketplace.booking import (
    PostgresBookingRepository,
    StripeCheckout,
    StripeConnectAccount,
)
from app.modules.human_tutor_marketplace.calendar import PostgresCalendarRepository
from app.modules.human_tutor_marketplace.discovery import PostgresDiscoveryRepository
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref
from app.modules.human_tutor_marketplace.messaging import PostgresMessagingRepository
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
    tutor_state, tutor_message = messaging.send_message(
        conversation_id=conversation.conversation_id,
        actor_ref=TUTOR_ACTOR,
        client_message_id=uuid4(),
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

    assert messaging.block_other(
        conversation_id=conversation.conversation_id, actor_ref=LEARNER_ACTOR
    )
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
    for index in range(10):
        result, _ = messaging.send_message(
            conversation_id=rate_conversation.conversation_id,
            actor_ref=OUTSIDER_ACTOR,
            client_message_id=uuid4(),
            body=f"Bounded message {index}",
            now=now,
        )
        assert result == "created"
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
                            "SELECT marketplace_set_tutor_publication(:actor_ref, "
                            ":profile_version, :offering_version, true)"
                        ),
                        {
                            "actor_ref": TUTOR_ACTOR,
                            "profile_version": profile.version,
                            "offering_version": offering_version,
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
        created_at=now,
    )
    pending = booking.attach_checkout(
        booking_id=held.booking_id,
        learner_actor_ref=owner,
        checkout=checkout,
    )
    assert pending is not None and pending.state == "payment_pending"
    assert pending.amount_minor == pending.commission_amount_minor + pending.tutor_amount_minor
    assert pending.commission_basis_points == 2000

    confirmed_checkout = StripeCheckout(
        checkout_id=checkout.checkout_id,
        url=None,
        payment_intent_id=checkout.payment_intent_id,
        status="complete",
        payment_status="paid",
        livemode=False,
        booking_id=held.booking_id,
        platform_account_id=platform_account,
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
    assert system_messages == 1
