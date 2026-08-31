import asyncio
import json
from uuid import UUID

import httpx
import pytest
from google.auth.exceptions import GoogleAuthError

from app.core.errors import LessonTutorNotSentError, LessonTutorTimeoutError
from app.integrations.lesson_tutor.client import LessonTutorHttpClient, PrivateLessonTutorTurn

TURN = PrivateLessonTutorTurn(
    actor_ref=f"tusr_v1_{'A' * 43}",
    turn_ref=UUID("00000000-0000-4000-8000-000000000001"),
    lesson_id="el-letters-1",
    visible_step_index=2,
    selected_choice=None,
    message="Why?",
    history=[],
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


def test_private_client_sends_only_allowlisted_payload_and_google_identity() -> None:
    captured: httpx.Request | None = None

    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal captured
        captured = request
        return httpx.Response(
            200,
            json={"reply": "A bounded reply.", "prompt_version": "lesson-tutor-v1"},
        )

    client = LessonTutorHttpClient(
        base_url="https://private-tutor.example.run.app",
        token_provider=TokenProvider(),
        timeout_seconds=1,
        transport=httpx.MockTransport(handle),
    )
    try:
        response = asyncio.run(client.turn(TURN, request_id="req_test"))
    finally:
        asyncio.run(client.close())

    assert response.reply == "A bounded reply."
    assert captured is not None
    assert captured.headers["authorization"] == "Bearer google-id-token"
    assert captured.headers["x-request-id"] == "req_test"
    payload = json.loads(captured.content)
    assert payload == TURN.model_dump(mode="json")
    assert "conversation_id" not in payload


def test_identity_token_failure_is_provably_not_sent() -> None:
    calls = 0

    def handle(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    client = LessonTutorHttpClient(
        base_url="https://private-tutor.example.run.app",
        token_provider=TokenProvider(error=GoogleAuthError("unavailable")),  # type: ignore[no-untyped-call]
        timeout_seconds=1,
        transport=httpx.MockTransport(handle),
    )
    try:
        with pytest.raises(LessonTutorNotSentError):
            asyncio.run(client.turn(TURN, request_id="req_test"))
    finally:
        asyncio.run(client.close())
    assert calls == 0


def test_identity_token_and_http_share_one_total_timeout() -> None:
    client = LessonTutorHttpClient(
        base_url="https://private-tutor.example.run.app",
        token_provider=TokenProvider(delay=0.05),
        timeout_seconds=0.01,
        transport=httpx.MockTransport(lambda _request: httpx.Response(500)),
    )
    try:
        with pytest.raises(LessonTutorTimeoutError):
            asyncio.run(client.turn(TURN, request_id="req_test"))
    finally:
        asyncio.run(client.close())
