"""Public discovery, favorites, and tutor-owned manual availability."""

import asyncio
import base64
import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from typing import Literal, Protocol, cast
from uuid import UUID, uuid4

from sqlalchemy import Engine, text
from sqlalchemy.engine import Connection, RowMapping
from sqlalchemy.exc import SQLAlchemyError

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    DependencyUnavailableError,
    HumanTutorMarketplaceForbiddenError,
    HumanTutorMarketplaceUnavailableError,
    TutorApplicationConflictError,
    TutorApplicationNotFoundError,
)
from app.modules.human_tutor_marketplace.availability import (
    AvailabilityException,
    AvailabilityRule,
    TimeInterval,
    derive_slots,
)
from app.modules.human_tutor_marketplace.calendar import (
    CalendarBusySnapshot,
    CalendarRepository,
)
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref
from app.modules.human_tutor_marketplace.schemas import (
    AvailabilityExceptionResponse,
    AvailabilityRuleResponse,
    ManualAvailabilityResponse,
    PublicTutorResponse,
    ReplaceManualAvailabilityRequest,
    TutorSearchResponse,
    TutorSlotResponse,
    TutorSlotsResponse,
)


@dataclass(frozen=True, slots=True)
class StoredAvailabilityRule:
    rule_id: UUID
    weekday: int
    start_local: time
    end_local: time
    effective_from: date
    effective_until: date | None
    time_zone: str


@dataclass(frozen=True, slots=True)
class StoredAvailabilityException:
    exception_id: UUID
    local_date: date
    start_local: time
    end_local: time
    kind: str
    time_zone: str


@dataclass(frozen=True, slots=True)
class StoredManualAvailability:
    tutor_id: UUID
    profile_version: int
    time_zone: str
    lead_time_minutes: int
    buffer_before_minutes: int
    buffer_after_minutes: int
    dialects: tuple[str, ...]
    rules: tuple[StoredAvailabilityRule, ...]
    exceptions: tuple[StoredAvailabilityException, ...]
    duration_minutes: int | None


@dataclass(frozen=True, slots=True)
class StoredPublicTutor:
    tutor_id: UUID
    headline: str
    biography: str
    time_zone: str
    languages: tuple[str, ...]
    dialects: tuple[str, ...]
    specialties: tuple[str, ...]
    verified_credentials: tuple[str, ...]
    offering_id: UUID
    offering_title: str
    duration_minutes: int
    amount_minor: int
    currency: str
    rating: float | None
    rating_count: int
    is_favorite: bool


class DiscoveryRepository(Protocol):
    def get_manual_availability_by_actor(
        self, *, actor_ref: str
    ) -> StoredManualAvailability | None: ...

    def get_manual_availability_by_tutor(
        self, *, tutor_id: UUID, require_public: bool
    ) -> StoredManualAvailability | None: ...

    def replace_manual_availability(
        self, *, actor_ref: str, request: ReplaceManualAvailabilityRequest
    ) -> StoredManualAvailability | None: ...

    def list_public_tutors(
        self,
        *,
        learner_actor_ref: str,
        language: str | None,
        dialect: str | None,
        specialty: str | None,
        duration_minutes: int | None,
        maximum_amount_minor: int | None,
        verified_credential: bool,
    ) -> list[StoredPublicTutor]: ...

    def get_public_tutor(
        self, *, learner_actor_ref: str, tutor_id: UUID
    ) -> StoredPublicTutor | None: ...

    def set_favorite(self, *, learner_actor_ref: str, tutor_id: UUID, favorite: bool) -> bool: ...


class BookingBusyReader(Protocol):
    def list_internal_busy(
        self, *, tutor_id: UUID, starts_at: datetime, ends_at: datetime
    ) -> tuple[TimeInterval, ...]: ...


class PostgresDiscoveryRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def get_manual_availability_by_actor(
        self, *, actor_ref: str
    ) -> StoredManualAvailability | None:
        try:
            with self._engine.connect() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                        SELECT profile.tutor_id, profile.version AS profile_version,
                               profile.time_zone, profile.lead_time_minutes,
                               profile.buffer_before_minutes, profile.buffer_after_minutes,
                               offering.duration_minutes
                        FROM marketplace_tutor_profile AS profile
                        JOIN marketplace_tutor_application AS application
                          ON application.application_id = profile.application_id
                        LEFT JOIN marketplace_tutor_offering AS offering
                          ON offering.tutor_id = profile.tutor_id
                        WHERE profile.actor_ref = :actor_ref
                          AND application.status = 'approved'
                        """
                        ),
                        {"actor_ref": actor_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                return self._hydrate_schedule(connection, row) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_manual_availability_by_tutor(
        self, *, tutor_id: UUID, require_public: bool
    ) -> StoredManualAvailability | None:
        eligibility = (
            "AND application.status = 'approved' AND profile.is_published "
            "AND profile.payout_ready AND offering.state = 'active'"
            if require_public
            else ""
        )
        try:
            with self._engine.connect() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                        SELECT profile.tutor_id, profile.version AS profile_version,
                               profile.time_zone, profile.lead_time_minutes,
                               profile.buffer_before_minutes, profile.buffer_after_minutes,
                               offering.duration_minutes
                        FROM marketplace_tutor_profile AS profile
                        JOIN marketplace_tutor_application AS application
                          ON application.application_id = profile.application_id
                        LEFT JOIN marketplace_tutor_offering AS offering
                          ON offering.tutor_id = profile.tutor_id
                        WHERE profile.tutor_id = :tutor_id
                        """
                            + eligibility
                        ),
                        {"tutor_id": tutor_id},
                    )
                    .mappings()
                    .one_or_none()
                )
                return self._hydrate_schedule(connection, row) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def replace_manual_availability(
        self, *, actor_ref: str, request: ReplaceManualAvailabilityRequest
    ) -> StoredManualAvailability | None:
        try:
            with self._engine.begin() as connection:
                profile = (
                    connection.execute(
                        text(
                            """
                        SELECT profile.tutor_id, profile.time_zone
                        FROM marketplace_tutor_profile AS profile
                        JOIN marketplace_tutor_application AS application
                          ON application.application_id = profile.application_id
                        WHERE profile.actor_ref = :actor_ref
                          AND profile.version = :expected_version
                          AND application.status = 'approved'
                        FOR UPDATE OF profile
                        """
                        ),
                        {
                            "actor_ref": actor_ref,
                            "expected_version": request.expected_profile_version,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if profile is None:
                    return None
                tutor_id = profile["tutor_id"]
                connection.execute(
                    text(
                        """
                        UPDATE marketplace_tutor_profile
                        SET lead_time_minutes = :lead_time,
                            buffer_before_minutes = :buffer_before,
                            buffer_after_minutes = :buffer_after,
                            version = version + 1,
                            updated_at = now()
                        WHERE tutor_id = :tutor_id
                        """
                    ),
                    {
                        "tutor_id": tutor_id,
                        "lead_time": request.lead_time_minutes,
                        "buffer_before": request.buffer_before_minutes,
                        "buffer_after": request.buffer_after_minutes,
                    },
                )
                for table in (
                    "marketplace_tutor_dialect",
                    "marketplace_availability_rule",
                    "marketplace_availability_exception",
                ):
                    connection.execute(
                        text(f"DELETE FROM {table} WHERE tutor_id = :tutor_id"),
                        {"tutor_id": tutor_id},
                    )
                if request.dialects:
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_tutor_dialect (tutor_id, position, dialect_code)
                            VALUES (:tutor_id, :position, :dialect_code)
                            """
                        ),
                        [
                            {"tutor_id": tutor_id, "position": index, "dialect_code": value}
                            for index, value in enumerate(request.dialects)
                        ],
                    )
                if request.rules:
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_availability_rule
                              (rule_id, tutor_id, weekday, start_local, end_local,
                               effective_from, effective_until, time_zone)
                            VALUES
                              (:rule_id, :tutor_id, :weekday, :start_local, :end_local,
                               :effective_from, :effective_until, :time_zone)
                            """
                        ),
                        [
                            {
                                "rule_id": uuid4(),
                                "tutor_id": tutor_id,
                                "weekday": rule.weekday,
                                "start_local": rule.start_local,
                                "end_local": rule.end_local,
                                "effective_from": rule.effective_from,
                                "effective_until": rule.effective_until,
                                "time_zone": profile["time_zone"],
                            }
                            for rule in request.rules
                        ],
                    )
                if request.exceptions:
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_availability_exception
                              (exception_id, tutor_id, local_date, start_local, end_local,
                               kind, time_zone)
                            VALUES
                              (:exception_id, :tutor_id, :local_date, :start_local, :end_local,
                               :kind, :time_zone)
                            """
                        ),
                        [
                            {
                                "exception_id": uuid4(),
                                "tutor_id": tutor_id,
                                "local_date": exception.local_date,
                                "start_local": exception.start_local,
                                "end_local": exception.end_local,
                                "kind": exception.kind,
                                "time_zone": profile["time_zone"],
                            }
                            for exception in request.exceptions
                        ],
                    )
                row = (
                    connection.execute(
                        text(
                            """
                        SELECT profile.tutor_id, profile.version AS profile_version,
                               profile.time_zone, profile.lead_time_minutes,
                               profile.buffer_before_minutes, profile.buffer_after_minutes,
                               offering.duration_minutes
                        FROM marketplace_tutor_profile AS profile
                        LEFT JOIN marketplace_tutor_offering AS offering
                          ON offering.tutor_id = profile.tutor_id
                        WHERE profile.tutor_id = :tutor_id
                        """
                        ),
                        {"tutor_id": tutor_id},
                    )
                    .mappings()
                    .one()
                )
                return self._hydrate_schedule(connection, row)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def list_public_tutors(
        self,
        *,
        learner_actor_ref: str,
        language: str | None,
        dialect: str | None,
        specialty: str | None,
        duration_minutes: int | None,
        maximum_amount_minor: int | None,
        verified_credential: bool,
    ) -> list[StoredPublicTutor]:
        conditions = [
            "application.status = 'approved'",
            "profile.is_published",
            "profile.payout_ready",
            "offering.state = 'active'",
        ]
        parameters: dict[str, object] = {"learner_actor_ref": learner_actor_ref}
        if language is not None:
            conditions.append(
                "EXISTS (SELECT 1 FROM marketplace_tutor_application_language language "
                "WHERE language.application_id = application.application_id "
                "AND language.language_code = :language)"
            )
            parameters["language"] = language.lower()
        if dialect is not None:
            conditions.append(
                "EXISTS (SELECT 1 FROM marketplace_tutor_dialect dialect "
                "WHERE dialect.tutor_id = profile.tutor_id AND dialect.dialect_code = :dialect)"
            )
            parameters["dialect"] = dialect.lower()
        if specialty is not None:
            conditions.append(
                "EXISTS (SELECT 1 FROM marketplace_tutor_application_specialty specialty "
                "WHERE specialty.application_id = application.application_id "
                "AND lower(specialty.specialty) = lower(:specialty))"
            )
            parameters["specialty"] = specialty
        if duration_minutes is not None:
            conditions.append("offering.duration_minutes = :duration_minutes")
            parameters["duration_minutes"] = duration_minutes
        if maximum_amount_minor is not None:
            conditions.append("offering.amount_minor <= :maximum_amount_minor")
            parameters["maximum_amount_minor"] = maximum_amount_minor
        if verified_credential:
            conditions.append("credential.verification_status = 'verified'")
        try:
            with self._engine.connect() as connection:
                rows = (
                    connection.execute(
                        text(
                            """
                        SELECT profile.tutor_id, profile.headline, profile.biography,
                               profile.time_zone, profile.application_id,
                               offering.offering_id, offering.title AS offering_title,
                               offering.duration_minutes, offering.amount_minor, offering.currency,
                               credential.title AS credential_title,
                               review.rating, review.rating_count,
                               EXISTS (
                                 SELECT 1 FROM marketplace_tutor_favorite favorite
                                 WHERE favorite.learner_actor_ref = :learner_actor_ref
                                   AND favorite.tutor_id = profile.tutor_id
                               ) AS is_favorite
                        FROM marketplace_tutor_profile AS profile
                        JOIN marketplace_tutor_application AS application
                          ON application.application_id = profile.application_id
                        JOIN marketplace_tutor_offering AS offering
                          ON offering.tutor_id = profile.tutor_id
                        LEFT JOIN marketplace_tutor_credential AS credential
                          ON credential.tutor_id = profile.tutor_id
                         AND credential.verification_status = 'verified'
                        LEFT JOIN LATERAL (
                          SELECT avg(published.rating)::double precision AS rating,
                                 count(*)::integer AS rating_count
                          FROM marketplace_booking_review AS published
                          WHERE published.tutor_id = profile.tutor_id
                            AND published.moderation_state = 'published'
                        ) AS review ON true
                        WHERE """
                            + " AND ".join(conditions)
                            + " ORDER BY lower(profile.headline), profile.tutor_id LIMIT 201"
                        ),
                        parameters,
                    )
                    .mappings()
                    .all()
                )
                return [self._hydrate_public(connection, row) for row in rows]
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_public_tutor(
        self, *, learner_actor_ref: str, tutor_id: UUID
    ) -> StoredPublicTutor | None:
        try:
            with self._engine.connect() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                        SELECT profile.tutor_id, profile.headline, profile.biography,
                               profile.time_zone, profile.application_id,
                               offering.offering_id, offering.title AS offering_title,
                               offering.duration_minutes, offering.amount_minor, offering.currency,
                               credential.title AS credential_title,
                               review.rating, review.rating_count,
                               EXISTS (
                                 SELECT 1 FROM marketplace_tutor_favorite favorite
                                 WHERE favorite.learner_actor_ref = :learner_actor_ref
                                   AND favorite.tutor_id = profile.tutor_id
                               ) AS is_favorite
                        FROM marketplace_tutor_profile AS profile
                        JOIN marketplace_tutor_application AS application
                          ON application.application_id = profile.application_id
                        JOIN marketplace_tutor_offering AS offering
                          ON offering.tutor_id = profile.tutor_id
                        LEFT JOIN marketplace_tutor_credential AS credential
                          ON credential.tutor_id = profile.tutor_id
                         AND credential.verification_status = 'verified'
                        LEFT JOIN LATERAL (
                          SELECT avg(published.rating)::double precision AS rating,
                                 count(*)::integer AS rating_count
                          FROM marketplace_booking_review AS published
                          WHERE published.tutor_id = profile.tutor_id
                            AND published.moderation_state = 'published'
                        ) AS review ON true
                        WHERE profile.tutor_id = :tutor_id
                          AND application.status = 'approved'
                          AND profile.is_published AND profile.payout_ready
                          AND offering.state = 'active'
                        """
                        ),
                        {"learner_actor_ref": learner_actor_ref, "tutor_id": tutor_id},
                    )
                    .mappings()
                    .one_or_none()
                )
                return self._hydrate_public(connection, row) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def set_favorite(self, *, learner_actor_ref: str, tutor_id: UUID, favorite: bool) -> bool:
        try:
            with self._engine.begin() as connection:
                eligible = connection.execute(
                    text(
                        """
                        SELECT 1
                        FROM marketplace_tutor_profile AS profile
                        JOIN marketplace_tutor_application AS application
                          ON application.application_id = profile.application_id
                        JOIN marketplace_tutor_offering AS offering
                          ON offering.tutor_id = profile.tutor_id
                        WHERE profile.tutor_id = :tutor_id
                          AND application.status = 'approved'
                          AND profile.is_published AND profile.payout_ready
                          AND offering.state = 'active'
                        """
                    ),
                    {"tutor_id": tutor_id},
                ).scalar_one_or_none()
                if eligible is None:
                    return False
                if favorite:
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_tutor_favorite (learner_actor_ref, tutor_id)
                            VALUES (:learner_actor_ref, :tutor_id)
                            ON CONFLICT DO NOTHING
                            """
                        ),
                        {"learner_actor_ref": learner_actor_ref, "tutor_id": tutor_id},
                    )
                else:
                    connection.execute(
                        text(
                            """
                            DELETE FROM marketplace_tutor_favorite
                            WHERE learner_actor_ref = :learner_actor_ref AND tutor_id = :tutor_id
                            """
                        ),
                        {"learner_actor_ref": learner_actor_ref, "tutor_id": tutor_id},
                    )
                return True
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def list_internal_busy(
        self, *, tutor_id: UUID, starts_at: datetime, ends_at: datetime
    ) -> tuple[TimeInterval, ...]:
        try:
            with self._engine.connect() as connection:
                return tuple(
                    TimeInterval(starts_at=row.starts_at, ends_at=row.ends_at)
                    for row in connection.execute(
                        text(
                            """
                            SELECT starts_at, ends_at
                            FROM marketplace_booking
                            WHERE tutor_id = :tutor_id
                              AND state IN (
                                'held', 'payment_pending', 'payment_ambiguous', 'confirmed'
                              )
                              AND tstzrange(starts_at, ends_at, '[)')
                                  && tstzrange(:starts_at, :ends_at, '[)')
                            ORDER BY starts_at, ends_at, booking_id
                            """
                        ),
                        {"tutor_id": tutor_id, "starts_at": starts_at, "ends_at": ends_at},
                    )
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    @classmethod
    def _hydrate_schedule(cls, connection: Connection, row: RowMapping) -> StoredManualAvailability:
        tutor_id = row["tutor_id"]
        dialects = tuple(
            connection.execute(
                text(
                    "SELECT dialect_code FROM marketplace_tutor_dialect "
                    "WHERE tutor_id = :tutor_id ORDER BY position"
                ),
                {"tutor_id": tutor_id},
            ).scalars()
        )
        rules = tuple(
            StoredAvailabilityRule(**dict(rule))
            for rule in connection.execute(
                text(
                    """
                    SELECT rule_id, weekday, start_local, end_local, effective_from,
                           effective_until, time_zone
                    FROM marketplace_availability_rule
                    WHERE tutor_id = :tutor_id AND enabled
                    ORDER BY weekday, start_local, rule_id
                    """
                ),
                {"tutor_id": tutor_id},
            ).mappings()
        )
        exceptions = tuple(
            StoredAvailabilityException(**dict(exception))
            for exception in connection.execute(
                text(
                    """
                    SELECT exception_id, local_date, start_local, end_local, kind, time_zone
                    FROM marketplace_availability_exception
                    WHERE tutor_id = :tutor_id
                    ORDER BY local_date, start_local, exception_id
                    """
                ),
                {"tutor_id": tutor_id},
            ).mappings()
        )
        return StoredManualAvailability(
            tutor_id=tutor_id,
            profile_version=row["profile_version"],
            time_zone=row["time_zone"],
            lead_time_minutes=row["lead_time_minutes"],
            buffer_before_minutes=row["buffer_before_minutes"],
            buffer_after_minutes=row["buffer_after_minutes"],
            dialects=dialects,
            rules=rules,
            exceptions=exceptions,
            duration_minutes=row["duration_minutes"],
        )

    @classmethod
    def _hydrate_public(cls, connection: Connection, row: RowMapping) -> StoredPublicTutor:
        application_id = row["application_id"]
        tutor_id = row["tutor_id"]
        languages = cls._ranked_values(
            connection,
            "marketplace_tutor_application_language",
            "language_code",
            "application_id",
            application_id,
        )
        specialties = cls._ranked_values(
            connection,
            "marketplace_tutor_application_specialty",
            "specialty",
            "application_id",
            application_id,
        )
        dialects = cls._ranked_values(
            connection,
            "marketplace_tutor_dialect",
            "dialect_code",
            "tutor_id",
            tutor_id,
        )
        credentials = (row["credential_title"],) if row["credential_title"] is not None else ()
        return StoredPublicTutor(
            tutor_id=tutor_id,
            headline=row["headline"],
            biography=row["biography"],
            time_zone=row["time_zone"],
            languages=languages,
            dialects=dialects,
            specialties=specialties,
            verified_credentials=credentials,
            offering_id=row["offering_id"],
            offering_title=row["offering_title"],
            duration_minutes=row["duration_minutes"],
            amount_minor=row["amount_minor"],
            currency=row["currency"],
            rating=row["rating"],
            rating_count=row["rating_count"],
            is_favorite=row["is_favorite"],
        )

    @staticmethod
    def _ranked_values(
        connection: Connection,
        table: str,
        column: str,
        key: str,
        value: UUID,
    ) -> tuple[str, ...]:
        return tuple(
            connection.execute(
                text(f"SELECT {column} FROM {table} WHERE {key} = :value ORDER BY position"),
                {"value": value},
            ).scalars()
        )


class MarketplaceDiscoveryService:
    def __init__(
        self,
        *,
        repository: DiscoveryRepository,
        calendar_busy_reader: CalendarRepository | None = None,
        booking_busy_reader: BookingBusyReader | None = None,
        pseudonym_key: bytes | None,
        actor_allowlist: tuple[str, ...],
        acquisition_enabled: bool = True,
    ) -> None:
        self._repository = repository
        self._calendar_busy_reader = calendar_busy_reader
        self._booking_busy_reader = booking_busy_reader
        self._pseudonym_key = pseudonym_key
        self._actor_allowlist = frozenset(actor_allowlist)
        self._acquisition_enabled = acquisition_enabled

    async def get_own_availability(
        self, *, principal: ClerkPrincipal
    ) -> ManualAvailabilityResponse:
        schedule = await asyncio.to_thread(
            self._repository.get_manual_availability_by_actor,
            actor_ref=self._actor_ref(principal),
        )
        if schedule is None:
            raise TutorApplicationNotFoundError
        return self._availability_response(schedule)

    async def replace_own_availability(
        self, *, principal: ClerkPrincipal, request: ReplaceManualAvailabilityRequest
    ) -> ManualAvailabilityResponse:
        actor_ref = self._actor_ref(principal)
        schedule = await asyncio.to_thread(
            self._repository.replace_manual_availability,
            actor_ref=actor_ref,
            request=request,
        )
        if schedule is None:
            current = await asyncio.to_thread(
                self._repository.get_manual_availability_by_actor, actor_ref=actor_ref
            )
            if current is None:
                raise TutorApplicationNotFoundError
            raise TutorApplicationConflictError
        return self._availability_response(schedule)

    async def list_tutors(
        self,
        *,
        principal: ClerkPrincipal,
        language: str | None,
        dialect: str | None,
        specialty: str | None,
        duration_minutes: int | None,
        maximum_amount_minor: int | None,
        verified_credential: bool,
        favorite: bool,
        available_before: datetime | None,
        cursor: str | None,
        limit: int,
    ) -> TutorSearchResponse:
        self._require_acquisition()
        actor_ref = self._actor_ref(principal)
        tutors = await asyncio.to_thread(
            self._repository.list_public_tutors,
            learner_actor_ref=actor_ref,
            language=language,
            dialect=dialect,
            specialty=specialty,
            duration_minutes=duration_minutes,
            maximum_amount_minor=maximum_amount_minor,
            verified_credential=verified_credential,
        )
        if favorite:
            tutors = [tutor for tutor in tutors if tutor.is_favorite]
        cursor_value = self._decode_cursor(cursor) if cursor is not None else None
        if cursor_value is not None:
            tutors = [
                tutor
                for tutor in tutors
                if (tutor.headline.casefold(), str(tutor.tutor_id)) > cursor_value
            ]
        if available_before is not None:
            now = datetime.now(UTC)
            available: list[StoredPublicTutor] = []
            for tutor in tutors:
                schedule = await asyncio.to_thread(
                    self._repository.get_manual_availability_by_tutor,
                    tutor_id=tutor.tutor_id,
                    require_public=True,
                )
                if schedule is not None and schedule.duration_minutes is not None:
                    calendar = await self._busy_snapshot(tutor_id=tutor.tutor_id, now=now)
                    if calendar.freshness in {"stale", "reconnect_required"}:
                        continue
                    slots = self._derive(
                        schedule,
                        now=now,
                        starts_at=now,
                        ends_at=available_before,
                        limit=1,
                        busy_intervals=calendar.intervals
                        + await self._internal_busy(
                            tutor_id=tutor.tutor_id, starts_at=now, ends_at=available_before
                        ),
                    )
                    if slots:
                        available.append(tutor)
            tutors = available
        page = tutors[:limit]
        next_cursor = self._encode_cursor(page[-1]) if len(tutors) > limit and page else None
        return TutorSearchResponse(
            items=[self._public_response(tutor) for tutor in page],
            next_cursor=next_cursor,
        )

    async def get_tutor(self, *, principal: ClerkPrincipal, tutor_id: UUID) -> PublicTutorResponse:
        self._require_acquisition()
        tutor = await asyncio.to_thread(
            self._repository.get_public_tutor,
            learner_actor_ref=self._actor_ref(principal),
            tutor_id=tutor_id,
        )
        if tutor is None:
            raise TutorApplicationNotFoundError
        return self._public_response(tutor)

    async def set_favorite(
        self, *, principal: ClerkPrincipal, tutor_id: UUID, favorite: bool
    ) -> PublicTutorResponse:
        self._require_acquisition()
        actor_ref = self._actor_ref(principal)
        updated = await asyncio.to_thread(
            self._repository.set_favorite,
            learner_actor_ref=actor_ref,
            tutor_id=tutor_id,
            favorite=favorite,
        )
        if not updated:
            raise TutorApplicationNotFoundError
        tutor = await asyncio.to_thread(
            self._repository.get_public_tutor,
            learner_actor_ref=actor_ref,
            tutor_id=tutor_id,
        )
        if tutor is None:
            raise TutorApplicationNotFoundError
        return self._public_response(tutor)

    async def list_slots(
        self,
        *,
        principal: ClerkPrincipal,
        tutor_id: UUID,
        starts_at: datetime,
        ends_at: datetime,
        limit: int,
    ) -> TutorSlotsResponse:
        self._require_acquisition()
        self._actor_ref(principal)
        schedule = await asyncio.to_thread(
            self._repository.get_manual_availability_by_tutor,
            tutor_id=tutor_id,
            require_public=True,
        )
        if schedule is None or schedule.duration_minutes is None:
            raise TutorApplicationNotFoundError
        now = datetime.now(UTC)
        calendar = await self._busy_snapshot(tutor_id=tutor_id, now=now)
        if calendar.freshness in {"stale", "reconnect_required"}:
            return TutorSlotsResponse(
                tutor_id=tutor_id,
                time_zone=schedule.time_zone,
                source="manual+google",
                freshness=cast(
                    Literal["current", "stale", "reconnect_required"], calendar.freshness
                ),
                slots=[],
            )
        slots = self._derive(
            schedule,
            now=now,
            starts_at=starts_at,
            ends_at=ends_at,
            limit=limit,
            busy_intervals=calendar.intervals
            + await self._internal_busy(tutor_id=tutor_id, starts_at=starts_at, ends_at=ends_at),
        )
        return TutorSlotsResponse(
            tutor_id=tutor_id,
            time_zone=schedule.time_zone,
            source="manual+google" if calendar.freshness != "not_connected" else "manual",
            slots=[
                TutorSlotResponse(starts_at=slot.starts_at, ends_at=slot.ends_at) for slot in slots
            ],
        )

    async def preview_own_slots(
        self,
        *,
        principal: ClerkPrincipal,
        starts_at: datetime,
        ends_at: datetime,
        limit: int,
    ) -> TutorSlotsResponse:
        schedule = await asyncio.to_thread(
            self._repository.get_manual_availability_by_actor,
            actor_ref=self._actor_ref(principal),
        )
        if schedule is None:
            raise TutorApplicationNotFoundError
        if schedule.duration_minutes is None:
            return TutorSlotsResponse(
                tutor_id=schedule.tutor_id,
                time_zone=schedule.time_zone,
                slots=[],
            )
        now = datetime.now(UTC)
        calendar = await self._busy_snapshot(tutor_id=schedule.tutor_id, now=now)
        if calendar.freshness in {"stale", "reconnect_required"}:
            return TutorSlotsResponse(
                tutor_id=schedule.tutor_id,
                time_zone=schedule.time_zone,
                source="manual+google",
                freshness=cast(
                    Literal["current", "stale", "reconnect_required"], calendar.freshness
                ),
                slots=[],
            )
        slots = self._derive(
            schedule,
            now=now,
            starts_at=starts_at,
            ends_at=ends_at,
            limit=limit,
            busy_intervals=calendar.intervals
            + await self._internal_busy(
                tutor_id=schedule.tutor_id, starts_at=starts_at, ends_at=ends_at
            ),
        )
        return TutorSlotsResponse(
            tutor_id=schedule.tutor_id,
            time_zone=schedule.time_zone,
            source="manual+google" if calendar.freshness != "not_connected" else "manual",
            slots=[
                TutorSlotResponse(starts_at=slot.starts_at, ends_at=slot.ends_at) for slot in slots
            ],
        )

    @staticmethod
    def _derive(
        schedule: StoredManualAvailability,
        *,
        now: datetime,
        starts_at: datetime,
        ends_at: datetime,
        limit: int,
        busy_intervals: tuple[TimeInterval, ...] = (),
    ) -> tuple[TimeInterval, ...]:
        assert schedule.duration_minutes is not None
        return derive_slots(
            rules=tuple(
                AvailabilityRule(
                    weekday=rule.weekday,
                    start_local=rule.start_local,
                    end_local=rule.end_local,
                    effective_from=rule.effective_from,
                    effective_until=rule.effective_until,
                    time_zone=rule.time_zone,
                )
                for rule in schedule.rules
            ),
            exceptions=tuple(
                AvailabilityException(
                    local_date=exception.local_date,
                    start_local=exception.start_local,
                    end_local=exception.end_local,
                    kind=cast(Literal["available", "unavailable"], exception.kind),
                    time_zone=exception.time_zone,
                )
                for exception in schedule.exceptions
            ),
            window_start=starts_at,
            window_end=ends_at,
            duration_minutes=schedule.duration_minutes,
            now=now,
            lead_time_minutes=schedule.lead_time_minutes,
            buffer_before_minutes=schedule.buffer_before_minutes,
            buffer_after_minutes=schedule.buffer_after_minutes,
            limit=limit,
            busy_intervals=busy_intervals,
        )

    async def _busy_snapshot(self, *, tutor_id: UUID, now: datetime) -> CalendarBusySnapshot:
        if self._calendar_busy_reader is None:
            return CalendarBusySnapshot("not_connected", (), None)
        return await asyncio.to_thread(
            self._calendar_busy_reader.get_busy_snapshot,
            tutor_id=tutor_id,
            now=now,
        )

    async def _internal_busy(
        self, *, tutor_id: UUID, starts_at: datetime, ends_at: datetime
    ) -> tuple[TimeInterval, ...]:
        if self._booking_busy_reader is None:
            return ()
        return await asyncio.to_thread(
            self._booking_busy_reader.list_internal_busy,
            tutor_id=tutor_id,
            starts_at=starts_at,
            ends_at=ends_at,
        )

    def _actor_ref(self, principal: ClerkPrincipal) -> str:
        if principal.user_id not in self._actor_allowlist or self._pseudonym_key is None:
            raise HumanTutorMarketplaceForbiddenError
        return derive_marketplace_actor_ref(
            key=self._pseudonym_key,
            clerk_user_id=principal.user_id,
        )

    def _require_acquisition(self) -> None:
        if not self._acquisition_enabled:
            raise HumanTutorMarketplaceUnavailableError

    @staticmethod
    def _availability_response(schedule: StoredManualAvailability) -> ManualAvailabilityResponse:
        return ManualAvailabilityResponse(
            tutor_id=schedule.tutor_id,
            profile_version=schedule.profile_version,
            time_zone=schedule.time_zone,
            lead_time_minutes=schedule.lead_time_minutes,
            buffer_before_minutes=schedule.buffer_before_minutes,
            buffer_after_minutes=schedule.buffer_after_minutes,
            dialects=list(schedule.dialects),
            rules=[
                AvailabilityRuleResponse(
                    rule_id=rule.rule_id,
                    weekday=rule.weekday,
                    start_local=rule.start_local,
                    end_local=rule.end_local,
                    effective_from=rule.effective_from,
                    effective_until=rule.effective_until,
                    time_zone=rule.time_zone,
                )
                for rule in schedule.rules
            ],
            exceptions=[
                AvailabilityExceptionResponse(
                    exception_id=exception.exception_id,
                    local_date=exception.local_date,
                    start_local=exception.start_local,
                    end_local=exception.end_local,
                    kind=cast(Literal["available", "unavailable"], exception.kind),
                    time_zone=exception.time_zone,
                )
                for exception in schedule.exceptions
            ],
        )

    @staticmethod
    def _public_response(tutor: StoredPublicTutor) -> PublicTutorResponse:
        return PublicTutorResponse(
            tutor_id=tutor.tutor_id,
            headline=tutor.headline,
            biography=tutor.biography,
            time_zone=tutor.time_zone,
            languages=list(tutor.languages),
            dialects=list(tutor.dialects),
            specialties=list(tutor.specialties),
            verified_credentials=list(tutor.verified_credentials),
            offering_id=tutor.offering_id,
            offering_title=tutor.offering_title,
            duration_minutes=cast(Literal[25, 50], tutor.duration_minutes),
            amount_minor=tutor.amount_minor,
            currency=cast(Literal["USD"], tutor.currency),
            rating=tutor.rating,
            rating_count=tutor.rating_count,
            is_favorite=tutor.is_favorite,
        )

    @staticmethod
    def _encode_cursor(tutor: StoredPublicTutor) -> str:
        payload = json.dumps(
            [tutor.headline.casefold(), str(tutor.tutor_id)], separators=(",", ":")
        ).encode()
        return base64.urlsafe_b64encode(payload).decode().rstrip("=")

    @staticmethod
    def _decode_cursor(cursor: str) -> tuple[str, str]:
        try:
            if len(cursor) > 512:
                raise ValueError
            payload = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
            value = json.loads(payload)
            if (
                not isinstance(value, list)
                or len(value) != 2
                or not all(isinstance(item, str) for item in value)
            ):
                raise ValueError
            UUID(value[1])
            return value[0], value[1]
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            raise TutorApplicationConflictError from None
