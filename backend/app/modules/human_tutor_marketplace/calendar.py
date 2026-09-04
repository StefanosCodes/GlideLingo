"""Google Calendar free/busy boundary with one-time OAuth state and encrypted tokens."""

import asyncio
import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol
from urllib.parse import urlencode
from uuid import UUID, uuid4

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    DependencyUnavailableError,
    HumanTutorMarketplaceForbiddenError,
    HumanTutorMarketplaceUnavailableError,
    TutorApplicationConflictError,
    TutorApplicationNotFoundError,
)
from app.modules.human_tutor_marketplace.availability import TimeInterval
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref

GOOGLE_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy"
MAX_BUSY_INTERVALS = 512
MAX_PROVIDER_BYTES = 1_048_576
OAUTH_STATE_TTL = timedelta(minutes=10)
BUSY_CACHE_TTL = timedelta(minutes=10)

CalendarStatus = Literal["disconnected", "connected", "stale", "reconnect_required"]
CalendarFreshness = Literal["not_connected", "current", "stale", "reconnect_required"]
ProviderFailureCode = Literal[
    "rate_limited", "timeout", "unavailable", "revoked", "invalid_response"
]


class CalendarProviderError(Exception):
    def __init__(self, code: ProviderFailureCode) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class ProviderToken:
    refresh_token: str
    granted_scopes: frozenset[str]


@dataclass(frozen=True, slots=True)
class StoredCalendarConnection:
    tutor_id: UUID
    actor_ref: str
    encrypted_refresh_token: bytes | None
    token_key_version: int | None
    status: Literal["connected", "stale", "reconnect_required", "revoked"]
    last_refreshed_at: datetime | None
    cache_expires_at: datetime | None
    safe_failure_code: str | None
    version: int


@dataclass(frozen=True, slots=True)
class CalendarBusySnapshot:
    freshness: CalendarFreshness
    intervals: tuple[TimeInterval, ...]
    refreshed_at: datetime | None


@dataclass(frozen=True, slots=True)
class CalendarConnectionView:
    status: CalendarStatus
    freshness: CalendarFreshness
    last_refreshed_at: datetime | None
    safe_failure_code: str | None


@dataclass(frozen=True, slots=True)
class CalendarOAuthStart:
    authorization_url: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class StoredCalendarRefreshJob:
    job_id: UUID
    attempt: int
    connection: StoredCalendarConnection


class CalendarProvider(Protocol):
    def authorization_url(self, *, state: str, redirect_uri: str) -> str: ...

    async def exchange_code(self, *, code: str, redirect_uri: str) -> ProviderToken: ...

    async def fetch_busy(
        self, *, refresh_token: str, starts_at: datetime, ends_at: datetime
    ) -> tuple[TimeInterval, ...]: ...

    async def revoke(self, *, refresh_token: str) -> None: ...

    async def close(self) -> None: ...


class CalendarRepository(Protocol):
    def get_approved_tutor_id(self, *, actor_ref: str) -> UUID | None: ...

    def insert_oauth_state(
        self,
        *,
        state_hash: bytes,
        tutor_id: UUID,
        actor_ref: str,
        redirect_uri: str,
        expires_at: datetime,
    ) -> None: ...

    def consume_oauth_state(
        self,
        *,
        state_hash: bytes,
        tutor_id: UUID,
        actor_ref: str,
        redirect_uri: str,
        now: datetime,
    ) -> bool: ...

    def upsert_connection(
        self,
        *,
        tutor_id: UUID,
        actor_ref: str,
        encrypted_refresh_token: bytes,
        token_key_version: int,
    ) -> StoredCalendarConnection: ...

    def get_connection_by_actor(self, *, actor_ref: str) -> StoredCalendarConnection | None: ...

    def get_connection_by_tutor(self, *, tutor_id: UUID) -> StoredCalendarConnection | None: ...

    def replace_busy_cache(
        self,
        *,
        tutor_id: UUID,
        expected_version: int,
        intervals: tuple[TimeInterval, ...],
        refreshed_at: datetime,
        expires_at: datetime,
    ) -> StoredCalendarConnection | None: ...

    def mark_failure(
        self,
        *,
        tutor_id: UUID,
        expected_version: int,
        code: ProviderFailureCode,
        reconnect_required: bool,
    ) -> StoredCalendarConnection | None: ...

    def delete_connection(self, *, actor_ref: str, expected_version: int) -> bool: ...

    def get_busy_snapshot(self, *, tutor_id: UUID, now: datetime) -> CalendarBusySnapshot: ...

    def claim_refresh(
        self, *, worker: str, now: datetime, lease_seconds: int
    ) -> StoredCalendarRefreshJob | None: ...

    def finish_refresh(
        self,
        *,
        job_id: UUID,
        worker: str,
        now: datetime,
        outcome: Literal["completed", "retryable", "dead"],
        available_at: datetime,
        failure_code: str | None,
    ) -> bool: ...


