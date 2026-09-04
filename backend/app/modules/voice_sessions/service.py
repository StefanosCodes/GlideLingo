import asyncio
import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID, uuid4

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    VoiceSessionConflictError,
    VoiceSessionNotFoundError,
    VoiceSessionUnavailableError,
)
from app.integrations.voice_realtime.client import (
    PrivateVoiceEndRequest,
    PrivateVoiceSessionRequest,
    PrivateVoiceSessionResponse,
)
from app.modules.voice_sessions.identity import derive_voice_actor_ref
from app.modules.voice_sessions.schemas import (
    CreateVoiceSessionRequest,
    EndVoiceSessionRequest,
    VoiceConnection,
    VoiceSessionAdmission,
    VoiceSessionRecap,
)


class VoiceRealtimeGateway(Protocol):
    async def create(
        self, request: PrivateVoiceSessionRequest, *, request_id: str
    ) -> PrivateVoiceSessionResponse: ...

    async def end(self, request: PrivateVoiceEndRequest, *, request_id: str) -> None: ...

    async def close(self) -> None: ...


@dataclass(slots=True)
class VoiceSessionRecord:
    actor_ref: str
    admission: VoiceSessionAdmission
    provider_call_id: str
    captions_enabled: bool
    cleanup_pending: bool = False
    recap: VoiceSessionRecap | None = None
    expiry_task: asyncio.Task[None] | None = None
    retained_until: datetime | None = None


@dataclass(frozen=True, slots=True)
class ReplayEntry[ReplayValue]:
    fingerprint: str
    value: ReplayValue
    expires_at: datetime


