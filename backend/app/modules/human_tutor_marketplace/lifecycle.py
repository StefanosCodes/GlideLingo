"""Booking lifecycle, delayed money jobs, earnings, and verified reviews."""

import asyncio
import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import Engine, text
from sqlalchemy.engine import Connection, RowMapping
from sqlalchemy.exc import DBAPIError, IntegrityError, SQLAlchemyError

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    DependencyUnavailableError,
    HumanTutorMarketplaceForbiddenError,
    HumanTutorMarketplaceUnavailableError,
    TutorApplicationConflictError,
    TutorApplicationNotFoundError,
)
from app.modules.human_tutor_marketplace.booking import (
    BookingService,
    BookingView,
    Environment,
    StripeMarketplaceProvider,
    StripeMoneyResult,
    StripeOperationError,
)
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref
from app.modules.human_tutor_marketplace.messaging import MarketplaceNotificationProvider

LifecycleAction = Literal[
    "reschedule",
    "cancel",
    "complete",
    "learner_no_show",
    "tutor_no_show",
    "dispute",
    "resolve_refund",
    "resolve_release",
    "calendar_conflict_refund",
]


@dataclass(frozen=True, slots=True)
class StoredMoneyOperation:
    operation_id: UUID
    booking_id: UUID
    kind: Literal["refund", "transfer", "reversal"]
    state: str
    amount_minor: int
    currency: str
    idempotency_key: str
    provider_environment: Environment
    provider_payment_intent_id: str | None
    destination_account_id: str
    prior_transfer_id: str | None


@dataclass(frozen=True, slots=True)
class EarningsView:
    pending_minor: int
    transferred_minor: int
    currency: Literal["USD"] = "USD"


@dataclass(frozen=True, slots=True)
class ReviewView:
    review_id: UUID
    booking_id: UUID
    tutor_id: UUID
    rating: int
    body: str | None
    moderation_state: Literal["published", "hidden"]
    moderation_reason: str | None
    moderated_at: datetime | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class StoredReminderJob:
    job_id: UUID
    booking_id: UUID
    kind: Literal["lesson_reminder", "completion_prompt"]
    attempt: int
    learner_actor_ref: str
    tutor_actor_ref: str


def next_weekly_payout_at(eligible_at: datetime) -> datetime:
    """Return the first Monday 15:00 UTC payout window at or after eligibility."""

    eligible_utc = eligible_at.astimezone(UTC)
    candidate = (eligible_utc + timedelta(days=(-eligible_utc.weekday()) % 7)).replace(
        hour=15, minute=0, second=0, microsecond=0
    )
    return candidate if candidate >= eligible_utc else candidate + timedelta(days=7)


def transition_fingerprint(
    *, action: LifecycleAction, reason: str, new_starts_at: datetime | None
) -> str:
    return hashlib.sha256(
        "\0".join(
            (action, reason, new_starts_at.isoformat() if new_starts_at is not None else "")
        ).encode()
    ).hexdigest()


