"""Tutor-scoped pseudonyms derived only after Clerk verification."""

import base64
import hashlib
import hmac

from app.auth.clerk import ClerkPrincipal

_DOMAIN = b"glidelingo:tutor-subject:v1\0"


def derive_tutor_actor_ref(*, key: bytes, principal: ClerkPrincipal) -> str:
    """Create a stable, non-reversible identifier for the private tutor boundary."""

    message = _DOMAIN + principal.issuer.encode() + b"\0" + principal.user_id.encode()
    digest = hmac.new(key, message, hashlib.sha256).digest()
    encoded = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return f"tusr_v1_{encoded}"