class CalendarTokenCipher:
    """AES-GCM boundary; ciphertext is bound to the tutor and actor pseudonym."""

    def __init__(self, *, key: bytes, key_version: int = 1) -> None:
        if len(key) != 32:
            raise ValueError("calendar token encryption key must be exactly 32 bytes")
        if not 1 <= key_version <= 32767:
            raise ValueError("calendar token key version is invalid")
        self._cipher = AESGCM(key)
        self.key_version = key_version

    def encrypt(self, *, tutor_id: UUID, actor_ref: str, token: str) -> bytes:
        if not 1 <= len(token.encode()) <= 4096:
            raise ValueError("calendar refresh token length is invalid")
        nonce = secrets.token_bytes(12)
        return nonce + self._cipher.encrypt(nonce, token.encode(), self._aad(tutor_id, actor_ref))

    def decrypt(self, *, tutor_id: UUID, actor_ref: str, ciphertext: bytes) -> str:
        if len(ciphertext) < 29:
            raise ValueError("calendar refresh token ciphertext is invalid")
        value = self._cipher.decrypt(
            ciphertext[:12], ciphertext[12:], self._aad(tutor_id, actor_ref)
        )
        return value.decode()

    def _aad(self, tutor_id: UUID, actor_ref: str) -> bytes:
        return f"google-calendar-token:v{self.key_version}:{tutor_id}:{actor_ref}".encode()


class PostgresCalendarRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def get_approved_tutor_id(self, *, actor_ref: str) -> UUID | None:
        try:
            with self._engine.connect() as connection:
                return connection.execute(
                    text(
                        """
                        SELECT profile.tutor_id
                        FROM marketplace_tutor_profile AS profile
                        JOIN marketplace_tutor_application AS application
                          ON application.application_id = profile.application_id
                        WHERE profile.actor_ref = :actor_ref AND application.status = 'approved'
                        """
                    ),
                    {"actor_ref": actor_ref},
                ).scalar_one_or_none()
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def insert_oauth_state(
        self,
        *,
        state_hash: bytes,
        tutor_id: UUID,
        actor_ref: str,
        redirect_uri: str,
        expires_at: datetime,
    ) -> None:
        try:
            with self._engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        INSERT INTO marketplace_calendar_oauth_state
                          (state_hash, tutor_id, actor_ref, redirect_uri, expires_at)
                        VALUES (:state_hash, :tutor_id, :actor_ref, :redirect_uri, :expires_at)
                        """
                    ),
                    {
                        "state_hash": state_hash,
                        "tutor_id": tutor_id,
                        "actor_ref": actor_ref,
                        "redirect_uri": redirect_uri,
                        "expires_at": expires_at,
                    },
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def consume_oauth_state(
        self,
        *,
        state_hash: bytes,
        tutor_id: UUID,
        actor_ref: str,
        redirect_uri: str,
        now: datetime,
    ) -> bool:
        try:
            with self._engine.begin() as connection:
                return (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_calendar_oauth_state
                            SET consumed_at = :now
                            WHERE state_hash = :state_hash AND tutor_id = :tutor_id
                              AND actor_ref = :actor_ref AND redirect_uri = :redirect_uri
                              AND consumed_at IS NULL AND expires_at >= :now
                            RETURNING 1
                            """
                        ),
                        {
                            "state_hash": state_hash,
                            "tutor_id": tutor_id,
                            "actor_ref": actor_ref,
                            "redirect_uri": redirect_uri,
                            "now": now,
                        },
                    ).scalar_one_or_none()
                    is not None
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def upsert_connection(
        self,
        *,
        tutor_id: UUID,
        actor_ref: str,
        encrypted_refresh_token: bytes,
        token_key_version: int,
    ) -> StoredCalendarConnection:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_calendar_connection
                              (tutor_id, actor_ref, encrypted_refresh_token, token_key_version,
                               granted_scope)
                            VALUES (:tutor_id, :actor_ref, :token, :key_version, :scope)
                            ON CONFLICT (tutor_id) DO UPDATE
                            SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
                                token_key_version = EXCLUDED.token_key_version,
                                granted_scope = EXCLUDED.granted_scope,
                                status = 'connected', cache_generation = NULL,
                                last_refreshed_at = NULL, cache_expires_at = NULL,
                                safe_failure_code = NULL,
                                version = marketplace_calendar_connection.version + 1,
                                updated_at = now()
                            WHERE marketplace_calendar_connection.actor_ref = EXCLUDED.actor_ref
                            RETURNING tutor_id, actor_ref, encrypted_refresh_token,
                                      token_key_version, status, last_refreshed_at,
                                      cache_expires_at, safe_failure_code, version
                            """
                        ),
                        {
                            "tutor_id": tutor_id,
                            "actor_ref": actor_ref,
                            "token": encrypted_refresh_token,
                            "key_version": token_key_version,
                            "scope": GOOGLE_FREEBUSY_SCOPE,
                        },
                    )
                    .mappings()
                    .one()
                )
                connection.execute(
                    text(
                        "DELETE FROM marketplace_calendar_busy_interval WHERE tutor_id = :tutor_id"
                    ),
                    {"tutor_id": tutor_id},
                )
                connection.execute(
                    text(
                        """
                        INSERT INTO marketplace_calendar_refresh_job (job_id, tutor_id)
                        VALUES (:job_id, :tutor_id)
                        ON CONFLICT (tutor_id) DO UPDATE
                        SET status = 'queued', attempt = 0, available_at = now(),
                            lease_owner = NULL, lease_expires_at = NULL,
                            safe_failure_code = NULL, updated_at = now()
                        """
                    ),
                    {"job_id": uuid4(), "tutor_id": tutor_id},
                )
                return StoredCalendarConnection(**dict(row))
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_connection_by_actor(self, *, actor_ref: str) -> StoredCalendarConnection | None:
        return self._get_connection("actor_ref", actor_ref)

    def get_connection_by_tutor(self, *, tutor_id: UUID) -> StoredCalendarConnection | None:
        return self._get_connection("tutor_id", tutor_id)

    def _get_connection(self, column: str, value: str | UUID) -> StoredCalendarConnection | None:
        try:
            with self._engine.connect() as connection:
                row = (
                    connection.execute(
                        text(
                            f"""
                            SELECT tutor_id, actor_ref, encrypted_refresh_token, token_key_version,
                                   status, last_refreshed_at, cache_expires_at,
                                   safe_failure_code, version
                            FROM marketplace_calendar_connection WHERE {column} = :value
                            """
                        ),
                        {"value": value},
                    )
                    .mappings()
                    .one_or_none()
                )
                return StoredCalendarConnection(**dict(row)) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def replace_busy_cache(
        self,
        *,
        tutor_id: UUID,
        expected_version: int,
        intervals: tuple[TimeInterval, ...],
        refreshed_at: datetime,
        expires_at: datetime,
    ) -> StoredCalendarConnection | None:
        generation = uuid4()
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_calendar_connection
                            SET status = 'connected', cache_generation = :generation,
                                last_refreshed_at = :refreshed_at, cache_expires_at = :expires_at,
                                safe_failure_code = NULL, version = version + 1, updated_at = now()
                            WHERE tutor_id = :tutor_id AND version = :expected_version
                              AND encrypted_refresh_token IS NOT NULL
                            RETURNING tutor_id, actor_ref, encrypted_refresh_token,
                                      token_key_version, status, last_refreshed_at,
                                      cache_expires_at, safe_failure_code, version
                            """
                        ),
                        {
                            "generation": generation,
                            "refreshed_at": refreshed_at,
                            "expires_at": expires_at,
                            "tutor_id": tutor_id,
                            "expected_version": expected_version,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                if intervals:
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_calendar_busy_interval
                              (tutor_id, generation, starts_at, ends_at)
                            VALUES (:tutor_id, :generation, :starts_at, :ends_at)
                            """
                        ),
                        [
                            {
                                "tutor_id": tutor_id,
                                "generation": generation,
                                "starts_at": interval.starts_at,
                                "ends_at": interval.ends_at,
                            }
                            for interval in intervals
                        ],
                    )
                connection.execute(
                    text(
                        "DELETE FROM marketplace_calendar_busy_interval "
                        "WHERE tutor_id = :tutor_id AND generation <> :generation"
                    ),
                    {"tutor_id": tutor_id, "generation": generation},
                )
                return StoredCalendarConnection(**dict(row))
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def mark_failure(
        self,
        *,
        tutor_id: UUID,
        expected_version: int,
        code: ProviderFailureCode,
        reconnect_required: bool,
    ) -> StoredCalendarConnection | None:
        status = "reconnect_required" if reconnect_required else "stale"
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_calendar_connection
                            SET status = :status,
                                encrypted_refresh_token = CASE WHEN :reconnect THEN NULL
                                                               ELSE encrypted_refresh_token END,
                                token_key_version = CASE WHEN :reconnect THEN NULL
                                                         ELSE token_key_version END,
                                safe_failure_code = :code, version = version + 1, updated_at = now()
                            WHERE tutor_id = :tutor_id AND version = :expected_version
                            RETURNING tutor_id, actor_ref, encrypted_refresh_token,
                                      token_key_version, status, last_refreshed_at,
                                      cache_expires_at, safe_failure_code, version
                            """
                        ),
                        {
                            "status": status,
                            "reconnect": reconnect_required,
                            "code": code,
                            "tutor_id": tutor_id,
                            "expected_version": expected_version,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if reconnect_required:
                    connection.execute(
                        text(
                            "DELETE FROM marketplace_calendar_busy_interval "
                            "WHERE tutor_id = :tutor_id"
                        ),
                        {"tutor_id": tutor_id},
                    )
                return StoredCalendarConnection(**dict(row)) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def delete_connection(self, *, actor_ref: str, expected_version: int) -> bool:
        try:
            with self._engine.begin() as connection:
                return (
                    connection.execute(
                        text(
                            "DELETE FROM marketplace_calendar_connection "
                            "WHERE actor_ref = :actor_ref AND version = :expected_version "
                            "RETURNING 1"
                        ),
                        {"actor_ref": actor_ref, "expected_version": expected_version},
                    ).scalar_one_or_none()
                    is not None
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_busy_snapshot(self, *, tutor_id: UUID, now: datetime) -> CalendarBusySnapshot:
        connection = self.get_connection_by_tutor(tutor_id=tutor_id)
        if connection is None:
            return CalendarBusySnapshot("not_connected", (), None)
        if connection.status == "reconnect_required":
            return CalendarBusySnapshot("reconnect_required", (), connection.last_refreshed_at)
        if (
            connection.status != "connected"
            or connection.cache_expires_at is None
            or connection.cache_expires_at <= now
        ):
            return CalendarBusySnapshot("stale", (), connection.last_refreshed_at)
        try:
            with self._engine.connect() as database:
                intervals = tuple(
                    TimeInterval(row.starts_at, row.ends_at)
                    for row in database.execute(
                        text(
                            """
                            SELECT busy.starts_at, busy.ends_at
                            FROM marketplace_calendar_busy_interval AS busy
                            JOIN marketplace_calendar_connection AS calendar
                              ON calendar.tutor_id = busy.tutor_id
                             AND calendar.cache_generation = busy.generation
                            WHERE busy.tutor_id = :tutor_id
                            ORDER BY busy.starts_at, busy.ends_at
                            """
                        ),
                        {"tutor_id": tutor_id},
                    )
                )
            return CalendarBusySnapshot("current", intervals, connection.last_refreshed_at)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def claim_refresh(
        self, *, worker: str, now: datetime, lease_seconds: int
    ) -> StoredCalendarRefreshJob | None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            WITH claimable AS (
                              SELECT job_id FROM marketplace_calendar_refresh_job
                              WHERE ((status IN ('queued', 'retryable') AND available_at <= :now)
                                  OR (status = 'leased' AND lease_expires_at <= :now))
                                AND attempt < 8
                              ORDER BY available_at, created_at, job_id
                              FOR UPDATE SKIP LOCKED LIMIT 1
                            ), claimed AS (
                              UPDATE marketplace_calendar_refresh_job AS job
                              SET status = 'leased', attempt = attempt + 1,
                                  lease_owner = :worker, lease_expires_at = :expires,
                                  updated_at = :now
                              FROM claimable WHERE job.job_id = claimable.job_id
                              RETURNING job.job_id, job.tutor_id, job.attempt
                            )
                            SELECT claimed.job_id, claimed.attempt,
                                   calendar.tutor_id, calendar.actor_ref,
                                   calendar.encrypted_refresh_token,
                                   calendar.token_key_version, calendar.status,
                                   calendar.last_refreshed_at, calendar.cache_expires_at,
                                   calendar.safe_failure_code, calendar.version
                            FROM claimed JOIN marketplace_calendar_connection AS calendar
                              ON calendar.tutor_id = claimed.tutor_id
                            """
                        ),
                        {
                            "worker": worker,
                            "now": now,
                            "expires": now + timedelta(seconds=lease_seconds),
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                return StoredCalendarRefreshJob(
                    job_id=row["job_id"],
                    attempt=row["attempt"],
                    connection=StoredCalendarConnection(
                        **{
                            key: row[key]
                            for key in (
                                "tutor_id",
                                "actor_ref",
                                "encrypted_refresh_token",
                                "token_key_version",
                                "status",
                                "last_refreshed_at",
                                "cache_expires_at",
                                "safe_failure_code",
                                "version",
                            )
                        }
                    ),
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def finish_refresh(
        self,
        *,
        job_id: UUID,
        worker: str,
        now: datetime,
        outcome: Literal["completed", "retryable", "dead"],
        available_at: datetime,
        failure_code: str | None,
    ) -> bool:
        status = "queued" if outcome == "completed" else outcome
        try:
            with self._engine.begin() as connection:
                return (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_calendar_refresh_job
                            SET status = :status, attempt = CASE WHEN :status = 'queued'
                                  THEN 0 ELSE attempt END,
                                available_at = :available_at, lease_owner = NULL,
                                lease_expires_at = NULL, safe_failure_code = :failure_code,
                                updated_at = :now
                            WHERE job_id = :job_id AND status = 'leased'
                              AND lease_owner = :worker RETURNING 1
                            """
                        ),
                        {
                            "status": status,
                            "available_at": available_at,
                            "failure_code": failure_code,
                            "now": now,
                            "job_id": job_id,
                            "worker": worker,
                        },
                    ).scalar_one_or_none()
                    is not None
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error