class VoiceSessionService:
    """Bounded in-process baseline; durable multi-instance storage remains an activation gate."""

    def __init__(
        self,
        *,
        enabled: bool,
        gateway: VoiceRealtimeGateway | None,
        pseudonym_key: bytes | None,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        cleanup_retry_delays: tuple[float, ...] = (0.0, 0.25, 1.0),
        retention_seconds: int = 900,
        maximum_session_records: int = 256,
        maximum_replay_entries: int = 512,
    ) -> None:
        if retention_seconds <= 0 or maximum_session_records <= 0 or maximum_replay_entries <= 0:
            raise ValueError("Voice session retention limits must be positive")
        self._enabled = enabled
        self._gateway = gateway
        self._pseudonym_key = pseudonym_key
        self._now = now
        self._cleanup_retry_delays = cleanup_retry_delays
        self._retention = timedelta(seconds=retention_seconds)
        self._maximum_session_records = maximum_session_records
        self._maximum_replay_entries = maximum_replay_entries
        self._pending_creates = 0
        self._actor_locks: dict[str, asyncio.Lock] = {}
        self._records: dict[UUID, VoiceSessionRecord] = {}
        self._active_by_actor: dict[str, UUID] = {}
        self._create_replays: dict[tuple[str, str], ReplayEntry[VoiceSessionAdmission]] = {}
        self._reconnect_replays: dict[tuple[UUID, str], ReplayEntry[VoiceSessionAdmission]] = {}
        self._end_replays: dict[tuple[UUID, str], ReplayEntry[VoiceSessionRecap]] = {}

    def ensure_available(self) -> None:
        if not self._enabled or self._gateway is None or self._pseudonym_key is None:
            raise VoiceSessionUnavailableError

    async def create(
        self,
        request: CreateVoiceSessionRequest,
        *,
        principal: ClerkPrincipal,
        idempotency_key: str,
        request_id: str,
    ) -> VoiceSessionAdmission:
        self.ensure_available()
        assert self._gateway is not None and self._pseudonym_key is not None
        self._prune_state()
        actor_ref = derive_voice_actor_ref(key=self._pseudonym_key, principal=principal)
        fingerprint = self._fingerprint(request)
        async with self._actor_lock(actor_ref):
            replay = self._create_replays.get((actor_ref, idempotency_key))
            if replay is not None:
                if replay.fingerprint != fingerprint:
                    raise VoiceSessionConflictError
                return replay.value
            if actor_ref in self._active_by_actor:
                raise VoiceSessionConflictError
            self._reserve_record_slot()
            try:
                session_id = uuid4()
                private = PrivateVoiceSessionRequest(
                    actor_ref=actor_ref,
                    application_session_id=session_id,
                    course_id=request.course_id,
                    scenario_id=request.scenario_id,
                    source_locale=request.source_locale,
                    target_locale=request.target_locale,
                    conversation_mode=request.conversation_mode,
                    captions_enabled=request.captions_enabled,
                    offer_sdp=request.offer_sdp,
                )
                provider = await self._gateway.create(private, request_id=request_id)
            finally:
                self._pending_creates -= 1
            if not self._provider_matches_request(provider, private):
                await self._safe_stop(actor_ref, session_id, provider.provider_call_id, request_id)
                raise VoiceSessionUnavailableError
            expires_at = self._now() + timedelta(seconds=provider.spec.maximum_duration_seconds)
            admission = VoiceSessionAdmission(
                session_id=session_id,
                expires_at=expires_at,
                spec=provider.spec,
                connection=VoiceConnection(answer_sdp=provider.answer_sdp),
            )
            record = VoiceSessionRecord(
                actor_ref=actor_ref,
                admission=admission,
                provider_call_id=provider.provider_call_id,
                captions_enabled=request.captions_enabled,
            )
            self._records[session_id] = record
            self._active_by_actor[actor_ref] = session_id
            self._store_replay(
                self._create_replays, (actor_ref, idempotency_key), fingerprint, admission
            )
            record.expiry_task = asyncio.create_task(self._expire(session_id))
            return admission

    async def reconnect(
        self,
        session_id: UUID,
        offer_sdp: str,
        *,
        principal: ClerkPrincipal,
        idempotency_key: str,
        request_id: str,
    ) -> VoiceSessionAdmission:
        self.ensure_available()
        assert self._gateway is not None and self._pseudonym_key is not None
        self._prune_state()
        actor_ref = derive_voice_actor_ref(key=self._pseudonym_key, principal=principal)
        fingerprint = hashlib.sha256(offer_sdp.encode()).hexdigest()
        async with self._actor_lock(actor_ref):
            record = self._owned_active(session_id, actor_ref)
            replay = self._reconnect_replays.get((session_id, idempotency_key))
            if replay is not None:
                if replay.fingerprint != fingerprint:
                    raise VoiceSessionConflictError
                return replay.value
            private = PrivateVoiceSessionRequest(
                actor_ref=actor_ref,
                application_session_id=session_id,
                course_id=record.admission.spec.course_id,
                scenario_id=record.admission.spec.scenario_id,
                source_locale=record.admission.spec.source_locale,
                target_locale=record.admission.spec.target_locale,
                conversation_mode=record.admission.spec.conversation_mode,
                captions_enabled=record.captions_enabled,
                offer_sdp=offer_sdp,
            )
            replacement = await self._gateway.create(private, request_id=request_id)
            if (
                replacement.application_session_id != session_id
                or replacement.spec != record.admission.spec
            ):
                await self._safe_stop(
                    actor_ref, session_id, replacement.provider_call_id, request_id
                )
                raise VoiceSessionUnavailableError
            try:
                await self._gateway.end(
                    PrivateVoiceEndRequest(
                        actor_ref=actor_ref,
                        application_session_id=session_id,
                        provider_call_id=record.provider_call_id,
                    ),
                    request_id=request_id,
                )
            except BaseException:
                await self._safe_stop(
                    actor_ref, session_id, replacement.provider_call_id, request_id
                )
                raise
            admission = record.admission.model_copy(
                update={"connection": VoiceConnection(answer_sdp=replacement.answer_sdp)}
            )
            record.admission = admission
            record.provider_call_id = replacement.provider_call_id
            self._store_replay(
                self._reconnect_replays, (session_id, idempotency_key), fingerprint, admission
            )
            return admission

    @staticmethod
    def _provider_matches_request(
        response: PrivateVoiceSessionResponse, request: PrivateVoiceSessionRequest
    ) -> bool:
        spec = response.spec
        return (
            response.application_session_id == request.application_session_id
            and spec.course_id == request.course_id
            and spec.scenario_id == request.scenario_id
            and spec.source_locale == request.source_locale
            and spec.target_locale == request.target_locale
            and spec.conversation_mode == request.conversation_mode
        )

    async def end(
        self,
        session_id: UUID,
        request: EndVoiceSessionRequest,
        *,
        principal: ClerkPrincipal,
        idempotency_key: str,
        request_id: str,
    ) -> VoiceSessionRecap:
        self.ensure_available()
        assert self._gateway is not None and self._pseudonym_key is not None
        self._prune_state()
        actor_ref = derive_voice_actor_ref(key=self._pseudonym_key, principal=principal)
        fingerprint = self._fingerprint(request)
        async with self._actor_lock(actor_ref):
            record = self._owned(session_id, actor_ref)
            replay = self._end_replays.get((session_id, idempotency_key))
            if replay is not None:
                if replay.fingerprint != fingerprint:
                    raise VoiceSessionConflictError
                return replay.value
            if any(event.session_id != session_id for event in request.events):
                raise VoiceSessionConflictError
            if record.recap is not None and not record.cleanup_pending:
                return record.recap
            await self._gateway.end(
                PrivateVoiceEndRequest(
                    actor_ref=actor_ref,
                    application_session_id=session_id,
                    provider_call_id=record.provider_call_id,
                ),
                request_id=request_id,
            )
            if record.recap is None:
                record.recap = VoiceSessionRecap(
                    session_id=session_id,
                    end_reason=request.reason,
                    # Admission only accepts retain_transcript=false. Client events are validated
                    # for lifecycle integrity, but text is never retained or returned.
                    transcript=[],
                )
            record.cleanup_pending = False
            record.retained_until = self._now() + self._retention
            self._active_by_actor.pop(actor_ref, None)
            if record.expiry_task is not asyncio.current_task():
                record.expiry_task and record.expiry_task.cancel()
            self._store_replay(
                self._end_replays, (session_id, idempotency_key), fingerprint, record.recap
            )
            return record.recap

    async def recap(self, session_id: UUID, *, principal: ClerkPrincipal) -> VoiceSessionRecap:
        self.ensure_available()
        assert self._pseudonym_key is not None
        self._prune_state()
        actor_ref = derive_voice_actor_ref(key=self._pseudonym_key, principal=principal)
        async with self._actor_lock(actor_ref):
            record = self._owned(session_id, actor_ref)
            if record.recap is None:
                raise VoiceSessionConflictError
            return record.recap

    async def _expire(self, session_id: UUID) -> None:
        record = self._records.get(session_id)
        if record is None:
            return
        delay = max(0.0, (record.admission.expires_at - self._now()).total_seconds())
        try:
            await asyncio.sleep(delay)
            for retry_delay in self._cleanup_retry_delays:
                if retry_delay > 0:
                    await asyncio.sleep(retry_delay)
                async with self._actor_lock(record.actor_ref):
                    if record.recap is not None or self._gateway is None:
                        return
                    stopped = await self._safe_stop(
                        record.actor_ref,
                        session_id,
                        record.provider_call_id,
                        f"req_{uuid4().hex}",
                        attempts=1,
                    )
                    if stopped:
                        record.cleanup_pending = False
                        record.recap = VoiceSessionRecap(
                            session_id=session_id, end_reason="timeout", transcript=[]
                        )
                        record.retained_until = self._now() + self._retention
                        self._active_by_actor.pop(record.actor_ref, None)
                        return
                    record.cleanup_pending = True

            async with self._actor_lock(record.actor_ref):
                if record.recap is None:
                    # Cleanup is not falsely reported as complete. A later explicit End or
                    # service shutdown retries the retained provider reference.
                    record.recap = VoiceSessionRecap(
                        session_id=session_id, end_reason="failed", transcript=[]
                    )
        except asyncio.CancelledError:
            return

    def _owned(self, session_id: UUID, actor_ref: str) -> VoiceSessionRecord:
        record = self._records.get(session_id)
        if record is None or record.actor_ref != actor_ref:
            raise VoiceSessionNotFoundError
        return record

    def _owned_active(self, session_id: UUID, actor_ref: str) -> VoiceSessionRecord:
        record = self._owned(session_id, actor_ref)
        if record.recap is not None or record.admission.expires_at <= self._now():
            raise VoiceSessionConflictError
        return record

    async def _safe_stop(
        self,
        actor_ref: str,
        session_id: UUID,
        provider_call_id: str,
        request_id: str,
        *,
        attempts: int = 2,
    ) -> bool:
        assert self._gateway is not None
        for _attempt in range(attempts):
            try:
                await asyncio.shield(
                    self._gateway.end(
                        PrivateVoiceEndRequest(
                            actor_ref=actor_ref,
                            application_session_id=session_id,
                            provider_call_id=provider_call_id,
                        ),
                        request_id=request_id,
                    )
                )
                return True
            except Exception:
                await asyncio.sleep(0)
        return False

    def _actor_lock(self, actor_ref: str) -> asyncio.Lock:
        return self._actor_locks.setdefault(actor_ref, asyncio.Lock())

    def _reserve_record_slot(self) -> None:
        required = len(self._records) + self._pending_creates + 1 - self._maximum_session_records
        if required > 0:
            evictable = sorted(
                (
                    record
                    for record in self._records.values()
                    if record.recap is not None and not record.cleanup_pending
                ),
                key=lambda record: record.retained_until or datetime.min.replace(tzinfo=UTC),
            )
            for record in evictable[:required]:
                self._evict_record(record.admission.session_id)
        if len(self._records) + self._pending_creates >= self._maximum_session_records:
            raise VoiceSessionUnavailableError
        self._pending_creates += 1

    def _prune_state(self) -> None:
        now = self._now()
        self._prune_replay_map(self._create_replays, now)
        self._prune_replay_map(self._reconnect_replays, now)
        self._prune_replay_map(self._end_replays, now)
        expired = [
            session_id
            for session_id, record in self._records.items()
            if record.recap is not None
            and not record.cleanup_pending
            and record.retained_until is not None
            and record.retained_until <= now
        ]
        for session_id in expired:
            self._evict_record(session_id)
        retained_actors = {record.actor_ref for record in self._records.values()}
        retained_actors.update(actor_ref for actor_ref, _key in self._create_replays)
        for actor_ref, lock in tuple(self._actor_locks.items()):
            if actor_ref not in retained_actors and not lock.locked():
                self._actor_locks.pop(actor_ref, None)

    def _evict_record(self, session_id: UUID) -> None:
        record = self._records.pop(session_id, None)
        if record is None:
            return
        self._active_by_actor.pop(record.actor_ref, None)
        for create_key, replay in tuple(self._create_replays.items()):
            if replay.value.session_id == session_id:
                self._create_replays.pop(create_key, None)
        for reconnect_key in tuple(self._reconnect_replays):
            if reconnect_key[0] == session_id:
                self._reconnect_replays.pop(reconnect_key, None)
        for end_key in tuple(self._end_replays):
            if end_key[0] == session_id:
                self._end_replays.pop(end_key, None)

    def _store_replay[ReplayKey, ReplayValue](
        self,
        replays: dict[ReplayKey, ReplayEntry[ReplayValue]],
        key: ReplayKey,
        fingerprint: str,
        value: ReplayValue,
    ) -> None:
        now = self._now()
        replays[key] = ReplayEntry(fingerprint, value, now + self._retention)
        self._prune_replay_map(replays, now)

    def _prune_replay_map[ReplayKey, ReplayValue](
        self, replays: dict[ReplayKey, ReplayEntry[ReplayValue]], now: datetime
    ) -> None:
        for key, replay in tuple(replays.items()):
            if replay.expires_at <= now:
                replays.pop(key, None)
        overflow = len(replays) - self._maximum_replay_entries
        if overflow > 0:
            oldest = sorted(replays, key=lambda key: replays[key].expires_at)[:overflow]
            for key in oldest:
                replays.pop(key, None)

    @staticmethod
    def _fingerprint(request: CreateVoiceSessionRequest | EndVoiceSessionRequest) -> str:
        canonical = json.dumps(
            request.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
        )
        return hashlib.sha256(canonical.encode()).hexdigest()

    async def close(self) -> None:
        if self._gateway is None:
            return
        for record in list(self._records.values()):
            record.expiry_task and record.expiry_task.cancel()
            if record.recap is None or record.cleanup_pending:
                stopped = await self._safe_stop(
                    record.actor_ref,
                    record.admission.session_id,
                    record.provider_call_id,
                    f"req_{uuid4().hex}",
                )
                if stopped:
                    record.cleanup_pending = False
        await self._gateway.close()