class PostgresLifecycleRepository:
    def __init__(self, *, engine: Engine, payment_engine: Engine | None = None) -> None:
        self._engine = engine
        self._payment_engine = payment_engine or engine

    def is_transition_replay(
        self,
        *,
        operation_id: UUID,
        booking_id: UUID,
        actor_ref: str,
        action: LifecycleAction,
        reason: str,
        new_starts_at: datetime | None,
    ) -> bool:
        try:
            with self._engine.connect() as connection:
                prior = (
                    connection.execute(
                        text(
                            "SELECT booking_id, actor_ref, action, request_fingerprint "
                            "FROM marketplace_booking_transition_operation "
                            "WHERE operation_id = :operation_id"
                        ),
                        {"operation_id": operation_id},
                    )
                    .mappings()
                    .one_or_none()
                )
            if prior is None:
                return False
            if (
                prior["booking_id"] != booking_id
                or prior["actor_ref"] != actor_ref
                or prior["action"] != action
                or prior["request_fingerprint"]
                != transition_fingerprint(action=action, reason=reason, new_starts_at=new_starts_at)
            ):
                raise TutorApplicationConflictError
            return True
        except TutorApplicationConflictError:
            raise
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def transition(
        self,
        *,
        booking_id: UUID,
        actor_ref: str,
        action: LifecycleAction,
        reason: str,
        new_starts_at: datetime | None,
        now: datetime,
        expected_profile_version: int | None = None,
        operation_id: UUID | None = None,
    ) -> bool:
        try:
            # Lifecycle transitions are the authority boundary that can enqueue
            # money movement.  Use the distinct payment principal so the
            # general application role cannot forge transition evidence.
            with self._payment_engine.begin() as connection:
                row = (
                    connection.execute(
                        text("SELECT * FROM marketplace_booking WHERE booking_id = :id FOR UPDATE"),
                        {"id": booking_id},
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return False
                # Direct repository callers still receive database-coupled operation
                # evidence; API callers supply the stable ID used for replay.
                operation_id = operation_id or uuid4()
                if operation_id is not None:
                    request_fingerprint = transition_fingerprint(
                        action=action, reason=reason, new_starts_at=new_starts_at
                    )
                    prior_operation = (
                        connection.execute(
                            text(
                                "SELECT booking_id, actor_ref, action, request_fingerprint "
                                "FROM marketplace_booking_transition_operation "
                                "WHERE operation_id = :operation_id"
                            ),
                            {"operation_id": operation_id},
                        )
                        .mappings()
                        .one_or_none()
                    )
                    if prior_operation is not None:
                        if (
                            prior_operation["booking_id"] == booking_id
                            and prior_operation["actor_ref"] == actor_ref
                            and prior_operation["action"] == action
                            and prior_operation["request_fingerprint"] == request_fingerprint
                        ):
                            return True
                        raise TutorApplicationConflictError
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_booking_transition_operation
                              (operation_id, booking_id, actor_ref, action, request_fingerprint)
                            VALUES (:operation_id, :booking_id, :actor_ref, :action, :fingerprint)
                            """
                        ),
                        {
                            "operation_id": operation_id,
                            "booking_id": booking_id,
                            "actor_ref": actor_ref,
                            "action": action,
                            "fingerprint": request_fingerprint,
                        },
                    )
                role = self._role(connection, row=row, actor_ref=actor_ref)
                current = row["state"]
                if action == "reschedule":
                    if role not in {"learner", "tutor"} or current != "confirmed":
                        raise TutorApplicationConflictError
                    cutoff = timedelta(hours=row["cancellation_cutoff_hours"])
                    if (
                        new_starts_at is None
                        or row["starts_at"] <= now + cutoff
                        or new_starts_at <= now + cutoff
                    ):
                        raise TutorApplicationConflictError
                    current_profile_version = connection.execute(
                        text(
                            "SELECT version FROM marketplace_tutor_profile "
                            "WHERE tutor_id = :tutor_id FOR UPDATE"
                        ),
                        {"tutor_id": row["tutor_id"]},
                    ).scalar_one()
                    if (
                        expected_profile_version is None
                        or current_profile_version != expected_profile_version
                    ):
                        raise TutorApplicationConflictError
                    duration = row["ends_at"] - row["starts_at"]
                    calendar = (
                        connection.execute(
                            text(
                                "SELECT status, cache_generation, cache_expires_at "
                                "FROM marketplace_calendar_connection "
                                "WHERE tutor_id = :tutor_id FOR SHARE"
                            ),
                            {"tutor_id": row["tutor_id"]},
                        )
                        .mappings()
                        .one_or_none()
                    )
                    if calendar is not None:
                        if (
                            calendar["status"] != "connected"
                            or calendar["cache_generation"] is None
                            or calendar["cache_expires_at"] is None
                            or calendar["cache_expires_at"] <= now
                        ):
                            raise TutorApplicationConflictError
                        externally_busy = connection.execute(
                            text(
                                """
                                SELECT 1 FROM marketplace_calendar_busy_interval
                                WHERE tutor_id = :tutor_id
                                  AND generation = :generation
                                  AND tstzrange(starts_at, ends_at, '[)') && tstzrange(
                                    :starts_at - make_interval(mins => :buffer_before),
                                    :ends_at + make_interval(mins => :buffer_after), '[)')
                                LIMIT 1
                                """
                            ),
                            {
                                "tutor_id": row["tutor_id"],
                                "generation": calendar["cache_generation"],
                                "starts_at": new_starts_at,
                                "ends_at": new_starts_at + duration,
                                "buffer_before": row["buffer_before_minutes"],
                                "buffer_after": row["buffer_after_minutes"],
                            },
                        ).scalar_one_or_none()
                        if externally_busy is not None:
                            raise TutorApplicationConflictError
                    updated = connection.execute(
                        text(
                            """
                            UPDATE marketplace_booking
                            SET starts_at = :starts_at, ends_at = :ends_at,
                                schedule_version = schedule_version + 1, updated_at = :now
                            WHERE booking_id = :id RETURNING schedule_version
                            """
                        ),
                        {
                            "starts_at": new_starts_at,
                            "ends_at": new_starts_at + duration,
                            "now": now,
                            "id": booking_id,
                        },
                    ).scalar_one()
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_booking_schedule_revision
                              (revision_id, booking_id, version, prior_starts_at,
                               prior_ends_at, starts_at, ends_at, actor_ref, reason)
                            VALUES (:revision_id, :booking_id, :version, :prior_starts,
                                    :prior_ends, :starts, :ends, :actor_ref, :reason)
                            """
                        ),
                        {
                            "revision_id": uuid4(),
                            "booking_id": booking_id,
                            "version": updated,
                            "prior_starts": row["starts_at"],
                            "prior_ends": row["ends_at"],
                            "starts": new_starts_at,
                            "ends": new_starts_at + duration,
                            "actor_ref": actor_ref,
                            "reason": reason,
                        },
                    )
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_booking_reminder_job
                            SET state = 'cancelled', updated_at = :now
                            WHERE booking_id = :id AND state IN ('queued', 'retryable')
                            """
                        ),
                        {"id": booking_id, "now": now},
                    )
                    self._insert_reminders(
                        connection,
                        booking_id=booking_id,
                        starts_at=new_starts_at,
                        ends_at=new_starts_at + duration,
                    )
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_learning_context
                            SET access_expires_at = :access_expires_at, updated_at = :now
                            WHERE booking_id = :id
                            """
                        ),
                        {
                            "access_expires_at": new_starts_at + duration + timedelta(days=7),
                            "now": now,
                            "id": booking_id,
                        },
                    )
                    self._audit(connection, row, "confirmed", actor_ref, "rescheduled")
                    self._system_message(connection, booking_id, "Booking time was rescheduled.")
                    return True

                target, money_kind, amount, available_at = self._decision(
                    connection,
                    row=row,
                    role=role,
                    action=action,
                    now=now,
                )
                money_state = (
                    self._current_money_state(connection, booking_id)
                    if action == "dispute"
                    else row["money_state"]
                )
                if money_kind is not None:
                    money_state = f"{money_kind}_pending"
                    self._queue_money(
                        connection,
                        row=row,
                        kind=money_kind,
                        amount_minor=amount,
                        available_at=available_at,
                    )
                values = {
                    "id": booking_id,
                    "state": target,
                    "money_state": money_state,
                    "now": now,
                    "completed_at": (
                        now if action in {"complete", "learner_no_show"} else row["completed_at"]
                    ),
                    "dispute_deadline": (
                        now + timedelta(hours=row["dispute_window_hours"])
                        if action in {"complete", "learner_no_show"}
                        else row["dispute_deadline_at"]
                    ),
                    "cancelled_at": (
                        now
                        if action in {"cancel", "calendar_conflict_refund"}
                        else row["cancelled_at"]
                    ),
                    "cancelled_by": (
                        role
                        if action in {"cancel", "calendar_conflict_refund"}
                        else row["cancelled_by_role"]
                    ),
                    "no_show": (
                        "learner"
                        if action == "learner_no_show"
                        else "tutor"
                        if action == "tutor_no_show"
                        else row["no_show_role"]
                    ),
                    "resolution": reason
                    if action.startswith("resolve_") or action == "calendar_conflict_refund"
                    else row["resolution_reason"],
                }
                connection.execute(
                    text(
                        """
                        UPDATE marketplace_booking
                        SET state = :state, money_state = :money_state,
                            completed_at = :completed_at,
                            dispute_deadline_at = :dispute_deadline,
                            cancelled_at = :cancelled_at,
                            cancelled_by_role = :cancelled_by,
                            no_show_role = :no_show,
                            resolution_reason = :resolution,
                            updated_at = :now
                        WHERE booking_id = :id
                        """
                    ),
                    values,
                )
                if action in {"cancel", "tutor_no_show", "calendar_conflict_refund"}:
                    connection.execute(
                        text(
                            "UPDATE marketplace_booking_reminder_job SET state = 'cancelled', "
                            "updated_at = :now WHERE booking_id = :id "
                            "AND state IN ('queued', 'retryable')"
                        ),
                        {"id": booking_id, "now": now},
                    )
                self._audit(connection, row, target, actor_ref, action)
                self._system_message(
                    connection,
                    booking_id,
                    f"Booking status changed to {target.replace('_', ' ')}.",
                )
                return True
        except TutorApplicationConflictError:
            raise
        except (IntegrityError, DBAPIError) as error:
            raise TutorApplicationConflictError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def claim_money_operation(
        self, *, worker: str, now: datetime, lease_seconds: int, include_transfers: bool = True
    ) -> StoredMoneyOperation | None:
        try:
            with self._engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        WITH expired AS (
                          UPDATE marketplace_money_operation
                          SET state = CASE WHEN attempt >= 8 THEN 'dead' ELSE 'retryable' END,
                              lease_owner = NULL,
                              lease_expires_at = NULL, available_at = :now,
                              safe_failure_code = CASE WHEN attempt >= 8
                                THEN 'attempts_exhausted' ELSE 'lease_expired' END,
                              updated_at = :now
                          WHERE state = 'leased' AND lease_expires_at <= :now
                          RETURNING booking_id, kind, state
                        )
                        UPDATE marketplace_booking AS booking
                        SET money_state = expired.kind || '_ambiguous', updated_at = :now
                        FROM expired WHERE expired.state = 'dead'
                          AND booking.booking_id = expired.booking_id
                        """
                    ),
                    {"now": now},
                )
                operation_id = connection.execute(
                    text(
                        """
                        SELECT operation_id FROM marketplace_money_operation
                        WHERE state IN ('queued', 'retryable') AND available_at <= :now
                          AND attempt < 8
                          AND (:include_transfers OR kind <> 'transfer')
                        ORDER BY available_at, created_at, operation_id
                        FOR UPDATE SKIP LOCKED LIMIT 1
                        """
                    ),
                    {"now": now, "include_transfers": include_transfers},
                ).scalar_one_or_none()
                if operation_id is None:
                    return None
                connection.execute(
                    text(
                        """
                        UPDATE marketplace_money_operation
                        SET state = 'leased', lease_owner = :worker,
                            lease_expires_at = :expires, attempt = attempt + 1,
                            updated_at = :now
                        WHERE operation_id = :id
                        """
                    ),
                    {
                        "worker": worker,
                        "expires": now + timedelta(seconds=lease_seconds),
                        "now": now,
                        "id": operation_id,
                    },
                )
                return self._money_operation(connection, operation_id)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def finish_money_operation(
        self, *, operation: StoredMoneyOperation, result: StripeMoneyResult, worker: str
    ) -> bool:
        expected_live = operation.provider_environment == "PRODUCTION"
        prefix = {"refund": "re_", "transfer": "tr_", "reversal": "trr_"}[operation.kind]
        if (
            result.livemode != expected_live
            or result.amount_minor != operation.amount_minor
            or result.currency != operation.currency
            or not result.operation_id.startswith(prefix)
        ):
            return False
        try:
            with self._payment_engine.begin() as connection:
                current = connection.execute(
                    text(
                        "SELECT state FROM marketplace_money_operation "
                        "WHERE operation_id = :id AND lease_owner = :worker FOR UPDATE"
                    ),
                    {"id": operation.operation_id, "worker": worker},
                ).scalar_one_or_none()
                if current != "leased":
                    return False
                connection.execute(
                    text(
                        """
                        INSERT INTO marketplace_money_ledger
                          (entry_id, booking_id, operation_id, kind, amount_minor, currency)
                        VALUES (:entry_id, :booking_id, :operation_id, :kind, :amount, :currency)
                        ON CONFLICT (operation_id) DO NOTHING
                        """
                    ),
                    {
                        "entry_id": uuid4(),
                        "booking_id": operation.booking_id,
                        "operation_id": operation.operation_id,
                        "kind": operation.kind,
                        "amount": operation.amount_minor,
                        "currency": operation.currency,
                    },
                )
                connection.execute(
                    text(
                        """
                        UPDATE marketplace_money_operation
                        SET state = 'completed', provider_operation_id = :provider_id,
                            lease_owner = NULL, lease_expires_at = NULL,
                            safe_failure_code = NULL, updated_at = now()
                        WHERE operation_id = :id
                        """
                    ),
                    {"provider_id": result.operation_id, "id": operation.operation_id},
                )
                next_state = {
                    "refund": "refunded",
                    "transfer": "transferred",
                    "reversal": "reversed",
                }[operation.kind]
                connection.execute(
                    text(
                        "UPDATE marketplace_booking SET money_state = :state, updated_at = now() "
                        "WHERE booking_id = :id"
                    ),
                    {"state": next_state, "id": operation.booking_id},
                )
                if operation.kind == "reversal":
                    booking = (
                        connection.execute(
                            text("SELECT * FROM marketplace_booking WHERE booking_id = :id"),
                            {"id": operation.booking_id},
                        )
                        .mappings()
                        .one()
                    )
                    self._queue_money_authority(
                        connection,
                        row=booking,
                        kind="refund",
                        amount_minor=booking["amount_minor"],
                        available_at=datetime.now(UTC),
                    )
                    connection.execute(
                        text(
                            "UPDATE marketplace_booking SET money_state = 'refund_pending' "
                            "WHERE booking_id = :id"
                        ),
                        {"id": operation.booking_id},
                    )
                return True
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def claim_reminder(
        self, *, worker: str, now: datetime, lease_seconds: int
    ) -> StoredReminderJob | None:
        try:
            with self._engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        UPDATE marketplace_booking_reminder_job
                        SET state = 'dead', lease_owner = NULL, lease_expires_at = NULL,
                            safe_failure_code = 'attempts_exhausted', updated_at = :now
                        WHERE state = 'leased' AND attempt >= 8
                          AND lease_expires_at <= :now
                        """
                    ),
                    {"now": now},
                )
                row = (
                    connection.execute(
                        text(
                            """
                            WITH claimable AS (
                              SELECT job_id FROM marketplace_booking_reminder_job
                              WHERE ((state IN ('queued', 'retryable') AND available_at <= :now)
                                  OR (state = 'leased' AND lease_expires_at <= :now))
                                AND attempt < 8
                              ORDER BY available_at, created_at, job_id
                              FOR UPDATE SKIP LOCKED LIMIT 1
                            )
                            UPDATE marketplace_booking_reminder_job AS job
                            SET state = 'leased', attempt = attempt + 1,
                                lease_owner = :worker, lease_expires_at = :lease_expires,
                                updated_at = :now
                            FROM claimable, marketplace_booking AS booking
                            WHERE job.job_id = claimable.job_id
                              AND booking.booking_id = job.booking_id
                            RETURNING job.job_id, job.booking_id, job.kind, job.attempt,
                                      booking.learner_actor_ref, booking.tutor_actor_ref
                            """
                        ),
                        {
                            "worker": worker,
                            "now": now,
                            "lease_expires": now + timedelta(seconds=lease_seconds),
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                return StoredReminderJob(**dict(row)) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def finish_reminder(
        self,
        *,
        job_id: UUID,
        worker: str,
        now: datetime,
        outcome: Literal["completed", "retryable", "rejected"],
    ) -> bool:
        try:
            with self._engine.begin() as connection:
                state = "dead" if outcome == "rejected" else outcome
                return (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_booking_reminder_job
                            SET state = CASE WHEN :state = 'retryable' AND attempt >= 8
                                             THEN 'dead' ELSE :state END,
                                lease_owner = NULL, lease_expires_at = NULL,
                                safe_failure_code = CASE WHEN :state = 'completed' THEN NULL
                                  WHEN :state = 'dead' THEN 'rejected' ELSE 'unavailable' END,
                                available_at = CASE WHEN :state = 'retryable'
                                  THEN :now + make_interval(
                                    secs => least(3600, 30 * power(2, attempt)))
                                  ELSE available_at END,
                                updated_at = :now
                            WHERE job_id = :job_id AND state = 'leased'
                              AND lease_owner = :worker RETURNING 1
                            """
                        ),
                        {
                            "state": state,
                            "now": now,
                            "job_id": job_id,
                            "worker": worker,
                        },
                    ).scalar_one_or_none()
                    is not None
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def fail_money_operation(
        self,
        *,
        operation_id: UUID,
        worker: str,
        code: str,
        ambiguous: bool,
        now: datetime,
    ) -> None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            "SELECT kind, attempt, booking_id FROM marketplace_money_operation "
                            "WHERE operation_id = :id AND state = 'leased' "
                            "AND lease_owner = :worker FOR UPDATE"
                        ),
                        {"id": operation_id, "worker": worker},
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return
                state = "ambiguous" if ambiguous else "dead" if row["attempt"] >= 8 else "retryable"
                connection.execute(
                    text(
                        """
                        UPDATE marketplace_money_operation
                        SET state = :state, safe_failure_code = :code,
                            available_at = :available, lease_owner = NULL,
                            lease_expires_at = NULL, updated_at = :now
                        WHERE operation_id = :id
                        """
                    ),
                    {
                        "state": state,
                        "code": code,
                        "available": now + timedelta(minutes=2),
                        "now": now,
                        "id": operation_id,
                    },
                )
                booking_state = (
                    f"{row['kind']}_ambiguous"
                    if state in {"ambiguous", "dead"}
                    else f"{row['kind']}_pending"
                )
                connection.execute(
                    text(
                        "UPDATE marketplace_booking SET money_state = :state, updated_at = :now "
                        "WHERE booking_id = :id"
                    ),
                    {"state": booking_state, "now": now, "id": row["booking_id"]},
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def recover_money_operation(
        self, *, booking_id: UUID, operator_actor_ref: str, reason: str, now: datetime
    ) -> bool:
        try:
            with self._engine.begin() as connection:
                if not self._has_capability(connection, operator_actor_ref, "manage_bookings"):
                    return False
                row = (
                    connection.execute(
                        text(
                            """
                        WITH candidate AS (
                            SELECT operation_id
                            FROM marketplace_money_operation
                            WHERE booking_id = :booking_id
                              AND state IN ('ambiguous', 'dead')
                            ORDER BY created_at, operation_id
                            FOR UPDATE SKIP LOCKED
                            LIMIT 1
                        )
                        UPDATE marketplace_money_operation AS operation
                        SET state = 'retryable', available_at = :now,
                            attempt = CASE WHEN operation.state = 'dead' THEN 0
                                           ELSE operation.attempt END,
                            safe_failure_code = 'operator_reconciled', updated_at = :now
                        FROM candidate
                        WHERE operation.operation_id = candidate.operation_id
                        RETURNING operation.kind
                        """
                        ),
                        {"booking_id": booking_id, "now": now},
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return bool(
                        connection.execute(
                            text(
                                "SELECT 1 FROM marketplace_money_recovery_audit "
                                "WHERE booking_id = :booking_id "
                                "AND operator_actor_ref = :actor AND reason = :reason"
                            ),
                            {
                                "booking_id": booking_id,
                                "actor": operator_actor_ref,
                                "reason": reason,
                            },
                        ).scalar_one_or_none()
                    )
                connection.execute(
                    text(
                        "UPDATE marketplace_booking SET money_state = :state, updated_at = :now "
                        "WHERE booking_id = :id"
                    ),
                    {"state": f"{row['kind']}_pending", "now": now, "id": booking_id},
                )
                booking = (
                    connection.execute(
                        text("SELECT * FROM marketplace_booking WHERE booking_id = :id"),
                        {"id": booking_id},
                    )
                    .mappings()
                    .one()
                )
                connection.execute(
                    text(
                        "INSERT INTO marketplace_money_recovery_audit "
                        "(audit_id, booking_id, operator_actor_ref, reason, occurred_at) "
                        "VALUES (:audit_id, :booking_id, :actor, :reason, :now)"
                    ),
                    {
                        "audit_id": uuid4(),
                        "booking_id": booking_id,
                        "actor": operator_actor_ref,
                        "reason": reason,
                        "now": now,
                    },
                )
                self._audit(
                    connection,
                    booking,
                    booking["state"],
                    operator_actor_ref,
                    "money_recovery_requeued",
                )
                return True
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def recover_delivery_jobs(
        self, *, booking_id: UUID, operator_actor_ref: str, reason: str, now: datetime
    ) -> bool:
        try:
            with self._engine.begin() as connection:
                if not self._has_capability(connection, operator_actor_ref, "manage_bookings"):
                    return False
                if (
                    connection.execute(
                        text("SELECT 1 FROM marketplace_booking WHERE booking_id = :id FOR UPDATE"),
                        {"id": booking_id},
                    ).scalar_one_or_none()
                    is None
                ):
                    return False
                reminders = connection.execute(
                    text(
                        "UPDATE marketplace_booking_reminder_job SET state = 'queued', "
                        "attempt = 0, available_at = :now, lease_owner = NULL, "
                        "lease_expires_at = NULL, safe_failure_code = 'operator_reconciled', "
                        "updated_at = :now WHERE booking_id = :id AND state = 'dead'"
                    ),
                    {"id": booking_id, "now": now},
                ).rowcount
                notifications = connection.execute(
                    text(
                        "UPDATE marketplace_message_notification_job AS job "
                        "SET status = 'queued', attempt = 0, available_at = :now, "
                        "lease_owner = NULL, lease_expires_at = NULL, "
                        "safe_failure_code = NULL, updated_at = :now "
                        "FROM marketplace_message AS message "
                        "JOIN marketplace_conversation AS conversation "
                        "ON conversation.conversation_id = message.conversation_id "
                        "WHERE job.message_id = message.message_id "
                        "AND conversation.booking_id = :id AND job.status = 'dead'"
                    ),
                    {"id": booking_id, "now": now},
                ).rowcount
                if reminders + notifications == 0:
                    return bool(
                        connection.execute(
                            text(
                                "SELECT 1 FROM marketplace_delivery_recovery_audit "
                                "WHERE booking_id = :id AND operator_actor_ref = :actor "
                                "AND reason = :reason"
                            ),
                            {"id": booking_id, "actor": operator_actor_ref, "reason": reason},
                        ).scalar_one_or_none()
                    )
                connection.execute(
                    text(
                        "INSERT INTO marketplace_delivery_recovery_audit "
                        "(audit_id, booking_id, operator_actor_ref, reason, "
                        "reminder_jobs_requeued, notification_jobs_requeued, occurred_at) "
                        "VALUES (:audit_id, :id, :actor, :reason, :reminders, "
                        ":notifications, :now)"
                    ),
                    {
                        "audit_id": uuid4(),
                        "id": booking_id,
                        "actor": operator_actor_ref,
                        "reason": reason,
                        "reminders": reminders,
                        "notifications": notifications,
                        "now": now,
                    },
                )
                return True
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def create_review(
        self,
        *,
        review_id: UUID,
        booking_id: UUID,
        learner_actor_ref: str,
        rating: int,
        body: str | None,
    ) -> ReviewView | None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                        INSERT INTO marketplace_booking_review
                          (review_id, booking_id, learner_actor_ref, tutor_id, rating, body)
                        SELECT :review_id, booking_id, :learner, tutor_id, :rating, :body
                        FROM marketplace_booking
                        WHERE booking_id = :booking_id AND learner_actor_ref = :learner
                        ON CONFLICT (booking_id) DO NOTHING
                        RETURNING review_id, booking_id, tutor_id, rating, body,
                                  moderation_state, moderation_reason, moderated_at, created_at
                        """
                        ),
                        {
                            "review_id": review_id,
                            "booking_id": booking_id,
                            "learner": learner_actor_ref,
                            "rating": rating,
                            "body": body,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    prior = (
                        connection.execute(
                            text(
                                "SELECT review_id, booking_id, tutor_id, rating, body, "
                                "moderation_state, moderation_reason, moderated_at, created_at "
                                "FROM marketplace_booking_review "
                                "WHERE booking_id = :booking_id "
                                "AND learner_actor_ref = :learner"
                            ),
                            {"booking_id": booking_id, "learner": learner_actor_ref},
                        )
                        .mappings()
                        .one_or_none()
                    )
                    if prior is None:
                        return None
                    if prior["rating"] != rating or prior["body"] != body:
                        raise TutorApplicationConflictError
                    row = prior
                return self._review(row) if row is not None else None
        except TutorApplicationConflictError:
            raise
        except (IntegrityError, DBAPIError) as error:
            raise TutorApplicationConflictError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def list_reviews_for_operator(
        self, *, operator_actor_ref: str, offset: int, limit: int
    ) -> tuple[tuple[ReviewView, ...], bool] | None:
        try:
            with self._engine.connect() as connection:
                if not self._has_capability(connection, operator_actor_ref, "moderate_reviews"):
                    return None
                rows = tuple(
                    self._review(row)
                    for row in connection.execute(
                        text(
                            """
                            SELECT review_id, booking_id, tutor_id, rating, body,
                                   moderation_state, moderation_reason, moderated_at, created_at
                            FROM marketplace_booking_review
                            ORDER BY created_at DESC, review_id
                            OFFSET :offset LIMIT :limit
                            """
                        ),
                        {"offset": offset, "limit": limit + 1},
                    ).mappings()
                )
                return rows[:limit], len(rows) > limit
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def moderate_review(
        self,
        *,
        operator_actor_ref: str,
        review_id: UUID,
        moderation_state: Literal["published", "hidden"],
        reason: str,
        now: datetime,
    ) -> ReviewView | None:
        try:
            with self._engine.begin() as connection:
                if not self._has_capability(connection, operator_actor_ref, "moderate_reviews"):
                    return None
                prior = (
                    connection.execute(
                        text(
                            "SELECT * FROM marketplace_booking_review "
                            "WHERE review_id = :review_id FOR UPDATE"
                        ),
                        {"review_id": review_id},
                    )
                    .mappings()
                    .one_or_none()
                )
                if prior is None:
                    return None
                prior_state = prior["moderation_state"]
                if (
                    prior_state == moderation_state
                    and prior["moderation_reason"] == reason
                    and prior["moderated_by_actor_ref"] == operator_actor_ref
                ):
                    return self._review(prior)
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_booking_review
                            SET moderation_state = :state, moderation_reason = :reason,
                                moderated_by_actor_ref = :actor, moderated_at = :now
                            WHERE review_id = :review_id
                            RETURNING review_id, booking_id, tutor_id, rating, body,
                                      moderation_state, moderation_reason,
                                      moderated_at, created_at
                            """
                        ),
                        {
                            "state": moderation_state,
                            "reason": reason,
                            "actor": operator_actor_ref,
                            "now": now,
                            "review_id": review_id,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                connection.execute(
                    text(
                        "INSERT INTO marketplace_booking_review_moderation_audit "
                        "(audit_id, review_id, from_state, to_state, operator_actor_ref, "
                        "reason, occurred_at) VALUES (:audit_id, :review_id, :from_state, "
                        ":to_state, :actor, :reason, :now)"
                    ),
                    {
                        "audit_id": uuid4(),
                        "review_id": review_id,
                        "from_state": prior_state,
                        "to_state": moderation_state,
                        "actor": operator_actor_ref,
                        "reason": reason,
                        "now": now,
                    },
                )
                return self._review(row) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def earnings(self, *, tutor_actor_ref: str) -> EarningsView:
        try:
            with self._engine.connect() as connection:
                row = connection.execute(
                    text(
                        """
                        SELECT coalesce(sum(tutor_amount_minor) FILTER (
                                 WHERE money_state IN ('charged', 'transfer_pending',
                                                       'transfer_ambiguous')), 0) AS pending,
                               coalesce(sum(tutor_amount_minor) FILTER (
                                 WHERE money_state = 'transferred'), 0) AS transferred
                        FROM marketplace_booking WHERE tutor_actor_ref = :actor
                        """
                    ),
                    {"actor": tutor_actor_ref},
                ).one()
                return EarningsView(pending_minor=row.pending, transferred_minor=row.transferred)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    @staticmethod
    def _decision(
        connection: Connection,
        *,
        row: RowMapping,
        role: str,
        action: LifecycleAction,
        now: datetime,
    ) -> tuple[str, Literal["refund", "transfer", "reversal"] | None, int, datetime]:
        state = row["state"]
        if action == "cancel" and state == "confirmed" and role in {"learner", "tutor"}:
            before_cutoff = row["starts_at"] - now >= timedelta(
                hours=row["cancellation_cutoff_hours"]
            )
            if role == "tutor" or before_cutoff:
                return "cancelled", "refund", row["amount_minor"], now
            eligibility = row["ends_at"] + timedelta(hours=row["dispute_window_hours"])
            return (
                "cancelled",
                "transfer",
                row["tutor_amount_minor"],
                next_weekly_payout_at(eligibility + timedelta(microseconds=1)),
            )
        if action == "complete" and state == "confirmed" and role in {"learner", "tutor"}:
            if now < row["ends_at"]:
                raise TutorApplicationConflictError
            deadline = now + timedelta(hours=row["dispute_window_hours"])
            return (
                "completed",
                "transfer",
                row["tutor_amount_minor"],
                next_weekly_payout_at(deadline + timedelta(microseconds=1)),
            )
        if action == "learner_no_show" and state == "confirmed" and role == "tutor":
            if now < row["ends_at"]:
                raise TutorApplicationConflictError
            deadline = now + timedelta(hours=row["dispute_window_hours"])
            return (
                "learner_no_show",
                "transfer",
                row["tutor_amount_minor"],
                next_weekly_payout_at(deadline + timedelta(microseconds=1)),
            )
        if action == "tutor_no_show" and state == "confirmed" and role == "learner":
            if now < row["ends_at"]:
                raise TutorApplicationConflictError
            return "tutor_no_show", "refund", row["amount_minor"], now
        if action == "calendar_conflict_refund" and state == "confirmed" and role == "operator":
            unresolved = connection.execute(
                text(
                    "SELECT 1 FROM marketplace_calendar_booking_conflict "
                    "WHERE booking_id = :booking_id AND resolved_at IS NULL FOR UPDATE"
                ),
                {"booking_id": row["booking_id"]},
            ).scalar_one_or_none()
            if unresolved is None:
                raise TutorApplicationConflictError
            return "cancelled", "refund", row["amount_minor"], now
        if action == "dispute" and state in {"completed", "learner_no_show"} and role == "learner":
            if row["dispute_deadline_at"] is None or now > row["dispute_deadline_at"]:
                raise TutorApplicationConflictError
            connection.execute(
                text(
                    "UPDATE marketplace_money_operation SET state = 'cancelled', updated_at = :now "
                    "WHERE booking_id = :id AND kind = 'transfer' AND state = 'queued'"
                ),
                {"id": row["booking_id"], "now": now},
            )
            return "disputed", None, 0, now
        if (
            action in {"resolve_refund", "resolve_release"}
            and state == "disputed"
            and role == "operator"
        ):
            if action == "resolve_refund":
                if row["money_state"] == "transferred":
                    return "resolved_refund", "reversal", row["tutor_amount_minor"], now
                if row["money_state"] != "charged":
                    raise TutorApplicationConflictError
                return "resolved_refund", "refund", row["amount_minor"], now
            if row["money_state"] == "transferred":
                return "resolved_release", None, 0, now
            if row["money_state"] != "charged":
                raise TutorApplicationConflictError
            return "resolved_release", "transfer", row["tutor_amount_minor"], now
        raise TutorApplicationConflictError

    @staticmethod
    def _current_money_state(connection: Connection, booking_id: UUID) -> str:
        transferred = connection.execute(
            text(
                "SELECT 1 FROM marketplace_money_ledger "
                "WHERE booking_id = :id AND kind = 'transfer' LIMIT 1"
            ),
            {"id": booking_id},
        ).scalar_one_or_none()
        if transferred is not None:
            return "transferred"
        operation_state = connection.execute(
            text(
                "SELECT state FROM marketplace_money_operation "
                "WHERE booking_id = :id AND kind = 'transfer'"
            ),
            {"id": booking_id},
        ).scalar_one_or_none()
        if operation_state in {"leased", "queued", "retryable"}:
            return "transfer_pending"
        if operation_state in {"ambiguous", "dead"}:
            return "transfer_ambiguous"
        return "charged"

    @staticmethod
    def _role(connection: Connection, *, row: RowMapping, actor_ref: str) -> str:
        if actor_ref == row["learner_actor_ref"]:
            return "learner"
        if actor_ref == row["tutor_actor_ref"]:
            return "tutor"
        if PostgresLifecycleRepository._has_capability(connection, actor_ref, "manage_bookings"):
            return "operator"
        raise TutorApplicationNotFoundError

    @staticmethod
    def _has_capability(connection: Connection, actor_ref: str, capability: str) -> bool:
        return (
            connection.execute(
                text(
                    "SELECT 1 FROM marketplace_operator_capability "
                    "WHERE actor_ref = :actor AND capability = :capability AND revoked_at IS NULL"
                ),
                {"actor": actor_ref, "capability": capability},
            ).scalar_one_or_none()
            is not None
        )

    @staticmethod
    def _queue_money(
        connection: Connection,
        *,
        row: RowMapping,
        kind: Literal["refund", "transfer", "reversal"],
        amount_minor: int,
        available_at: datetime,
    ) -> None:
        operation_id = connection.execute(
            text("SELECT marketplace_queue_booking_money(:booking_id, :kind, :available_at)"),
            {
                "booking_id": row["booking_id"],
                "kind": kind,
                "available_at": available_at,
            },
        ).scalar_one_or_none()
        if operation_id is None:
            raise TutorApplicationConflictError

    @staticmethod
    def _queue_money_authority(
        connection: Connection,
        *,
        row: RowMapping,
        kind: Literal["refund", "transfer", "reversal"],
        amount_minor: int,
        available_at: datetime,
    ) -> None:
        connection.execute(
            text(
                """
                INSERT INTO marketplace_money_operation
                  (operation_id, booking_id, kind, amount_minor, currency,
                   idempotency_key, available_at)
                VALUES (:operation_id, :booking_id, :kind, :amount, :currency,
                        :idempotency, :available_at)
                ON CONFLICT (booking_id, kind) DO UPDATE
                SET state = 'queued', available_at = excluded.available_at,
                    safe_failure_code = NULL, updated_at = now()
                WHERE marketplace_money_operation.state = 'cancelled'
                """
            ),
            {
                "operation_id": uuid4(),
                "booking_id": row["booking_id"],
                "kind": kind,
                "amount": amount_minor,
                "currency": row["currency"],
                "idempotency": f"booking:{row['booking_id']}:{kind}",
                "available_at": available_at,
            },
        )

    @staticmethod
    def _insert_reminders(
        connection: Connection, *, booking_id: UUID, starts_at: datetime, ends_at: datetime
    ) -> None:
        for kind, available_at in (
            ("lesson_reminder", starts_at - timedelta(hours=24)),
            ("completion_prompt", ends_at),
        ):
            connection.execute(
                text(
                    """
                    INSERT INTO marketplace_booking_reminder_job
                      (job_id, booking_id, kind, available_at)
                    VALUES (:job_id, :booking_id, :kind, :available_at)
                    ON CONFLICT (booking_id, kind) DO UPDATE
                    SET state = 'queued', available_at = excluded.available_at,
                        lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
                    """
                ),
                {
                    "job_id": uuid4(),
                    "booking_id": booking_id,
                    "kind": kind,
                    "available_at": available_at,
                },
            )

    @staticmethod
    def _audit(
        connection: Connection,
        row: RowMapping,
        target: str,
        actor_ref: str,
        reason: str,
    ) -> None:
        source = (
            "learner"
            if actor_ref == row["learner_actor_ref"]
            else "tutor"
            if actor_ref == row["tutor_actor_ref"]
            else "operator"
        )
        connection.execute(
            text(
                """
                INSERT INTO marketplace_booking_transition_audit
                  (audit_id, booking_id, from_state, to_state, source, reason_code, actor_ref)
                VALUES (:audit_id, :booking_id, :old, :new, :source, :reason, :actor)
                """
            ),
            {
                "audit_id": uuid4(),
                "booking_id": row["booking_id"],
                "old": row["state"],
                "new": target,
                "source": source,
                "reason": reason[:64].replace(" ", "_").lower(),
                "actor": actor_ref,
            },
        )

    @staticmethod
    def _system_message(connection: Connection, booking_id: UUID, body: str) -> None:
        conversation_id = connection.execute(
            text("SELECT conversation_id FROM marketplace_conversation WHERE booking_id = :id"),
            {"id": booking_id},
        ).scalar_one_or_none()
        if conversation_id is not None:
            connection.execute(
                text(
                    """
                    INSERT INTO marketplace_message
                      (message_id, conversation_id, sender_actor_ref, kind, body)
                    VALUES (:message_id, :conversation_id, NULL, 'system', :body)
                    """
                ),
                {"message_id": uuid4(), "conversation_id": conversation_id, "body": body},
            )

    @staticmethod
    def _money_operation(connection: Connection, operation_id: UUID) -> StoredMoneyOperation:
        row = (
            connection.execute(
                text(
                    """
                SELECT operation.operation_id, operation.booking_id, operation.kind,
                       operation.state, operation.amount_minor, operation.currency,
                       operation.idempotency_key, booking.provider_environment,
                       booking.provider_payment_intent_id,
                       account.provider_account_id AS destination_account_id,
                       prior.provider_operation_id AS prior_transfer_id
                FROM marketplace_money_operation AS operation
                JOIN marketplace_booking AS booking USING (booking_id)
                JOIN marketplace_tutor_connect_account AS account
                  ON account.tutor_id = booking.tutor_id
                LEFT JOIN marketplace_money_operation AS prior
                  ON prior.booking_id = booking.booking_id AND prior.kind = 'transfer'
                WHERE operation.operation_id = :id
                """
                ),
                {"id": operation_id},
            )
            .mappings()
            .one()
        )
        return StoredMoneyOperation(**dict(row))

    @staticmethod
    def _review(row: RowMapping) -> ReviewView:
        return ReviewView(**dict(row))


class LifecycleService:
    def __init__(
        self,
        *,
        enabled: bool,
        repository: PostgresLifecycleRepository,
        booking_service: BookingService,
        provider: StripeMarketplaceProvider | None,
        pseudonym_key: bytes | None,
        actor_allowlist: tuple[str, ...],
        payout_execution_enabled: bool = True,
        notification_provider: MarketplaceNotificationProvider | None = None,
        platform_account_id: str | None = None,
    ) -> None:
        self._enabled = enabled
        self._repository = repository
        self._booking_service = booking_service
        self._provider = provider
        self._pseudonym_key = pseudonym_key
        self._actor_allowlist = frozenset(actor_allowlist)
        self._payout_execution_enabled = payout_execution_enabled
        self._notification_provider = notification_provider
        self._platform_account_id = platform_account_id

    async def transition(
        self,
        *,
        principal: ClerkPrincipal,
        booking_id: UUID,
        action: LifecycleAction,
        reason: str,
        new_starts_at: datetime | None,
        operation_id: UUID,
    ) -> BookingView:
        actor_ref = self._actor_ref(principal)
        if await asyncio.to_thread(
            self._repository.is_transition_replay,
            operation_id=operation_id,
            booking_id=booking_id,
            actor_ref=actor_ref,
            action=action,
            reason=reason,
            new_starts_at=new_starts_at,
        ):
            return await self._booking_service.get_booking(
                principal=principal, booking_id=booking_id
            )
        expected_profile_version: int | None = None
        if action == "reschedule":
            if new_starts_at is None:
                raise TutorApplicationConflictError
            expected_profile_version = await self._booking_service.validate_reschedule(
                principal=principal,
                booking_id=booking_id,
                starts_at=new_starts_at,
            )
        updated = await asyncio.to_thread(
            self._repository.transition,
            booking_id=booking_id,
            actor_ref=actor_ref,
            action=action,
            reason=reason,
            new_starts_at=new_starts_at,
            now=datetime.now(UTC),
            expected_profile_version=expected_profile_version,
            operation_id=operation_id,
        )
        if not updated:
            raise TutorApplicationNotFoundError
        return await self._booking_service.get_booking(principal=principal, booking_id=booking_id)

    async def create_review(
        self,
        *,
        principal: ClerkPrincipal,
        booking_id: UUID,
        rating: int,
        body: str | None,
    ) -> ReviewView:
        review = await asyncio.to_thread(
            self._repository.create_review,
            review_id=uuid4(),
            booking_id=booking_id,
            learner_actor_ref=self._actor_ref(principal),
            rating=rating,
            body=body,
        )
        if review is None:
            raise TutorApplicationNotFoundError
        return review

    async def list_reviews(
        self, *, principal: ClerkPrincipal, offset: int, limit: int
    ) -> tuple[tuple[ReviewView, ...], int | None]:
        result = await asyncio.to_thread(
            self._repository.list_reviews_for_operator,
            operator_actor_ref=self._actor_ref(principal),
            offset=offset,
            limit=limit,
        )
        if result is None:
            raise HumanTutorMarketplaceForbiddenError
        reviews, has_more = result
        return reviews, offset + limit if has_more else None

    async def moderate_review(
        self,
        *,
        principal: ClerkPrincipal,
        review_id: UUID,
        moderation_state: Literal["published", "hidden"],
        reason: str,
    ) -> ReviewView:
        review = await asyncio.to_thread(
            self._repository.moderate_review,
            operator_actor_ref=self._actor_ref(principal),
            review_id=review_id,
            moderation_state=moderation_state,
            reason=reason,
            now=datetime.now(UTC),
        )
        if review is None:
            raise HumanTutorMarketplaceForbiddenError
        return review

    async def earnings(self, *, principal: ClerkPrincipal) -> EarningsView:
        return await asyncio.to_thread(
            self._repository.earnings,
            tutor_actor_ref=self._actor_ref(principal),
        )

    async def run_one_money_job(self, *, worker: str) -> bool:
        self._require_enabled()
        operation = await asyncio.to_thread(
            self._repository.claim_money_operation,
            worker=worker,
            now=datetime.now(UTC),
            lease_seconds=60,
            include_transfers=self._payout_execution_enabled,
        )
        if operation is None:
            return False
        provider = self._provider
        if provider is None or self._platform_account_id is None:
            raise HumanTutorMarketplaceUnavailableError
        actual_platform_account = await provider.get_platform_account_id()
        if not hmac.compare_digest(actual_platform_account, self._platform_account_id):
            await asyncio.to_thread(
                self._repository.fail_money_operation,
                operation_id=operation.operation_id,
                worker=worker,
                code="platform_account_mismatch",
                ambiguous=False,
                now=datetime.now(UTC),
            )
            return True
        try:
            if operation.kind == "refund":
                if operation.provider_payment_intent_id is None:
                    raise StripeOperationError(code="missing_payment", ambiguous=False)
                result = await provider.create_refund(
                    payment_intent_id=operation.provider_payment_intent_id,
                    amount_minor=operation.amount_minor,
                    idempotency_key=operation.idempotency_key,
                )
            elif operation.kind == "transfer":
                result = await provider.create_transfer(
                    destination_account_id=operation.destination_account_id,
                    amount_minor=operation.amount_minor,
                    currency=operation.currency,
                    booking_id=operation.booking_id,
                    idempotency_key=operation.idempotency_key,
                )
            else:
                if operation.prior_transfer_id is None:
                    raise StripeOperationError(code="missing_transfer", ambiguous=False)
                result = await provider.create_reversal(
                    transfer_id=operation.prior_transfer_id,
                    amount_minor=operation.amount_minor,
                    idempotency_key=operation.idempotency_key,
                )
        except StripeOperationError as error:
            await asyncio.to_thread(
                self._repository.fail_money_operation,
                operation_id=operation.operation_id,
                worker=worker,
                code=error.code,
                ambiguous=error.ambiguous,
                now=datetime.now(UTC),
            )
            return True
        if not await asyncio.to_thread(
            self._repository.finish_money_operation,
            operation=operation,
            result=result,
            worker=worker,
        ):
            await asyncio.to_thread(
                self._repository.fail_money_operation,
                operation_id=operation.operation_id,
                worker=worker,
                code="provider_mismatch",
                ambiguous=True,
                now=datetime.now(UTC),
            )
        return True

    async def run_one_reminder_job(self, *, worker: str) -> bool:
        self._require_enabled()
        if self._notification_provider is None:
            return False
        job = await asyncio.to_thread(
            self._repository.claim_reminder,
            worker=worker,
            now=datetime.now(UTC),
            lease_seconds=60,
        )
        if job is None:
            return False
        outcomes = []
        for role, recipient in (
            ("learner", job.learner_actor_ref),
            ("tutor", job.tutor_actor_ref),
        ):
            outcomes.append(
                await self._notification_provider.deliver(
                    recipient_actor_ref=recipient,
                    template=job.kind,
                    idempotency_key=f"marketplace-reminder:{job.job_id}:{role}",
                )
            )
        outcome: Literal["completed", "retryable", "rejected"] = (
            "rejected"
            if "rejected" in outcomes
            else "retryable"
            if "retryable" in outcomes
            else "completed"
        )
        await asyncio.to_thread(
            self._repository.finish_reminder,
            job_id=job.job_id,
            worker=worker,
            now=datetime.now(UTC),
            outcome=outcome,
        )
        return True

    async def recover_money(
        self, *, principal: ClerkPrincipal, booking_id: UUID, reason: str
    ) -> BookingView:
        if not await asyncio.to_thread(
            self._repository.recover_money_operation,
            booking_id=booking_id,
            operator_actor_ref=self._actor_ref(principal),
            reason=reason,
            now=datetime.now(UTC),
        ):
            raise HumanTutorMarketplaceForbiddenError
        return await self._booking_service.get_booking(principal=principal, booking_id=booking_id)

    async def recover_delivery(
        self, *, principal: ClerkPrincipal, booking_id: UUID, reason: str
    ) -> BookingView:
        if not await asyncio.to_thread(
            self._repository.recover_delivery_jobs,
            booking_id=booking_id,
            operator_actor_ref=self._actor_ref(principal),
            reason=reason,
            now=datetime.now(UTC),
        ):
            raise HumanTutorMarketplaceForbiddenError
        return await self._booking_service.get_booking(principal=principal, booking_id=booking_id)

    def _actor_ref(self, principal: ClerkPrincipal) -> str:
        self._require_enabled()
        if principal.user_id not in self._actor_allowlist or self._pseudonym_key is None:
            raise HumanTutorMarketplaceForbiddenError
        return derive_marketplace_actor_ref(
            key=self._pseudonym_key,
            clerk_user_id=principal.user_id,
        )

    def _require_enabled(self) -> None:
        if not self._enabled:
            raise HumanTutorMarketplaceUnavailableError