class CalendarService:
    def __init__(
        self,
        *,
        enabled: bool,
        repository: CalendarRepository,
        provider: CalendarProvider | None,
        cipher: CalendarTokenCipher | None,
        state_key: bytes | None,
        pseudonym_key: bytes | None,
        actor_allowlist: tuple[str, ...],
        redirect_allowlist: tuple[str, ...],
    ) -> None:
        self._enabled = enabled
        self._repository = repository
        self._provider = provider
        self._cipher = cipher
        self._state_key = state_key
        self._pseudonym_key = pseudonym_key
        self._actor_allowlist = frozenset(actor_allowlist)
        self._redirect_allowlist = frozenset(redirect_allowlist)

    async def status(self, *, principal: ClerkPrincipal) -> CalendarConnectionView:
        self._require_runtime()
        actor_ref = self._actor_ref(principal)
        connection = await asyncio.to_thread(
            self._repository.get_connection_by_actor, actor_ref=actor_ref
        )
        if connection is None:
            return CalendarConnectionView("disconnected", "not_connected", None, None)
        snapshot = await asyncio.to_thread(
            self._repository.get_busy_snapshot,
            tutor_id=connection.tutor_id,
            now=datetime.now(UTC),
        )
        status: CalendarStatus = (
            "reconnect_required"
            if connection.status == "reconnect_required"
            else "stale"
            if snapshot.freshness == "stale"
            else "connected"
        )
        return CalendarConnectionView(
            status, snapshot.freshness, connection.last_refreshed_at, connection.safe_failure_code
        )

    async def start_oauth(
        self, *, principal: ClerkPrincipal, redirect_uri: str
    ) -> CalendarOAuthStart:
        self._require_runtime()
        actor_ref = self._actor_ref(principal)
        self._validate_redirect(redirect_uri)
        tutor_id = await asyncio.to_thread(
            self._repository.get_approved_tutor_id, actor_ref=actor_ref
        )
        if tutor_id is None:
            raise TutorApplicationNotFoundError
        now = datetime.now(UTC)
        expires_at = now + OAUTH_STATE_TTL
        payload = {
            "a": actor_ref,
            "e": int(expires_at.timestamp()),
            "n": secrets.token_urlsafe(24),
            "r": redirect_uri,
            "t": str(tutor_id),
        }
        encoded = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
        assert self._state_key is not None
        signature = _b64(hmac.digest(self._state_key, f"v1.{encoded}".encode(), "sha256"))
        state = f"v1.{encoded}.{signature}"
        await asyncio.to_thread(
            self._repository.insert_oauth_state,
            state_hash=hashlib.sha256(state.encode()).digest(),
            tutor_id=tutor_id,
            actor_ref=actor_ref,
            redirect_uri=redirect_uri,
            expires_at=expires_at,
        )
        assert self._provider is not None
        return CalendarOAuthStart(
            self._provider.authorization_url(state=state, redirect_uri=redirect_uri), expires_at
        )

    async def complete_oauth(
        self,
        *,
        principal: ClerkPrincipal,
        state: str,
        code: str,
        redirect_uri: str,
    ) -> CalendarConnectionView:
        self._require_runtime()
        actor_ref = self._actor_ref(principal)
        self._validate_redirect(redirect_uri)
        tutor_id, expires_at = self._verify_state(
            state=state, actor_ref=actor_ref, redirect_uri=redirect_uri
        )
        now = datetime.now(UTC)
        if expires_at < now:
            raise TutorApplicationConflictError
        consumed = await asyncio.to_thread(
            self._repository.consume_oauth_state,
            state_hash=hashlib.sha256(state.encode()).digest(),
            tutor_id=tutor_id,
            actor_ref=actor_ref,
            redirect_uri=redirect_uri,
            now=now,
        )
        if not consumed:
            raise TutorApplicationConflictError
        assert self._provider is not None
        try:
            token = await self._provider.exchange_code(code=code, redirect_uri=redirect_uri)
        except CalendarProviderError as error:
            raise HumanTutorMarketplaceUnavailableError from error
        if token.granted_scopes != frozenset({GOOGLE_FREEBUSY_SCOPE}):
            raise HumanTutorMarketplaceUnavailableError
        assert self._cipher is not None
        ciphertext = self._cipher.encrypt(
            tutor_id=tutor_id, actor_ref=actor_ref, token=token.refresh_token
        )
        connection = await asyncio.to_thread(
            self._repository.upsert_connection,
            tutor_id=tutor_id,
            actor_ref=actor_ref,
            encrypted_refresh_token=ciphertext,
            token_key_version=self._cipher.key_version,
        )
        return CalendarConnectionView("connected", "stale", None, connection.safe_failure_code)

    async def refresh(
        self,
        *,
        principal: ClerkPrincipal,
        starts_at: datetime | None = None,
        ends_at: datetime | None = None,
    ) -> CalendarConnectionView:
        self._require_runtime()
        actor_ref = self._actor_ref(principal)
        connection = await asyncio.to_thread(
            self._repository.get_connection_by_actor, actor_ref=actor_ref
        )
        if connection is None:
            raise TutorApplicationNotFoundError
        if connection.encrypted_refresh_token is None or connection.token_key_version is None:
            return CalendarConnectionView(
                "reconnect_required",
                "reconnect_required",
                connection.last_refreshed_at,
                connection.safe_failure_code,
            )
        now = datetime.now(UTC)
        if (
            starts_at is None
            and ends_at is None
            and connection.status == "connected"
            and connection.cache_expires_at is not None
            and connection.cache_expires_at > now
        ):
            return CalendarConnectionView(
                "connected", "current", connection.last_refreshed_at, None
            )
        assert self._cipher is not None
        if connection.token_key_version != self._cipher.key_version:
            raise HumanTutorMarketplaceUnavailableError
        window_start = starts_at or now
        window_end = ends_at or now + timedelta(days=31)
        _validate_window(window_start, window_end)
        try:
            refresh_token = self._cipher.decrypt(
                tutor_id=connection.tutor_id,
                actor_ref=actor_ref,
                ciphertext=connection.encrypted_refresh_token,
            )
            assert self._provider is not None
            intervals = await self._provider.fetch_busy(
                refresh_token=refresh_token,
                starts_at=window_start,
                ends_at=window_end,
            )
            intervals = _normalize_busy(intervals, window_start, window_end)
        except CalendarProviderError as error:
            reconnect = error.code == "revoked"
            updated = await asyncio.to_thread(
                self._repository.mark_failure,
                tutor_id=connection.tutor_id,
                expected_version=connection.version,
                code=error.code,
                reconnect_required=reconnect,
            )
            if updated is None:
                raise TutorApplicationConflictError from None
            return CalendarConnectionView(
                "reconnect_required" if reconnect else "stale",
                "reconnect_required" if reconnect else "stale",
                updated.last_refreshed_at,
                error.code,
            )
        except (UnicodeDecodeError, ValueError) as error:
            raise HumanTutorMarketplaceUnavailableError from error
        updated = await asyncio.to_thread(
            self._repository.replace_busy_cache,
            tutor_id=connection.tutor_id,
            expected_version=connection.version,
            intervals=intervals,
            refreshed_at=now,
            expires_at=now + BUSY_CACHE_TTL,
        )
        if updated is None:
            raise TutorApplicationConflictError
        return CalendarConnectionView("connected", "current", now, None)

    async def revoke(self, *, principal: ClerkPrincipal) -> CalendarConnectionView:
        self._require_runtime()
        actor_ref = self._actor_ref(principal)
        connection = await asyncio.to_thread(
            self._repository.get_connection_by_actor, actor_ref=actor_ref
        )
        if connection is None:
            return CalendarConnectionView("disconnected", "not_connected", None, None)
        if connection.encrypted_refresh_token is not None:
            assert self._cipher is not None and self._provider is not None
            try:
                token = self._cipher.decrypt(
                    tutor_id=connection.tutor_id,
                    actor_ref=actor_ref,
                    ciphertext=connection.encrypted_refresh_token,
                )
                await self._provider.revoke(refresh_token=token)
            except CalendarProviderError:
                pass
        deleted = await asyncio.to_thread(
            self._repository.delete_connection,
            actor_ref=actor_ref,
            expected_version=connection.version,
        )
        if not deleted:
            raise TutorApplicationConflictError
        return CalendarConnectionView("disconnected", "not_connected", None, None)

    async def run_one_refresh_job(self, *, worker: str) -> bool:
        """Refresh one due free/busy cache behind a durable database lease."""

        if not self._enabled or self._provider is None or self._cipher is None:
            return False
        now = datetime.now(UTC)
        job = await asyncio.to_thread(
            self._repository.claim_refresh,
            worker=worker,
            now=now,
            lease_seconds=60,
        )
        if job is None:
            return False
        connection = job.connection
        outcome: Literal["completed", "retryable", "dead"] = "completed"
        failure_code: str | None = None
        available_at = now + BUSY_CACHE_TTL
        if (
            connection.encrypted_refresh_token is None
            or connection.token_key_version != self._cipher.key_version
        ):
            outcome, failure_code = "dead", "token_unavailable"
        else:
            try:
                token = self._cipher.decrypt(
                    tutor_id=connection.tutor_id,
                    actor_ref=connection.actor_ref,
                    ciphertext=connection.encrypted_refresh_token,
                )
                intervals = _normalize_busy(
                    await self._provider.fetch_busy(
                        refresh_token=token,
                        starts_at=now,
                        ends_at=now + timedelta(days=31),
                    ),
                    now,
                    now + timedelta(days=31),
                )
                updated = await asyncio.to_thread(
                    self._repository.replace_busy_cache,
                    tutor_id=connection.tutor_id,
                    expected_version=connection.version,
                    intervals=intervals,
                    refreshed_at=now,
                    expires_at=now + BUSY_CACHE_TTL,
                )
                if updated is None:
                    available_at = now + timedelta(seconds=30)
            except CalendarProviderError as error:
                reconnect = error.code == "revoked"
                await asyncio.to_thread(
                    self._repository.mark_failure,
                    tutor_id=connection.tutor_id,
                    expected_version=connection.version,
                    code=error.code,
                    reconnect_required=reconnect,
                )
                outcome = "dead" if reconnect or job.attempt >= 8 else "retryable"
                failure_code = error.code
                available_at = now + timedelta(minutes=2)
            except (UnicodeDecodeError, ValueError):
                outcome, failure_code = "dead", "invalid_token"
        await asyncio.to_thread(
            self._repository.finish_refresh,
            job_id=job.job_id,
            worker=worker,
            now=datetime.now(UTC),
            outcome=outcome,
            available_at=available_at,
            failure_code=failure_code,
        )
        return True

    def _require_runtime(self) -> None:
        if (
            not self._enabled
            or self._provider is None
            or self._cipher is None
            or self._state_key is None
            or len(self._state_key) < 32
        ):
            raise HumanTutorMarketplaceUnavailableError

    def _actor_ref(self, principal: ClerkPrincipal) -> str:
        if principal.user_id not in self._actor_allowlist or self._pseudonym_key is None:
            raise HumanTutorMarketplaceForbiddenError
        return derive_marketplace_actor_ref(
            key=self._pseudonym_key, clerk_user_id=principal.user_id
        )

    def _validate_redirect(self, redirect_uri: str) -> None:
        if redirect_uri not in self._redirect_allowlist:
            raise HumanTutorMarketplaceForbiddenError

    def _verify_state(
        self, *, state: str, actor_ref: str, redirect_uri: str
    ) -> tuple[UUID, datetime]:
        try:
            if len(state) > 2048:
                raise ValueError
            version, encoded, supplied = state.split(".")
            if version != "v1":
                raise ValueError
            assert self._state_key is not None
            expected = _b64(hmac.digest(self._state_key, f"v1.{encoded}".encode(), "sha256"))
            if not hmac.compare_digest(supplied, expected):
                raise ValueError
            payload = json.loads(_unb64(encoded))
            if (
                not isinstance(payload, dict)
                or payload.get("a") != actor_ref
                or payload.get("r") != redirect_uri
                or not isinstance(payload.get("e"), int)
                or not isinstance(payload.get("n"), str)
                or len(payload["n"]) < 20
            ):
                raise ValueError
            tutor_id = UUID(payload["t"])
            expires_at = datetime.fromtimestamp(payload["e"], tz=UTC)
            return tutor_id, expires_at
        except (AssertionError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            raise TutorApplicationConflictError from None


class GoogleCalendarHttpAdapter:
    """Narrow Google adapter: OAuth tokens in, UTC busy ranges out."""

    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._timeout_seconds = timeout_seconds
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds), transport=transport
        )

    def authorization_url(self, *, state: str, redirect_uri: str) -> str:
        query = urlencode(
            {
                "access_type": "offline",
                "client_id": self._client_id,
                "include_granted_scopes": "false",
                "prompt": "consent",
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": GOOGLE_FREEBUSY_SCOPE,
                "state": state,
            }
        )
        return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"

    async def exchange_code(self, *, code: str, redirect_uri: str) -> ProviderToken:
        payload = await self._post_json(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
        )
        refresh_token = payload.get("refresh_token")
        scope = payload.get("scope")
        if not isinstance(refresh_token, str) or not isinstance(scope, str):
            raise CalendarProviderError("invalid_response")
        return ProviderToken(refresh_token, frozenset(scope.split()))

    async def fetch_busy(
        self, *, refresh_token: str, starts_at: datetime, ends_at: datetime
    ) -> tuple[TimeInterval, ...]:
        token_payload = await self._post_json(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
        )
        access_token = token_payload.get("access_token")
        if not isinstance(access_token, str):
            raise CalendarProviderError("invalid_response")
        payload = await self._post_json(
            "https://www.googleapis.com/calendar/v3/freeBusy",
            json_body={
                "items": [{"id": "primary"}],
                "timeMax": ends_at.astimezone(UTC).isoformat(),
                "timeMin": starts_at.astimezone(UTC).isoformat(),
                "timeZone": "UTC",
            },
            headers={"Authorization": f"Bearer {access_token}"},
        )
        calendars = payload.get("calendars")
        primary = calendars.get("primary") if isinstance(calendars, dict) else None
        busy = primary.get("busy") if isinstance(primary, dict) else None
        if not isinstance(busy, list) or len(busy) > MAX_BUSY_INTERVALS:
            raise CalendarProviderError("invalid_response")
        intervals: list[TimeInterval] = []
        try:
            for item in busy:
                if not isinstance(item, dict) or set(item) != {"start", "end"}:
                    raise ValueError
                start = datetime.fromisoformat(item["start"].replace("Z", "+00:00"))
                end = datetime.fromisoformat(item["end"].replace("Z", "+00:00"))
                intervals.append(TimeInterval(start.astimezone(UTC), end.astimezone(UTC)))
        except (AttributeError, TypeError, ValueError) as error:
            raise CalendarProviderError("invalid_response") from error
        return tuple(intervals)

    async def revoke(self, *, refresh_token: str) -> None:
        try:
            response = await self._client.post(
                "https://oauth2.googleapis.com/revoke", data={"token": refresh_token}
            )
        except (httpx.HTTPError, OSError) as error:
            raise CalendarProviderError("unavailable") from error
        if response.status_code not in {200, 400}:
            raise self._status_error(response.status_code)

    async def _post_json(
        self,
        url: str,
        *,
        data: dict[str, str] | None = None,
        json_body: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, object]:
        try:
            async with asyncio.timeout(self._timeout_seconds):
                async with self._client.stream(
                    "POST", url, data=data, json=json_body, headers=headers
                ) as response:
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > MAX_PROVIDER_BYTES:
                            raise CalendarProviderError("invalid_response")
        except (TimeoutError, httpx.TimeoutException) as error:
            raise CalendarProviderError("timeout") from error
        except (httpx.HTTPError, OSError) as error:
            raise CalendarProviderError("unavailable") from error
        if response.status_code not in {200, 201}:
            if response.status_code == 400 and b"invalid_grant" in content[:4096]:
                raise CalendarProviderError("revoked")
            raise self._status_error(response.status_code)
        try:
            value = json.loads(content)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise CalendarProviderError("invalid_response") from error
        if not isinstance(value, dict):
            raise CalendarProviderError("invalid_response")
        return value

    @staticmethod
    def _status_error(status_code: int) -> CalendarProviderError:
        if status_code == 429:
            return CalendarProviderError("rate_limited")
        if status_code in {401, 403}:
            return CalendarProviderError("revoked")
        return CalendarProviderError("unavailable")

    async def close(self) -> None:
        await self._client.aclose()


