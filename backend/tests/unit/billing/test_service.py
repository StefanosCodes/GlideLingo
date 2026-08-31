import asyncio
import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    BillingUnavailableError,
    DependencyUnavailableError,
    ProRequiredError,
)
from app.integrations.revenuecat.client import RevenueCatSnapshot, RevenueCatUnavailableError
from app.modules.billing.identity import derive_billing_actor_ref
from app.modules.billing.repository import EntitlementRepository, StoredProEntitlement
from app.modules.billing.service import (
    BillingService,
    InvalidRevenueCatWebhookError,
    RevenueCatWebhookPayload,
)

NOW = datetime(2026, 8, 31, 20, 0, tzinfo=UTC)
KEY = b"billing-test-pseudonym-key-at-least-32-bytes"
PRINCIPAL = ClerkPrincipal(user_id="user_test_123", issuer="https://clerk.test")


class FakeRepository:
    def __init__(self, stored: StoredProEntitlement | None = None) -> None:
        self.stored = stored
        self.events: set[str] = set()
        self.apply_result = "applied"
        self.store_calls = 0
        self.raise_unavailable = False
        self.webhook_snapshot: dict[str, object] | None = None

    def get_pro(self, **_kwargs: object) -> StoredProEntitlement | None:
        if self.raise_unavailable:
            raise DependencyUnavailableError
        return self.stored

    def has_webhook_event(self, *, event_id: str) -> bool:
        return event_id in self.events

    def store_reconciliation(self, **kwargs: object) -> StoredProEntitlement:
        self.store_calls += 1
        expires_at = kwargs["expires_at"]
        verified_at = kwargs["observed_at"]
        assert expires_at is None or isinstance(expires_at, datetime)
        assert isinstance(verified_at, datetime)
        self.stored = stored_entitlement(
            active=bool(kwargs["is_active"]),
            expires_at=expires_at,
            verified_at=verified_at,
        )
        return self.stored

    def record_webhook_snapshot(self, *, event_id: str, **kwargs: object) -> str:
        self.events.add(event_id)
        self.webhook_snapshot = kwargs
        return self.apply_result


class FakeProvider:
    def __init__(
        self,
        snapshot: RevenueCatSnapshot | None = None,
        error: Exception | None = None,
    ) -> None:
        self.snapshot = snapshot
        self.error = error
        self.calls: list[str] = []

    async def fetch_pro_entitlement(
        self, *, app_user_id: str, **_kwargs: object
    ) -> RevenueCatSnapshot:
        self.calls.append(app_user_id)
        if self.error is not None:
            raise self.error
        assert self.snapshot is not None
        return self.snapshot

    async def close(self) -> None:
        return None


def stored_entitlement(
    *,
    active: bool,
    expires_at: datetime | None = None,
    verified_at: datetime = NOW,
) -> StoredProEntitlement:
    return StoredProEntitlement(
        actor_ref=derive_billing_actor_ref(key=KEY, app_user_id=PRINCIPAL.user_id),
        environment="SANDBOX",
        is_active=active,
        expires_at=expires_at,
        provider_event_at=verified_at,
        verified_at=verified_at,
    )


def service(
    repository: FakeRepository,
    provider: FakeProvider | None = None,
    *,
    enabled: bool = True,
) -> BillingService:
    return BillingService(
        enabled=enabled,
        repository=cast(EntitlementRepository, repository),
        provider=provider,
        pseudonym_key=KEY,
        environment="SANDBOX",
        freshness_seconds=900,
        webhook_authorization="Bearer webhook-test-secret",
        webhook_signing_secret="webhook-signing-test-secret-at-least-32-bytes",
        webhook_signature_tolerance_seconds=300,
        now=lambda: NOW,
    )


@pytest.mark.parametrize(
    ("stored", "state", "is_pro"),
    [
        (stored_entitlement(active=True, expires_at=NOW + timedelta(days=1)), "active", True),
        (stored_entitlement(active=False), "inactive", False),
        (stored_entitlement(active=True, expires_at=NOW - timedelta(seconds=1)), "inactive", False),
    ],
)
def test_fresh_persisted_state_is_authoritative(
    stored: StoredProEntitlement, state: str, is_pro: bool
) -> None:
    status = asyncio.run(service(FakeRepository(stored)).status(principal=PRINCIPAL))

    assert status.state == state
    assert status.is_pro is is_pro


