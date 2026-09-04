import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

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
from app.modules.voice_sessions.schemas import (
    CreateVoiceSessionRequest,
    EndVoiceSessionRequest,
    VoiceSessionEvent,
    VoiceSessionSpec,
)
from app.modules.voice_sessions.service import VoiceSessionService

NOW = datetime(2026, 9, 2, tzinfo=UTC)
PRINCIPAL = ClerkPrincipal(user_id="user_voice_test", issuer="https://clerk.test")
OTHER_PRINCIPAL = ClerkPrincipal(user_id="other_voice_test", issuer="https://clerk.test")


def request(
    offer: str = "v=0\r\na=offer-data-for-voice-test", *, captions_enabled: bool = True
) -> CreateVoiceSessionRequest:
    return CreateVoiceSessionRequest(
        course_id="el-from-zero",
        scenario_id="el-greeting-introduction-v1",
        conversation_mode="guided",
        source_locale="en",
        target_locale="el-GR",
        captions_enabled=captions_enabled,
        retain_transcript=False,
        offer_sdp=offer,
        client_capabilities=["audio", "captions", "interrupt", "reconnect"],
    )


def spec() -> VoiceSessionSpec:
    return VoiceSessionSpec(
        course_id="el-from-zero",
        course_version="greek-foundations-v1",
        course_content_hash="sha256:" + "a" * 64,
        scenario_id="el-greeting-introduction-v1",
        scenario_version="1.0.0",
        conversation_mode="guided",
        source_locale="en",
        target_locale="el-GR",
        persona_id="greek-guide-v1",
        voice_id="configured-voice",
        learner_level="A0-A1",
        capability_ids=["el-introduce-self"],
        correction_policy_version="gentle-recast-v1",
        evidence_policy_version="conversation-observation-v1",
        maximum_duration_seconds=300,
    )


class FakeGateway:
    def __init__(self) -> None:
        self.creates: list[PrivateVoiceSessionRequest] = []
        self.ends: list[PrivateVoiceEndRequest] = []
        self.end_failures = 0
        self.closed = False

    async def create(
        self, payload: PrivateVoiceSessionRequest, *, request_id: str
    ) -> PrivateVoiceSessionResponse:
        assert request_id.startswith("req_")
        self.creates.append(payload)
        number = len(self.creates)
        return PrivateVoiceSessionResponse(
            application_session_id=payload.application_session_id,
            provider_call_id=f"call_{number}",
            answer_sdp=f"v=0\r\na=answer-data-{number}",
            spec=spec(),
        )

    async def end(self, payload: PrivateVoiceEndRequest, *, request_id: str) -> None:
        assert request_id.startswith("req_")
        self.ends.append(payload)
        if self.end_failures > 0:
            self.end_failures -= 1
            raise OSError("transient cleanup failure")

    async def close(self) -> None:
        self.closed = True


class MisroutingGateway(FakeGateway):
    def __init__(self, *, call_number: int, application_session: bool = False) -> None:
        super().__init__()
        self.call_number = call_number
        self.application_session = application_session

    async def create(
        self, payload: PrivateVoiceSessionRequest, *, request_id: str
    ) -> PrivateVoiceSessionResponse:
        response = await super().create(payload, request_id=request_id)
        if len(self.creates) != self.call_number:
            return response
        if self.application_session:
            return response.model_copy(
                update={"application_session_id": UUID("00000000-0000-4000-8000-000000000099")}
            )
        return response.model_copy(
            update={"spec": response.spec.model_copy(update={"scenario_id": "wrong-scenario"})}
        )


def service(gateway: FakeGateway, clock: list[datetime] | None = None) -> VoiceSessionService:
    return VoiceSessionService(
        enabled=True,
        gateway=gateway,
        pseudonym_key=b"voice-test-pseudonym-key-at-least-32-bytes",
        now=(lambda: clock[0]) if clock else (lambda: NOW),
        cleanup_retry_delays=(0.0, 0.0, 0.0),
    )


