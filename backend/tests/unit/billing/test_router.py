import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.clerk import ClerkPrincipal
from app.core.config import Settings
from app.integrations.revenuecat.client import RevenueCatSnapshot
from app.main import create_app
from app.modules.billing.identity import derive_billing_actor_ref
from app.modules.billing.repository import EntitlementRepository, StoredProEntitlement
from app.modules.billing.service import BillingService

NOW = datetime.now(UTC).replace(microsecond=0)
KEY = b"billing-router-pseudonym-key-at-least-32-bytes"
AUTHORIZATION = "Bearer billing-router-webhook-secret"
SIGNING_SECRET = b"billing-router-signing-secret-at-least-32-bytes"


class AcceptingVerifier:
    def verify(self, token: str) -> ClerkPrincipal:
        assert token == "valid-test-token"
        return ClerkPrincipal(user_id="user_route_123", issuer="https://clerk.test")


class MemoryRepository:
    def __init__(self) -> None:
        self.stored: StoredProEntitlement | None = None
        self.events: set[str] = set()

    def get_pro(self, **_kwargs: object) -> StoredProEntitlement | None:
        return self.stored

    def has_webhook_event(self, *, event_id: str) -> bool:
        return event_id in self.events

    def store_reconciliation(self, **kwargs: object) -> StoredProEntitlement:
        self.stored = self._stored(kwargs)
        return self.stored

    def record_webhook_snapshot(self, *, event_id: str, **kwargs: object) -> str:
        if event_id in self.events:
            return "duplicate"
        self.events.add(event_id)
        self.stored = self._stored(kwargs)
        return "applied"

    @staticmethod
    def _stored(values: dict[str, object]) -> StoredProEntitlement:
        observed = values.get("observed_at", values.get("snapshot_at", values.get("verified_at")))
        expires_at = values.get("expires_at")
        assert isinstance(observed, datetime)
        assert expires_at is None or isinstance(expires_at, datetime)
        return StoredProEntitlement(
            actor_ref=str(values["actor_ref"]),
            environment="SANDBOX",
            is_active=bool(values["is_active"]),
            expires_at=expires_at,
            provider_event_at=observed,
            verified_at=observed,
        )


class ActiveProvider:
    def __init__(self) -> None:
        self.users: list[str] = []

    async def fetch_pro_entitlement(
        self, *, app_user_id: str, **_kwargs: object
    ) -> RevenueCatSnapshot:
        self.users.append(app_user_id)
        return RevenueCatSnapshot(
            is_active=True,
            environment="SANDBOX",
            expires_at=NOW + timedelta(days=30),
            observed_at=NOW,
        )

    async def close(self) -> None:
        return None


def billing_service(repository: MemoryRepository, provider: ActiveProvider) -> BillingService:
    return BillingService(
        enabled=True,
        repository=cast(EntitlementRepository, repository),
        provider=provider,
        pseudonym_key=KEY,
        environment="SANDBOX",
        freshness_seconds=900,
        webhook_authorization=AUTHORIZATION,
        webhook_signing_secret=SIGNING_SECRET.decode(),
        webhook_signature_tolerance_seconds=300,
    )


def make_client() -> tuple[TestClient, MemoryRepository, ActiveProvider]:
    repository = MemoryRepository()
    provider = ActiveProvider()
    application = create_app(
        Settings(_env_file=None),
        billing_service=billing_service(repository, provider),
    )
    application.state.clerk_token_verifier = AcceptingVerifier()
    return TestClient(application), repository, provider


