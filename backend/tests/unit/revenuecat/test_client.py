import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.integrations.revenuecat.client import (
    MAX_CUSTOMER_INFO_BYTES,
    RevenueCatHttpClient,
    RevenueCatIdentityMismatchError,
    RevenueCatUnavailableError,
)

NOW = datetime.now(UTC).replace(microsecond=0)


def response_payload(
    *,
    app_user_id: str = "user_123",
    expires_at: datetime | None = None,
    include_entitlement: bool = True,
    is_sandbox: bool = True,
) -> dict[str, object]:
    entitlement = {
        "expires_date": expires_at.isoformat().replace("+00:00", "Z") if expires_at else None,
        "product_identifier": "glidelingo_monthly",
    }
    return {
        "request_date_ms": int(NOW.timestamp() * 1000),
        "subscriber": {
            "original_app_user_id": app_user_id,
            "entitlements": {"pro": entitlement} if include_entitlement else {},
            "subscriptions": {"glidelingo_monthly": {"is_sandbox": is_sandbox}},
            "non_subscriptions": {},
        },
    }


def client_for(payload: dict[str, object]) -> RevenueCatHttpClient:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/subscribers/user_123"
        assert request.headers["authorization"] == "Bearer server-secret"
        return httpx.Response(200, json=payload)

    return RevenueCatHttpClient(
        api_key="server-secret",
        timeout_seconds=1,
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.parametrize(
    ("payload", "active"),
    [
        (response_payload(expires_at=NOW + timedelta(days=1)), True),
        (response_payload(expires_at=NOW - timedelta(seconds=1)), False),
        (response_payload(include_entitlement=False), False),
        (response_payload(expires_at=NOW + timedelta(days=1), is_sandbox=False), False),
    ],
)
def test_reconciliation_derives_only_expected_environment_access(
    payload: dict[str, object], active: bool
) -> None:
    provider = client_for(payload)
    snapshot = asyncio.run(
        provider.fetch_pro_entitlement(app_user_id="user_123", environment="SANDBOX")
    )

    assert snapshot.is_active is active
    assert snapshot.environment == "SANDBOX"
    asyncio.run(provider.close())


def test_reconciliation_rejects_mismatched_subscriber_identity() -> None:
    provider = client_for(response_payload(app_user_id="user_other"))

    with pytest.raises(RevenueCatIdentityMismatchError):
        asyncio.run(provider.fetch_pro_entitlement(app_user_id="user_123", environment="SANDBOX"))
    asyncio.run(provider.close())


def test_reconciliation_rejects_entitlement_without_environment_source() -> None:
    payload = response_payload()
    subscriber = payload["subscriber"]
    assert isinstance(subscriber, dict)
    subscriber["subscriptions"] = {}
    provider = client_for(payload)

    with pytest.raises(RevenueCatUnavailableError):
        asyncio.run(provider.fetch_pro_entitlement(app_user_id="user_123", environment="SANDBOX"))
    asyncio.run(provider.close())


def test_reconciliation_rejects_sandbox_access_in_production() -> None:
    provider = client_for(response_payload(expires_at=NOW + timedelta(days=1), is_sandbox=True))

    snapshot = asyncio.run(
        provider.fetch_pro_entitlement(app_user_id="user_123", environment="PRODUCTION")
    )

    assert snapshot.is_active is False
    assert snapshot.environment == "PRODUCTION"
    asyncio.run(provider.close())


def test_reconciliation_bounds_untrusted_provider_response() -> None:
    provider = RevenueCatHttpClient(
        api_key="server-secret",
        timeout_seconds=1,
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, content=b"x" * (MAX_CUSTOMER_INFO_BYTES + 1))
        ),
    )

    with pytest.raises(RevenueCatUnavailableError):
        asyncio.run(provider.fetch_pro_entitlement(app_user_id="user_123", environment="SANDBOX"))
    asyncio.run(provider.close())
