import asyncio
from collections.abc import Generator, Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from typing import Any, cast
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import DBAPIError

from app.core.config import Settings
from app.core.errors import BillingEventConflictError, DependencyUnavailableError
from app.integrations.revenuecat.client import RevenueCatSnapshot, RevenueCatUnavailableError
from app.modules.billing.identity import derive_billing_actor_ref
from app.modules.billing.repository import PostgresEntitlementRepository
from app.modules.billing_events.crypto import ProviderActorCipher
from app.modules.billing_events.delivery import (
    BillingEventWorker,
    ProEntitlementDeliveryHandler,
    placeholder_affiliate_finance_handler,
)
from app.modules.billing_events.models import (
    BillingEventConsumer,
    ClaimedBillingEventDelivery,
    IntakeStatus,
    NormalizedBillingEvent,
)
from app.modules.billing_events.repository import PostgresBillingEventRepository

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"
ENTITLEMENT_MIGRATION = MIGRATIONS / "002_revenuecat_entitlements.sql"
EVENT_MIGRATION = MIGRATIONS / "005_billing_event_intake.sql"
NOW = datetime.now(UTC).replace(microsecond=0)
KEY = b"billing-event-integration-key-at-least-32-bytes"
ACTOR_ID = "user_billing_event_integration"
ACTOR_REF = derive_billing_actor_ref(key=KEY, app_user_id=ACTOR_ID)


@pytest.fixture
def billing_event_engine() -> Generator[Engine]:
    database_url = Settings().database_url.get_secret_value()
    operator = create_engine(database_url, pool_pre_ping=True)
    schema = f"billing_event_test_{uuid4().hex}"

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
            cursor.execute(ENTITLEMENT_MIGRATION.read_text(encoding="utf-8"))
            cursor.execute(EVENT_MIGRATION.read_text(encoding="utf-8"))
            cursor.execute("RESET ROLE")
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


def event(
    *,
    event_id: str,
    environment: str = "SANDBOX",
    account: str = "app_test",
    event_type: str = "INITIAL_PURCHASE",
    occurred_at: datetime = NOW,
    received_at: datetime = NOW,
    actor_id: str | None = ACTOR_ID,
    payload_sha256: str = "a" * 64,
) -> NormalizedBillingEvent:
    actor_ref = (
        derive_billing_actor_ref(key=KEY, app_user_id=actor_id) if actor_id is not None else None
    )
    ciphertext = (
        ProviderActorCipher(secret=KEY).encrypt(
            provider_actor_id=actor_id,
            provider="revenuecat",
            environment=environment,
            provider_account_ref=account,
            actor_ref=actor_ref,
        )
        if actor_id is not None and actor_ref is not None
        else None
    )
    return NormalizedBillingEvent(
        event_ref=uuid4(),
        provider="revenuecat",
        environment=environment,
        provider_account_ref=account,
        provider_event_id=event_id,
        event_type=event_type,
        occurred_at=occurred_at,
        received_at=received_at,
        actor_ref=actor_ref,
        provider_actor_ciphertext=ciphertext,
        object_refs={"product": "monthly"},
        schema_version=1,
        payload_sha256=payload_sha256,
    )


def accept(
    repository: PostgresBillingEventRepository,
    accepted_event: NormalizedBillingEvent,
    consumers: Sequence[BillingEventConsumer] = ("pro_entitlement", "affiliate_finance"),
) -> IntakeStatus:
    return repository.accept(event=accepted_event, consumers=consumers).status


