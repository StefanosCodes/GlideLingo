from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import DBAPIError

from app.core.config import Settings
from app.core.errors import LessonTutorConflictError, LessonTutorLimitedError
from app.modules.lesson_tutor.guard import GuardLimits, PostgresLessonTutorGuard
from app.modules.lesson_tutor.schemas import LessonTutorTurnResponse

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"
MIGRATION = MIGRATIONS / "001_lesson_tutor_guard.sql"
MAINTENANCE = MIGRATIONS / "maintenance_lesson_tutor_guard.sql"
ACTOR_A = f"tusr_v1_{'A' * 43}"
ACTOR_B = f"tusr_v1_{'B' * 43}"
FINGERPRINT_A = "a" * 64
FINGERPRINT_B = "b" * 64


@pytest.fixture
def migrated_engine() -> Generator[Engine]:
    settings = Settings()
    database_url = settings.database_url.get_secret_value()
    operator = create_engine(database_url, pool_pre_ping=True)
    schema = f"lesson_tutor_test_{uuid4().hex}"

    with operator.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        connection.exec_driver_sql(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glidelingo_app') THEN
                CREATE ROLE glidelingo_app NOLOGIN;
              END IF;
            END
            $$
            """
        )
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'GRANT USAGE ON SCHEMA "{schema}" TO glidelingo_app')

    raw_connection = operator.raw_connection()
    try:
        driver_connection = cast(Any, raw_connection.driver_connection)
        driver_connection.autocommit = True
        cursor = driver_connection.cursor()
        try:
            cursor.execute(f'SET search_path TO "{schema}", public')
            cursor.execute(MIGRATION.read_text(encoding="utf-8"))
        finally:
            cursor.close()
    finally:
        raw_connection.close()

    engine = create_engine(
        database_url,
        pool_size=8,
        max_overflow=0,
        connect_args={"options": f"-c search_path={schema},public -c statement_timeout=2000"},
    )
    try:
        yield engine
    finally:
        engine.dispose()
        with operator.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        operator.dispose()


def guard(
    engine: Engine, *, concurrency: int = 1, global_daily: int = 100
) -> PostgresLessonTutorGuard:
    return PostgresLessonTutorGuard(
        engine=engine,
        limits=GuardLimits(
            burst=10,
            burst_window_seconds=60,
            concurrency=concurrency,
            daily=100,
            global_daily=global_daily,
        ),
    )


@pytest.mark.integration
def test_completed_turn_replays_and_conflicting_fingerprint_fails(
    migrated_engine: Engine,
) -> None:
    turn_guard = guard(migrated_engine)
    key = "completed-turn-key-0001"
    turn_ref = str(uuid4())
    admitted = turn_guard.admit(
        actor_ref=ACTOR_A,
        idempotency_key=key,
        fingerprint=FINGERPRINT_A,
        turn_ref=turn_ref,
    )
    assert admitted.turn_ref == turn_ref

    expected = LessonTutorTurnResponse(reply="Bounded reply.", prompt_version="lesson-tutor-v1")
    turn_guard.complete(actor_ref=ACTOR_A, idempotency_key=key, response=expected)

    replay = turn_guard.admit(
        actor_ref=ACTOR_A,
        idempotency_key=key,
        fingerprint=FINGERPRINT_A,
        turn_ref=str(uuid4()),
    )
    assert replay.replay == expected
    assert replay.turn_ref is None

    with pytest.raises(LessonTutorConflictError):
        turn_guard.admit(
            actor_ref=ACTOR_A,
            idempotency_key=key,
            fingerprint=FINGERPRINT_B,
            turn_ref=str(uuid4()),
        )


@pytest.mark.integration
def test_retryable_turn_rechecks_concurrency_before_readmission(
    migrated_engine: Engine,
) -> None:
    turn_guard = guard(migrated_engine, concurrency=1)
    retry_key = "retryable-turn-key-01"
    retry_turn_ref = str(uuid4())
    turn_guard.admit(
        actor_ref=ACTOR_A,
        idempotency_key=retry_key,
        fingerprint=FINGERPRINT_A,
        turn_ref=retry_turn_ref,
    )
    turn_guard.fail(actor_ref=ACTOR_A, idempotency_key=retry_key, outcome="retryable")

    active_key = "active-turn-key-00001"
    turn_guard.admit(
        actor_ref=ACTOR_A,
        idempotency_key=active_key,
        fingerprint=FINGERPRINT_B,
        turn_ref=str(uuid4()),
    )
    with pytest.raises(LessonTutorLimitedError):
        turn_guard.admit(
            actor_ref=ACTOR_A,
            idempotency_key=retry_key,
            fingerprint=FINGERPRINT_A,
            turn_ref=str(uuid4()),
        )

    with migrated_engine.connect() as connection:
        status = connection.execute(
            text(
                """
                SELECT status FROM lesson_tutor_turn_guard
                WHERE actor_ref = :actor_ref AND idempotency_key = :idempotency_key
                """
            ),
            {"actor_ref": ACTOR_A, "idempotency_key": retry_key},
        ).scalar_one()
    assert status == "retryable"

    turn_guard.fail(actor_ref=ACTOR_A, idempotency_key=active_key, outcome="ambiguous")
    retried = turn_guard.admit(
        actor_ref=ACTOR_A,
        idempotency_key=retry_key,
        fingerprint=FINGERPRINT_A,
        turn_ref=str(uuid4()),
    )
    assert retried.turn_ref == retry_turn_ref


@pytest.mark.integration
def test_global_cap_serializes_two_actors(migrated_engine: Engine) -> None:
    turn_guard = guard(migrated_engine, global_daily=1)

    def admit(actor_ref: str, suffix: str) -> str:
        try:
            turn_guard.admit(
                actor_ref=actor_ref,
                idempotency_key=f"global-cap-key-{suffix}",
                fingerprint=FINGERPRINT_A,
                turn_ref=str(uuid4()),
            )
        except LessonTutorLimitedError:
            return "limited"
        return "admitted"

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda args: admit(*args), [(ACTOR_A, "0001"), (ACTOR_B, "0002")]))

    assert sorted(outcomes) == ["admitted", "limited"]


@pytest.mark.integration
def test_runtime_role_can_use_guard_but_cannot_delete(migrated_engine: Engine) -> None:
    with migrated_engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL ROLE glidelingo_app")
        connection.execute(
            text(
                """
                INSERT INTO lesson_tutor_turn_guard
                  (actor_ref, operation, idempotency_key, fingerprint, turn_ref, status)
                VALUES
                  (:actor_ref, 'lesson_tutor_turn_v1', :key, :fingerprint, :turn_ref, 'in_progress')
                """
            ),
            {
                "actor_ref": ACTOR_A,
                "key": "runtime-role-key-0001",
                "fingerprint": FINGERPRINT_A,
                "turn_ref": str(uuid4()),
            },
        )
        connection.execute(
            text(
                """
                UPDATE lesson_tutor_turn_guard SET status = 'ambiguous'
                WHERE actor_ref = :actor_ref AND idempotency_key = :key
                """
            ),
            {"actor_ref": ACTOR_A, "key": "runtime-role-key-0001"},
        )
        assert (
            connection.execute(text("SELECT count(*) FROM lesson_tutor_turn_guard")).scalar_one()
            == 1
        )

    with pytest.raises(DBAPIError), migrated_engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL ROLE glidelingo_app")
        connection.execute(text("DELETE FROM lesson_tutor_turn_guard"))


@pytest.mark.integration
def test_maintenance_bounds_abandoned_rows_without_a_future_admission(
    migrated_engine: Engine,
) -> None:
    expired_key = "expired-abandoned-key-01"
    recent_key = "recent-abandoned-key-001"
    with migrated_engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO lesson_tutor_turn_guard
                  (actor_ref, operation, idempotency_key, fingerprint, turn_ref, status, updated_at)
                VALUES
                  (:actor_ref, :operation, :expired_key, :fingerprint, :expired_ref,
                   'in_progress', now() - interval '8 days'),
                  (:actor_ref, :operation, :recent_key, :fingerprint, :recent_ref,
                   'in_progress', now() - interval '3 minutes')
                """
            ),
            {
                "actor_ref": ACTOR_A,
                "operation": "lesson_tutor_turn_v1",
                "expired_key": expired_key,
                "fingerprint": FINGERPRINT_A,
                "expired_ref": str(uuid4()),
                "recent_key": recent_key,
                "recent_ref": str(uuid4()),
            },
        )
        connection.exec_driver_sql(MAINTENANCE.read_text(encoding="utf-8"))

    with migrated_engine.connect() as connection:
        rows = connection.execute(
            text(
                """
                SELECT idempotency_key, status
                FROM lesson_tutor_turn_guard
                WHERE idempotency_key IN (:expired_key, :recent_key)
                """
            ),
            {"expired_key": expired_key, "recent_key": recent_key},
        ).all()

    assert len(rows) == 1
    assert rows[0].idempotency_key == recent_key
    assert rows[0].status == "ambiguous"
