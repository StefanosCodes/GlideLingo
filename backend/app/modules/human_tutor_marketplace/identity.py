"""Data-minimized identity derivation for human tutor marketplace records."""

import base64
import hashlib
import hmac


def derive_marketplace_actor_ref(*, key: bytes, clerk_user_id: str) -> str:
    """Derive a stable pseudonym without persisting the Clerk subject."""

    digest = hmac.new(key, clerk_user_id.encode(), hashlib.sha256).digest()
    encoded = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return f"mktusr_v1_{encoded}"
