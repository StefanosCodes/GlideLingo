import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import cast
from urllib.parse import parse_qs, urlencode, urlsplit
from uuid import UUID

import httpx
import pytest

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    HumanTutorMarketplaceForbiddenError,
    HumanTutorMarketplaceUnavailableError,
    TutorApplicationConflictError,
)
from app.modules.human_tutor_marketplace.availability import TimeInterval
from app.modules.human_tutor_marketplace.calendar import (
    BUSY_CACHE_TTL,
    GOOGLE_FREEBUSY_SCOPE,
    CalendarBusySnapshot,
    CalendarProviderError,
    CalendarRepository,
    CalendarService,
    CalendarTokenCipher,
    GoogleCalendarHttpAdapter,
    ProviderFailureCode,
    ProviderToken,
    StoredCalendarConnection,
    StoredCalendarRefreshJob,
)
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref

KEY = b"calendar-test-pseudonym-key-32bytes"
STATE_KEY = b"calendar-test-state-signing-key-32b"
TUTOR_ID = UUID("0e855ed5-a23f-4501-8cb4-ce92fed5d412")
REDIRECT = "https://app.glidelingo.test/tutor/availability"


class MemoryCalendarRepository:
    def __init__(self) -> None:
        self.approved_actor = derive_marketplace_actor_ref(key=KEY, clerk_user_id="tutor-user")
        self.states: dict[bytes, tuple[UUID, str, str, datetime, bool]] = {}
        self.connection: StoredCalendarConnection | None = None
        self.busy: tuple[TimeInterval, ...] = ()
        self.persisted_ciphertext: bytes | None = None
        self.refresh_attempt = 1
        self.refresh_claimed = False
        self.refresh_finished: tuple[str, str | None] | None = None
        self.refresh_recovered = 0

    def get_approved_tutor_id(self, *, actor_ref: str) -> UUID | None:
        return TUTOR_ID if actor_ref == self.approved_actor else None

    def insert_oauth_state(
        self,
        *,
        state_hash: bytes,
        tutor_id: UUID,
        actor_ref: str,
        redirect_uri: str,
        expires_at: datetime,
    ) -> None:
        self.states[state_hash] = (tutor_id, actor_ref, redirect_uri, expires_at, False)

    def consume_oauth_state(
        self,
        *,
        state_hash: bytes,
        tutor_id: UUID,
        actor_ref: str,
        redirect_uri: str,
        now: datetime,
    ) -> bool:
        value = self.states.get(state_hash)
        if value is None or value != (tutor_id, actor_ref, redirect_uri, value[3], False):
            return False
        if value[3] < now:
            return False
        self.states[state_hash] = (*value[:4], True)
        return True

    def upsert_connection(
        self,
        *,
        tutor_id: UUID,
        actor_ref: str,
        encrypted_refresh_token: bytes,
        token_key_version: int,
    ) -> StoredCalendarConnection:
        version = self.connection.version + 1 if self.connection is not None else 1
        self.persisted_ciphertext = encrypted_refresh_token
        self.connection = StoredCalendarConnection(
            tutor_id,
            actor_ref,
            encrypted_refresh_token,
            token_key_version,
            "connected",
            None,
            None,
            None,
            version,
        )
        return self.connection

    def get_connection_by_actor(self, *, actor_ref: str) -> StoredCalendarConnection | None:
        if self.connection is None or self.connection.actor_ref != actor_ref:
            return None
        return self.connection

    def get_connection_by_tutor(self, *, tutor_id: UUID) -> StoredCalendarConnection | None:
        if self.connection is None or self.connection.tutor_id != tutor_id:
            return None
        return self.connection

    def replace_busy_cache(
        self,
        *,
        tutor_id: UUID,
        expected_version: int,
        intervals: tuple[TimeInterval, ...],
        refreshed_at: datetime,
        expires_at: datetime,
    ) -> StoredCalendarConnection | None:
        if (
            self.connection is None
            or self.connection.tutor_id != tutor_id
            or self.connection.version != expected_version
        ):
            return None
        self.busy = intervals
        self.connection = replace(
            self.connection,
            status="connected",
            last_refreshed_at=refreshed_at,
            cache_expires_at=expires_at,
            safe_failure_code=None,
            version=expected_version + 1,
        )
        return self.connection

    def mark_failure(
        self,
        *,
        tutor_id: UUID,
        expected_version: int,
        code: ProviderFailureCode,
        reconnect_required: bool,
    ) -> StoredCalendarConnection | None:
        if (
            self.connection is None
            or self.connection.tutor_id != tutor_id
            or self.connection.version != expected_version
        ):
            return None
        self.connection = replace(
            self.connection,
            encrypted_refresh_token=None
            if reconnect_required
            else self.connection.encrypted_refresh_token,
            token_key_version=None if reconnect_required else self.connection.token_key_version,
            status="reconnect_required" if reconnect_required else "stale",
            safe_failure_code=code,
            version=expected_version + 1,
        )
        if reconnect_required:
            self.busy = ()
        return self.connection

    def delete_connection(self, *, actor_ref: str, expected_version: int) -> bool:
        if (
            self.connection is None
            or self.connection.actor_ref != actor_ref
            or self.connection.version != expected_version
        ):
            return False
        self.connection = None
        self.busy = ()
        return True

    def get_busy_snapshot(self, *, tutor_id: UUID, now: datetime) -> CalendarBusySnapshot:
        connection = self.get_connection_by_tutor(tutor_id=tutor_id)
        if connection is None:
            return CalendarBusySnapshot("not_connected", (), None)
        if connection.status == "reconnect_required":
            return CalendarBusySnapshot("reconnect_required", (), connection.last_refreshed_at)
        if connection.cache_expires_at is None or connection.cache_expires_at <= now:
            return CalendarBusySnapshot("stale", (), connection.last_refreshed_at)
        return CalendarBusySnapshot("current", self.busy, connection.last_refreshed_at)

    def claim_refresh(
        self, *, worker: str, now: datetime, lease_seconds: int
    ) -> StoredCalendarRefreshJob | None:
        if self.connection is None or self.refresh_claimed:
            return None
        self.refresh_claimed = True
        return StoredCalendarRefreshJob(
            job_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9994567"),
            attempt=self.refresh_attempt,
            connection=self.connection,
        )

    def finish_refresh(
        self,
        *,
        job_id: UUID,
        worker: str,
        now: datetime,
        outcome: str,
        available_at: datetime,
        failure_code: str | None,
    ) -> bool:
        self.refresh_finished = (outcome, failure_code)
        return True

    def recover_refresh(self, *, tutor_id: UUID, now: datetime) -> None:
        assert tutor_id == TUTOR_ID
        self.refresh_recovered += 1
        self.refresh_attempt = 0
        self.refresh_claimed = False