def decode_calendar_encryption_key(value: str) -> bytes:
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, TypeError) as error:
        raise ValueError("calendar token encryption key must be base64url") from error
    if len(decoded) != 32:
        raise ValueError("calendar token encryption key must decode to exactly 32 bytes")
    return decoded


def _validate_window(starts_at: datetime, ends_at: datetime) -> None:
    if starts_at.tzinfo is None or ends_at.tzinfo is None or starts_at >= ends_at:
        raise TutorApplicationConflictError
    if ends_at - starts_at > timedelta(days=31):
        raise TutorApplicationConflictError


def _normalize_busy(
    intervals: tuple[TimeInterval, ...], starts_at: datetime, ends_at: datetime
) -> tuple[TimeInterval, ...]:
    if len(intervals) > MAX_BUSY_INTERVALS:
        raise CalendarProviderError("invalid_response")
    normalized: list[TimeInterval] = []
    for interval in sorted(intervals, key=lambda value: (value.starts_at, value.ends_at)):
        if (
            interval.starts_at.tzinfo is None
            or interval.ends_at.tzinfo is None
            or interval.starts_at >= interval.ends_at
            or interval.starts_at < starts_at
            or interval.ends_at > ends_at
        ):
            raise CalendarProviderError("invalid_response")
        value = TimeInterval(interval.starts_at.astimezone(UTC), interval.ends_at.astimezone(UTC))
        if normalized and value.starts_at <= normalized[-1].ends_at:
            normalized[-1] = TimeInterval(
                normalized[-1].starts_at, max(normalized[-1].ends_at, value.ends_at)
            )
        else:
            normalized.append(value)
    return tuple(normalized)


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
