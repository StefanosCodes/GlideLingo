from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import DBAPIError

from app.core.config import Settings
from app.modules.billing.identity import derive_billing_actor_ref
from app.modules.billing.repository import PostgresEntitlementRepository

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"
MIGRATION = MIGRATIONS / "002_revenuecat_entitlements.sql"
MAINTENANCE = MIGRATIONS / "maintenance_revenuecat_webhooks.sql"
ACTOR = derive_billing_actor_ref(
    key=b"integration-billing-pseudonym-key-at-least-32-bytes",
    app_user_id="user_integration_123",
)


@pytest.fixture
def revenuecat_engine() -> Generator[Engine]:
    database_url = Settings().database_url.get_secret_value()
    operator = create_engine(database_url, pool_pre_ping=True)
    schema = f"revenuecat_test_{uuid4().hex}"

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
        connect_args={"options": f"-c search_path={schema},public -c statement_timeout=2000"},
    )
    try:
        yield engine
    finally:
        engine.dispose()
        with operator.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        operator.dispose()


@pytest.mark.integration
def test_reconciliation_persists_only_minimum_pseudonymous_state(
    revenuecat_engine: Engine,
) -> None:
    repository = PostgresEntitlementRepository(engine=revenuecat_engine)
    observed_at = datetime.now(UTC).replace(microsecond=0)
    expires_at = observed_at + timedelta(days=30)

    stored = repository.store_reconciliation(
        actor_ref=ACTOR,
        environment="SANDBOX",
        is_active=True,
        expires_at=expires_at,
        observed_at=observed_at,
    )

    assert stored == repository.get_pro(actor_ref=ACTOR, environment="SANDBOX")
    assert stored.is_active is True
    with revenuecat_engine.connect() as connection:
        columns = {
            row.column_name
            for row in connection.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'revenuecat_entitlement_state'
                    """
                )
            )
        }
        serialized_rows = str(
            connection.execute(text("SELECT * FROM revenuecat_entitlement_state")).all()
        )
    assert columns == {
        "actor_ref",
        "entitlement_id",
        "environment",
        "is_active",
        "expires_at",
        "provider_event_at",
        "verified_at",
        "updated_at",
    }
    assert "user_integration_123" not in serialized_rows


@pytest.mark.integration
def test_webhook_event_is_deduplicated_and_out_of_order_update_is_ignored(
    revenuecat_engine: Engine,
) -> None:
    repository = PostgresEntitlementRepository(engine=revenuecat_engine)
    now = datetime.now(UTC).replace(microsecond=0)
    newer = now + timedelta(seconds=10)
    older = now - timedelta(seconds=10)

    assert (
        repository.record_webhook_snapshot(
            event_id="evt_newer",
            actor_ref=ACTOR,
            environment="SANDBOX",
            event_at=newer,
            snapshot_at=newer,
            is_active=False,
            expires_at=now - timedelta(days=1),
        )
        == "applied"
    )
    assert (
        repository.record_webhook_snapshot(
            event_id="evt_newer",
            actor_ref=ACTOR,
            environment="SANDBOX",
            event_at=newer,
            snapshot_at=newer,
            is_active=True,
            expires_at=now + timedelta(days=30),
        )
        == "duplicate"
    )
    assert (
        repository.record_webhook_snapshot(
            event_id="evt_older",
            actor_ref=ACTOR,
            environment="SANDBOX",
            event_at=older,
            snapshot_at=older,
            is_active=True,
            expires_at=now + timedelta(days=30),
        )
        == "out_of_order"
    )
    stored = repository.get_pro(actor_ref=ACTOR, environment="SANDBOX")
    assert stored is not None
    assert stored.is_active is False
    assert stored.provider_event_at == newer


@pytest.mark.integration
def test_delayed_webhook_applies_newer_current_snapshot_after_reconciliation(
    revenuecat_engine: Engine,
) -> None:
    repository = PostgresEntitlementRepository(engine=revenuecat_engine)
    now = datetime.now(UTC).replace(microsecond=0)
    reconciled_at = now + timedelta(seconds=10)
    delayed_event_at = now - timedelta(minutes=5)
    webhook_snapshot_at = now + timedelta(seconds=20)
    repository.store_reconciliation(
        actor_ref=ACTOR,
        environment="SANDBOX",
        is_active=False,
        expires_at=now - timedelta(days=1),
        observed_at=reconciled_at,
    )

    result = repository.record_webhook_snapshot(
        event_id="evt_delayed_new_snapshot",
        actor_ref=ACTOR,
        environment="SANDBOX",
        event_at=delayed_event_at,
        snapshot_at=webhook_snapshot_at,
        is_active=True,
        expires_at=now + timedelta(days=30),
    )

    stored = repository.get_pro(actor_ref=ACTOR, environment="SANDBOX")
    assert result == "applied"
    assert stored is not None
    assert stored.is_active is True
    assert stored.provider_event_at == webhook_snapshot_at


@pytest.mark.integration
def test_runtime_role_has_no_delete_or_ddl_privileges(revenuecat_engine: Engine) -> None:
    now = datetime.now(UTC).replace(microsecond=0)
    with revenuecat_engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL ROLE glidelingo_app")
        connection.execute(
            text(
                """
                INSERT INTO revenuecat_entitlement_state
                  (actor_ref, entitlement_id, environment, is_active,
                   provider_event_at, verified_at)
                VALUES (:actor_ref, 'pro', 'SANDBOX', false, :now, :now)
                """
            ),
            {"actor_ref": ACTOR, "now": now},
        )
        connection.execute(
            text(
                """
                UPDATE revenuecat_entitlement_state
                SET is_active = true
                WHERE actor_ref = :actor_ref
                """
            ),
            {"actor_ref": ACTOR},
        )
        connection.execute(
            text(
                """
                INSERT INTO revenuecat_webhook_event
                  (event_id, environment, actor_ref, event_at)
                VALUES ('evt_runtime', 'SANDBOX', :actor_ref, :now)
                """
            ),
            {"actor_ref": ACTOR, "now": now},
        )

    for statement in (
        "DELETE FROM revenuecat_entitlement_state",
        "DELETE FROM revenuecat_webhook_event",
        "ALTER TABLE revenuecat_entitlement_state ADD COLUMN forbidden text",
    ):
        with pytest.raises(DBAPIError), revenuecat_engine.begin() as connection:
            connection.exec_driver_sql("SET LOCAL ROLE glidelingo_app")
            connection.exec_driver_sql(statement)


@pytest.mark.integration
def test_webhook_maintenance_is_bounded_and_operator_only(revenuecat_engine: Engine) -> None:
    with revenuecat_engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO revenuecat_webhook_event
                  (event_id, environment, actor_ref, event_at, processed_at)
                VALUES
                  ('evt_expired', 'SANDBOX', :actor_ref, now() - interval '31 days',
                   now() - interval '31 days'),
                  ('evt_current', 'SANDBOX', :actor_ref, now(), now())
                """
            ),
            {"actor_ref": ACTOR},
        )
        connection.exec_driver_sql(MAINTENANCE.read_text(encoding="utf-8"))

    with revenuecat_engine.connect() as connection:
        event_ids = set(
            connection.execute(text("SELECT event_id FROM revenuecat_webhook_event")).scalars()
        )
    assert event_ids == {"evt_current"}