class FakeCalendarProvider:
    def __init__(self) -> None:
        self.scopes = frozenset({GOOGLE_FREEBUSY_SCOPE})
        self.failure: ProviderFailureCode | None = None
        self.revoked: list[str] = []
        self.fetch_count = 0

    def authorization_url(self, *, state: str, redirect_uri: str) -> str:
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
            {"redirect_uri": redirect_uri, "scope": GOOGLE_FREEBUSY_SCOPE, "state": state}
        )

    async def exchange_code(self, *, code: str, redirect_uri: str) -> ProviderToken:
        assert code == "provider-code" and redirect_uri == REDIRECT
        return ProviderToken("refresh-token-secret", self.scopes)

    async def fetch_busy(
        self, *, refresh_token: str, starts_at: datetime, ends_at: datetime
    ) -> tuple[TimeInterval, ...]:
        assert refresh_token == "refresh-token-secret"
        self.fetch_count += 1
        if self.failure is not None:
            raise CalendarProviderError(self.failure)
        return (TimeInterval(starts_at + timedelta(hours=2), starts_at + timedelta(hours=3)),)

    async def revoke(self, *, refresh_token: str) -> None:
        self.revoked.append(refresh_token)

    async def close(self) -> None:
        return None


def build_service(
    repository: MemoryCalendarRepository, provider: FakeCalendarProvider
) -> CalendarService:
    return CalendarService(
        enabled=True,
        repository=cast(CalendarRepository, repository),
        provider=provider,
        cipher=CalendarTokenCipher(key=b"e" * 32),
        state_key=STATE_KEY,
        pseudonym_key=KEY,
        actor_allowlist=("tutor-user", "other-user"),
        redirect_allowlist=(REDIRECT,),
    )