def test_stale_state_reconciles_from_verified_principal_only() -> None:
    repository = FakeRepository(
        stored_entitlement(active=False, verified_at=NOW - timedelta(hours=1))
    )
    provider = FakeProvider(
        RevenueCatSnapshot(
            is_active=True,
            environment="SANDBOX",
            expires_at=NOW + timedelta(days=30),
            observed_at=NOW,
        )
    )

    status = asyncio.run(service(repository, provider).status(principal=PRINCIPAL))

    assert status.state == "active"
    assert status.is_pro is True
    assert provider.calls == [PRINCIPAL.user_id]
    assert repository.store_calls == 1


def test_stale_provider_snapshot_remains_fail_closed() -> None:
    repository = FakeRepository()
    provider = FakeProvider(
        RevenueCatSnapshot(
            is_active=True,
            environment="SANDBOX",
            expires_at=NOW + timedelta(days=30),
            observed_at=NOW - timedelta(hours=1),
        )
    )

    status = asyncio.run(service(repository, provider).status(principal=PRINCIPAL))

    assert status.state == "stale"
    assert status.is_pro is False


@pytest.mark.parametrize(
    ("stored", "expected_state"),
    [
        (stored_entitlement(active=True, verified_at=NOW - timedelta(hours=1)), "stale"),
        (None, "unavailable"),
    ],
)
def test_provider_failure_fails_closed(
    stored: StoredProEntitlement | None, expected_state: str
) -> None:
    provider = FakeProvider(error=RevenueCatUnavailableError())

    status = asyncio.run(service(FakeRepository(stored), provider).status(principal=PRINCIPAL))

    assert status.state == expected_state
    assert status.is_pro is False


def test_database_failure_fails_closed() -> None:
    repository = FakeRepository()
    repository.raise_unavailable = True

    status = asyncio.run(service(repository).status(principal=PRINCIPAL))

    assert status.state == "unavailable"
    assert status.is_pro is False


def test_require_pro_rejects_verified_inactive_state_as_pro_required() -> None:
    repository = FakeRepository(stored_entitlement(active=False))

    with pytest.raises(ProRequiredError):
        asyncio.run(service(repository).require_pro(principal=PRINCIPAL))


def test_require_pro_rejects_stale_state_as_billing_unavailable() -> None:
    repository = FakeRepository(
        stored_entitlement(active=True, verified_at=NOW - timedelta(hours=1))
    )

    with pytest.raises(BillingUnavailableError):
        asyncio.run(service(repository).require_pro(principal=PRINCIPAL))


def test_require_pro_rejects_disabled_billing_as_unavailable() -> None:
    with pytest.raises(BillingUnavailableError):
        asyncio.run(service(FakeRepository(), enabled=False).require_pro(principal=PRINCIPAL))


def test_require_pro_rejects_database_failure_as_unavailable() -> None:
    repository = FakeRepository()
    repository.raise_unavailable = True

    with pytest.raises(BillingUnavailableError):
        asyncio.run(service(repository).require_pro(principal=PRINCIPAL))


def test_require_pro_rejects_provider_failure_as_unavailable() -> None:
    repository = FakeRepository(
        stored_entitlement(active=True, verified_at=NOW - timedelta(hours=1))
    )
    provider = FakeProvider(error=RevenueCatUnavailableError())

    with pytest.raises(BillingUnavailableError):
        asyncio.run(service(repository, provider).require_pro(principal=PRINCIPAL))


def test_reconcile_forces_provider_over_fresh_inactive_state() -> None:
    repository = FakeRepository(stored_entitlement(active=False))
    provider = FakeProvider(
        RevenueCatSnapshot(
            is_active=True,
            environment="SANDBOX",
            expires_at=NOW + timedelta(days=30),
            observed_at=NOW,
        )
    )

    status = asyncio.run(service(repository, provider).reconcile(principal=PRINCIPAL))

    assert status.state == "active"
    assert status.is_pro is True
    assert provider.calls == [PRINCIPAL.user_id]
    assert repository.store_calls == 1