def test_create_is_idempotent_and_enforces_one_active_session() -> None:
    async def run() -> None:
        gateway = FakeGateway()
        subject = service(gateway)
        first = await subject.create(
            request(),
            principal=PRINCIPAL,
            idempotency_key="voice-create-key-0001",
            request_id="req_" + "1" * 32,
        )
        replay = await subject.create(
            request(),
            principal=PRINCIPAL,
            idempotency_key="voice-create-key-0001",
            request_id="req_" + "2" * 32,
        )
        assert replay == first
        assert len(gateway.creates) == 1
        assert gateway.creates[0].captions_enabled is True
        assert gateway.creates[0].actor_ref.startswith("vusr_v1_")
        assert PRINCIPAL.user_id not in gateway.creates[0].actor_ref
        with pytest.raises(VoiceSessionConflictError):
            await subject.create(
                request("v=0\r\na=different-offer-data"),
                principal=PRINCIPAL,
                idempotency_key="voice-create-key-0002",
                request_id="req_" + "3" * 32,
            )
        await subject.close()

    asyncio.run(run())


def test_reconnect_replaces_and_cleans_up_the_previous_provider_call() -> None:
    async def run() -> None:
        gateway = FakeGateway()
        subject = service(gateway)
        first = await subject.create(
            request(captions_enabled=False),
            principal=PRINCIPAL,
            idempotency_key="voice-create-key-0003",
            request_id="req_" + "4" * 32,
        )
        replacement = await subject.reconnect(
            first.session_id,
            "v=0\r\na=reconnect-offer-data",
            principal=PRINCIPAL,
            idempotency_key="voice-reconnect-key-0001",
            request_id="req_" + "5" * 32,
        )
        assert replacement.session_id == first.session_id
        assert replacement.spec == first.spec
        assert replacement.connection.answer_sdp.endswith("2")
        assert [item.provider_call_id for item in gateway.ends] == ["call_1"]
        assert [item.captions_enabled for item in gateway.creates] == [False, False]
        replay = await subject.reconnect(
            first.session_id,
            "v=0\r\na=reconnect-offer-data",
            principal=PRINCIPAL,
            idempotency_key="voice-reconnect-key-0001",
            request_id="req_" + "6" * 32,
        )
        assert replay == replacement
        assert len(gateway.creates) == 2
        await subject.close()

    asyncio.run(run())


def test_create_rejects_and_cleans_up_a_mismatched_private_spec() -> None:
    async def run() -> None:
        gateway = MisroutingGateway(call_number=1)
        subject = service(gateway)

        with pytest.raises(VoiceSessionUnavailableError):
            await subject.create(
                request(),
                principal=PRINCIPAL,
                idempotency_key="voice-create-mismatched-spec",
                request_id="req_" + "2" * 32,
            )

        assert [item.provider_call_id for item in gateway.ends] == ["call_1"]
        assert subject._records == {}
        assert subject._active_by_actor == {}
        await subject.close()

    asyncio.run(run())


def test_reconnect_rejects_a_mismatched_application_session_and_preserves_original() -> None:
    async def run() -> None:
        gateway = MisroutingGateway(call_number=2, application_session=True)
        subject = service(gateway)
        original = await subject.create(
            request(),
            principal=PRINCIPAL,
            idempotency_key="voice-create-before-misroute",
            request_id="req_" + "3" * 32,
        )

        with pytest.raises(VoiceSessionUnavailableError):
            await subject.reconnect(
                original.session_id,
                "v=0\r\na=mismatched-reconnect-offer",
                principal=PRINCIPAL,
                idempotency_key="voice-reconnect-misrouted",
                request_id="req_" + "4" * 32,
            )

        assert [item.provider_call_id for item in gateway.ends] == ["call_2"]
        assert subject._records[original.session_id].provider_call_id == "call_1"
        assert subject._active_by_actor
        await subject.close()

    asyncio.run(run())


def test_foreign_actor_cannot_reconnect_or_end_an_owned_session() -> None:
    async def run() -> None:
        gateway = FakeGateway()
        subject = service(gateway)
        admission = await subject.create(
            request(),
            principal=PRINCIPAL,
            idempotency_key="voice-create-owner-scope",
            request_id="req_" + "5" * 32,
        )

        with pytest.raises(VoiceSessionNotFoundError):
            await subject.reconnect(
                admission.session_id,
                "v=0\r\na=foreign-reconnect-offer",
                principal=OTHER_PRINCIPAL,
                idempotency_key="voice-reconnect-foreign",
                request_id="req_" + "6" * 32,
            )
        with pytest.raises(VoiceSessionNotFoundError):
            await subject.end(
                admission.session_id,
                EndVoiceSessionRequest(reason="cancelled", events=[]),
                principal=OTHER_PRINCIPAL,
                idempotency_key="voice-end-foreign",
                request_id="req_" + "7" * 32,
            )

        assert len(gateway.creates) == 1
        assert gateway.ends == []
        await subject.close()

    asyncio.run(run())