def signed_webhook_headers(raw_body: bytes) -> dict[str, str]:
    timestamp = int(datetime.now(UTC).timestamp())
    signature = hmac.new(
        SIGNING_SECRET,
        str(timestamp).encode() + b"." + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return {
        "Authorization": AUTHORIZATION,
        "X-RevenueCat-Webhook-Signature": f"t={timestamp},v1={signature}",
        "Content-Type": "application/json",
    }


def test_status_reconciles_only_the_verified_clerk_subject() -> None:
    client, repository, provider = make_client()
    with client:
        response = client.get(
            "/v1/billing/entitlements/pro",
            headers={"Authorization": "Bearer valid-test-token"},
        )

    assert response.status_code == 200
    assert response.json()["state"] == "active"
    assert response.json()["is_pro"] is True
    assert provider.users == ["user_route_123"]
    assert repository.stored is not None
    assert repository.stored.actor_ref == derive_billing_actor_ref(
        key=KEY, app_user_id="user_route_123"
    )
    assert "user_route_123" not in str(response.json())


def test_reconcile_forces_provider_fetch_over_fresh_inactive_state() -> None:
    client, repository, provider = make_client()
    repository.stored = StoredProEntitlement(
        actor_ref=derive_billing_actor_ref(key=KEY, app_user_id="user_route_123"),
        environment="SANDBOX",
        is_active=False,
        expires_at=None,
        provider_event_at=NOW,
        verified_at=datetime.now(UTC),
    )

    with client:
        response = client.post(
            "/v1/billing/entitlements/pro/reconcile",
            headers={"Authorization": "Bearer valid-test-token"},
        )

    assert response.status_code == 200
    assert response.json()["state"] == "active"
    assert response.json()["is_pro"] is True
    assert provider.users == ["user_route_123"]


def test_webhook_verifies_raw_body_and_deduplicates_event_id() -> None:
    client, repository, provider = make_client()
    raw = json.dumps(
        {
            "api_version": "1.0",
            "event": {
                "id": "evt_router_1",
                "type": "INITIAL_PURCHASE",
                "event_timestamp_ms": int(NOW.timestamp() * 1000),
                "environment": "SANDBOX",
                "app_user_id": "user_route_123",
            },
        },
        separators=(",", ":"),
    ).encode()
    headers = signed_webhook_headers(raw)
    with client:
        first = client.post("/v1/billing/revenuecat/webhook", content=raw, headers=headers)
        duplicate = client.post("/v1/billing/revenuecat/webhook", content=raw, headers=headers)

    assert first.status_code == 200
    assert first.json() == {"status": "applied"}
    assert duplicate.status_code == 200
    assert duplicate.json() == {"status": "duplicate"}
    assert repository.events == {"evt_router_1"}
    assert provider.users == ["user_route_123"]


def test_webhook_rejects_invalid_signature_before_payload_processing() -> None:
    client, _repository, provider = make_client()
    raw = b"not-json"
    headers = signed_webhook_headers(raw)
    headers["X-RevenueCat-Webhook-Signature"] = "t=1,v1=" + "0" * 64
    with client:
        response = client.post("/v1/billing/revenuecat/webhook", content=raw, headers=headers)

    assert response.status_code == 401
    assert provider.users == []


def test_webhook_body_is_bounded() -> None:
    client, _repository, provider = make_client()
    raw = b"x" * 65537
    with client:
        response = client.post(
            "/v1/billing/revenuecat/webhook",
            content=raw,
            headers=signed_webhook_headers(raw),
        )

    assert response.status_code == 413
    assert provider.users == []


def test_billing_openapi_separates_clerk_status_from_public_webhook() -> None:
    client, _repository, _provider = make_client()
    with client:
        schema = cast(FastAPI, client.app).openapi()

    status_operation = schema["paths"]["/v1/billing/entitlements/pro"]["get"]
    reconcile_operation = schema["paths"]["/v1/billing/entitlements/pro/reconcile"]["post"]
    webhook_operation = schema["paths"]["/v1/billing/revenuecat/webhook"]["post"]
    assert status_operation["security"] == [{"ClerkSessionToken": []}]
    assert reconcile_operation["security"] == [{"ClerkSessionToken": []}]
    assert "requestBody" not in reconcile_operation
    assert "security" not in webhook_operation
