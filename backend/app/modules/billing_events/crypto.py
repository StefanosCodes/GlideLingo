"""Authenticated encryption for provider actor identifiers needed by workers."""

import hashlib
import hmac
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_VERSION = b"\x01"
_NONCE_BYTES = 12
_KEY_CONTEXT = b"glidelingo-billing-event-provider-actor-v1"


class InvalidProviderActorCiphertextError(Exception):
    """Stored provider identity cannot be authenticated or decoded."""


class ProviderActorCipher:
    """Encrypt the minimum reversible provider identity outside inbox rows."""

    def __init__(self, *, secret: bytes) -> None:
        if len(secret) < 32:
            raise ValueError("provider actor encryption secret must be at least 32 bytes")
        key = hmac.new(secret, _KEY_CONTEXT, hashlib.sha256).digest()
        self._cipher = AESGCM(key)

    def encrypt(
        self,
        *,
        provider_actor_id: str,
        provider: str,
        environment: str,
        provider_account_ref: str,
        actor_ref: str,
    ) -> bytes:
        encoded = provider_actor_id.encode()
        if not encoded or len(encoded) > 255:
            raise ValueError("provider actor identifier must contain 1 to 255 bytes")
        nonce = os.urandom(_NONCE_BYTES)
        ciphertext = self._cipher.encrypt(
            nonce,
            encoded,
            self._associated_data(
                provider=provider,
                environment=environment,
                provider_account_ref=provider_account_ref,
                actor_ref=actor_ref,
            ),
        )
        return _VERSION + nonce + ciphertext

    def decrypt(
        self,
        *,
        ciphertext: bytes,
        provider: str,
        environment: str,
        provider_account_ref: str,
        actor_ref: str,
    ) -> str:
        if len(ciphertext) <= len(_VERSION) + _NONCE_BYTES or not ciphertext.startswith(_VERSION):
            raise InvalidProviderActorCiphertextError
        nonce = ciphertext[1 : 1 + _NONCE_BYTES]
        encrypted = ciphertext[1 + _NONCE_BYTES :]
        try:
            plaintext = self._cipher.decrypt(
                nonce,
                encrypted,
                self._associated_data(
                    provider=provider,
                    environment=environment,
                    provider_account_ref=provider_account_ref,
                    actor_ref=actor_ref,
                ),
            )
            provider_actor_id = plaintext.decode()
        except (InvalidTag, UnicodeDecodeError) as error:
            raise InvalidProviderActorCiphertextError from error
        if not provider_actor_id or len(plaintext) > 255:
            raise InvalidProviderActorCiphertextError
        return provider_actor_id

    @staticmethod
    def _associated_data(
        *, provider: str, environment: str, provider_account_ref: str, actor_ref: str
    ) -> bytes:
        return "\x1f".join((provider, environment, provider_account_ref, actor_ref)).encode()