def tutor_principal() -> ClerkPrincipal:
    return ClerkPrincipal(user_id="tutor-user", issuer="https://clerk.test")


@pytest.mark.anyio
async def test_oauth_state_is_actor_redirect_and_replay_bound_then_tokens_stay_encrypted() -> None:
    repository = MemoryCalendarRepository()
    provider = FakeCalendarProvider()
    service = build_service(repository, provider)
    start = await service.start_oauth(principal=tutor_principal(), redirect_uri=REDIRECT)
    state = parse_qs(urlsplit(start.authorization_url).query)["state"][0]

    with pytest.raises(HumanTutorMarketplaceForbiddenError):
        await service.complete_oauth(
            principal=tutor_principal(),
            state=state,
            code="provider-code",
            redirect_uri="https://attacker.test/callback",
        )
    with pytest.raises(TutorApplicationConflictError):
        await service.complete_oauth(
            principal=ClerkPrincipal(user_id="other-user", issuer="https://clerk.test"),
            state=state,
            code="provider-code",
            redirect_uri=REDIRECT,
        )

    connected = await service.complete_oauth(
        principal=tutor_principal(), state=state, code="provider-code", redirect_uri=REDIRECT
    )
    assert connected.status == "connected"
    assert repository.persisted_ciphertext is not None
    assert b"refresh-token-secret" not in repository.persisted_ciphertext
    with pytest.raises(TutorApplicationConflictError):
        await service.complete_oauth(
            principal=tutor_principal(), state=state, code="provider-code", redirect_uri=REDIRECT
        )


@pytest.mark.anyio
async def test_refresh_is_bounded_marks_freshness_and_revocation_requires_reconnect() -> None:
    repository = MemoryCalendarRepository()
    provider = FakeCalendarProvider()
    service = build_service(repository, provider)
    start = await service.start_oauth(principal=tutor_principal(), redirect_uri=REDIRECT)
    state = parse_qs(urlsplit(start.authorization_url).query)["state"][0]
    await service.complete_oauth(
        principal=tutor_principal(), state=state, code="provider-code", redirect_uri=REDIRECT
    )

    current = await service.refresh(principal=tutor_principal())
    assert current.freshness == "current"
    assert len(repository.busy) == 1
    repeated = await service.refresh(principal=tutor_principal())
    assert repeated.freshness == "current"
    assert provider.fetch_count == 1
    assert repository.connection is not None
    assert repository.connection.cache_expires_at is not None
    assert repository.connection.last_refreshed_at is not None
    assert (
        repository.connection.cache_expires_at - repository.connection.last_refreshed_at
        == BUSY_CACHE_TTL
    )

    provider.failure = "revoked"
    next_start = datetime.now(UTC)
    reconnect = await service.refresh(
        principal=tutor_principal(),
        starts_at=next_start,
        ends_at=next_start + timedelta(days=1),
    )
    assert reconnect.status == "reconnect_required"
    assert repository.connection is not None
    assert repository.connection.encrypted_refresh_token is None
    assert len(repository.busy) == 0


@pytest.mark.anyio
@pytest.mark.parametrize("failure", ["rate_limited", "timeout", "unavailable"])
async def test_transient_provider_failures_are_explicitly_stale_and_keep_reconnect_possible(
    failure: ProviderFailureCode,
) -> None:
    repository = MemoryCalendarRepository()
    provider = FakeCalendarProvider()
    service = build_service(repository, provider)
    start = await service.start_oauth(principal=tutor_principal(), redirect_uri=REDIRECT)
    state = parse_qs(urlsplit(start.authorization_url).query)["state"][0]
    await service.complete_oauth(
        principal=tutor_principal(), state=state, code="provider-code", redirect_uri=REDIRECT
    )
    provider.failure = failure

    result = await service.refresh(principal=tutor_principal())

    assert result.status == "stale"
    assert result.freshness == "stale"
    assert result.safe_failure_code == failure
    assert repository.connection is not None
    assert repository.connection.encrypted_refresh_token is not None


