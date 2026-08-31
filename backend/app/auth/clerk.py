"""Clerk session-token verification and FastAPI authentication dependency."""

from dataclasses import dataclass
from typing import Annotated, Protocol, cast

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWK, PyJWKClient
from jwt.exceptions import PyJWKClientError, PyJWTError


@dataclass(frozen=True, slots=True)
class ClerkPrincipal:
    """Authenticated identity derived only from a verified Clerk session token."""

    user_id: str


class ClerkSigningKeyClient(Protocol):
    """Narrow key-resolution contract used by the verifier."""

    def get_signing_key_from_jwt(self, token: str) -> PyJWK: ...


class InvalidClerkTokenError(Exception):
    """A bearer token cannot establish an authenticated Clerk identity."""


class ClerkTokenVerifier:
    """Verify Clerk RS256 session tokens against Clerk's cached JWKS."""

    def __init__(
        self,
        *,
        issuer: str,
        audience: str | None,
        jwks_url: str,
        signing_key_client: ClerkSigningKeyClient | None = None,
    ) -> None:
        self._issuer = issuer
        self._audience = audience
        self._signing_key_client = signing_key_client or PyJWKClient(
            jwks_url,
            cache_keys=True,
            timeout=5,
        )

    def verify(self, token: str) -> ClerkPrincipal:
        """Return the verified subject without retaining or logging the token."""

        try:
            signing_key = self._signing_key_client.get_signing_key_from_jwt(token)
            required_claims = ["exp", "iss", "sub"]
            if self._audience is not None:
                required_claims.append("aud")

            claims = jwt.decode(
                token,
                key=signing_key.key,
                algorithms=["RS256"],
                audience=self._audience,
                issuer=self._issuer,
                options={
                    "require": required_claims,
                    "verify_aud": self._audience is not None,
                },
            )
        except (PyJWKClientError, PyJWTError, UnicodeError, ValueError, TypeError) as error:
            raise InvalidClerkTokenError from error

        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject.strip():
            raise InvalidClerkTokenError
        return ClerkPrincipal(user_id=subject)


bearer_scheme = HTTPBearer(
    auto_error=False,
    bearerFormat="JWT",
    scheme_name="ClerkSessionToken",
)
BearerCredentialsDependency = Annotated[
    HTTPAuthorizationCredentials | None,
    Depends(bearer_scheme),
]


def get_clerk_token_verifier(request: Request) -> ClerkTokenVerifier | None:
    """Return the process-level verifier configured by the application factory."""

    return cast(ClerkTokenVerifier | None, request.app.state.clerk_token_verifier)


ClerkTokenVerifierDependency = Annotated[
    ClerkTokenVerifier | None,
    Depends(get_clerk_token_verifier),
]


def get_current_clerk_principal(
    credentials: BearerCredentialsDependency,
    verifier: ClerkTokenVerifierDependency,
) -> ClerkPrincipal:
    """Authenticate one request and expose only its verified Clerk subject."""

    if credentials is None:
        raise _unauthorized()
    if verifier is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is unavailable.",
        )
    try:
        return verifier.verify(credentials.credentials)
    except InvalidClerkTokenError:
        raise _unauthorized() from None


CurrentClerkPrincipal = Annotated[ClerkPrincipal, Depends(get_current_clerk_principal)]


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication credentials are invalid.",
        headers={"WWW-Authenticate": "Bearer"},
    )