def test_end_validates_scope_and_finalizes_once_without_false_evidence() -> None:
    async def run() -> None:
        gateway = FakeGateway()
        subject = service(gateway)
        admission = await subject.create(
            request(),
            principal=PRINCIPAL,
            idempotency_key="voice-create-key-0004",
            request_id="req_" + "7" * 32,
        )
        event = VoiceSessionEvent(
            event_id="event:voice:0001",
            session_id=admission.session_id,
            sequence=1,
            occurred_at=NOW,
            type="transcript.final",
            speaker="coach",
            text="Γεια σου!",
        )
        recap = await subject.end(
            admission.session_id,
            EndVoiceSessionRequest(reason="completed", events=[event]),
            principal=PRINCIPAL,
            idempotency_key="voice-end-key-0001",
            request_id="req_" + "8" * 32,
        )
        replay = await subject.end(
            admission.session_id,
            EndVoiceSessionRequest(reason="completed", events=[event]),
            principal=PRINCIPAL,
            idempotency_key="voice-end-key-0001",
            request_id="req_" + "9" * 32,
        )
        assert replay == recap
        assert recap.scenario_completed is False
        assert recap.evidence.applied is False
        assert recap.transcript == []
        assert await subject.recap(admission.session_id, principal=PRINCIPAL) == recap
        assert "Γεια σου" not in recap.model_dump_json()
        assert [item.provider_call_id for item in gateway.ends] == ["call_1"]
        with pytest.raises(VoiceSessionConflictError):
            await subject.end(
                admission.session_id,
                EndVoiceSessionRequest(reason="failed", events=[]),
                principal=PRINCIPAL,
                idempotency_key="voice-end-key-0001",
                request_id="req_" + "0" * 32,
            )
        with pytest.raises(VoiceSessionNotFoundError):
            await subject.recap(
                admission.session_id,
                principal=ClerkPrincipal(user_id="attacker", issuer="https://clerk.test"),
            )
        await subject.close()

    asyncio.run(run())


def test_expiry_stops_provider_and_preserves_a_timeout_recap() -> None:
    async def run() -> None:
        clock = [NOW]
        gateway = FakeGateway()
        gateway.end_failures = 1
        subject = service(gateway, clock)
        admission = await subject.create(
            request(),
            principal=PRINCIPAL,
            idempotency_key="voice-create-key-0005",
            request_id="req_" + "a" * 32,
        )
        clock[0] = NOW + timedelta(seconds=301)
        expiry_task = subject._records[admission.session_id].expiry_task
        assert expiry_task is not None
        await expiry_task
        recap = await subject.recap(admission.session_id, principal=PRINCIPAL)
        assert recap.end_reason == "timeout"
        assert [item.provider_call_id for item in gateway.ends] == ["call_1", "call_1"]
        await subject.close()

    asyncio.run(run())


def test_expiry_retains_failed_cleanup_for_an_explicit_retry() -> None:
    async def run() -> None:
        clock = [NOW]
        gateway = FakeGateway()
        gateway.end_failures = 3
        subject = service(gateway, clock)
        admission = await subject.create(
            request(),
            principal=PRINCIPAL,
            idempotency_key="voice-create-key-expiry-cleanup",
            request_id="req_" + "d" * 32,
        )
        clock[0] = NOW + timedelta(seconds=301)
        expiry_task = subject._records[admission.session_id].expiry_task
        assert expiry_task is not None
        await expiry_task

        recap = await subject.recap(admission.session_id, principal=PRINCIPAL)
        assert recap.end_reason == "failed"
        with pytest.raises(VoiceSessionConflictError):
            await subject.create(
                request("v=0\r\na=new-offer-after-expiry"),
                principal=PRINCIPAL,
                idempotency_key="voice-create-key-after-expiry",
                request_id="req_" + "e" * 32,
            )

        recovered = await subject.end(
            admission.session_id,
            EndVoiceSessionRequest(reason="failed", events=[]),
            principal=PRINCIPAL,
            idempotency_key="voice-end-key-expiry-cleanup",
            request_id="req_" + "f" * 32,
        )
        assert recovered == recap
        replacement = await subject.create(
            request("v=0\r\na=new-offer-after-cleanup"),
            principal=PRINCIPAL,
            idempotency_key="voice-create-key-after-cleanup",
            request_id="req_" + "1" * 32,
        )
        assert replacement.session_id != admission.session_id
        await subject.close()

    asyncio.run(run())


