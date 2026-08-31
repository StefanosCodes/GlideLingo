"""PostgreSQL-backed idempotency and bounded tutor-use admission."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, Protocol

from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.errors import (
    DependencyUnavailableError,
    LessonTutorConflictError,
    LessonTutorLimitedError,
)
from app.modules.lesson_tutor.schemas import LessonTutorTurnResponse

OPERATION = "lesson_tutor_turn_v1"


@dataclass(frozen=True, slots=True)
class GuardLimits:
    burst: int
    burst_window_seconds: int
    concurrency: int
    daily: int
    global_daily: int
    stale_in_progress_seconds: int = 120


@dataclass(frozen=True, slots=True)
class GuardAdmission:
    turn_ref: str | None
    replay: LessonTutorTurnResponse | None = None


class LessonTutorGuard(Protocol):
    def admit(
        self, *, actor_ref: str, idempotency_key: str, fingerprint: str, turn_ref: str
    ) -> GuardAdmission: ...

    def complete(
        self, *, actor_ref: str, idempotency_key: str, response: LessonTutorTurnResponse
    ) -> None: ...

    def fail(
        self,
        *,
        actor_ref: str,
        idempotency_key: str,
        outcome: Literal["retryable", "ambiguous"],
    ) -> None: ...


class PostgresLessonTutorGuard:
    """Admit one turn in a short transaction; never hold a lock over the remote call."""

    def __init__(self, *, engine: Engine, limits: GuardLimits) -> None:
        self._engine = engine
        self._limits = limits

    def admit(
        self, *, actor_ref: str, idempotency_key: str, fingerprint: str, turn_ref: str
    ) -> GuardAdmission:
        try:
            with self._engine.begin() as connection:
                connection.execute(
                    text(
                        "SELECT pg_advisory_xact_lock("
                        "hashtextextended('glidelingo:tutor-global:v1', 0))"
                    )
                )
                connection.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:actor_ref, 0))"),
                    {"actor_ref": actor_ref},
                )
                connection.execute(
                    text(
                        """
                        UPDATE lesson_tutor_turn_guard
                        SET status = 'ambiguous', updated_at = now()
                        WHERE status = 'in_progress'
                          AND operation = :operation
                          AND updated_at < now() - make_interval(secs => :lease_seconds)
                        """
                    ),
                    {
                        "operation": OPERATION,
                        "lease_seconds": self._limits.stale_in_progress_seconds,
                    },
                )
                existing = (
                    connection.execute(
                        text(
                            """
                        SELECT fingerprint, status, response, turn_ref
                        FROM lesson_tutor_turn_guard
                        WHERE actor_ref = :actor_ref AND operation = :operation
                          AND idempotency_key = :idempotency_key
                        FOR UPDATE
                        """
                        ),
                        {
                            "actor_ref": actor_ref,
                            "operation": OPERATION,
                            "idempotency_key": idempotency_key,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if existing is not None:
                    if existing["fingerprint"] != fingerprint:
                        raise LessonTutorConflictError
                    if existing["status"] == "completed" and existing["response"] is not None:
                        payload = existing["response"]
                        if isinstance(payload, str):
                            payload = json.loads(payload)
                        return GuardAdmission(
                            turn_ref=None,
                            replay=LessonTutorTurnResponse.model_validate(payload),
                        )
                    if existing["status"] != "retryable":
                        raise LessonTutorConflictError

                counts = (
                    connection.execute(
                        text(
                            """
                        SELECT
                          count(*) FILTER (
                            WHERE actor_ref = :actor_ref
                              AND created_at >= now() - make_interval(secs => :burst_window)
                          ) AS burst,
                          count(*) FILTER (WHERE actor_ref = :actor_ref
                            AND status = 'in_progress') AS active,
                          count(*) FILTER (
                            WHERE actor_ref = :actor_ref
                              AND created_at >= (
                                date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                              )
                          ) AS daily,
                          count(*) FILTER (
                            WHERE created_at >= (
                              date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                            )
                          ) AS global_daily
                        FROM lesson_tutor_turn_guard
                        WHERE operation = :operation
                          AND NOT (
                            actor_ref = :actor_ref
                            AND idempotency_key = :idempotency_key
                          )
                          AND (
                            created_at >= LEAST(
                              date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
                              now() - make_interval(secs => :burst_window)
                            )
                            OR (actor_ref = :actor_ref AND status = 'in_progress')
                          )
                        """
                        ),
                        {
                            "actor_ref": actor_ref,
                            "operation": OPERATION,
                            "idempotency_key": idempotency_key,
                            "burst_window": self._limits.burst_window_seconds,
                        },
                    )
                    .mappings()
                    .one()
                )
                if (
                    int(counts["burst"]) >= self._limits.burst
                    or int(counts["active"]) >= self._limits.concurrency
                    or int(counts["daily"]) >= self._limits.daily
                    or int(counts["global_daily"]) >= self._limits.global_daily
                ):
                    raise LessonTutorLimitedError

                if existing is not None:
                    result = connection.execute(
                        text(
                            """
                            UPDATE lesson_tutor_turn_guard
                            SET status = 'in_progress', created_at = now(), updated_at = now()
                            WHERE actor_ref = :actor_ref AND operation = :operation
                              AND idempotency_key = :idempotency_key
                              AND status = 'retryable'
                            """
                        ),
                        {
                            "actor_ref": actor_ref,
                            "operation": OPERATION,
                            "idempotency_key": idempotency_key,
                        },
                    )
                    if result.rowcount != 1:
                        raise DependencyUnavailableError
                    return GuardAdmission(turn_ref=str(existing["turn_ref"]))

                connection.execute(
                    text(
                        """
                        INSERT INTO lesson_tutor_turn_guard
                          (actor_ref, operation, idempotency_key, fingerprint, turn_ref, status)
                        VALUES
                          (
                            :actor_ref, :operation, :idempotency_key,
                            :fingerprint, :turn_ref, 'in_progress'
                          )
                        """
                    ),
                    {
                        "actor_ref": actor_ref,
                        "operation": OPERATION,
                        "idempotency_key": idempotency_key,
                        "fingerprint": fingerprint,
                        "turn_ref": turn_ref,
                    },
                )
            return GuardAdmission(turn_ref=turn_ref)
        except (LessonTutorConflictError, LessonTutorLimitedError):
            raise
        except (IntegrityError, SQLAlchemyError, ValueError, TypeError) as error:
            raise DependencyUnavailableError from error

    def complete(
        self, *, actor_ref: str, idempotency_key: str, response: LessonTutorTurnResponse
    ) -> None:
        self._terminal_update(
            actor_ref=actor_ref,
            idempotency_key=idempotency_key,
            status="completed",
            response=response.model_dump(mode="json"),
        )

    def fail(
        self,
        *,
        actor_ref: str,
        idempotency_key: str,
        outcome: Literal["retryable", "ambiguous"],
    ) -> None:
        self._terminal_update(
            actor_ref=actor_ref,
            idempotency_key=idempotency_key,
            status=outcome,
            response=None,
        )

    def _terminal_update(
        self,
        *,
        actor_ref: str,
        idempotency_key: str,
        status: str,
        response: dict[str, str] | None,
    ) -> None:
        try:
            with self._engine.begin() as connection:
                result = connection.execute(
                    text(
                        """
                        UPDATE lesson_tutor_turn_guard
                        SET status = :status,
                            response = CAST(:response AS jsonb),
                            updated_at = :updated_at
                        WHERE actor_ref = :actor_ref AND operation = :operation
                          AND idempotency_key = :idempotency_key AND status = 'in_progress'
                        """
                    ),
                    {
                        "status": status,
                        "response": json.dumps(response) if response is not None else None,
                        "updated_at": datetime.now(UTC),
                        "actor_ref": actor_ref,
                        "operation": OPERATION,
                        "idempotency_key": idempotency_key,
                    },
                )
                if result.rowcount != 1:
                    raise DependencyUnavailableError
        except DependencyUnavailableError:
            raise
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
