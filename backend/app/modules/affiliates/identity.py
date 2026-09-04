"""One-way, server-owned references for verified Clerk principals."""

import base64
import hashlib
import hmac

from app.auth.clerk import ClerkPrincipal


def derive_affiliate_principal_ref(*, key: bytes, principal: ClerkPrincipal) -> str:
    """Derive a stable reference without retaining the Clerk subject or issuer."""

    digest = hmac.new(
        key,
        principal.issuer.encode("utf-8") + b"\0" + principal.user_id.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    encoded = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return f"affusr_v1_{encoded}"


def digest_handoff_token(token: str) -> str:
    """Return the irreversible digest persisted for a random handoff token."""

    return hashlib.sha256(token.encode("ascii")).hexdigest()
