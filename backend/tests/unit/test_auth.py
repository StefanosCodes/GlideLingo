from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx2 import Response
from jwt import PyJWK
from jwt.algorithms import RSAAlgorithm
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

from app.auth.clerk import ClerkTokenVerifier, InvalidClerkTokenError
from app.core.config import Settings
from app.main import create_app

ISSUER = "https://clerk.glidelingo.test"
JWKS_URL = f"{ISSUER}/.well-known/jwks.json"
AUDIENCE = "glidelingo-api"
KEY_ID = "test-clerk-key"
USER_ID = "user_test_123"
AUTHORIZED_PARTY = "https://app.glidelingo.test"


@dataclass(frozen=True)
class SigningMaterial:
    private_key: rsa.RSAPrivateKey
    public_jwk: PyJWK


class StaticSigningKeyClient:
    def __init__(self, signing_key: PyJWK) -> None:
        self._signing_key = signing_key

    def get_signing_key_from_jwt(self, token: str) -> PyJWK:
        header = jwt.get_unverified_header(token)
        if header.get("kid") != KEY_ID:
            raise PyJWKClientError("Unknown signing key")
        return self._signing_key


class UnavailableSigningKeyClient:
    def get_signing_key_from_jwt(self, _token: str) -> PyJWK:
        raise PyJWKClientConnectionError("JWKS unavailable")


@pytest.fixture(scope="module")
def signing_material() -> SigningMaterial:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk_data = cast(
        dict[str, object],
        RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True),
    )
    public_jwk_data["kid"] = KEY_ID
    return SigningMaterial(
        private_key=private_key,
        public_jwk=PyJWK.from_dict(public_jwk_data),
    )


@pytest.fixture
def client(signing_material: SigningMaterial) -> Iterator[TestClient]:
    application = create_app(
        Settings(
            _env_file=None,
            clerk_issuer=ISSUER,
            clerk_jwks_url=JWKS_URL,
            clerk_audience=AUDIENCE,
            clerk_authorized_parties=(AUTHORIZED_PARTY,),
        )
    )
    application.state.clerk_token_verifier = ClerkTokenVerifier(
        issuer=ISSUER,
        jwks_url=JWKS_URL,
        audience=AUDIENCE,
        authorized_parties=(AUTHORIZED_PARTY,),
        signing_key_client=StaticSigningKeyClient(signing_material.public_jwk),
    )
    with TestClient(application) as test_client:
        yield test_client


def create_token(
    signing_material: SigningMaterial,
    *,
    private_key: rsa.RSAPrivateKey | None = None,
    claim_overrides: dict[str, object | None] | None = None,
) -> str:
    now = datetime.now(UTC)
    claims: dict[str, object] = {
        "aud": AUDIENCE,
        "azp": AUTHORIZED_PARTY,
        "exp": now + timedelta(minutes=5),
        "iat": now,
        "iss": ISSUER,
        "sub": USER_ID,
    }
    for claim, value in (claim_overrides or {}).items():
        if value is None:
            claims.pop(claim, None)
        else:
            claims[claim] = value
    return jwt.encode(
        claims,
        key=private_key or signing_material.private_key,
        algorithm="RS256",
        headers={"kid": KEY_ID},
    )


