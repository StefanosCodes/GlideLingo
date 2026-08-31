import pytest
from pydantic import ValidationError
from pytest import MonkeyPatch

from app.core.config import Settings


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "file:///tmp/app",
        "http://user:password@localhost:8081",
        "http://localhost:8081/a-path",
        "http://localhost:8081?query=true",
    ],
)
def test_cors_origin_must_be_an_explicit_origin(origin: str) -> None:
    with pytest.raises(ValidationError):
        Settings(cors_origins=(origin,))


def test_cors_origins_load_from_json_environment_value(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv(
        "GLIDELINGO_CORS_ORIGINS",
        '["https://desktop.example","https://mobile.example"]',
    )

    assert Settings().normalized_cors_origins == [
        "https://desktop.example",
        "https://mobile.example",
    ]


def test_clerk_configuration_loads_from_expected_environment_names(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLIDELINGO_CLERK_ISSUER", "https://clerk.glidelingo.test")
    monkeypatch.setenv(
        "GLIDELINGO_CLERK_JWKS_URL",
        "https://clerk.glidelingo.test/.well-known/jwks.json",
    )
    monkeypatch.setenv("GLIDELINGO_CLERK_AUDIENCE", "glidelingo-api")

    assert Settings(_env_file=None).clerk_configuration == (
        "https://clerk.glidelingo.test",
        "https://clerk.glidelingo.test/.well-known/jwks.json",
        "glidelingo-api",
    )


def test_partial_clerk_configuration_is_rejected() -> None:
    with pytest.raises(ValidationError, match="must be configured together"):
        Settings(
            _env_file=None,
            clerk_issuer="https://clerk.glidelingo.test",
        )


def test_clerk_audience_is_optional_for_standard_session_tokens() -> None:
    settings = Settings(
        _env_file=None,
        clerk_issuer="https://clerk.glidelingo.test",
        clerk_jwks_url="https://clerk.glidelingo.test/.well-known/jwks.json",
    )

    assert settings.clerk_configuration == (
        "https://clerk.glidelingo.test",
        "https://clerk.glidelingo.test/.well-known/jwks.json",
        None,
    )


def test_clerk_urls_must_use_https() -> None:
    with pytest.raises(ValidationError, match="must be an HTTPS URL"):
        Settings(
            _env_file=None,
            clerk_issuer="http://clerk.glidelingo.test",
            clerk_jwks_url="https://clerk.glidelingo.test/.well-known/jwks.json",
            clerk_audience="glidelingo-api",
        )
