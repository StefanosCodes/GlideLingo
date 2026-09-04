from pathlib import Path

import pytest
from pydantic import ValidationError
from pytest import MonkeyPatch

from app.core.config import DESKTOP_APP_ORIGIN, Settings


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


def test_ignored_env_local_files_override_their_matching_env_files(tmp_path: Path) -> None:
    assert Settings.model_config["env_file"] == (
        "../.env",
        "../.env.local",
        ".env",
        ".env.local",
    )
    env_file = tmp_path / ".env"
    env_local_file = tmp_path / ".env.local"
    env_file.write_text("GLIDELINGO_LOG_LEVEL=INFO\n")
    env_local_file.write_text("GLIDELINGO_LOG_LEVEL=DEBUG\n")

    settings = Settings(_env_file=(env_file, env_local_file))

    assert settings.log_level == "DEBUG"


def test_lesson_tutor_is_disabled_by_default() -> None:
    settings = Settings(_env_file=None)

    assert settings.lesson_tutor_enabled is False
    assert settings.lesson_tutor_service_timeout_seconds == 6
    assert settings.lesson_tutor_pseudonym_key is None
    assert not hasattr(settings, "openai_api_key")


def test_revenuecat_server_authorization_is_disabled_by_default() -> None:
    settings = Settings(_env_file=None)

    assert settings.revenuecat_enabled is False
    assert settings.revenuecat_environment == "SANDBOX"
    assert settings.revenuecat_api_key is None
    assert settings.revenuecat_entitlement_freshness_seconds == 900
    assert settings.billing_event_intake_enabled is False


def test_enabled_revenuecat_requires_all_server_only_secrets() -> None:
    with pytest.raises(ValidationError, match="RevenueCat API key"):
        Settings(_env_file=None, revenuecat_enabled=True)


def test_enabled_revenuecat_accepts_complete_fail_closed_configuration() -> None:
    settings = Settings(
        _env_file=None,
        revenuecat_enabled=True,
        revenuecat_environment="PRODUCTION",
        revenuecat_api_key="rcb_public-web-key",
        revenuecat_pseudonym_key="p" * 32,
        revenuecat_webhook_authorization="Bearer webhook-secret-value",
        revenuecat_webhook_signing_secret="s" * 32,
    )

    assert settings.revenuecat_enabled is True
    assert settings.revenuecat_environment == "PRODUCTION"


def test_billing_event_intake_requires_revenuecat_and_scoped_app_id() -> None:
    with pytest.raises(ValidationError, match="RevenueCat must be enabled"):
        Settings(_env_file=None, billing_event_intake_enabled=True)

    with pytest.raises(ValidationError, match="webhook app ID"):
        Settings(
            _env_file=None,
            revenuecat_enabled=True,
            revenuecat_api_key="rcb_public-web-key",
            revenuecat_pseudonym_key="p" * 32,
            revenuecat_webhook_authorization="Bearer webhook-secret-value",
            revenuecat_webhook_signing_secret="s" * 32,
            billing_event_intake_enabled=True,
        )


def test_billing_event_intake_accepts_complete_scoped_configuration() -> None:
    settings = Settings(
        _env_file=None,
        revenuecat_enabled=True,
        revenuecat_api_key="rcb_public-web-key",
        revenuecat_pseudonym_key="p" * 32,
        revenuecat_webhook_app_id="app_test",
        revenuecat_webhook_authorization="Bearer webhook-secret-value",
        revenuecat_webhook_signing_secret="s" * 32,
        billing_event_intake_enabled=True,
    )

    assert settings.billing_event_intake_enabled is True
    assert settings.revenuecat_webhook_app_id == "app_test"


def test_enabled_revenuecat_rejects_overprivileged_project_secret_key() -> None:
    with pytest.raises(ValidationError, match="app public SDK key"):
        Settings(
            _env_file=None,
            revenuecat_enabled=True,
            revenuecat_environment="PRODUCTION",
            revenuecat_api_key="sk_overprivileged-project-key",
            revenuecat_pseudonym_key="p" * 32,
            revenuecat_webhook_authorization="Bearer webhook-secret-value",
            revenuecat_webhook_signing_secret="s" * 32,
        )


def test_enabled_lesson_tutor_requires_bounded_database_timeouts() -> None:
    with pytest.raises(ValidationError, match="database pool timeout"):
        Settings(_env_file=None, lesson_tutor_enabled=True)


def test_enabled_lesson_tutor_accepts_complete_private_boundary() -> None:
    service_url = "https://tutor.example.run.app"
    settings = Settings(
        _env_file=None,
        lesson_tutor_enabled=True,
        database_pool_timeout_seconds=1,
        database_statement_timeout_seconds=2,
        lesson_tutor_service_url=service_url,
        lesson_tutor_service_audience=service_url,
        lesson_tutor_pseudonym_key="p" * 32,
        clerk_issuer="https://clerk.glidelingo.test",
        clerk_jwks_url="https://clerk.glidelingo.test/.well-known/jwks.json",
    )

    assert settings.lesson_tutor_enabled is True
    assert settings.lesson_tutor_service_timeout_seconds == 6


def test_packaged_desktop_origin_is_allowed_but_other_custom_origins_are_rejected() -> None:
    assert DESKTOP_APP_ORIGIN in Settings(_env_file=None).normalized_cors_origins

    with pytest.raises(ValidationError):
        Settings(_env_file=None, cors_origins=("glidelingo://attacker",))


def test_clerk_configuration_loads_from_expected_environment_names(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLIDELINGO_CLERK_ISSUER", "https://clerk.glidelingo.test")
    monkeypatch.setenv(
        "GLIDELINGO_CLERK_JWKS_URL",
        "https://clerk.glidelingo.test/.well-known/jwks.json",
    )
    monkeypatch.setenv("GLIDELINGO_CLERK_AUDIENCE", "glidelingo-api")
    monkeypatch.setenv(
        "GLIDELINGO_CLERK_AUTHORIZED_PARTIES",
        '["https://app.glidelingo.test","http://localhost:8081","https://desktop.glidelingo.com"]',
    )

    assert Settings(_env_file=None).clerk_configuration == (
        "https://clerk.glidelingo.test",
        "https://clerk.glidelingo.test/.well-known/jwks.json",
        "glidelingo-api",
        (
            "https://app.glidelingo.test",
            "http://localhost:8081",
            "https://desktop.glidelingo.com",
        ),
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
        (),
    )


def test_clerk_authorized_parties_must_be_origins() -> None:
    with pytest.raises(ValidationError, match=r"authorized parties must be HTTP\(S\) origins"):
        Settings(
            _env_file=None,
            clerk_issuer="https://clerk.glidelingo.test",
            clerk_jwks_url="https://clerk.glidelingo.test/.well-known/jwks.json",
            clerk_authorized_parties=("https://app.glidelingo.test/sign-in",),
        )


def test_clerk_urls_must_use_https() -> None:
    with pytest.raises(ValidationError, match="must be an HTTPS URL"):
        Settings(
            _env_file=None,
            clerk_issuer="http://clerk.glidelingo.test",
            clerk_jwks_url="https://clerk.glidelingo.test/.well-known/jwks.json",
            clerk_audience="glidelingo-api",
        )