@pytest.mark.anyio
async def test_extra_oauth_scope_fails_closed_after_one_use() -> None:
    repository = MemoryCalendarRepository()
    provider = FakeCalendarProvider()
    provider.scopes = frozenset({GOOGLE_FREEBUSY_SCOPE, "https://www.googleapis.com/auth/calendar"})
    service = build_service(repository, provider)
    start = await service.start_oauth(principal=tutor_principal(), redirect_uri=REDIRECT)
    state = parse_qs(urlsplit(start.authorization_url).query)["state"][0]

    with pytest.raises(HumanTutorMarketplaceUnavailableError):
        await service.complete_oauth(
            principal=tutor_principal(), state=state, code="provider-code", redirect_uri=REDIRECT
        )
    with pytest.raises(TutorApplicationConflictError):
        await service.complete_oauth(
            principal=tutor_principal(), state=state, code="provider-code", redirect_uri=REDIRECT
        )


@pytest.mark.anyio
async def test_durable_refresh_job_reuses_encrypted_token_and_terminalizes_exhaustion() -> None:
    repository = MemoryCalendarRepository()
    provider = FakeCalendarProvider()
    service = build_service(repository, provider)
    start = await service.start_oauth(principal=tutor_principal(), redirect_uri=REDIRECT)
    state = parse_qs(urlsplit(start.authorization_url).query)["state"][0]
    await service.complete_oauth(
        principal=tutor_principal(), state=state, code="provider-code", redirect_uri=REDIRECT
    )

    assert await service.run_one_refresh_job(worker="calendar-a")
    assert provider.fetch_count == 1
    assert repository.refresh_finished == ("completed", None)

    repository.refresh_claimed = False
    repository.refresh_attempt = 8
    repository.refresh_finished = None
    provider.failure = "rate_limited"
    assert await service.run_one_refresh_job(worker="calendar-b")
    assert repository.refresh_finished == ("dead", "rate_limited")

    provider.failure = None
    manual_start = datetime.now(UTC)
    recovered = await service.refresh(
        principal=tutor_principal(),
        starts_at=manual_start,
        ends_at=manual_start + timedelta(days=1),
    )
    assert recovered.freshness == "current"
    assert repository.refresh_recovered == 1
    assert repository.refresh_attempt == 0


@pytest.mark.anyio
async def test_google_adapter_requests_only_freebusy_and_returns_only_busy_ranges() -> None:
    starts_at = datetime(2026, 9, 5, 12, tzinfo=UTC)
    ends_at = starts_at + timedelta(days=1)

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            assert b"grant_type=refresh_token" in request.content
            return httpx.Response(200, json={"access_token": "short-lived-access-token"})
        assert request.url.path == "/calendar/v3/freeBusy"
        assert request.headers["authorization"] == "Bearer short-lived-access-token"
        body = json.loads(request.content)
        assert body["items"] == [{"id": "primary"}]
        return httpx.Response(
            200,
            json={
                "calendars": {
                    "primary": {
                        "busy": [
                            {
                                "start": "2026-09-05T13:00:00Z",
                                "end": "2026-09-05T14:00:00Z",
                            }
                        ]
                    }
                }
            },
        )

    adapter = GoogleCalendarHttpAdapter(
        client_id="client-id",
        client_secret="client-secret",
        timeout_seconds=2,
        transport=httpx.MockTransport(handler),
    )
    authorization = urlsplit(adapter.authorization_url(state="signed-state", redirect_uri=REDIRECT))
    query = parse_qs(authorization.query)
    assert authorization.netloc == "accounts.google.com"
    assert query["scope"] == [GOOGLE_FREEBUSY_SCOPE]
    assert query["include_granted_scopes"] == ["false"]

    intervals = await adapter.fetch_busy(
        refresh_token="refresh-token", starts_at=starts_at, ends_at=ends_at
    )
    assert intervals == (
        TimeInterval(
            datetime(2026, 9, 5, 13, tzinfo=UTC),
            datetime(2026, 9, 5, 14, tzinfo=UTC),
        ),
    )
    await adapter.close()