def test_valid_clerk_token_returns_verified_subject(
    client: TestClient,
    signing_material: SigningMaterial,
) -> None:
    token = create_token(signing_material)

    response = client.get(
        "/v1/auth/session",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json() == {"user_id": USER_ID}


def test_missing_bearer_token_is_unauthorized(client: TestClient) -> None:
    response = client.get("/v1/auth/session")

    assert_unauthorized(response)


def test_malformed_bearer_token_is_unauthorized(client: TestClient) -> None:
    response = client.get(
        "/v1/auth/session",
        headers={"Authorization": "Bearer not-a-jwt"},
    )

    assert_unauthorized(response)
    assert "not-a-jwt" not in response.text


def test_expired_bearer_token_is_unauthorized(
    client: TestClient,
    signing_material: SigningMaterial,
) -> None:
    token = create_token(
        signing_material,
        claim_overrides={"exp": datetime.now(UTC) - timedelta(seconds=1)},
    )

    response = authenticated_get(client, token)

    assert_unauthorized(response)


def test_invalid_signature_is_unauthorized(
    client: TestClient,
    signing_material: SigningMaterial,
) -> None:
    untrusted_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = create_token(signing_material, private_key=untrusted_key)

    response = authenticated_get(client, token)

    assert_unauthorized(response)


def test_wrong_issuer_is_unauthorized(
    client: TestClient,
    signing_material: SigningMaterial,
) -> None:
    token = create_token(
        signing_material,
        claim_overrides={"iss": "https://attacker.example"},
    )

    response = authenticated_get(client, token)

    assert_unauthorized(response)


def test_wrong_audience_is_unauthorized(
    client: TestClient,
    signing_material: SigningMaterial,
) -> None:
    token = create_token(signing_material, claim_overrides={"aud": "another-api"})

    response = authenticated_get(client, token)

    assert_unauthorized(response)


def test_untrusted_authorized_party_is_unauthorized(
    client: TestClient,
    signing_material: SigningMaterial,
) -> None:
    token = create_token(
        signing_material,
        claim_overrides={"azp": "https://attacker.example"},
    )

    response = authenticated_get(client, token)

    assert_unauthorized(response)


def test_malformed_authorized_party_is_unauthorized(
    client: TestClient,
    signing_material: SigningMaterial,
) -> None:
    token = create_token(signing_material, claim_overrides={"azp": [AUTHORIZED_PARTY]})

    response = authenticated_get(client, token)

    assert_unauthorized(response)


def test_standard_session_token_without_audience_is_accepted(
    signing_material: SigningMaterial,
) -> None:
    verifier = ClerkTokenVerifier(
        issuer=ISSUER,
        jwks_url=JWKS_URL,
        audience=None,
        authorized_parties=(AUTHORIZED_PARTY,),
        signing_key_client=StaticSigningKeyClient(signing_material.public_jwk),
    )
    token = create_token(signing_material, claim_overrides={"aud": None, "azp": None})

    # PyJWT omits audience validation when the API has not configured one. The
    # issuer, signature, expiry, and subject remain mandatory.
    assert verifier.verify(token).user_id == USER_ID


def test_token_with_authorized_party_fails_closed_when_allowlist_is_empty(
    signing_material: SigningMaterial,
) -> None:
    verifier = ClerkTokenVerifier(
        issuer=ISSUER,
        jwks_url=JWKS_URL,
        audience=AUDIENCE,
        authorized_parties=(),
        signing_key_client=StaticSigningKeyClient(signing_material.public_jwk),
    )

    with pytest.raises(InvalidClerkTokenError):
        verifier.verify(create_token(signing_material))


def test_unconfigured_authentication_fails_closed() -> None:
    with TestClient(create_app(Settings(_env_file=None))) as client:
        response = client.get(
            "/v1/auth/session",
            headers={"Authorization": "Bearer token"},
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "authentication_unavailable"


def test_jwks_connection_failure_is_operationally_unavailable() -> None:
    application = create_app(Settings(_env_file=None))
    application.state.clerk_token_verifier = ClerkTokenVerifier(
        issuer=ISSUER,
        jwks_url=JWKS_URL,
        audience=AUDIENCE,
        authorized_parties=(AUTHORIZED_PARTY,),
        signing_key_client=UnavailableSigningKeyClient(),
    )

    with TestClient(application) as unavailable_client:
        response = unavailable_client.get(
            "/v1/auth/session",
            headers={"Authorization": "Bearer syntactically-valid-enough"},
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "authentication_unavailable"


def test_openapi_documents_clerk_bearer_security(client: TestClient) -> None:
    application = cast(FastAPI, client.app)
    schema = application.openapi()
    operation = schema["paths"]["/v1/auth/session"]["get"]

    assert operation["operationId"] == "get_authenticated_session"
    assert operation["security"] == [{"ClerkSessionToken": []}]
    assert schema["components"]["securitySchemes"]["ClerkSessionToken"] == {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }


def test_browser_preflight_allows_authorization_header(client: TestClient) -> None:
    response = client.options(
        "/v1/auth/session",
        headers={
            "Origin": "http://localhost:8081",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )

    assert response.status_code == 200
    assert "Authorization" in response.headers["access-control-allow-headers"]


def test_packaged_desktop_preflight_allows_its_exact_origin(client: TestClient) -> None:
    response = client.options(
        "/v1/auth/session",
        headers={
            "Origin": "glidelingo://app",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "glidelingo://app"


def authenticated_get(client: TestClient, token: str) -> Response:
    return client.get(
        "/v1/auth/session",
        headers={"Authorization": f"Bearer {token}"},
    )


def assert_unauthorized(response: Response) -> None:
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication credentials are invalid."}
    assert response.headers["www-authenticate"] == "Bearer"
