"""PostgreSQL transaction, idempotency, and lease ownership for billing events."""

import json
from collections.abc import Sequence
from datetime import datetime
from typing import Protocol, cast
from uuid import UUID, uuid4

from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import BillingEventConflictError, DependencyUnavailableError
from app.modules.billing_events.models import (
    BillingEventConsumer,
    ClaimedBillingEventDelivery,
    IntakeReceipt,
    NormalizedBillingEvent,
)


class BillingEventRepository(Protocol):
    def accept(
        self,
        *,
        event: NormalizedBillingEvent,
        consumers: Sequence[BillingEventConsumer],
    ) -> IntakeReceipt: ...

    def claim_next(
        self, *, claimed_at: datetime, lease_expires_at: datetime
    ) -> ClaimedBillingEventDelivery | None: ...

    def complete(
        self, *, delivery_ref: UUID, lease_token: UUID, completed_at: datetime
    ) -> bool: ...

    def fail(
        self,
        *,
        delivery_ref: UUID,
        lease_token: UUID,
        failed_at: datetime,
        next_attempt_at: datetime,
        error_class: str,
        terminal: bool,
    ) -> bool: ...


class PostgresBillingEventRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def accept(
        self,
        *,
        event: NormalizedBillingEvent,
        consumers: Sequence[BillingEventConsumer],
    ) -> IntakeReceipt:
        try:
            with self._engine.begin() as connection:
                inserted = connection.execute(
                    text(
                        """
                        INSERT INTO billing_event_inbox
                          (event_ref, provider, environment, provider_account_ref,
                           provider_event_id, event_type, occurred_at, received_at,
                           actor_ref, object_refs, schema_version, payload_sha256)
                        VALUES
                          (:event_ref, :provider, :environment, :provider_account_ref,
                           :provider_event_id, :event_type, :occurred_at, :received_at,
                           :actor_ref, CAST(:object_refs AS jsonb), :schema_version,
                           :payload_sha256)
                        ON CONFLICT
                          (provider, environment, provider_account_ref, provider_event_id)
                        DO NOTHING
                        RETURNING event_ref
                        """
                    ),
                    {
                        "event_ref": event.event_ref,
                        "provider": event.provider,
                        "environment": event.environment,
                        "provider_account_ref": event.provider_account_ref,
                        "provider_event_id": event.provider_event_id,
                        "event_type": event.event_type,
                        "occurred_at": event.occurred_at,
                        "received_at": event.received_at,
                        "actor_ref": event.actor_ref,
                        "object_refs": json.dumps(event.object_refs, separators=(",", ":")),
                        "schema_version": event.schema_version,
                        "payload_sha256": event.payload_sha256,
                    },
                ).scalar_one_or_none()
                if inserted is None:
                    existing_payload_sha256 = connection.execute(
                        text(
                            """
                            SELECT payload_sha256
                            FROM billing_event_inbox
                            WHERE provider = :provider
                              AND environment = :environment
                              AND provider_account_ref = :provider_account_ref
                              AND provider_event_id = :provider_event_id
                            """
                        ),
                        {
                            "provider": event.provider,
                            "environment": event.environment,
                            "provider_account_ref": event.provider_account_ref,
                            "provider_event_id": event.provider_event_id,
                        },
                    ).scalar_one()
                    if existing_payload_sha256 != event.payload_sha256:
                        raise BillingEventConflictError
                    return IntakeReceipt(status="duplicate")
                if event.actor_ref is not None and event.provider_actor_ciphertext is not None:
                    connection.execute(
                        text(
                            """
                            INSERT INTO billing_event_provider_actor
                              (provider, environment, provider_account_ref, actor_ref,
                               provider_actor_ciphertext)
                            VALUES
                              (:provider, :environment, :provider_account_ref, :actor_ref,
                               :provider_actor_ciphertext)
                            ON CONFLICT
                              (provider, environment, provider_account_ref, actor_ref)
                            DO NOTHING
                            """
                        ),
                        {
                            "provider": event.provider,
                            "environment": event.environment,
                            "provider_account_ref": event.provider_account_ref,
                            "actor_ref": event.actor_ref,
                            "provider_actor_ciphertext": event.provider_actor_ciphertext,
                        },
                    )
                for consumer in consumers:
                    connection.execute(
                        text(
                            """
                            INSERT INTO billing_event_delivery
                              (delivery_ref, event_ref, consumer, state, next_attempt_at)
                            VALUES
                              (:delivery_ref, :event_ref, :consumer, 'pending', :received_at)
                            """
                        ),
                        {
                            "delivery_ref": uuid4(),
                            "event_ref": event.event_ref,
                            "consumer": consumer,
                            "received_at": event.received_at,
                        },
                    )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
        return IntakeReceipt(status="accepted")

    def claim_next(
        self, *, claimed_at: datetime, lease_expires_at: datetime
    ) -> ClaimedBillingEventDelivery | None:
        lease_token = uuid4()
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            WITH candidate AS (
                              SELECT delivery.delivery_ref
                              FROM billing_event_delivery AS delivery
                              JOIN billing_event_inbox AS inbox
                                ON inbox.event_ref = delivery.event_ref
                              WHERE (
                                delivery.state IN ('pending', 'retryable')
                                AND delivery.next_attempt_at <= :claimed_at
                              ) OR (
                                delivery.state = 'processing'
                                AND delivery.lease_expires_at <= :claimed_at
                              )
                              ORDER BY delivery.next_attempt_at, inbox.received_at,
                                       delivery.delivery_ref
                              FOR UPDATE OF delivery SKIP LOCKED
                              LIMIT 1
                            ), claimed AS (
                              UPDATE billing_event_delivery AS delivery
                              SET state = 'processing',
                                  attempt_count = delivery.attempt_count + 1,
                                  lease_token = :lease_token,
                                  lease_expires_at = :lease_expires_at,
                                  updated_at = :claimed_at
                              FROM candidate
                              WHERE delivery.delivery_ref = candidate.delivery_ref
                              RETURNING delivery.*
                            )
                            SELECT claimed.delivery_ref, claimed.lease_token,
                                   claimed.consumer, claimed.attempt_count,
                                   inbox.event_ref, inbox.provider, inbox.environment,
                                   inbox.provider_account_ref, inbox.provider_event_id,
                                   inbox.event_type, inbox.occurred_at, inbox.actor_ref,
                                   actor.provider_actor_ciphertext, inbox.object_refs
                            FROM claimed
                            JOIN billing_event_inbox AS inbox
                              ON inbox.event_ref = claimed.event_ref
                            LEFT JOIN billing_event_provider_actor AS actor
                              ON actor.provider = inbox.provider
                             AND actor.environment = inbox.environment
                             AND actor.provider_account_ref = inbox.provider_account_ref
                             AND actor.actor_ref = inbox.actor_ref
                            """
                        ),
                        {
                            "claimed_at": claimed_at,
                            "lease_token": lease_token,
                            "lease_expires_at": lease_expires_at,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
        if row is None:
            return None
        return ClaimedBillingEventDelivery(
            delivery_ref=row["delivery_ref"],
            lease_token=row["lease_token"],
            consumer=cast(BillingEventConsumer, row["consumer"]),
            attempt_count=row["attempt_count"],
            event_ref=row["event_ref"],
            provider=row["provider"],
            environment=row["environment"],
            provider_account_ref=row["provider_account_ref"],
            provider_event_id=row["provider_event_id"],
            event_type=row["event_type"],
            occurred_at=row["occurred_at"],
            actor_ref=row["actor_ref"],
            provider_actor_ciphertext=row["provider_actor_ciphertext"],
            object_refs=dict(row["object_refs"]),
        )

    def complete(self, *, delivery_ref: UUID, lease_token: UUID, completed_at: datetime) -> bool:
        try:
            with self._engine.begin() as connection:
                result = connection.execute(
                    text(
                        """
                        UPDATE billing_event_delivery
                        SET state = 'completed', completed_at = :completed_at,
                            lease_token = NULL, lease_expires_at = NULL,
                            updated_at = :completed_at
                        WHERE delivery_ref = :delivery_ref
                          AND state = 'processing'
                          AND lease_token = :lease_token
                        """
                    ),
                    {
                        "delivery_ref": delivery_ref,
                        "lease_token": lease_token,
                        "completed_at": completed_at,
                    },
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
        return result.rowcount == 1

    def fail(
        self,
        *,
        delivery_ref: UUID,
        lease_token: UUID,
        failed_at: datetime,
        next_attempt_at: datetime,
        error_class: str,
        terminal: bool,
    ) -> bool:
        try:
            with self._engine.begin() as connection:
                result = connection.execute(
                    text(
                        """
                        UPDATE billing_event_delivery
                        SET state = CASE WHEN :terminal THEN 'manual_review' ELSE 'retryable' END,
                            next_attempt_at = :next_attempt_at,
                            lease_token = NULL, lease_expires_at = NULL,
                            last_error_class = :error_class, updated_at = :failed_at
                        WHERE delivery_ref = :delivery_ref
                          AND state = 'processing'
                          AND lease_token = :lease_token
                        """
                    ),
                    {
                        "delivery_ref": delivery_ref,
                        "lease_token": lease_token,
                        "failed_at": failed_at,
                        "next_attempt_at": next_attempt_at,
                        "error_class": error_class,
                        "terminal": terminal,
                    },
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
        return result.rowcount == 1