@pytest.mark.integration
def test_intake_is_minimized_deduplicated_and_scoped(
    billing_event_engine: Engine,
) -> None:
    repository = PostgresBillingEventRepository(engine=billing_event_engine)

    assert accept(repository, event(event_id="evt_scoped")) == "accepted"
    assert accept(repository, event(event_id="evt_scoped")) == "duplicate"
    assert accept(repository, event(event_id="evt_scoped", environment="PRODUCTION")) == "accepted"
    assert accept(repository, event(event_id="evt_scoped", account="app_other")) == "accepted"
    assert (
        accept(
            repository,
            event(event_id="evt_unknown", event_type="FUTURE_EVENT", actor_id=None),
            consumers=(),
        )
        == "accepted"
    )

    with billing_event_engine.connect() as connection:
        inbox_columns = set(
            connection.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'billing_event_inbox'
                    """
                )
            ).scalars()
        )
        inbox_count = connection.execute(
            text("SELECT count(*) FROM billing_event_inbox")
        ).scalar_one()
        delivery_count = connection.execute(
            text("SELECT count(*) FROM billing_event_delivery")
        ).scalar_one()
        serialized = str(
            connection.execute(
                text(
                    """
                    SELECT inbox.*, actor.provider_actor_ciphertext
                    FROM billing_event_inbox AS inbox
                    LEFT JOIN billing_event_provider_actor AS actor
                      ON actor.provider = inbox.provider
                     AND actor.environment = inbox.environment
                     AND actor.provider_account_ref = inbox.provider_account_ref
                     AND actor.actor_ref = inbox.actor_ref
                    """
                )
            ).all()
        )
    assert inbox_count == 4
    assert delivery_count == 6
    assert inbox_columns == {
        "event_ref",
        "provider",
        "environment",
        "provider_account_ref",
        "provider_event_id",
        "event_type",
        "occurred_at",
        "received_at",
        "actor_ref",
        "object_refs",
        "schema_version",
        "payload_sha256",
    }
    assert ACTOR_ID not in serialized


@pytest.mark.integration
def test_inbox_and_deliveries_commit_atomically(billing_event_engine: Engine) -> None:
    repository = PostgresBillingEventRepository(engine=billing_event_engine)
    invalid_consumers = cast(Sequence[BillingEventConsumer], ("invalid_consumer",))

    with pytest.raises(DependencyUnavailableError):
        accept(repository, event(event_id="evt_rollback"), consumers=invalid_consumers)

    with billing_event_engine.connect() as connection:
        assert (
            connection.execute(text("SELECT count(*) FROM billing_event_inbox")).scalar_one() == 0
        )
        assert (
            connection.execute(
                text("SELECT count(*) FROM billing_event_provider_actor")
            ).scalar_one()
            == 0
        )


@pytest.mark.integration
def test_concurrent_reuse_of_event_id_with_different_payload_is_rejected(
    billing_event_engine: Engine,
) -> None:
    repository = PostgresBillingEventRepository(engine=billing_event_engine)
    hashes = ("a" * 64, "b" * 64)
    start = Barrier(2)

    def accept_conflicting(payload_sha256: str) -> IntakeStatus | str:
        start.wait()
        try:
            return accept(
                repository,
                event(event_id="evt_conflicting_payload", payload_sha256=payload_sha256),
            )
        except BillingEventConflictError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = dict(zip(hashes, pool.map(accept_conflicting, hashes), strict=True))

    assert sorted(results.values()) == ["accepted", "conflict"]
    with billing_event_engine.connect() as connection:
        stored_hash = connection.execute(
            text(
                """
                SELECT payload_sha256
                FROM billing_event_inbox
                WHERE provider_event_id = 'evt_conflicting_payload'
                """
            )
        ).scalar_one()
        delivery_count = connection.execute(
            text("SELECT count(*) FROM billing_event_delivery")
        ).scalar_one()
    assert results[stored_hash] == "accepted"
    assert (
        accept(
            repository,
            event(event_id="evt_conflicting_payload", payload_sha256=stored_hash),
        )
        == "duplicate"
    )
    assert delivery_count == 2


@pytest.mark.integration
def test_concurrent_skip_locked_claims_do_not_duplicate_delivery(
    billing_event_engine: Engine,
) -> None:
    repository = PostgresBillingEventRepository(engine=billing_event_engine)
    for number in range(4):
        assert (
            accept(
                repository,
                event(event_id=f"evt_concurrent_{number}"),
                consumers=("pro_entitlement",),
            )
            == "accepted"
        )

    def claim_one(_: int) -> ClaimedBillingEventDelivery | None:
        return repository.claim_next(
            claimed_at=NOW,
            lease_expires_at=NOW + timedelta(seconds=30),
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        claims = list(pool.map(claim_one, range(4)))

    assert all(claim is not None for claim in claims)
    delivery_refs = {claim.delivery_ref for claim in claims if claim is not None}
    assert len(delivery_refs) == 4


@pytest.mark.integration
def test_expired_lease_is_reclaimed_and_stale_owner_cannot_complete(
    billing_event_engine: Engine,
) -> None:
    repository = PostgresBillingEventRepository(engine=billing_event_engine)
    assert (
        accept(
            repository,
            event(event_id="evt_crash"),
            consumers=("pro_entitlement",),
        )
        == "accepted"
    )
    first = repository.claim_next(
        claimed_at=NOW,
        lease_expires_at=NOW + timedelta(seconds=30),
    )
    assert first is not None
    assert (
        repository.claim_next(
            claimed_at=NOW + timedelta(seconds=29),
            lease_expires_at=NOW + timedelta(seconds=59),
        )
        is None
    )

    recovered = repository.claim_next(
        claimed_at=NOW + timedelta(seconds=31),
        lease_expires_at=NOW + timedelta(seconds=61),
    )

    assert recovered is not None
    assert recovered.delivery_ref == first.delivery_ref
    assert recovered.lease_token != first.lease_token
    assert recovered.attempt_count == 2
    assert not repository.complete(
        delivery_ref=first.delivery_ref,
        lease_token=first.lease_token,
        completed_at=NOW + timedelta(seconds=32),
    )
    assert repository.complete(
        delivery_ref=recovered.delivery_ref,
        lease_token=recovered.lease_token,
        completed_at=NOW + timedelta(seconds=32),
    )


class SequenceProvider:
    def __init__(self, snapshots: list[RevenueCatSnapshot | Exception]) -> None:
        self.snapshots = snapshots
        self.users: list[str] = []

    async def fetch_pro_entitlement(
        self, *, app_user_id: str, **_kwargs: object
    ) -> RevenueCatSnapshot:
        self.users.append(app_user_id)
        result = self.snapshots.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    async def close(self) -> None:
        return None


def make_worker(
    *,
    engine: Engine,
    provider: SequenceProvider,
    now: datetime,
    affiliate_succeeds: bool = False,
) -> BillingEventWorker:
    async def complete_affiliate(_delivery: object) -> None:
        return None

    return BillingEventWorker(
        repository=PostgresBillingEventRepository(engine=engine),
        handlers={
            "pro_entitlement": ProEntitlementDeliveryHandler(
                provider=provider,
                repository=PostgresEntitlementRepository(engine=engine),
                actor_cipher=ProviderActorCipher(secret=KEY),
            ),
            "affiliate_finance": (
                cast(Any, complete_affiliate)
                if affiliate_succeeds
                else placeholder_affiliate_finance_handler
            ),
        },
        lease_seconds=30,
        maximum_attempts=3,
        retry_base_seconds=5,
        retry_max_seconds=20,
        now=lambda: now,
    )


@pytest.mark.integration
def test_pro_entitlement_succeeds_while_placeholder_affiliate_retries(
    billing_event_engine: Engine,
) -> None:
    repository = PostgresBillingEventRepository(engine=billing_event_engine)
    assert accept(repository, event(event_id="evt_independent")) == "accepted"
    provider = SequenceProvider(
        [
            RevenueCatSnapshot(
                is_active=True,
                environment="SANDBOX",
                expires_at=NOW + timedelta(days=30),
                observed_at=NOW,
            )
        ]
    )
    event_worker = make_worker(
        engine=billing_event_engine,
        provider=provider,
        now=NOW + timedelta(seconds=2),
    )

    assert asyncio.run(event_worker.run_once()) is True
    assert asyncio.run(event_worker.run_once()) is True

    with billing_event_engine.connect() as connection:
        states: dict[str, str] = {
            row.consumer: row.state
            for row in connection.execute(
                text("SELECT consumer, state FROM billing_event_delivery")
            ).mappings()
        }
    stored = PostgresEntitlementRepository(engine=billing_event_engine).get_pro(
        actor_ref=ACTOR_REF,
        environment="SANDBOX",
    )
    assert states == {"pro_entitlement": "completed", "affiliate_finance": "retryable"}
    assert stored is not None
    assert stored.is_active is True
    assert provider.users == [ACTOR_ID]


@pytest.mark.integration
def test_affiliate_completion_is_independent_when_entitlement_provider_fails(
    billing_event_engine: Engine,
) -> None:
    repository = PostgresBillingEventRepository(engine=billing_event_engine)
    assert accept(repository, event(event_id="evt_inverse")) == "accepted"
    provider = SequenceProvider([RevenueCatUnavailableError()])
    event_worker = make_worker(
        engine=billing_event_engine,
        provider=provider,
        now=NOW,
        affiliate_succeeds=True,
    )

    assert asyncio.run(event_worker.run_once()) is True
    assert asyncio.run(event_worker.run_once()) is True

    with billing_event_engine.connect() as connection:
        states: dict[str, str] = {
            row.consumer: row.state
            for row in connection.execute(
                text("SELECT consumer, state FROM billing_event_delivery")
            ).mappings()
        }
    assert states == {"pro_entitlement": "retryable", "affiliate_finance": "completed"}


@pytest.mark.integration
def test_out_of_order_provider_snapshots_cannot_overwrite_newer_entitlement(
    billing_event_engine: Engine,
) -> None:
    repository = PostgresBillingEventRepository(engine=billing_event_engine)
    assert (
        accept(
            repository,
            event(
                event_id="evt_newer_snapshot",
                occurred_at=NOW + timedelta(seconds=20),
                received_at=NOW,
            ),
            consumers=("pro_entitlement",),
        )
        == "accepted"
    )
    assert (
        accept(
            repository,
            event(
                event_id="evt_older_snapshot",
                occurred_at=NOW - timedelta(seconds=20),
                received_at=NOW + timedelta(seconds=1),
            ),
            consumers=("pro_entitlement",),
        )
        == "accepted"
    )
    provider = SequenceProvider(
        [
            RevenueCatSnapshot(
                is_active=False,
                environment="SANDBOX",
                expires_at=NOW - timedelta(days=1),
                observed_at=NOW + timedelta(seconds=20),
            ),
            RevenueCatSnapshot(
                is_active=True,
                environment="SANDBOX",
                expires_at=NOW + timedelta(days=30),
                observed_at=NOW - timedelta(seconds=20),
            ),
        ]
    )
    event_worker = make_worker(
        engine=billing_event_engine,
        provider=provider,
        now=NOW + timedelta(seconds=2),
    )

    assert asyncio.run(event_worker.run_once()) is True
    assert asyncio.run(event_worker.run_once()) is True

    stored = PostgresEntitlementRepository(engine=billing_event_engine).get_pro(
        actor_ref=ACTOR_REF,
        environment="SANDBOX",
    )
    assert stored is not None
    assert stored.is_active is False
    assert stored.provider_event_at == NOW + timedelta(seconds=20)


@pytest.mark.integration
def test_runtime_role_has_only_required_billing_event_privileges(
    billing_event_engine: Engine,
) -> None:
    expected = {
        "billing_event_provider_actor": {"SELECT", "INSERT"},
        "billing_event_inbox": {"SELECT", "INSERT"},
        "billing_event_delivery": {"SELECT", "INSERT", "UPDATE"},
    }
    with billing_event_engine.begin() as connection:
        owners: dict[str, str] = {
            row.tablename: row.tableowner
            for row in connection.execute(
                text(
                    """
                    SELECT tablename, tableowner
                    FROM pg_tables
                    WHERE schemaname = current_schema()
                      AND tablename LIKE 'billing_event_%'
                    """
                )
            ).mappings()
        }
        assert owners == {table: "cloudsqlsuperuser" for table in expected}
        assert not connection.execute(
            text("SELECT has_schema_privilege('glidelingo_app', current_schema(), 'CREATE')")
        ).scalar_one()
        for table, allowed in expected.items():
            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                actual = connection.execute(
                    text("SELECT has_table_privilege('glidelingo_app', :table, :privilege)"),
                    {"table": table, "privilege": privilege},
                ).scalar_one()
                assert actual is (privilege in allowed)

    for statement in (
        "DELETE FROM billing_event_delivery",
        "UPDATE billing_event_inbox SET event_type = 'FORBIDDEN'",
        "ALTER TABLE billing_event_inbox ADD COLUMN forbidden text",
    ):
        with pytest.raises(DBAPIError), billing_event_engine.begin() as connection:
            connection.exec_driver_sql("SET LOCAL ROLE glidelingo_app")
            connection.exec_driver_sql(statement)
