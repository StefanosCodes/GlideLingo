import base64
import hashlib
import hmac

from app.auth.clerk import ClerkPrincipal

_DOMAIN = b"glidelingo:voice-subject:v1\0"


def derive_voice_actor_ref(*, key: bytes, principal: ClerkPrincipal) -> str:
    message = _DOMAIN + principal.issuer.encode() + b"\0" + principal.user_id.encode()
    digest = hmac.new(key, message, hashlib.sha256).digest()
    encoded = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return f"vusr_v1_{encoded}"
