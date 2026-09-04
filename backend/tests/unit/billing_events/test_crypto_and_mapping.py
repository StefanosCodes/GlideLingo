import pytest

from app.modules.billing_events.crypto import (
    InvalidProviderActorCiphertextError,
    ProviderActorCipher,
)
from app.modules.billing_events.intake import revenuecat_consumers

KEY = b"billing-event-crypto-test-key-at-least-32-bytes"


def test_provider_actor_cipher_is_bound_to_provider_scope() -> None:
    cipher = ProviderActorCipher(secret=KEY)
    encrypted = cipher.encrypt(
        provider_actor_id="user_test_123",
        provider="revenuecat",
        environment="SANDBOX",
        provider_account_ref="app_test",
        actor_ref=f"rcusr_v1_{'A' * 43}",
    )

    assert (
        cipher.decrypt(
            ciphertext=encrypted,
            provider="revenuecat",
            environment="SANDBOX",
            provider_account_ref="app_test",
            actor_ref=f"rcusr_v1_{'A' * 43}",
        )
        == "user_test_123"
    )
    with pytest.raises(InvalidProviderActorCiphertextError):
        cipher.decrypt(
            ciphertext=encrypted,
            provider="revenuecat",
            environment="PRODUCTION",
            provider_account_ref="app_test",
            actor_ref=f"rcusr_v1_{'A' * 43}",
        )


def test_reviewed_purchase_event_routes_to_independent_consumers() -> None:
    for event_type in ("INITIAL_PURCHASE", "REFUND", "REFUND_REVERSED"):
        assert revenuecat_consumers(event_type=event_type, has_provider_actor=True) == (
            "pro_entitlement",
            "affiliate_finance",
        )


def test_unknown_or_actorless_event_has_no_consumer_side_effect() -> None:
    assert revenuecat_consumers(event_type="FUTURE_EVENT", has_provider_actor=True) == ()
    assert revenuecat_consumers(event_type="RENEWAL", has_provider_actor=False) == ()


def test_actorless_reversal_routes_only_to_transaction_scoped_finance() -> None:
    assert revenuecat_consumers(
        event_type="REFUND",
        has_provider_actor=False,
        has_transaction_ref=True,
    ) == ("affiliate_finance",)
    assert (
        revenuecat_consumers(
            event_type="REFUND",
            has_provider_actor=False,
            has_transaction_ref=False,
        )
        == ()
    )
