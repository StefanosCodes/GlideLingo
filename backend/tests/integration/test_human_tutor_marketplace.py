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
from app.modules.human_tutor_marketplace.schemas import CreateTutorApplicationRequest

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
            cursor.execute(
                """
                INSERT INTO marketplace_operator_capability (actor_ref, capability)
                VALUES (%s, 'review_tutor_applications')
                """,
                (OPERATOR_ACTOR,),
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