def test_event_contract_rejects_malformed_sequence_and_cross_session_scope() -> None:
    with pytest.raises(ValueError, match="strictly increasing"):
        EndVoiceSessionRequest(
            reason="cancelled",
            events=[
                VoiceSessionEvent(
                    event_id=f"event:voice:{sequence}",
                    session_id=UUID("00000000-0000-4000-8000-000000000001"),
                    sequence=sequence,
                    occurred_at=NOW,
                    type="response.started",
                )
                for sequence in (2, 1)
            ],
        )


def test_slow_admission_does_not_block_an_unrelated_actor() -> None:
    async def run() -> None:
        started = asyncio.Event()
        release = asyncio.Event()

        class BlockingGateway(FakeGateway):
            def __init__(self) -> None:
                super().__init__()
                self.started_count = 0

            async def create(
                self, payload: PrivateVoiceSessionRequest, *, request_id: str
            ) -> PrivateVoiceSessionResponse:
                self.started_count += 1
                if self.started_count == 1:
                    started.set()
                    await release.wait()
                return await super().create(payload, request_id=request_id)

        gateway = BlockingGateway()
        subject = service(gateway)
        first = asyncio.create_task(
            subject.create(
                request(),
                principal=PRINCIPAL,
                idempotency_key="voice-create-key-concurrent-1",
                request_id="req_" + "b" * 32,
            )
        )
        await started.wait()
        second = await asyncio.wait_for(
            subject.create(
                request(),
                principal=OTHER_PRINCIPAL,
                idempotency_key="voice-create-key-concurrent-2",
                request_id="req_" + "c" * 32,
            ),
            timeout=0.5,
        )
        assert second.session_id is not None
        release.set()
        await first
        await subject.close()

    asyncio.run(run())


def test_terminal_records_and_replays_are_size_and_ttl_bounded() -> None:
    async def run() -> None:
        clock = [NOW]
        gateway = FakeGateway()
        subject = VoiceSessionService(
            enabled=True,
            gateway=gateway,
            pseudonym_key=b"voice-test-pseudonym-key-at-least-32-bytes",
            now=lambda: clock[0],
            cleanup_retry_delays=(0.0,),
            retention_seconds=10,
            maximum_session_records=2,
            maximum_replay_entries=2,
        )
        admissions = []
        for index in range(3):
            admission = await subject.create(
                request(f"v=0\r\na=bounded-offer-{index}"),
                principal=PRINCIPAL,
                idempotency_key=f"voice-create-bounded-{index:04d}",
                request_id="req_" + str(index) * 32,
            )
            admissions.append(admission)
            await subject.end(
                admission.session_id,
                EndVoiceSessionRequest(reason="cancelled", events=[]),
                principal=PRINCIPAL,
                idempotency_key=f"voice-end-bounded-{index:04d}",
                request_id="req_" + str(index + 3) * 32,
            )

        assert len(subject._records) == 2
        assert len(subject._create_replays) <= 2
        assert len(subject._end_replays) <= 2
        with pytest.raises(VoiceSessionNotFoundError):
            await subject.recap(admissions[0].session_id, principal=PRINCIPAL)

        clock[0] += timedelta(seconds=11)
        with pytest.raises(VoiceSessionNotFoundError):
            await subject.recap(admissions[-1].session_id, principal=PRINCIPAL)
        assert subject._records == {}
        assert subject._create_replays == {}
        assert subject._end_replays == {}
        await subject.close()

    asyncio.run(run())


def test_capacity_never_evicts_an_active_provider_reference() -> None:
    async def run() -> None:
        gateway = FakeGateway()
        subject = VoiceSessionService(
            enabled=True,
            gateway=gateway,
            pseudonym_key=b"voice-test-pseudonym-key-at-least-32-bytes",
            maximum_session_records=1,
        )
        await subject.create(
            request(),
            principal=PRINCIPAL,
            idempotency_key="voice-create-capacity-0001",
            request_id="req_" + "7" * 32,
        )
        with pytest.raises(VoiceSessionUnavailableError):
            await subject.create(
                request("v=0\r\na=second-capacity-offer"),
                principal=OTHER_PRINCIPAL,
                idempotency_key="voice-create-capacity-0002",
                request_id="req_" + "8" * 32,
            )
        assert len(subject._records) == 1
        assert len(gateway.creates) == 1
        await subject.close()

    asyncio.run(run())
