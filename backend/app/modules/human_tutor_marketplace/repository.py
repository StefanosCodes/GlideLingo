"""PostgreSQL persistence for tutor applications and operator review."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import Engine, text
from sqlalchemy.engine import Connection, RowMapping
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.errors import DependencyUnavailableError
from app.modules.human_tutor_marketplace.schemas import (
    CreateTutorApplicationRequest,
    TutorApplicationDecision,
    TutorApplicationStatus,
)


@dataclass(frozen=True, slots=True)
class StoredTutorApplication:
    application_id: UUID
    actor_ref: str
    status: TutorApplicationStatus
    version: int
    headline: str
    biography: str
    time_zone: str
    languages: tuple[str, ...]
    specialties: tuple[str, ...]
    submitted_at: datetime | None
    reviewed_at: datetime | None
    decision_reason: str | None
    reviewer_actor_ref: str | None


class ApplicationAlreadyExistsError(Exception):
    """A different application already belongs to this actor."""


class TutorApplicationRepository(Protocol):
    def get_by_actor(self, *, actor_ref: str) -> StoredTutorApplication | None: ...

    def get_by_id(self, *, application_id: UUID) -> StoredTutorApplication | None: ...

    def create_draft(
        self,
        *,
        application_id: UUID,
        actor_ref: str,
        request: CreateTutorApplicationRequest,
    ) -> StoredTutorApplication: ...

    def submit(self, *, actor_ref: str, expected_version: int) -> StoredTutorApplication | None: ...

    def has_operator_capability(self, *, actor_ref: str, capability: str) -> bool: ...

    def list_review_queue(
        self, *, offset: int, limit: int
    ) -> tuple[list[StoredTutorApplication], bool]: ...

    def start_review(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        expected_version: int,
    ) -> StoredTutorApplication | None: ...

    def decide(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        decision: TutorApplicationDecision,
        reason: str,
        expected_version: int,
    ) -> StoredTutorApplication | None: ...


class PostgresTutorApplicationRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def get_by_actor(self, *, actor_ref: str) -> StoredTutorApplication | None:
        try:
            with self._engine.connect() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            SELECT application_id, actor_ref, status, version, headline,
                                   biography, time_zone, submitted_at, reviewed_at,
                                   decision_reason, reviewer_actor_ref
                            FROM marketplace_tutor_application
                            WHERE actor_ref = :actor_ref
                            """
                        ),
                        {"actor_ref": actor_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                return self._hydrate(connection, row) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_by_id(self, *, application_id: UUID) -> StoredTutorApplication | None:
        try:
            with self._engine.connect() as connection:
                row = self._get_row(connection, application_id=application_id)
                return self._hydrate(connection, row) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def create_draft(
        self,
        *,
        application_id: UUID,
        actor_ref: str,
        request: CreateTutorApplicationRequest,
    ) -> StoredTutorApplication:
        try:
            with self._engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        INSERT INTO marketplace_tutor_application
                          (application_id, actor_ref, status, version, headline, biography,
                           time_zone)
                        VALUES
                          (:application_id, :actor_ref, 'draft', 1, :headline, :biography,
                           :time_zone)
                        """
                    ),
                    {
                        "application_id": application_id,
                        "actor_ref": actor_ref,
                        "headline": request.headline,
                        "biography": request.biography,
                        "time_zone": request.time_zone,
                    },
                )
                self._insert_ranked_values(
                    connection,
                    table="marketplace_tutor_application_language",
                    column="language_code",
                    application_id=application_id,
                    values=request.languages,
                )
                self._insert_ranked_values(
                    connection,
                    table="marketplace_tutor_application_specialty",
                    column="specialty",
                    application_id=application_id,
                    values=request.specialties,
                )
                self._insert_audit(
                    connection,
                    application_id=application_id,
                    actor_ref=actor_ref,
                    action="application_created",
                    from_status=None,
                    to_status="draft",
                    reason=None,
                )
                row = self._get_row(connection, application_id=application_id)
                assert row is not None
                return self._hydrate(connection, row)
        except IntegrityError as error:
            raise ApplicationAlreadyExistsError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def submit(self, *, actor_ref: str, expected_version: int) -> StoredTutorApplication | None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_application
                            SET status = 'submitted',
                                submitted_at = now(),
                                version = version + 1,
                                updated_at = now()
                            WHERE actor_ref = :actor_ref
                              AND status = 'draft'
                              AND version = :expected_version
                            RETURNING application_id, actor_ref, status, version, headline,
                                      biography, time_zone, submitted_at, reviewed_at,
                                      decision_reason, reviewer_actor_ref
                            """
                        ),
                        {"actor_ref": actor_ref, "expected_version": expected_version},
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                self._insert_audit(
                    connection,
                    application_id=row["application_id"],
                    actor_ref=actor_ref,
                    action="application_submitted",
                    from_status="draft",
                    to_status="submitted",
                    reason=None,
                )
                return self._hydrate(connection, row)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def has_operator_capability(self, *, actor_ref: str, capability: str) -> bool:
        try:
            with self._engine.connect() as connection:
                return bool(
                    connection.execute(
                        text(
                            """
                            SELECT EXISTS (
                              SELECT 1
                              FROM marketplace_operator_capability
                              WHERE actor_ref = :actor_ref
                                AND capability = :capability
                                AND revoked_at IS NULL
                            )
                            """
                        ),
                        {"actor_ref": actor_ref, "capability": capability},
                    ).scalar_one()
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def list_review_queue(
        self, *, offset: int, limit: int
    ) -> tuple[list[StoredTutorApplication], bool]:
        try:
            with self._engine.connect() as connection:
                rows = (
                    connection.execute(
                        text(
                            """
                            SELECT application_id, actor_ref, status, version, headline,
                                   biography, time_zone, submitted_at, reviewed_at,
                                   decision_reason, reviewer_actor_ref
                            FROM marketplace_tutor_application
                            WHERE status IN ('submitted', 'under_review')
                            ORDER BY submitted_at ASC, application_id ASC
                            OFFSET :offset
                            LIMIT :fetch_limit
                            """
                        ),
                        {"offset": offset, "fetch_limit": limit + 1},
                    )
                    .mappings()
                    .all()
                )
                hydrated = [self._hydrate(connection, row) for row in rows[:limit]]
                return hydrated, len(rows) > limit
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def start_review(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        expected_version: int,
    ) -> StoredTutorApplication | None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_application
                            SET status = 'under_review',
                                reviewer_actor_ref = :operator_actor_ref,
                                version = version + 1,
                                updated_at = now()
                            WHERE application_id = :application_id
                              AND status = 'submitted'
                              AND version = :expected_version
                              AND actor_ref <> :operator_actor_ref
                              AND EXISTS (
                                SELECT 1
                                FROM marketplace_operator_capability
                                WHERE actor_ref = :operator_actor_ref
                                  AND capability = 'review_tutor_applications'
                                  AND revoked_at IS NULL
                              )
                            RETURNING application_id, actor_ref, status, version, headline,
                                      biography, time_zone, submitted_at, reviewed_at,
                                      decision_reason, reviewer_actor_ref
                            """
                        ),
                        {
                            "application_id": application_id,
                            "operator_actor_ref": operator_actor_ref,
                            "expected_version": expected_version,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                self._insert_audit(
                    connection,
                    application_id=application_id,
                    actor_ref=operator_actor_ref,
                    action="application_review_started",
                    from_status="submitted",
                    to_status="under_review",
                    reason=None,
                )
                return self._hydrate(connection, row)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def decide(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        decision: TutorApplicationDecision,
        reason: str,
        expected_version: int,
    ) -> StoredTutorApplication | None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_application
                            SET status = :decision,
                                reviewed_at = now(),
                                decision_reason = :reason,
                                reviewer_actor_ref = :operator_actor_ref,
                                version = version + 1,
                                updated_at = now()
                            WHERE application_id = :application_id
                              AND status = 'under_review'
                              AND version = :expected_version
                              AND actor_ref <> :operator_actor_ref
                              AND EXISTS (
                                SELECT 1
                                FROM marketplace_operator_capability
                                WHERE actor_ref = :operator_actor_ref
                                  AND capability = 'review_tutor_applications'
                                  AND revoked_at IS NULL
                              )
                            RETURNING application_id, actor_ref, status, version, headline,
                                      biography, time_zone, submitted_at, reviewed_at,
                                      decision_reason, reviewer_actor_ref
                            """
                        ),
                        {
                            "application_id": application_id,
                            "operator_actor_ref": operator_actor_ref,
                            "decision": decision,
                            "reason": reason,
                            "expected_version": expected_version,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                if decision == "approved":
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_tutor_profile
                              (tutor_id, application_id, actor_ref, headline, biography, time_zone)
                            VALUES
                              (:tutor_id, :application_id, :actor_ref, :headline, :biography,
                               :time_zone)
                            ON CONFLICT (application_id) DO NOTHING
                            """
                        ),
                        {
                            "tutor_id": uuid4(),
                            "application_id": application_id,
                            "actor_ref": row["actor_ref"],
                            "headline": row["headline"],
                            "biography": row["biography"],
                            "time_zone": row["time_zone"],
                        },
                    )
                self._insert_audit(
                    connection,
                    application_id=application_id,
                    actor_ref=operator_actor_ref,
                    action="application_decided",
                    from_status="under_review",
                    to_status=decision,
                    reason=reason,
                )
                return self._hydrate(connection, row)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    @staticmethod
    def _get_row(connection: Connection, *, application_id: UUID) -> RowMapping | None:
        return (
            connection.execute(
                text(
                    """
                SELECT application_id, actor_ref, status, version, headline, biography,
                       time_zone, submitted_at, reviewed_at, decision_reason,
                       reviewer_actor_ref
                FROM marketplace_tutor_application
                WHERE application_id = :application_id
                """
                ),
                {"application_id": application_id},
            )
            .mappings()
            .one_or_none()
        )

    @classmethod
    def _hydrate(cls, connection: Connection, row: RowMapping) -> StoredTutorApplication:
        languages = cls._ranked_values(
            connection,
            table="marketplace_tutor_application_language",
            column="language_code",
            application_id=row["application_id"],
        )
        specialties = cls._ranked_values(
            connection,
            table="marketplace_tutor_application_specialty",
            column="specialty",
            application_id=row["application_id"],
        )
        return StoredTutorApplication(
            application_id=row["application_id"],
            actor_ref=row["actor_ref"],
            status=row["status"],
            version=row["version"],
            headline=row["headline"],
            biography=row["biography"],
            time_zone=row["time_zone"],
            languages=languages,
            specialties=specialties,
            submitted_at=row["submitted_at"],
            reviewed_at=row["reviewed_at"],
            decision_reason=row["decision_reason"],
            reviewer_actor_ref=row["reviewer_actor_ref"],
        )

    @staticmethod
    def _ranked_values(
        connection: Connection,
        *,
        table: str,
        column: str,
        application_id: UUID,
    ) -> tuple[str, ...]:
        result = connection.execute(
            text(
                f"SELECT {column} FROM {table} "
                "WHERE application_id = :application_id ORDER BY position ASC"
            ),
            {"application_id": application_id},
        )
        return tuple(result.scalars().all())

    @staticmethod
    def _insert_ranked_values(
        connection: Connection,
        *,
        table: str,
        column: str,
        application_id: UUID,
        values: list[str],
    ) -> None:
        statement = text(
            f"INSERT INTO {table} (application_id, position, {column}) "
            f"VALUES (:application_id, :position, :{column})"
        )
        connection.execute(
            statement,
            [
                {"application_id": application_id, "position": index, column: value}
                for index, value in enumerate(values)
            ],
        )

    @staticmethod
    def _insert_audit(
        connection: Connection,
        *,
        application_id: UUID,
        actor_ref: str,
        action: str,
        from_status: str | None,
        to_status: str,
        reason: str | None,
    ) -> None:
        connection.execute(
            text(
                """
                INSERT INTO marketplace_audit_event
                  (audit_id, application_id, actor_ref, action, from_status, to_status, reason)
                VALUES
                  (:audit_id, :application_id, :actor_ref, :action, :from_status, :to_status,
                   :reason)
                """
            ),
            {
                "audit_id": uuid4(),
                "application_id": application_id,
                "actor_ref": actor_ref,
                "action": action,
                "from_status": from_status,
                "to_status": to_status,
                "reason": reason,
            },
        )
