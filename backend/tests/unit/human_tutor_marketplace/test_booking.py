import asyncio
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from typing import cast
from urllib.parse import parse_qs
from uuid import UUID

import httpx
import pytest

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    HumanTutorMarketplaceForbiddenError,
    HumanTutorMarketplaceUnavailableError,
    TutorApplicationConflictError,
)
from app.modules.human_tutor_marketplace.booking import (
    BookingRepository,
    BookingService,
    StripeHttpMarketplaceProvider,
    StripeOperationError,
    parse_checkout_webhook,
    verify_stripe_signature,
)
from app.modules.human_tutor_marketplace.discovery import MarketplaceDiscoveryService

BOOKING_ID = UUID("9948afe2-59ac-46f6-88cf-15c5f9994567")


def test_acquisition_kill_switch_rejects_checkout_before_any_dependency_access() -> None:
    service = BookingService(
        enabled=True,
        repository=cast(BookingRepository, object()),
        provider=None,
        discovery=cast(MarketplaceDiscoveryService, object()),
        pseudonym_key=b"booking-test-key-at-least-32-bytes",
        actor_allowlist=("user_learner",),
        environment="SANDBOX",
        platform_account_id="acct_test",
        connect_refresh_url="https://app.example.test/refresh",
        connect_return_url="https://app.example.test/return",
        checkout_success_url="https://app.example.test/success",
        checkout_cancel_url="https://app.example.test/cancel",
        meeting_hosts=("meet.example.test",),
        accepting_new_bookings=False,
    )

    with pytest.raises(HumanTutorMarketplaceUnavailableError):
        asyncio.run(
            service.create_checkout(
                principal=ClerkPrincipal(user_id="user_learner", issuer="https://clerk.test"),
                tutor_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9991234"),
                starts_at=datetime.now(UTC) + timedelta(hours=2),
                idempotency_key=UUID("9948afe2-59ac-46f6-88cf-15c5f9995678"),
            )
        )


def checkout_payload(*, created: int = 1_800_000_000) -> dict[str, object]:
    return {
        "id": "cs_test_reviewed123",
        "url": "https://checkout.stripe.com/c/pay/reviewed123",
        "payment_intent": "pi_reviewed123",
        "status": "open",
        "payment_status": "unpaid",
        "livemode": False,
        "metadata": {
            "booking_id": str(BOOKING_ID),
            "platform_account_id": "acct_reviewed123",
            "environment": "SANDBOX",
        },
        "created": created,
    }


def test_stripe_adapter_pins_version_idempotency_and_server_owned_amount() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=checkout_payload())

    client = httpx.AsyncClient(
        base_url="https://api.stripe.com", transport=httpx.MockTransport(handler)
    )
    provider = StripeHttpMarketplaceProvider(
        secret_key="sk_test_server_only",
        api_version="2026-02-25.clover",
        timeout_seconds=2,
        client=client,
    )
    checkout = asyncio.run(
        provider.create_checkout(
            booking_id=BOOKING_ID,
            amount_minor=2500,
            currency="USD",
            title="Reviewed lesson",
            success_url="https://app.glidelingo.test/bookings?checkout=success",
            cancel_url="https://app.glidelingo.test/bookings?checkout=cancelled",
            idempotency_key="booking:reviewed:checkout",
            platform_account_id="acct_reviewed123",
            environment="SANDBOX",
        )
    )
    asyncio.run(provider.close())

    assert checkout.booking_id == BOOKING_ID
    request = captured[0]
    body = parse_qs(request.content.decode())
    assert request.headers["Stripe-Version"] == "2026-02-25.clover"
    assert request.headers["Idempotency-Key"] == "booking:reviewed:checkout"
    assert body["line_items[0][price_data][unit_amount]"] == ["2500"]
    assert body["client_reference_id"] == [str(BOOKING_ID)]
    assert body["payment_intent_data[transfer_group]"] == [f"booking_{BOOKING_ID}"]
    assert not any("destination" in key for key in body)


def test_stripe_adapter_classifies_post_timeout_as_ambiguous() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("bounded timeout")

    client = httpx.AsyncClient(
        base_url="https://api.stripe.com", transport=httpx.MockTransport(handler)
    )
    provider = StripeHttpMarketplaceProvider(
        secret_key="sk_test_server_only",
        api_version="2026-02-25.clover",
        timeout_seconds=2,
        client=client,
    )
    with pytest.raises(StripeOperationError) as caught:
        asyncio.run(
            provider.create_checkout(
                booking_id=BOOKING_ID,
                amount_minor=2500,
                currency="USD",
                title="Reviewed lesson",
                success_url="https://app.glidelingo.test/bookings",
                cancel_url="https://app.glidelingo.test/bookings",
                idempotency_key="booking:reviewed:checkout",
                platform_account_id="acct_reviewed123",
                environment="SANDBOX",
            )
        )
    asyncio.run(provider.close())

    assert caught.value.ambiguous is True
    assert caught.value.code == "provider_timeout"


def test_webhook_signature_rejects_tampering_and_staleness() -> None:
    now = datetime(2026, 9, 4, 12, tzinfo=UTC)
    raw = b'{"reviewed":true}'
    secret = b"whsec_reviewed_test_secret"
    timestamp = int(now.timestamp())
    signature = hmac.new(secret, str(timestamp).encode() + b"." + raw, hashlib.sha256).hexdigest()

    verify_stripe_signature(
        raw_body=raw,
        signature_header=f"t={timestamp},v1={signature}",
        secret=secret,
        now=now,
        tolerance_seconds=300,
    )
    with pytest.raises(HumanTutorMarketplaceForbiddenError):
        verify_stripe_signature(
            raw_body=raw + b" ",
            signature_header=f"t={timestamp},v1={signature}",
            secret=secret,
            now=now,
            tolerance_seconds=300,
        )
    with pytest.raises(HumanTutorMarketplaceForbiddenError):
        verify_stripe_signature(
            raw_body=raw,
            signature_header=f"t={timestamp},v1={signature}",
            secret=secret,
            now=now + timedelta(seconds=301),
            tolerance_seconds=300,
        )


def test_webhook_uses_event_time_and_rejects_unknown_event_type() -> None:
    payload = {
        "id": "evt_reviewed123",
        "type": "checkout.session.completed",
        "created": 1_800_000_100,
        "data": {"object": checkout_payload(created=1_700_000_000)},
    }
    parsed = parse_checkout_webhook(json.dumps(payload).encode())

    assert parsed.checkout.created_at == datetime.fromtimestamp(1_800_000_100, UTC)

    payload["type"] = "charge.succeeded"
    with pytest.raises(TutorApplicationConflictError):
        parse_checkout_webhook(json.dumps(payload).encode())
