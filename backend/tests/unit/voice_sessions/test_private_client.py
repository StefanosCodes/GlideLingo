import asyncio
import json
from uuid import UUID

import httpx
import pytest
from google.auth.exceptions import GoogleAuthError

from app.core.errors import (
    VoiceSessionNotSentError,
    VoiceSessionTimeoutError,
    VoiceSessionUnavailableError,
)
from app.integrations.voice_realtime.client import (
    PrivateVoiceSessionRequest,
    VoiceRealtimeHttpClient,
)

REQUEST = PrivateVoiceSessionRequest(
    actor_ref=f"vusr_v1_{'A' * 43}",
    application_session_id=UUID("00000000-0000-4000-8000-000000000001"),
    course_id="en-el-GR",
    scenario_id="el-letters-1-voice-v1",
    source_locale="en",
    target_locale="el-GR",
    conversation_mode="guided",
    captions_enabled=True,
    offer_sdp="v=0\r\na=private-client-offer",
)


class TokenProvider:
    def __init__(self, *, error: Exception | None = None, delay: float = 0) -> None:
        self.error = error
        self.delay = delay

    async def token(self) -> str:
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return "google-id-token"


def valid_response() -> dict[str, object]:
    return {
        "application_session_id": str(REQUEST.application_session_id),
        "provider_call_id": "call_private_test",
        "answer_sdp": "v=0\r\na=private-client-answer",
        "spec": {
            "course_id": REQUEST.course_id,
            "course_version": "1.0.0",
            "course_content_hash": "sha256:" + "a" * 64,
            "scenario_id": REQUEST.scenario_id,
            "scenario_version": "1.0.0",
            "conversation_mode": REQUEST.conversation_mode,
            "source_locale": REQUEST.source_locale,
            "target_locale": REQUEST.target_locale,
            "persona_id": "glide-coach-v1",
            "voice_id": "configured-voice",
            "learner_level": "beginner",
            "capability_ids": ["el-script-vowels-a-e-i"],
            "correction_policy_version": "voice-correction-v1",
            "evidence_policy_version": "voice-practice-no-credit-v1",
            "maximum_duration_seconds": 180,
        },
    }


def test_private_client_sends_bounded_payload_with_service_identity() -> None:
    captured: httpx.Request | None = None

    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal captured
        captured = request
        return httpx.Response(200, json=valid_response())

    client = VoiceRealtimeHttpClient(
        base_url="https://private-tutor.example.run.app",
        token_provider=TokenProvider(),
        timeout_seconds=1,
        transport=httpx.MockTransport(handle),
    )
    try:
        response = asyncio.run(client.create(REQUEST, request_id="req_voice_private"))
    finally:
        asyncio.run(client.close())

    assert response.provider_call_id == "call_private_test"
    assert captured is not None
    assert captured.headers["authorization"] == "Bearer google-id-token"
    assert captured.headers["x-request-id"] == "req_voice_private"
    assert json.loads(captured.content) == REQUEST.model_dump(mode="json")


def test_identity_failure_is_not_sent_and_total_deadline_includes_token_fetch() -> None:
    calls = 0

    def handle(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=valid_response())

    identity_failure = VoiceRealtimeHttpClient(
        base_url="https://private-tutor.example.run.app",
        token_provider=TokenProvider(error=GoogleAuthError("unavailable")),  # type: ignore[no-untyped-call]
        timeout_seconds=1,
        transport=httpx.MockTransport(handle),
    )
    deadline = VoiceRealtimeHttpClient(
        base_url="https://private-tutor.example.run.app",
        token_provider=TokenProvider(delay=0.05),
        timeout_seconds=0.01,
        transport=httpx.MockTransport(handle),
    )
    try:
        with pytest.raises(VoiceSessionNotSentError):
            asyncio.run(identity_failure.create(REQUEST, request_id="req_identity_failure"))
        with pytest.raises(VoiceSessionTimeoutError):
            asyncio.run(deadline.create(REQUEST, request_id="req_token_deadline"))
    finally:
        asyncio.run(identity_failure.close())
        asyncio.run(deadline.close())
    assert calls == 0


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (httpx.Response(504), VoiceSessionTimeoutError),
        (httpx.Response(503), VoiceSessionUnavailableError),
        (httpx.Response(200, json={"unexpected": True}), VoiceSessionUnavailableError),
    ],
)
def test_private_failures_are_mapped_without_leaking_response_details(
    response: httpx.Response, expected: type[Exception]
) -> None:
    client = VoiceRealtimeHttpClient(
        base_url="https://private-tutor.example.run.app",
        token_provider=TokenProvider(),
        timeout_seconds=1,
        transport=httpx.MockTransport(lambda _request: response),
    )
    try:
        with pytest.raises(expected):
            asyncio.run(client.create(REQUEST, request_id="req_private_failure"))
    finally:
        asyncio.run(client.close())
