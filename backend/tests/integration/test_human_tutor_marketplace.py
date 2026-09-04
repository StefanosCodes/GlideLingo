from collections.abc import Generator
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import DBAPIError

from app.core.config import Settings
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref
from app.modules.human_tutor_marketplace.repository import (
    PostgresTutorApplicationRepository,
)
from app.modules.human_tutor_marketplace.schemas import (
    ChangeTutorStatusRequest,
    CreateTutorApplicationRequest,
    SaveTutorCredentialRequest,
    SaveTutorOfferingRequest,
    UpdateTutorApplicationDraftRequest,
    UpdateTutorProfileDraftRequest,
)

MIGRATION = (
    Path(__file__).resolve().parents[2] / "migrations" / "006_human_tutor_marketplace_core.sql"
)
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
            cursor.execute(MIGRATION.read_text(encoding="utf-8"))
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
