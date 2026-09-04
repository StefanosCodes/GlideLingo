from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.clerk import ClerkPrincipal
from app.core.config import Settings
from app.integrations.voice_realtime.client import (
    PrivateVoiceEndRequest,
    PrivateVoiceSessionRequest,
    PrivateVoiceSessionResponse,
)
from app.main import create_app
from app.modules.billing.schemas import ProEntitlementStatus
from app.modules.billing.service import BillingService
from app.modules.voice_sessions.schemas import VoiceSessionSpec
from app.modules.voice_sessions.service import VoiceSessionService

PAYLOAD = {
    "course_id": "el-from-zero",
    "scenario_id": "el-greeting-introduction-v1",
    "conversation_mode": "guided",
    "source_locale": "en",
    "target_locale": "el-GR",
    "captions_enabled": True,
    "retain_transcript": False,
    "offer_sdp": "v=0\r\na=offer-data-for-router-test",
    "client_capabilities": ["audio", "captions", "interrupt", "reconnect"],
}
HEADERS = {
    "Authorization": "Bearer valid-test-token",
    "Idempotency-Key": "voice-router-idempotency-0001",
}


class AcceptingVerifier:
    def verify(self, token: str) -> ClerkPrincipal:
        assert token == "valid-test-token"
        return ClerkPrincipal(user_id="user_voice_router", issuer="https://clerk.test")


class Billing:
    def __init__(self, allowed: bool = True) -> None:
        self.allowed = allowed
        self.calls = 0

    async def require_pro(self, **_kwargs: object) -> ProEntitlementStatus:
        self.calls += 1
        if not self.allowed:
            from app.core.errors import ProRequiredError

            raise ProRequiredError
        return ProEntitlementStatus(state="active", is_pro=True, environment="SANDBOX")


class Gateway:
    def __init__(self) -> None:
        self.creates = 0
        self.ends = 0
        self.last_create: PrivateVoiceSessionRequest | None = None

    async def create(
        self, payload: PrivateVoiceSessionRequest, *, request_id: str
    ) -> PrivateVoiceSessionResponse:
        self.creates += 1
        self.last_create = payload
        return PrivateVoiceSessionResponse(
            application_session_id=payload.application_session_id,
            provider_call_id="call_router_1",
            answer_sdp="v=0\r\na=answer-data-for-router-test",
            spec=VoiceSessionSpec(
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
            ),
        )

    async def end(self, payload: PrivateVoiceEndRequest, *, request_id: str) -> None:
        self.ends += 1

    async def close(self) -> None:
        return None


def make_app(*, enabled: bool = True, allowed: bool = True) -> tuple[FastAPI, Gateway, Billing]:
    gateway = Gateway()
    voice = VoiceSessionService(
        enabled=enabled,
        gateway=gateway,
        pseudonym_key=b"voice-router-pseudonym-key-at-least-32-bytes",
    )
    application = create_app(Settings(_env_file=None), voice_session_service=voice)
    application.state.clerk_token_verifier = AcceptingVerifier()
    billing = Billing(allowed)
    application.state.billing_service = cast(BillingService, billing)
    return application, gateway, billing


def test_entitlement_is_admission_only_and_cannot_block_cleanup_or_recap() -> None:
    application, gateway, billing = make_app()
    with TestClient(application) as client:
        created = client.post("/v1/voice-sessions", json=PAYLOAD, headers=HEADERS)
        assert created.status_code == 200
        session_id = created.json()["session_id"]
        assert "provider_call_id" not in created.text
        assert "token" not in created.text.lower()
        billing.allowed = False
        ended = client.post(
            f"/v1/voice-sessions/{session_id}/end",
            json={
                "reason": "cancelled",
                "events": [
                    {
                        "event_id": "event:voice:router:0001",
                        "session_id": session_id,
                        "sequence": 1,
                        "occurred_at": "2026-09-04T12:00:00Z",
                        "type": "transcript.final",
                        "speaker": "learner",
                        "text": "private learner text",
                    }
                ],
            },
            headers={**HEADERS, "Idempotency-Key": "voice-end-idempotency-0001"},
        )
        recap = client.get(
            f"/v1/voice-sessions/{session_id}/recap",
            headers={"Authorization": "Bearer valid-test-token"},
        )
    assert ended.status_code == 200
    assert recap.json() == ended.json()
    assert ended.json()["transcript"] == []
    assert "private learner text" not in ended.text
    assert "private learner text" not in recap.text
    assert gateway.creates == 1
    assert gateway.ends == 1
    assert gateway.last_create is not None
    assert gateway.last_create.captions_enabled is True
    assert gateway.last_create.actor_ref.startswith("vusr_v1_")
    assert "user_voice_router" not in gateway.last_create.actor_ref
    assert billing.calls == 1


def test_authentication_and_entitlement_precede_provider_admission() -> None:
    application, gateway, billing = make_app(allowed=False)
    with TestClient(application) as client:
        unauthenticated = client.post(
            "/v1/voice-sessions",
            json=PAYLOAD,
            headers={"Idempotency-Key": HEADERS["Idempotency-Key"]},
        )
        denied = client.post("/v1/voice-sessions", json=PAYLOAD, headers=HEADERS)
    assert unauthenticated.status_code == 401
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "pro_required"
    assert billing.calls == 1
    assert gateway.creates == 0


def test_disabled_flag_fails_before_billing_or_provider() -> None:
    application, gateway, billing = make_app(enabled=False)
    with TestClient(application) as client:
        response = client.post("/v1/voice-sessions", json=PAYLOAD, headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "voice_session_unavailable"
    assert billing.calls == 0
    assert gateway.creates == 0


def test_malformed_sdp_retention_and_removed_presentation_fields_are_rejected() -> None:
    application, gateway, _billing = make_app()
    with TestClient(application) as client:
        bad_sdp = client.post(
            "/v1/voice-sessions",
            json={**PAYLOAD, "offer_sdp": "not-an-sdp"},
            headers=HEADERS,
        )
        retention = client.post(
            "/v1/voice-sessions",
            json={**PAYLOAD, "retain_transcript": True},
            headers=HEADERS,
        )
        removed_presentation = client.post(
            "/v1/voice-sessions",
            json={**PAYLOAD, "show_tutor": False},
            headers=HEADERS,
        )
    assert bad_sdp.status_code == 422
    assert retention.status_code == 422
    assert removed_presentation.status_code == 422
    assert gateway.creates == 0
