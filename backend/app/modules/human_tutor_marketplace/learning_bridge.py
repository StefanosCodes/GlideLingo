"""Booking-scoped learner consent and non-authoritative tutor follow-up."""

import asyncio
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
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref


@dataclass(frozen=True, slots=True)
class LearningBrief:
    selected_goal: str
    language_code: str
    course_id: str | None
    course_title: str | None
    capabilities: tuple[str, ...]
    review_focus: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class FollowUpRecommendation:
    kind: Literal["course_content", "free_text"]
    content_reference: str | None
    recommendation: str


@dataclass(frozen=True, slots=True)
class TutorFollowUp:
    follow_up_id: UUID
    version: int
    summary: str
    recommendations: tuple[FollowUpRecommendation, ...]
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class LearningContextView:
    booking_id: UUID
    role: Literal["learner", "tutor"]
    consent_state: Literal["not_shared", "granted", "revoked", "expired"]
    access_expires_at: datetime | None
    brief: LearningBrief | None
    follow_up: TutorFollowUp | None


class PostgresLearningBridgeRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def get_context(
        self, *, booking_id: UUID, actor_ref: str, now: datetime
    ) -> LearningContextView | None:
        try:
            with self._engine.connect() as connection:
                booking = self._booking(connection, booking_id)
                if booking is None:
                    return None
                role = self._participant_role(booking, actor_ref)
                if role is None:
                    return None
                context = (
                    connection.execute(
                        text(
                            """
                            SELECT consent_state, access_expires_at, selected_goal,
                                   language_code, course_id, course_title
                            FROM marketplace_learning_context WHERE booking_id = :id
                            """
                        ),
                        {"id": booking_id},
                    )
                    .mappings()
                    .one_or_none()
                )
                consent_state: Literal["not_shared", "granted", "revoked", "expired"]
                brief = None
                access_expires_at = None
                if context is None:
                    consent_state = "not_shared"
                elif context["consent_state"] == "revoked":
                    consent_state = "revoked"
                elif (
                    role == "tutor"
                    and booking["state"]
                    not in {"confirmed", "completed", "learner_no_show", "resolved_release"}
                ) or context["access_expires_at"] <= now:
                    consent_state = "expired"
                else:
                    consent_state = "granted"
                    access_expires_at = context["access_expires_at"]
                    brief = LearningBrief(
                        selected_goal=context["selected_goal"],
                        language_code=context["language_code"],
                        course_id=context["course_id"],
                        course_title=context["course_title"],
                        capabilities=tuple(
                            connection.execute(
                                text(
                                    """
                                    SELECT capability
                                    FROM marketplace_learning_context_capability
                                    WHERE booking_id = :id ORDER BY position
                                    """
                                ),
                                {"id": booking_id},
                            ).scalars()
                        ),
                        review_focus=tuple(
                            connection.execute(
                                text(
                                    """
                                    SELECT review_focus
                                    FROM marketplace_learning_context_review_focus
                                    WHERE booking_id = :id ORDER BY position
                                    """
                                ),
                                {"id": booking_id},
                            ).scalars()
                        ),
                    )
                return LearningContextView(
                    booking_id=booking_id,
                    role=role,
                    consent_state=consent_state,
                    access_expires_at=access_expires_at,
                    brief=brief,
                    follow_up=(
                        self._follow_up(connection, booking_id)
                        if role == "learner" or now <= booking["ends_at"] + self._access_window()
                        else None
                    ),
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def save_context(
        self,
        *,
        booking_id: UUID,
        learner_actor_ref: str,
        brief: LearningBrief,
        now: datetime,
    ) -> bool:
        try:
            with self._engine.begin() as connection:
                booking = self._booking(connection, booking_id, lock=True)
                if booking is None or booking["learner_actor_ref"] != learner_actor_ref:
                    return False
                if booking["state"] != "confirmed" or now > booking["ends_at"]:
                    raise TutorApplicationConflictError
                version = connection.execute(
                    text(
                        """
                        INSERT INTO marketplace_learning_context
                          (booking_id, learner_actor_ref, tutor_id, consent_state,
                           selected_goal, language_code, course_id, course_title,
                           consented_at, access_expires_at)
                        VALUES (:booking_id, :learner, :tutor_id, 'granted', :goal,
                                :language, :course_id, :course_title, :now,
                                :access_expires_at)
                        ON CONFLICT (booking_id) DO UPDATE
                        SET version = marketplace_learning_context.version + 1,
                            consent_state = 'granted', selected_goal = excluded.selected_goal,
                            language_code = excluded.language_code,
                            course_id = excluded.course_id, course_title = excluded.course_title,
                            consented_at = excluded.consented_at, revoked_at = NULL,
                            access_expires_at = excluded.access_expires_at, updated_at = :now
                        RETURNING version
                        """
                    ),
                    {
                        "booking_id": booking_id,
                        "learner": learner_actor_ref,
                        "tutor_id": booking["tutor_id"],
                        "goal": brief.selected_goal,
                        "language": brief.language_code,
                        "course_id": brief.course_id,
                        "course_title": brief.course_title,
                        "now": now,
                        "access_expires_at": booking["ends_at"] + self._access_window(),
                    },
                ).scalar_one()
                connection.execute(
                    text(
                        "DELETE FROM marketplace_learning_context_capability WHERE booking_id = :id"
                    ),
                    {"id": booking_id},
                )
                connection.execute(
                    text(
                        "DELETE FROM marketplace_learning_context_review_focus "
                        "WHERE booking_id = :id"
                    ),
                    {"id": booking_id},
                )
                if brief.capabilities:
                    connection.execute(
                        text(
                            "INSERT INTO marketplace_learning_context_capability "
                            "(booking_id, position, capability) "
                            "VALUES (:booking_id, :position, :value)"
                        ),
                        [
                            {"booking_id": booking_id, "position": position, "value": value}
                            for position, value in enumerate(brief.capabilities)
                        ],
                    )
                if brief.review_focus:
                    connection.execute(
                        text(
                            "INSERT INTO marketplace_learning_context_review_focus "
                            "(booking_id, position, review_focus) "
                            "VALUES (:booking_id, :position, :value)"
                        ),
                        [
                            {"booking_id": booking_id, "position": position, "value": value}
                            for position, value in enumerate(brief.review_focus)
                        ],
                    )
                self._audit(
                    connection,
                    booking_id=booking_id,
                    version=version,
                    event="granted",
                    actor_ref=learner_actor_ref,
                )
                return True
        except TutorApplicationConflictError:
            raise
        except (IntegrityError, DBAPIError) as error:
            raise TutorApplicationConflictError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def revoke_context(self, *, booking_id: UUID, learner_actor_ref: str, now: datetime) -> bool:
        try:
            with self._engine.begin() as connection:
                version = connection.execute(
                    text(
                        """
                        UPDATE marketplace_learning_context
                        SET version = version + 1, consent_state = 'revoked',
                            revoked_at = :now, updated_at = :now
                        WHERE booking_id = :booking_id
                          AND learner_actor_ref = :learner
                          AND consent_state = 'granted'
                        RETURNING version
                        """
                    ),
                    {"booking_id": booking_id, "learner": learner_actor_ref, "now": now},
                ).scalar_one_or_none()
                if version is None:
                    return (
                        connection.execute(
                            text(
                                """
                                SELECT 1 FROM marketplace_learning_context
                                WHERE booking_id = :booking_id
                                  AND learner_actor_ref = :learner
                                  AND consent_state = 'revoked'
                                """
                            ),
                            {"booking_id": booking_id, "learner": learner_actor_ref},
                        ).scalar_one_or_none()
                        is not None
                    )
                self._audit(
                    connection,
                    booking_id=booking_id,
                    version=version,
                    event="revoked",
                    actor_ref=learner_actor_ref,
                )
                return True
        except (IntegrityError, DBAPIError) as error:
            raise TutorApplicationConflictError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def save_follow_up(
        self,
        *,
        booking_id: UUID,
        tutor_actor_ref: str,
        summary: str,
        recommendations: tuple[FollowUpRecommendation, ...],
        now: datetime,
    ) -> bool:
        try:
            with self._engine.begin() as connection:
                booking = self._booking(connection, booking_id, lock=True)
                if booking is None or booking["tutor_actor_ref"] != tutor_actor_ref:
                    return False
                if (
                    booking["state"] not in {"completed", "learner_no_show", "resolved_release"}
                    or now > booking["ends_at"] + self._access_window()
                ):
                    raise TutorApplicationConflictError
                follow_up_id = connection.execute(
                    text(
                        """
                        INSERT INTO marketplace_tutor_follow_up
                          (follow_up_id, booking_id, tutor_actor_ref, summary)
                        VALUES (:follow_up_id, :booking_id, :tutor, :summary)
                        ON CONFLICT (booking_id) DO UPDATE
                        SET version = marketplace_tutor_follow_up.version + 1,
                            summary = excluded.summary, updated_at = :now
                        RETURNING follow_up_id
                        """
                    ),
                    {
                        "follow_up_id": uuid4(),
                        "booking_id": booking_id,
                        "tutor": tutor_actor_ref,
                        "summary": summary,
                        "now": now,
                    },
                ).scalar_one()
                connection.execute(
                    text(
                        "DELETE FROM marketplace_tutor_follow_up_recommendation "
                        "WHERE follow_up_id = :id"
                    ),
                    {"id": follow_up_id},
                )
                if recommendations:
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_tutor_follow_up_recommendation
                              (follow_up_id, position, kind, content_reference, recommendation)
                            VALUES (:follow_up_id, :position, :kind, :reference, :recommendation)
                            """
                        ),
                        [
                            {
                                "follow_up_id": follow_up_id,
                                "position": position,
                                "kind": item.kind,
                                "reference": item.content_reference,
                                "recommendation": item.recommendation,
                            }
                            for position, item in enumerate(recommendations)
                        ],
                    )
                return True
        except TutorApplicationConflictError:
            raise
        except (IntegrityError, DBAPIError) as error:
            raise TutorApplicationConflictError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    @staticmethod
    def _booking(
        connection: Connection, booking_id: UUID, *, lock: bool = False
    ) -> RowMapping | None:
        suffix = " FOR UPDATE" if lock else ""
        return (
            connection.execute(
                text(
                    "SELECT booking_id, learner_actor_ref, tutor_actor_ref, tutor_id, "
                    "state, ends_at FROM marketplace_booking WHERE booking_id = :id" + suffix
                ),
                {"id": booking_id},
            )
            .mappings()
            .one_or_none()
        )

    @staticmethod
    def _participant_role(
        booking: RowMapping, actor_ref: str
    ) -> Literal["learner", "tutor"] | None:
        if actor_ref == booking["learner_actor_ref"]:
            return "learner"
        if actor_ref == booking["tutor_actor_ref"]:
            return "tutor"
        return None

    @staticmethod
    def _access_window() -> timedelta:
        return timedelta(days=7)

    @staticmethod
    def _audit(
        connection: Connection,
        *,
        booking_id: UUID,
        version: int,
        event: Literal["granted", "revoked"],
        actor_ref: str,
    ) -> None:
        connection.execute(
            text(
                """
                INSERT INTO marketplace_learning_context_audit
                  (audit_id, booking_id, version, event, actor_ref)
                VALUES (:id, :booking_id, :version, :event, :actor)
                """
            ),
            {
                "id": uuid4(),
                "booking_id": booking_id,
                "version": version,
                "event": event,
                "actor": actor_ref,
            },
        )

    @staticmethod
    def _follow_up(connection: Connection, booking_id: UUID) -> TutorFollowUp | None:
        row = (
            connection.execute(
                text(
                    """
                    SELECT follow_up_id, version, summary, created_at, updated_at
                    FROM marketplace_tutor_follow_up WHERE booking_id = :id
                    """
                ),
                {"id": booking_id},
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            return None
        recommendations = tuple(
            FollowUpRecommendation(**dict(item))
            for item in connection.execute(
                text(
                    """
                    SELECT kind, content_reference, recommendation
                    FROM marketplace_tutor_follow_up_recommendation
                    WHERE follow_up_id = :id ORDER BY position
                    """
                ),
                {"id": row["follow_up_id"]},
            ).mappings()
        )
        return TutorFollowUp(recommendations=recommendations, **dict(row))


class LearningBridgeService:
    def __init__(
        self,
        *,
        enabled: bool,
        repository: PostgresLearningBridgeRepository,
        pseudonym_key: bytes | None,
        actor_allowlist: tuple[str, ...],
    ) -> None:
        self._enabled = enabled
        self._repository = repository
        self._pseudonym_key = pseudonym_key
        self._actor_allowlist = frozenset(actor_allowlist)

    async def get_context(
        self, *, principal: ClerkPrincipal, booking_id: UUID
    ) -> LearningContextView:
        view = await asyncio.to_thread(
            self._repository.get_context,
            booking_id=booking_id,
            actor_ref=self._actor_ref(principal),
            now=datetime.now(UTC),
        )
        if view is None:
            raise TutorApplicationNotFoundError
        return view

    async def save_context(
        self, *, principal: ClerkPrincipal, booking_id: UUID, brief: LearningBrief
    ) -> LearningContextView:
        actor_ref = self._actor_ref(principal)
        if not await asyncio.to_thread(
            self._repository.save_context,
            booking_id=booking_id,
            learner_actor_ref=actor_ref,
            brief=brief,
            now=datetime.now(UTC),
        ):
            raise TutorApplicationNotFoundError
        return await self.get_context(principal=principal, booking_id=booking_id)

    async def revoke_context(
        self, *, principal: ClerkPrincipal, booking_id: UUID
    ) -> LearningContextView:
        actor_ref = self._actor_ref(principal)
        if not await asyncio.to_thread(
            self._repository.revoke_context,
            booking_id=booking_id,
            learner_actor_ref=actor_ref,
            now=datetime.now(UTC),
        ):
            raise TutorApplicationNotFoundError
        return await self.get_context(principal=principal, booking_id=booking_id)

    async def save_follow_up(
        self,
        *,
        principal: ClerkPrincipal,
        booking_id: UUID,
        summary: str,
        recommendations: tuple[FollowUpRecommendation, ...],
    ) -> LearningContextView:
        actor_ref = self._actor_ref(principal)
        if not await asyncio.to_thread(
            self._repository.save_follow_up,
            booking_id=booking_id,
            tutor_actor_ref=actor_ref,
            summary=summary,
            recommendations=recommendations,
            now=datetime.now(UTC),
        ):
            raise TutorApplicationNotFoundError
        return await self.get_context(principal=principal, booking_id=booking_id)

    def _actor_ref(self, principal: ClerkPrincipal) -> str:
        if not self._enabled:
            raise HumanTutorMarketplaceUnavailableError
        if principal.user_id not in self._actor_allowlist or self._pseudonym_key is None:
            raise HumanTutorMarketplaceForbiddenError
        return derive_marketplace_actor_ref(
            key=self._pseudonym_key,
            clerk_user_id=principal.user_id,
        )