def signed_headers(raw_body: bytes, *, timestamp: int | None = None) -> tuple[str, str]:
    signed_at = timestamp if timestamp is not None else int(NOW.timestamp())
    digest = hmac.new(
        b"webhook-signing-test-secret-at-least-32-bytes",
        str(signed_at).encode() + b"." + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return "Bearer webhook-test-secret", f"t={signed_at},v1={digest}"


def test_webhook_authenticates_exact_raw_body() -> None:
    raw = b'{"api_version":"1.0","event":{}}'
    authorization, signature = signed_headers(raw)

    service(FakeRepository()).verify_webhook(
        raw_body=raw,
        authorization=authorization,
        signature_header=signature,
    )
    with pytest.raises(InvalidRevenueCatWebhookError):
        service(FakeRepository()).verify_webhook(
            raw_body=raw + b" ",
            authorization=authorization,
            signature_header=signature,
        )


@pytest.mark.parametrize(
    ("authorization", "signature"),
    [
        ("Bearer wrong", None),
        ("Bearer webhook-test-secret", "t=1,v1=" + "0" * 64),
        ("Bearer webhook-test-secret", "invalid"),
    ],
)
def test_webhook_rejects_invalid_secret_or_signature(
    authorization: str, signature: str | None
) -> None:
    with pytest.raises(InvalidRevenueCatWebhookError):
        service(FakeRepository()).verify_webhook(
            raw_body=b"{}",
            authorization=authorization,
            signature_header=signature,
        )


def webhook_payload(
    *, event_id: str = "evt_1", timestamp_ms: int | None = None
) -> RevenueCatWebhookPayload:
    return RevenueCatWebhookPayload.model_validate(
        {
            "api_version": "1.0",
            "event": {
                "id": event_id,
                "type": "INITIAL_PURCHASE",
                "event_timestamp_ms": timestamp_ms or int(NOW.timestamp() * 1000),
                "environment": "SANDBOX",
                "app_user_id": PRINCIPAL.user_id,
            },
        }
    )


def test_webhook_duplicate_skips_provider() -> None:
    repository = FakeRepository()
    repository.events.add("evt_1")
    provider = FakeProvider(error=AssertionError("provider must not be called"))

    response = asyncio.run(service(repository, provider).process_webhook(webhook_payload()))

    assert response.status == "duplicate"
    assert provider.calls == []


def test_webhook_preserves_repository_out_of_order_result() -> None:
    repository = FakeRepository()
    repository.apply_result = "out_of_order"
    provider = FakeProvider(
        RevenueCatSnapshot(
            is_active=False,
            environment="SANDBOX",
            expires_at=NOW - timedelta(days=1),
            observed_at=NOW,
        )
    )

    response = asyncio.run(service(repository, provider).process_webhook(webhook_payload()))

    assert response.status == "out_of_order"


def test_webhook_orders_current_state_by_snapshot_observation_time() -> None:
    repository = FakeRepository()
    snapshot_at = NOW + timedelta(seconds=20)
    provider = FakeProvider(
        RevenueCatSnapshot(
            is_active=True,
            environment="SANDBOX",
            expires_at=NOW + timedelta(days=30),
            observed_at=snapshot_at,
        )
    )

    response = asyncio.run(
        service(repository, provider).process_webhook(
            webhook_payload(timestamp_ms=int((NOW - timedelta(minutes=5)).timestamp() * 1000))
        )
    )

    assert response.status == "applied"
    assert repository.webhook_snapshot is not None
    assert repository.webhook_snapshot["snapshot_at"] == snapshot_at


def test_webhook_from_other_environment_is_ignored() -> None:
    payload = webhook_payload()
    payload.event.environment = "PRODUCTION"
    provider = FakeProvider(error=AssertionError("provider must not be called"))

    response = asyncio.run(service(FakeRepository(), provider).process_webhook(payload))

    assert response.status == "ignored"
    assert provider.calls == []


def test_webhook_with_future_provider_timestamp_cannot_poison_ordering() -> None:
    provider = FakeProvider(
        RevenueCatSnapshot(
            is_active=True,
            environment="SANDBOX",
            expires_at=NOW + timedelta(days=30),
            observed_at=NOW,
        )
    )
    payload = webhook_payload(timestamp_ms=int((NOW + timedelta(minutes=6)).timestamp() * 1000))
    repository = FakeRepository()

    response = asyncio.run(service(repository, provider).process_webhook(payload))

    assert response.status == "ignored"
    assert repository.events == set()
    assert provider.calls == []
