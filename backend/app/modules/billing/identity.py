"""Data-minimized RevenueCat identity derivation."""

import base64
import hashlib
import hmac


def derive_billing_actor_ref(*, key: bytes, app_user_id: str) -> str:
    """Pseudonymize a provider App User ID before persistence."""

    digest = hmac.new(key, app_user_id.encode(), hashlib.sha256).digest()
    encoded = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return f"rcusr_v1_{encoded}"
