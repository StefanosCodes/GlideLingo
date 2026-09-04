"""Participant-scoped text messaging, safety reports, and durable email work."""

import asyncio
import base64
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    DependencyUnavailableError,
    HumanTutorMarketplaceForbiddenError,
    HumanTutorMarketplaceUnavailableError,
    MarketplaceMessageLimitedError,
    TutorApplicationConflictError,
    TutorApplicationNotFoundError,
)
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref

MESSAGE_RATE_LIMIT = 10
MESSAGE_TARGET_RATE_LIMIT = 30
MESSAGE_RATE_WINDOW = timedelta(minutes=1)
CONVERSATION_ACTOR_RATE_LIMIT = 5
CONVERSATION_TUTOR_RATE_LIMIT = 20
CONVERSATION_RATE_WINDOW = timedelta(hours=1)
REPORT_ACTOR_RATE_LIMIT = 10
REPORT_SUBJECT_RATE_LIMIT = 50
REPORT_RATE_WINDOW = timedelta(days=1)
CONTACT_PATTERN = re.compile(
    r"(?i)(?:https?://|www\.|(?:[a-z0-9._%+-]+)@(?:[a-z0-9.-]+\.[a-z]{2,})|"
    r"(?:\+?\d[\s().-]*){7,}|(?:whatsapp|telegram|signal|discord|instagram)\s*[:@])"
)

MessageKind = Literal["user", "system"]
ReportReason = Literal["harassment", "spam", "unsafe", "other"]
SendResult = Literal["created", "duplicate", "blocked", "limited", "missing"]


@dataclass(frozen=True, slots=True)
class StoredConversation:
    conversation_id: UUID
    learner_actor_ref: str
    tutor_id: UUID
    tutor_actor_ref: str
    booking_id: UUID | None
    state: Literal["open", "closed"]
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class StoredMessage:
    message_id: UUID
    conversation_id: UUID
    sender_actor_ref: str | None
    kind: MessageKind
    body: str
    client_message_id: UUID | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class StoredReport:
    report_id: UUID
    conversation_id: UUID
    message_id: UUID | None
    reporter_actor_ref: str
    subject_actor_ref: str
    reason: ReportReason
    details: str | None
    status: Literal["open", "resolved"]
    resolution_reason: str | None
    created_at: datetime
    resolved_at: datetime | None


@dataclass(frozen=True, slots=True)
class StoredNotificationJob:
    job_id: UUID
    message_id: UUID
    recipient_actor_ref: str
    attempt: int
    lease_owner: str
    lease_expires_at: datetime
    template: Literal["new_message", "calendar_conflict"]


NotificationOutcome = Literal["completed", "retryable", "rejected"]


class MarketplaceNotificationProvider(Protocol):
    async def deliver(
        self,
        *,
        recipient_actor_ref: str,
        template: Literal[
            "new_message", "calendar_conflict", "lesson_reminder", "completion_prompt"
        ],
        idempotency_key: str,
    ) -> NotificationOutcome: ...


@dataclass(frozen=True, slots=True)
class ConversationView:
    conversation_id: UUID
    tutor_id: UUID
    participant_role: Literal["learner", "tutor"]
    state: Literal["open", "closed"]
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class MessageView:
    message_id: UUID
    kind: MessageKind
    sender_role: Literal["learner", "tutor", "system"]
    body: str
    is_own: bool
    created_at: datetime


@dataclass(frozen=True, slots=True)
class MessagePage:
    items: tuple[MessageView, ...]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class ReportView:
    report_id: UUID
    conversation_id: UUID
    message_id: UUID | None
    reason: ReportReason
    details: str | None
    status: Literal["open", "resolved"]
    created_at: datetime
    messages: tuple[MessageView, ...] = ()


class MessagingRepository(Protocol):
    def create_prebooking_conversation(
        self, *, learner_actor_ref: str, tutor_id: UUID
    ) -> StoredConversation | None: ...

    def list_conversations(
        self,
        *,
        actor_ref: str,
        before_created_at: datetime | None,
        before_conversation_id: UUID | None,
        limit: int,
    ) -> tuple[tuple[StoredConversation, ...], bool]: ...

    def get_conversation(
        self, *, conversation_id: UUID, actor_ref: str
    ) -> StoredConversation | None: ...

    def list_messages(
        self,
        *,
        conversation_id: UUID,
        actor_ref: str,
        before_created_at: datetime | None,
        before_message_id: UUID | None,
        limit: int,
    ) -> tuple[tuple[StoredMessage, ...], bool]: ...

    def send_message(
        self,
        *,
        conversation_id: UUID,
        actor_ref: str,
        client_message_id: UUID,
        body: str,
        now: datetime,
    ) -> tuple[SendResult, StoredMessage | None]: ...

    def block_other(self, *, conversation_id: UUID, actor_ref: str) -> bool: ...

    def create_report(
        self,
        *,
        report_id: UUID,
        conversation_id: UUID,
        message_id: UUID | None,
        reporter_actor_ref: str,
        reason: ReportReason,
        details: str | None,
        now: datetime,
    ) -> StoredReport | None: ...

    def list_reports_for_operator(
        self, *, operator_actor_ref: str, offset: int, limit: int
    ) -> tuple[tuple[StoredReport, ...], bool] | None: ...

    def get_report_for_operator(
        self, *, operator_actor_ref: str, report_id: UUID
    ) -> tuple[StoredReport, StoredConversation, tuple[StoredMessage, ...]] | None: ...

    def resolve_report(
        self, *, operator_actor_ref: str, report_id: UUID, reason: str, now: datetime
    ) -> StoredReport | None: ...

    def purge_expired_messages(self, *, cutoff: datetime, limit: int) -> int: ...

    def purge_bounded_events(self, *, limit: int) -> int: ...

    def get_notification_preference(self, *, actor_ref: str) -> bool: ...

    def set_notification_preference(self, *, actor_ref: str, email_enabled: bool) -> bool: ...

    def claim_notification(
        self, *, lease_owner: str, now: datetime, lease_seconds: int
    ) -> StoredNotificationJob | None: ...

    def finish_notification(
        self,
        *,
        job_id: UUID,
        lease_owner: str,
        now: datetime,
        outcome: Literal["completed", "retryable", "rejected"],
    ) -> bool: ...

    def recover_notifications(
        self,
        *,
        conversation_id: UUID,
        operator_actor_ref: str,
        reason: str,
        now: datetime,
    ) -> bool: ...


class PostgresMessagingRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def create_prebooking_conversation(
        self, *, learner_actor_ref: str, tutor_id: UUID
    ) -> StoredConversation | None:
        conversation_id = uuid4()
        try:
            with self._engine.begin() as connection:
                connection.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 4101))"),
                    {"key": f"actor:{learner_actor_ref}"},
                )
                connection.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 4101))"),
                    {"key": f"tutor:{tutor_id}"},
                )
                existing = (
                    connection.execute(
                        text(
                            "SELECT * FROM marketplace_conversation "
                            "WHERE learner_actor_ref = :learner_actor_ref "
                            "AND tutor_id = :tutor_id AND booking_id IS NULL"
                        ),
                        {"learner_actor_ref": learner_actor_ref, "tutor_id": tutor_id},
                    )
                    .mappings()
                    .one_or_none()
                )
                if existing is not None:
                    return self._conversation(existing)
                cutoff = datetime.now(UTC) - CONVERSATION_RATE_WINDOW
                actor_count, tutor_count = connection.execute(
                    text(
                        "SELECT count(*) FILTER (WHERE learner_actor_ref = :learner_actor_ref), "
                        "count(*) FILTER (WHERE tutor_id = :tutor_id) "
                        "FROM marketplace_conversation_rate_event WHERE occurred_at >= :cutoff"
                    ),
                    {
                        "learner_actor_ref": learner_actor_ref,
                        "tutor_id": tutor_id,
                        "cutoff": cutoff,
                    },
                ).one()
                if (
                    actor_count >= CONVERSATION_ACTOR_RATE_LIMIT
                    or tutor_count >= CONVERSATION_TUTOR_RATE_LIMIT
                ):
                    raise MarketplaceMessageLimitedError
                row = (
                    connection.execute(
                        text(
                            """
                            WITH eligible AS (
                              SELECT profile.tutor_id, profile.actor_ref AS tutor_actor_ref
                              FROM marketplace_tutor_profile AS profile
                              JOIN marketplace_tutor_application AS application
                                ON application.application_id = profile.application_id
                              WHERE profile.tutor_id = :tutor_id
                                AND application.status = 'approved'
                                AND profile.is_published AND profile.payout_ready
                                AND EXISTS (
                                  SELECT 1 FROM marketplace_tutor_offering AS offering
                                  WHERE offering.tutor_id = profile.tutor_id
                                    AND offering.state = 'active'
                                )
                                AND profile.actor_ref <> :learner_actor_ref
                            ), inserted AS (
                              INSERT INTO marketplace_conversation
                                (conversation_id, learner_actor_ref, tutor_id, tutor_actor_ref)
                              SELECT :conversation_id, :learner_actor_ref,
                                     eligible.tutor_id, eligible.tutor_actor_ref
                              FROM eligible
                              ON CONFLICT (learner_actor_ref, tutor_id) WHERE booking_id IS NULL
                              DO NOTHING
                              RETURNING *, true AS was_created
                            )
                            SELECT * FROM inserted
                            UNION ALL
                            SELECT existing.*, false AS was_created
                            FROM marketplace_conversation AS existing
                            WHERE existing.learner_actor_ref = :learner_actor_ref
                              AND existing.tutor_id = :tutor_id AND existing.booking_id IS NULL
                              AND NOT EXISTS (SELECT 1 FROM inserted)
                            LIMIT 1
                            """
                        ),
                        {
                            "conversation_id": conversation_id,
                            "learner_actor_ref": learner_actor_ref,
                            "tutor_id": tutor_id,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                if row["was_created"]:
                    connection.execute(
                        text(
                            "INSERT INTO marketplace_conversation_rate_event "
                            "(event_id, learner_actor_ref, tutor_id) "
                            "VALUES (:event_id, :learner_actor_ref, :tutor_id)"
                        ),
                        {
                            "event_id": uuid4(),
                            "learner_actor_ref": learner_actor_ref,
                            "tutor_id": tutor_id,
                        },
                    )
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_message
                              (message_id, conversation_id, kind, body, client_message_id)
                            VALUES (:message_id, :conversation_id, 'system',
                                    'Conversation started. Keep contact and meeting details '
                                    'in GlideLingo.',
                                    :client_message_id)
                            ON CONFLICT DO NOTHING
                            """
                        ),
                        {
                            "message_id": uuid4(),
                            "conversation_id": row["conversation_id"],
                            "client_message_id": row["conversation_id"],
                        },
                    )
                return self._conversation(row)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def list_conversations(
        self,
        *,
        actor_ref: str,
        before_created_at: datetime | None,
        before_conversation_id: UUID | None,
        limit: int,
    ) -> tuple[tuple[StoredConversation, ...], bool]:
        cursor_clause = ""
        if before_created_at is not None and before_conversation_id is not None:
            cursor_clause = (
                "AND (created_at, conversation_id) < (:before_created_at, :before_conversation_id)"
            )
        try:
            with self._engine.connect() as connection:
                rows = (
                    connection.execute(
                        text(
                            """
                        SELECT conversation_id, learner_actor_ref, tutor_id, tutor_actor_ref,
                               booking_id, state, created_at, updated_at
                        FROM marketplace_conversation
                        WHERE (learner_actor_ref = :actor_ref OR tutor_actor_ref = :actor_ref)
                        """
                            + cursor_clause
                            + " ORDER BY created_at DESC, conversation_id DESC LIMIT :limit"
                        ),
                        {
                            "actor_ref": actor_ref,
                            "before_created_at": before_created_at,
                            "before_conversation_id": before_conversation_id,
                            "limit": limit + 1,
                        },
                    )
                    .mappings()
                    .all()
                )
                return tuple(self._conversation(row) for row in rows[:limit]), len(rows) > limit
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_conversation(
        self, *, conversation_id: UUID, actor_ref: str
    ) -> StoredConversation | None:
        try:
            with self._engine.connect() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            SELECT conversation_id, learner_actor_ref, tutor_id, tutor_actor_ref,
                                   booking_id, state, created_at, updated_at
                            FROM marketplace_conversation
                            WHERE conversation_id = :conversation_id
                              AND (learner_actor_ref = :actor_ref OR tutor_actor_ref = :actor_ref)
                            """
                        ),
                        {"conversation_id": conversation_id, "actor_ref": actor_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                return self._conversation(row) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def list_messages(
        self,
        *,
        conversation_id: UUID,
        actor_ref: str,
        before_created_at: datetime | None,
        before_message_id: UUID | None,
        limit: int,
    ) -> tuple[tuple[StoredMessage, ...], bool]:
        cursor_clause = ""
        if before_created_at is not None and before_message_id is not None:
            cursor_clause = (
                "AND (message.created_at, message.message_id) "
                "< (:before_created_at, :before_message_id)"
            )
        try:
            with self._engine.connect() as connection:
                rows = (
                    connection.execute(
                        text(
                            """
                            SELECT message.message_id, message.conversation_id,
                                   message.sender_actor_ref, message.kind, message.body,
                                   message.client_message_id, message.created_at
                            FROM marketplace_message AS message
                            JOIN marketplace_conversation AS conversation
                              ON conversation.conversation_id = message.conversation_id
                            WHERE message.conversation_id = :conversation_id
                              AND (conversation.learner_actor_ref = :actor_ref
                                   OR conversation.tutor_actor_ref = :actor_ref)
                            """
                            + cursor_clause
                            + " ORDER BY message.created_at DESC, message.message_id DESC "
                            "LIMIT :limit"
                        ),
                        {
                            "conversation_id": conversation_id,
                            "actor_ref": actor_ref,
                            "before_created_at": before_created_at,
                            "before_message_id": before_message_id,
                            "limit": limit + 1,
                        },
                    )
                    .mappings()
                    .all()
                )
                return (
                    tuple(self._message(row) for row in reversed(rows[:limit])),
                    len(rows) > limit,
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def send_message(
        self,
        *,
        conversation_id: UUID,
        actor_ref: str,
        client_message_id: UUID,
        body: str,
        now: datetime,
    ) -> tuple[SendResult, StoredMessage | None]:
        try:
            with self._engine.begin() as connection:
                conversation = (
                    connection.execute(
                        text(
                            """
                            SELECT conversation_id, learner_actor_ref, tutor_actor_ref, booking_id
                            FROM marketplace_conversation
                            WHERE conversation_id = :conversation_id AND state = 'open'
                              AND (learner_actor_ref = :actor_ref OR tutor_actor_ref = :actor_ref)
                            FOR UPDATE
                            """
                        ),
                        {"conversation_id": conversation_id, "actor_ref": actor_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                if conversation is None:
                    return "missing", None
                other = (
                    conversation["tutor_actor_ref"]
                    if conversation["learner_actor_ref"] == actor_ref
                    else conversation["learner_actor_ref"]
                )
                for lock_ref in sorted((actor_ref, other)):
                    connection.execute(
                        text("SELECT pg_advisory_xact_lock(hashtextextended(:actor_ref, 0))"),
                        {"actor_ref": lock_ref},
                    )
                duplicate = (
                    connection.execute(
                        text(
                            """
                            SELECT message_id, conversation_id, sender_actor_ref, kind, body,
                                   client_message_id, created_at
                            FROM marketplace_message
                            WHERE conversation_id = :conversation_id
                              AND client_message_id = :client_message_id
                              AND sender_actor_ref = :actor_ref
                            """
                        ),
                        {
                            "conversation_id": conversation_id,
                            "client_message_id": client_message_id,
                            "actor_ref": actor_ref,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if duplicate is not None:
                    if duplicate["body"] != body:
                        return "missing", None
                    return "duplicate", self._message(duplicate)
                blocked = connection.execute(
                    text(
                        """
                        SELECT 1 FROM marketplace_actor_block
                        WHERE (blocker_actor_ref = :actor_ref AND blocked_actor_ref = :other)
                           OR (blocker_actor_ref = :other AND blocked_actor_ref = :actor_ref)
                        """
                    ),
                    {"actor_ref": actor_ref, "other": other},
                ).scalar_one_or_none()
                if blocked is not None:
                    return "blocked", None
                cutoff = now - MESSAGE_RATE_WINDOW
                recent, target_recent = connection.execute(
                    text(
                        "SELECT count(*) FILTER (WHERE actor_ref = :actor_ref), "
                        "count(*) FILTER (WHERE target_actor_ref = :other) "
                        "FROM marketplace_message_rate_event WHERE occurred_at >= :cutoff"
                    ),
                    {"actor_ref": actor_ref, "other": other, "cutoff": cutoff},
                ).one()
                if recent >= MESSAGE_RATE_LIMIT or target_recent >= MESSAGE_TARGET_RATE_LIMIT:
                    return "limited", None
                connection.execute(
                    text(
                        "INSERT INTO marketplace_message_rate_event "
                        "(event_id, actor_ref, target_actor_ref, occurred_at) "
                        "VALUES (:event_id, :actor_ref, :other, :now)"
                    ),
                    {"event_id": uuid4(), "actor_ref": actor_ref, "other": other, "now": now},
                )
                row = (
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_message
                              (message_id, conversation_id, sender_actor_ref, kind, body,
                               client_message_id, created_at)
                            VALUES (:message_id, :conversation_id, :actor_ref, 'user', :body,
                                    :client_message_id, :now)
                            RETURNING message_id, conversation_id, sender_actor_ref, kind, body,
                                      client_message_id, created_at
                            """
                        ),
                        {
                            "message_id": uuid4(),
                            "conversation_id": conversation_id,
                            "actor_ref": actor_ref,
                            "body": body,
                            "client_message_id": client_message_id,
                            "now": now,
                        },
                    )
                    .mappings()
                    .one()
                )
                connection.execute(
                    text(
                        "UPDATE marketplace_conversation SET updated_at = :now "
                        "WHERE conversation_id = :conversation_id"
                    ),
                    {"now": now, "conversation_id": conversation_id},
                )
                enabled = connection.execute(
                    text(
                        "SELECT email_enabled FROM marketplace_message_notification_preference "
                        "WHERE actor_ref = :other"
                    ),
                    {"other": other},
                ).scalar_one_or_none()
                if enabled is not False:
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_message_notification_job
                              (job_id, message_id, recipient_actor_ref)
                            VALUES (:job_id, :message_id, :other)
                            ON CONFLICT (message_id, recipient_actor_ref) DO NOTHING
                            """
                        ),
                        {"job_id": uuid4(), "message_id": row["message_id"], "other": other},
                    )
                return "created", self._message(row)
        except IntegrityError as error:
            raise TutorApplicationConflictError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def block_other(self, *, conversation_id: UUID, actor_ref: str) -> bool:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            SELECT learner_actor_ref, tutor_actor_ref
                            FROM marketplace_conversation
                            WHERE conversation_id = :conversation_id
                              AND (learner_actor_ref = :actor_ref OR tutor_actor_ref = :actor_ref)
                            """
                        ),
                        {"conversation_id": conversation_id, "actor_ref": actor_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return False
                other = (
                    row["tutor_actor_ref"]
                    if row["learner_actor_ref"] == actor_ref
                    else row["learner_actor_ref"]
                )
                connection.execute(
                    text(
                        "INSERT INTO marketplace_actor_block "
                        "(blocker_actor_ref, blocked_actor_ref) "
                        "VALUES (:actor_ref, :other) ON CONFLICT DO NOTHING"
                    ),
                    {"actor_ref": actor_ref, "other": other},
                )
                return True
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def create_report(
        self,
        *,
        report_id: UUID,
        conversation_id: UUID,
        message_id: UUID | None,
        reporter_actor_ref: str,
        reason: ReportReason,
        details: str | None,
        now: datetime,
    ) -> StoredReport | None:
        try:
            with self._engine.begin() as connection:
                conversation = (
                    connection.execute(
                        text(
                            """
                            SELECT learner_actor_ref, tutor_actor_ref
                            FROM marketplace_conversation
                            WHERE conversation_id = :conversation_id
                              AND (learner_actor_ref = :actor_ref OR tutor_actor_ref = :actor_ref)
                            """
                        ),
                        {"conversation_id": conversation_id, "actor_ref": reporter_actor_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                if conversation is None:
                    return None
                subject = (
                    conversation["tutor_actor_ref"]
                    if conversation["learner_actor_ref"] == reporter_actor_ref
                    else conversation["learner_actor_ref"]
                )
                for lock_ref in sorted((reporter_actor_ref, subject)):
                    connection.execute(
                        text(
                            "SELECT pg_advisory_xact_lock("
                            "hashtextextended('marketplace-report:' || :actor_ref, 0))"
                        ),
                        {"actor_ref": lock_ref},
                    )
                if message_id is not None:
                    valid_message = connection.execute(
                        text(
                            """
                            SELECT 1 FROM marketplace_message
                            WHERE message_id = :message_id AND conversation_id = :conversation_id
                              AND sender_actor_ref = :subject
                            """
                        ),
                        {
                            "message_id": message_id,
                            "conversation_id": conversation_id,
                            "subject": subject,
                        },
                    ).scalar_one_or_none()
                    if valid_message is None:
                        return None
                existing = (
                    connection.execute(
                        text(
                            "SELECT * FROM marketplace_message_report "
                            "WHERE conversation_id = :conversation_id "
                            "AND reporter_actor_ref = :reporter "
                            "AND message_id IS NOT DISTINCT FROM CAST(:message_id AS uuid)"
                        ),
                        {
                            "conversation_id": conversation_id,
                            "reporter": reporter_actor_ref,
                            "message_id": message_id,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if existing is not None:
                    return self._report(existing)
                cutoff = now - REPORT_RATE_WINDOW
                reporter_recent, subject_recent = connection.execute(
                    text(
                        "SELECT count(*) FILTER (WHERE reporter_actor_ref = :reporter), "
                        "count(*) FILTER (WHERE subject_actor_ref = :subject) "
                        "FROM marketplace_message_report_rate_event "
                        "WHERE occurred_at >= :cutoff"
                    ),
                    {"reporter": reporter_actor_ref, "subject": subject, "cutoff": cutoff},
                ).one()
                if (
                    reporter_recent >= REPORT_ACTOR_RATE_LIMIT
                    or subject_recent >= REPORT_SUBJECT_RATE_LIMIT
                ):
                    raise MarketplaceMessageLimitedError
                connection.execute(
                    text(
                        "INSERT INTO marketplace_message_report_rate_event "
                        "(event_id, reporter_actor_ref, subject_actor_ref, occurred_at) "
                        "VALUES (:event_id, :reporter, :subject, :now)"
                    ),
                    {
                        "event_id": uuid4(),
                        "reporter": reporter_actor_ref,
                        "subject": subject,
                        "now": now,
                    },
                )
                row = (
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_message_report
                              (report_id, conversation_id, message_id, reporter_actor_ref,
                               subject_actor_ref, reason, details)
                            VALUES (:report_id, :conversation_id, :message_id, :reporter,
                                    :subject, :reason, :details)
                            ON CONFLICT DO NOTHING
                            RETURNING *
                            """
                        ),
                        {
                            "report_id": report_id,
                            "conversation_id": conversation_id,
                            "message_id": message_id,
                            "reporter": reporter_actor_ref,
                            "subject": subject,
                            "reason": reason,
                            "details": details,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is not None:
                    return self._report(row)
                converged = (
                    connection.execute(
                        text(
                            "SELECT * FROM marketplace_message_report "
                            "WHERE conversation_id = :conversation_id "
                            "AND reporter_actor_ref = :reporter "
                            "AND message_id IS NOT DISTINCT FROM CAST(:message_id AS uuid)"
                        ),
                        {
                            "conversation_id": conversation_id,
                            "reporter": reporter_actor_ref,
                            "message_id": message_id,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                return self._report(converged) if converged is not None else None
        except TutorApplicationConflictError:
            raise
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def list_reports_for_operator(
        self, *, operator_actor_ref: str, offset: int, limit: int
    ) -> tuple[tuple[StoredReport, ...], bool] | None:
        try:
            with self._engine.connect() as connection:
                if not self._has_report_capability(connection, operator_actor_ref):
                    return None
                rows = (
                    connection.execute(
                        text(
                            """
                        SELECT * FROM marketplace_message_report
                        ORDER BY created_at, report_id
                        OFFSET :offset LIMIT :limit
                        """
                        ),
                        {"offset": offset, "limit": limit + 1},
                    )
                    .mappings()
                    .all()
                )
                return tuple(self._report(row) for row in rows[:limit]), len(rows) > limit
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_report_for_operator(
        self, *, operator_actor_ref: str, report_id: UUID
    ) -> tuple[StoredReport, StoredConversation, tuple[StoredMessage, ...]] | None:
        try:
            with self._engine.begin() as connection:
                if not self._has_report_capability(connection, operator_actor_ref):
                    return None
                report = (
                    connection.execute(
                        text(
                            "SELECT * FROM marketplace_message_report WHERE report_id = :report_id"
                        ),
                        {"report_id": report_id},
                    )
                    .mappings()
                    .one_or_none()
                )
                if report is None:
                    return None
                conversation = (
                    connection.execute(
                        text("SELECT * FROM marketplace_conversation WHERE conversation_id = :id"),
                        {"id": report["conversation_id"]},
                    )
                    .mappings()
                    .one()
                )
                messages = tuple(
                    self._message(row)
                    for row in connection.execute(
                        text(
                            """
                            WITH recent AS (
                              SELECT * FROM marketplace_message
                              WHERE conversation_id = :id
                              ORDER BY created_at DESC, message_id DESC LIMIT 200
                            ), evidence AS (
                              SELECT * FROM recent
                              UNION
                              SELECT * FROM marketplace_message
                              WHERE conversation_id = :id
                                AND message_id = CAST(:message_id AS uuid)
                            )
                            SELECT * FROM evidence ORDER BY created_at, message_id
                            """
                        ),
                        {
                            "id": report["conversation_id"],
                            "message_id": report["message_id"],
                        },
                    ).mappings()
                )
                connection.execute(
                    text(
                        """
                        INSERT INTO marketplace_message_report_access_audit
                          (audit_id, report_id, operator_actor_ref, action)
                        VALUES (:audit_id, :report_id, :operator, 'viewed')
                        """
                    ),
                    {"audit_id": uuid4(), "report_id": report_id, "operator": operator_actor_ref},
                )
                return self._report(report), self._conversation(conversation), messages
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def resolve_report(
        self, *, operator_actor_ref: str, report_id: UUID, reason: str, now: datetime
    ) -> StoredReport | None:
        try:
            with self._engine.begin() as connection:
                if not self._has_report_capability(connection, operator_actor_ref):
                    return None
                prior = (
                    connection.execute(
                        text(
                            "SELECT * FROM marketplace_message_report "
                            "WHERE report_id = :report_id FOR UPDATE"
                        ),
                        {"report_id": report_id},
                    )
                    .mappings()
                    .one_or_none()
                )
                if prior is None:
                    return None
                if prior["status"] == "resolved":
                    if (
                        prior["resolved_by_actor_ref"] == operator_actor_ref
                        and prior["resolution_reason"] == reason
                    ):
                        return self._report(prior)
                    raise TutorApplicationConflictError
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_message_report
                            SET status = 'resolved', resolved_by_actor_ref = :operator,
                                resolution_reason = :reason, resolved_at = :now
                            WHERE report_id = :report_id AND status = 'open'
                            RETURNING *
                            """
                        ),
                        {
                            "operator": operator_actor_ref,
                            "reason": reason,
                            "now": now,
                            "report_id": report_id,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                connection.execute(
                    text(
                        """
                        INSERT INTO marketplace_message_report_access_audit
                          (audit_id, report_id, operator_actor_ref, action, reason)
                        VALUES (:audit_id, :report_id, :operator, 'resolved', :reason)
                        """
                    ),
                    {
                        "audit_id": uuid4(),
                        "report_id": report_id,
                        "operator": operator_actor_ref,
                        "reason": reason,
                    },
                )
                return self._report(row)
        except TutorApplicationConflictError:
            raise
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def purge_expired_messages(self, *, cutoff: datetime, limit: int) -> int:
        try:
            with self._engine.begin() as connection:
                removed = connection.execute(
                    text(
                        """
                        DELETE FROM marketplace_message WHERE message_id IN (
                          SELECT message.message_id FROM marketplace_message AS message
                          WHERE message.created_at < :cutoff
                            AND NOT EXISTS (
                              SELECT 1 FROM marketplace_message_report AS report
                              WHERE report.message_id = message.message_id
                            )
                          ORDER BY message.created_at, message.message_id LIMIT :limit
                        )
                        """
                    ),
                    {"cutoff": cutoff, "limit": limit},
                )
                return removed.rowcount
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def purge_bounded_events(self, *, limit: int) -> int:
        try:
            with self._engine.begin() as connection:
                return int(
                    connection.execute(
                        text("SELECT marketplace_purge_bounded_events(:limit)"),
                        {"limit": limit},
                    ).scalar_one()
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_notification_preference(self, *, actor_ref: str) -> bool:
        try:
            with self._engine.connect() as connection:
                value = connection.execute(
                    text(
                        "SELECT email_enabled FROM marketplace_message_notification_preference "
                        "WHERE actor_ref = :actor_ref"
                    ),
                    {"actor_ref": actor_ref},
                ).scalar_one_or_none()
                return True if value is None else bool(value)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def set_notification_preference(self, *, actor_ref: str, email_enabled: bool) -> bool:
        try:
            with self._engine.begin() as connection:
                result = bool(
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_message_notification_preference
                              (actor_ref, email_enabled)
                            VALUES (:actor_ref, :email_enabled)
                            ON CONFLICT (actor_ref) DO UPDATE
                            SET email_enabled = excluded.email_enabled, updated_at = now()
                            RETURNING email_enabled
                            """
                        ),
                        {"actor_ref": actor_ref, "email_enabled": email_enabled},
                    ).scalar_one()
                )
                if not email_enabled:
                    connection.execute(
                        text(
                            "UPDATE marketplace_message_notification_job SET status = 'dead', "
                            "lease_owner = NULL, lease_expires_at = NULL, "
                            "safe_failure_code = 'rejected', updated_at = now() "
                            "WHERE recipient_actor_ref = :actor_ref AND template = 'new_message' "
                            "AND status IN ('queued', 'retryable')"
                        ),
                        {"actor_ref": actor_ref},
                    )
                return result
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def claim_notification(
        self, *, lease_owner: str, now: datetime, lease_seconds: int
    ) -> StoredNotificationJob | None:
        try:
            with self._engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        UPDATE marketplace_message_notification_job
                        SET status = 'dead', lease_owner = NULL, lease_expires_at = NULL,
                            safe_failure_code = 'unavailable', updated_at = :now
                        WHERE status = 'leased' AND attempt >= 8
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
                              SELECT job_id FROM marketplace_message_notification_job
                              WHERE ((status IN ('queued', 'retryable') AND available_at <= :now)
                                  OR (status = 'leased' AND lease_expires_at <= :now))
                                AND attempt < 8
                              ORDER BY available_at, created_at, job_id
                              FOR UPDATE SKIP LOCKED LIMIT 1
                            )
                            UPDATE marketplace_message_notification_job AS job
                            SET status = 'leased', attempt = attempt + 1,
                                lease_owner = :lease_owner,
                                lease_expires_at = :lease_expires_at, updated_at = :now
                            FROM claimable WHERE job.job_id = claimable.job_id
                            RETURNING job.job_id, job.message_id, job.recipient_actor_ref,
                                      job.attempt, job.lease_owner, job.lease_expires_at,
                                      job.template
                            """
                        ),
                        {
                            "now": now,
                            "lease_owner": lease_owner,
                            "lease_expires_at": now + timedelta(seconds=lease_seconds),
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                return StoredNotificationJob(**dict(row)) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def finish_notification(
        self,
        *,
        job_id: UUID,
        lease_owner: str,
        now: datetime,
        outcome: Literal["completed", "retryable", "rejected"],
    ) -> bool:
        status = "dead" if outcome == "rejected" else outcome
        code = (
            None
            if outcome == "completed"
            else "rejected"
            if outcome == "rejected"
            else "unavailable"
        )
        try:
            with self._engine.begin() as connection:
                return (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_message_notification_job
                            SET status = CASE
                                  WHEN :status = 'retryable' AND attempt >= 8 THEN 'dead'
                                  ELSE :status END,
                                lease_owner = NULL, lease_expires_at = NULL,
                                safe_failure_code = :code,
                                available_at = CASE WHEN :status = 'retryable'
                                  THEN :now + make_interval(
                                    secs => least(3600, 30 * power(2, attempt))
                                  )
                                  ELSE available_at END,
                                updated_at = :now
                            WHERE job_id = :job_id AND status = 'leased'
                              AND lease_owner = :lease_owner
                            RETURNING 1
                            """
                        ),
                        {
                            "status": status,
                            "code": code,
                            "now": now,
                            "job_id": job_id,
                            "lease_owner": lease_owner,
                        },
                    ).scalar_one_or_none()
                    is not None
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def recover_notifications(
        self,
        *,
        conversation_id: UUID,
        operator_actor_ref: str,
        reason: str,
        now: datetime,
    ) -> bool:
        try:
            with self._engine.begin() as connection:
                if not self._has_report_capability(connection, operator_actor_ref):
                    return False
                recovered = connection.execute(
                    text(
                        "UPDATE marketplace_message_notification_job AS job "
                        "SET status = 'queued', attempt = 0, available_at = :now, "
                        "lease_owner = NULL, lease_expires_at = NULL, "
                        "safe_failure_code = NULL, updated_at = :now "
                        "FROM marketplace_message AS message "
                        "WHERE job.message_id = message.message_id "
                        "AND message.conversation_id = :conversation_id "
                        "AND job.status = 'dead'"
                    ),
                    {"conversation_id": conversation_id, "now": now},
                ).rowcount
                if recovered == 0:
                    return bool(
                        connection.execute(
                            text(
                                "SELECT 1 FROM marketplace_notification_recovery_audit "
                                "WHERE conversation_id = :conversation_id "
                                "AND operator_actor_ref = :actor AND reason = :reason"
                            ),
                            {
                                "conversation_id": conversation_id,
                                "actor": operator_actor_ref,
                                "reason": reason,
                            },
                        ).scalar_one_or_none()
                    )
                connection.execute(
                    text(
                        "INSERT INTO marketplace_notification_recovery_audit "
                        "(audit_id, conversation_id, operator_actor_ref, reason, "
                        "jobs_requeued, occurred_at) VALUES (:audit_id, :conversation_id, "
                        ":actor, :reason, :jobs, :now)"
                    ),
                    {
                        "audit_id": uuid4(),
                        "conversation_id": conversation_id,
                        "actor": operator_actor_ref,
                        "reason": reason,
                        "jobs": recovered,
                        "now": now,
                    },
                )
                return True
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    @staticmethod
    def _has_report_capability(connection: object, actor_ref: str) -> bool:
        from sqlalchemy.engine import Connection

        assert isinstance(connection, Connection)
        return (
            connection.execute(
                text(
                    """
                    SELECT 1 FROM marketplace_operator_capability
                    WHERE actor_ref = :actor_ref AND capability = 'review_message_reports'
                      AND revoked_at IS NULL
                    """
                ),
                {"actor_ref": actor_ref},
            ).scalar_one_or_none()
            is not None
        )

    @staticmethod
    def _conversation(row: object) -> StoredConversation:
        from sqlalchemy.engine import RowMapping

        assert isinstance(row, RowMapping)
        return StoredConversation(
            conversation_id=row["conversation_id"],
            learner_actor_ref=row["learner_actor_ref"],
            tutor_id=row["tutor_id"],
            tutor_actor_ref=row["tutor_actor_ref"],
            booking_id=row["booking_id"],
            state=row["state"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _message(row: object) -> StoredMessage:
        from sqlalchemy.engine import RowMapping

        assert isinstance(row, RowMapping)
        return StoredMessage(
            message_id=row["message_id"],
            conversation_id=row["conversation_id"],
            sender_actor_ref=row["sender_actor_ref"],
            kind=row["kind"],
            body=row["body"],
            client_message_id=row["client_message_id"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _report(row: object) -> StoredReport:
        from sqlalchemy.engine import RowMapping

        assert isinstance(row, RowMapping)
        return StoredReport(
            report_id=row["report_id"],
            conversation_id=row["conversation_id"],
            message_id=row["message_id"],
            reporter_actor_ref=row["reporter_actor_ref"],
            subject_actor_ref=row["subject_actor_ref"],
            reason=row["reason"],
            details=row["details"],
            status=row["status"],
            resolution_reason=row["resolution_reason"],
            created_at=row["created_at"],
            resolved_at=row["resolved_at"],
        )


class MessagingService:
    def __init__(
        self,
        *,
        enabled: bool,
        repository: MessagingRepository,
        pseudonym_key: bytes | None,
        actor_allowlist: tuple[str, ...],
        retention_days: int | None,
        accepting_new_conversations: bool = True,
        notification_provider: MarketplaceNotificationProvider | None = None,
        system_notifications_enabled: bool = False,
        provider_retention_enabled: bool = False,
    ) -> None:
        self._enabled = enabled
        self._repository = repository
        self._pseudonym_key = pseudonym_key
        self._actor_allowlist = frozenset(actor_allowlist)
        self._retention_days = retention_days
        self._accepting_new_conversations = accepting_new_conversations
        self._notification_provider = notification_provider
        self._system_notifications_enabled = system_notifications_enabled
        self._provider_retention_enabled = provider_retention_enabled

    async def create_conversation(
        self, *, principal: ClerkPrincipal, tutor_id: UUID
    ) -> ConversationView:
        if not self._accepting_new_conversations:
            raise HumanTutorMarketplaceUnavailableError
        actor_ref = self._actor_ref(principal)
        conversation = await asyncio.to_thread(
            self._repository.create_prebooking_conversation,
            learner_actor_ref=actor_ref,
            tutor_id=tutor_id,
        )
        if conversation is None:
            raise TutorApplicationNotFoundError
        return self._conversation_view(conversation, actor_ref)

    async def list_conversations(
        self, *, principal: ClerkPrincipal, cursor: str | None, limit: int
    ) -> tuple[tuple[ConversationView, ...], str | None]:
        actor_ref = self._actor_ref(principal)
        before_created_at, before_conversation_id = self._decode_conversation_cursor(cursor)
        conversations, has_more = await asyncio.to_thread(
            self._repository.list_conversations,
            actor_ref=actor_ref,
            before_created_at=before_created_at,
            before_conversation_id=before_conversation_id,
            limit=limit,
        )
        return (
            tuple(self._conversation_view(value, actor_ref) for value in conversations),
            self._encode_conversation_cursor(conversations[-1])
            if has_more and conversations
            else None,
        )

    async def list_messages(
        self,
        *,
        principal: ClerkPrincipal,
        conversation_id: UUID,
        cursor: str | None,
        limit: int,
    ) -> MessagePage:
        actor_ref = self._actor_ref(principal)
        conversation = await asyncio.to_thread(
            self._repository.get_conversation,
            conversation_id=conversation_id,
            actor_ref=actor_ref,
        )
        if conversation is None:
            raise TutorApplicationNotFoundError
        before_created_at, before_message_id = self._decode_cursor(cursor)
        messages, has_more = await asyncio.to_thread(
            self._repository.list_messages,
            conversation_id=conversation_id,
            actor_ref=actor_ref,
            before_created_at=before_created_at,
            before_message_id=before_message_id,
            limit=limit,
        )
        next_cursor = self._encode_cursor(messages[0]) if has_more and messages else None
        return MessagePage(
            tuple(self._message_view(value, conversation, actor_ref) for value in messages),
            next_cursor,
        )

    async def send_message(
        self,
        *,
        principal: ClerkPrincipal,
        conversation_id: UUID,
        client_message_id: UUID,
        body: str,
    ) -> MessageView:
        actor_ref = self._actor_ref(principal)
        conversation = await asyncio.to_thread(
            self._repository.get_conversation,
            conversation_id=conversation_id,
            actor_ref=actor_ref,
        )
        if conversation is None:
            raise TutorApplicationNotFoundError
        safe_body = validate_message_body(body, prebooking=conversation.booking_id is None)
        result, message = await asyncio.to_thread(
            self._repository.send_message,
            conversation_id=conversation_id,
            actor_ref=actor_ref,
            client_message_id=client_message_id,
            body=safe_body,
            now=datetime.now(UTC),
        )
        if result == "limited":
            raise MarketplaceMessageLimitedError
        if result == "blocked":
            raise HumanTutorMarketplaceForbiddenError
        if result == "missing" or message is None:
            raise TutorApplicationConflictError
        return self._message_view(message, conversation, actor_ref)

    async def block_other(self, *, principal: ClerkPrincipal, conversation_id: UUID) -> None:
        actor_ref = self._actor_ref(principal)
        if not await asyncio.to_thread(
            self._repository.block_other,
            conversation_id=conversation_id,
            actor_ref=actor_ref,
        ):
            raise TutorApplicationNotFoundError

    async def report(
        self,
        *,
        principal: ClerkPrincipal,
        conversation_id: UUID,
        message_id: UUID | None,
        reason: ReportReason,
        details: str | None,
    ) -> ReportView:
        actor_ref = self._actor_ref(principal)
        report = await asyncio.to_thread(
            self._repository.create_report,
            report_id=uuid4(),
            conversation_id=conversation_id,
            message_id=message_id,
            reporter_actor_ref=actor_ref,
            reason=reason,
            details=details.strip() if details is not None else None,
            now=datetime.now(UTC),
        )
        if report is None:
            raise TutorApplicationConflictError
        return self._report_view(report)

    async def list_reports(
        self, *, principal: ClerkPrincipal, offset: int, limit: int
    ) -> tuple[tuple[ReportView, ...], int | None]:
        result = await asyncio.to_thread(
            self._repository.list_reports_for_operator,
            operator_actor_ref=self._actor_ref(principal),
            offset=offset,
            limit=limit,
        )
        if result is None:
            raise HumanTutorMarketplaceForbiddenError
        reports, has_more = result
        return (
            tuple(self._report_view(report) for report in reports),
            offset + limit if has_more else None,
        )

    async def get_report(self, *, principal: ClerkPrincipal, report_id: UUID) -> ReportView:
        result = await asyncio.to_thread(
            self._repository.get_report_for_operator,
            operator_actor_ref=self._actor_ref(principal),
            report_id=report_id,
        )
        if result is None:
            raise HumanTutorMarketplaceForbiddenError
        report, conversation, messages = result
        return ReportView(
            report_id=report.report_id,
            conversation_id=report.conversation_id,
            message_id=report.message_id,
            reason=report.reason,
            details=report.details,
            status=report.status,
            created_at=report.created_at,
            messages=tuple(
                self._message_view(message, conversation, actor_ref="") for message in messages
            ),
        )

    async def resolve_report(
        self, *, principal: ClerkPrincipal, report_id: UUID, reason: str
    ) -> ReportView:
        report = await asyncio.to_thread(
            self._repository.resolve_report,
            operator_actor_ref=self._actor_ref(principal),
            report_id=report_id,
            reason=reason.strip(),
            now=datetime.now(UTC),
        )
        if report is None:
            raise HumanTutorMarketplaceForbiddenError
        return self._report_view(report)

    async def recover_notifications(
        self, *, principal: ClerkPrincipal, conversation_id: UUID, reason: str
    ) -> None:
        self._require_enabled()
        if not await asyncio.to_thread(
            self._repository.recover_notifications,
            conversation_id=conversation_id,
            operator_actor_ref=self._actor_ref(principal),
            reason=reason,
            now=datetime.now(UTC),
        ):
            raise HumanTutorMarketplaceForbiddenError

    async def purge_expired(self, *, now: datetime, limit: int = 1000) -> int:
        self._require_enabled()
        if self._retention_days is None:
            raise HumanTutorMarketplaceUnavailableError
        return await asyncio.to_thread(
            self._repository.purge_expired_messages,
            cutoff=now - timedelta(days=self._retention_days),
            limit=limit,
        )

    async def run_one_notification_job(self, *, worker: str) -> bool:
        if (
            not (self._enabled or self._system_notifications_enabled)
            or self._notification_provider is None
        ):
            return False
        now = datetime.now(UTC)
        job = await asyncio.to_thread(
            self._repository.claim_notification,
            lease_owner=worker,
            now=now,
            lease_seconds=60,
        )
        if job is None:
            return False
        if job.template == "new_message" and not await asyncio.to_thread(
            self._repository.get_notification_preference,
            actor_ref=job.recipient_actor_ref,
        ):
            await asyncio.to_thread(
                self._repository.finish_notification,
                job_id=job.job_id,
                lease_owner=worker,
                now=datetime.now(UTC),
                outcome="rejected",
            )
            return True
        outcome = await self._notification_provider.deliver(
            recipient_actor_ref=job.recipient_actor_ref,
            template=job.template,
            idempotency_key=f"marketplace-message:{job.job_id}",
        )
        await asyncio.to_thread(
            self._repository.finish_notification,
            job_id=job.job_id,
            lease_owner=worker,
            now=datetime.now(UTC),
            outcome=outcome,
        )
        return True

    async def run_retention_batch(self, *, now: datetime, limit: int = 1000) -> bool:
        if not self._enabled or self._retention_days is None:
            return False
        return bool(
            await asyncio.to_thread(
                self._repository.purge_expired_messages,
                cutoff=now - timedelta(days=self._retention_days),
                limit=limit,
            )
        )

    async def run_provider_retention_batch(self, *, limit: int = 1000) -> bool:
        if not self._provider_retention_enabled:
            return False
        return bool(await asyncio.to_thread(self._repository.purge_bounded_events, limit=limit))

    async def get_notification_preference(self, *, principal: ClerkPrincipal) -> bool:
        return await asyncio.to_thread(
            self._repository.get_notification_preference,
            actor_ref=self._actor_ref(principal),
        )

    async def set_notification_preference(
        self, *, principal: ClerkPrincipal, email_enabled: bool
    ) -> bool:
        return await asyncio.to_thread(
            self._repository.set_notification_preference,
            actor_ref=self._actor_ref(principal),
            email_enabled=email_enabled,
        )

    def _actor_ref(self, principal: ClerkPrincipal) -> str:
        self._require_enabled()
        if principal.user_id not in self._actor_allowlist or self._pseudonym_key is None:
            raise HumanTutorMarketplaceForbiddenError
        return derive_marketplace_actor_ref(
            key=self._pseudonym_key, clerk_user_id=principal.user_id
        )

    def _require_enabled(self) -> None:
        if not self._enabled or self._retention_days is None:
            raise HumanTutorMarketplaceUnavailableError

    @staticmethod
    def _conversation_view(value: StoredConversation, actor_ref: str) -> ConversationView:
        return ConversationView(
            value.conversation_id,
            value.tutor_id,
            "learner" if value.learner_actor_ref == actor_ref else "tutor",
            value.state,
            value.updated_at,
        )

    @staticmethod
    def _message_view(
        value: StoredMessage, conversation: StoredConversation, actor_ref: str
    ) -> MessageView:
        sender_role: Literal["learner", "tutor", "system"] = (
            "system"
            if value.sender_actor_ref is None
            else "learner"
            if value.sender_actor_ref == conversation.learner_actor_ref
            else "tutor"
        )
        return MessageView(
            value.message_id,
            value.kind,
            sender_role,
            value.body,
            value.sender_actor_ref == actor_ref,
            value.created_at,
        )

    @staticmethod
    def _report_view(value: StoredReport) -> ReportView:
        return ReportView(
            value.report_id,
            value.conversation_id,
            value.message_id,
            value.reason,
            value.details,
            value.status,
            value.created_at,
        )

    @staticmethod
    def _encode_cursor(value: StoredMessage) -> str:
        payload = json.dumps(
            [value.created_at.astimezone(UTC).isoformat(), str(value.message_id)],
            separators=(",", ":"),
        ).encode()
        return base64.urlsafe_b64encode(payload).decode().rstrip("=")

    @staticmethod
    def _encode_conversation_cursor(value: StoredConversation) -> str:
        payload = json.dumps(
            [value.created_at.astimezone(UTC).isoformat(), str(value.conversation_id)],
            separators=(",", ":"),
        ).encode()
        return base64.urlsafe_b64encode(payload).decode().rstrip("=")

    @staticmethod
    def _decode_conversation_cursor(cursor: str | None) -> tuple[datetime | None, UUID | None]:
        return MessagingService._decode_timestamp_cursor(cursor)

    @staticmethod
    def _decode_cursor(cursor: str | None) -> tuple[datetime | None, UUID | None]:
        return MessagingService._decode_timestamp_cursor(cursor)

    @staticmethod
    def _decode_timestamp_cursor(cursor: str | None) -> tuple[datetime | None, UUID | None]:
        if cursor is None:
            return None, None
        try:
            if len(cursor) > 512:
                raise ValueError
            decoded = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
            value = json.loads(decoded)
            if not isinstance(value, list) or len(value) != 2:
                raise ValueError
            timestamp = datetime.fromisoformat(value[0])
            message_id = UUID(value[1])
            if timestamp.tzinfo is None:
                raise ValueError
            return timestamp, message_id
        except (TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
            raise TutorApplicationConflictError from None


def validate_message_body(body: str, *, prebooking: bool) -> str:
    value = body.strip()
    if not 1 <= len(value) <= 2000:
        raise TutorApplicationConflictError
    if any(ord(character) < 32 and character not in {"\n", "\t"} for character in value):
        raise TutorApplicationConflictError
    if prebooking and CONTACT_PATTERN.search(value):
        raise TutorApplicationConflictError
    return value


def validate_approved_meeting_url(url: str, *, approved_hosts: tuple[str, ...]) -> str:
    if not 12 <= len(url) <= 1000:
        raise ValueError("meeting URL length is invalid")
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in frozenset(approved_hosts)
        or parsed.username is not None
        or parsed.password is not None
        or not parsed.path.startswith("/")
        or parsed.fragment
    ):
        raise ValueError("meeting URL is not on an approved HTTPS host")
    return url
