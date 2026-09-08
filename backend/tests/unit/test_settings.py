import base64
from pathlib import Path
from typing import Any

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


def test_human_tutor_marketplace_is_disabled_by_default() -> None:
    settings = Settings(_env_file=None)

    assert settings.human_tutor_marketplace_enabled is False
    assert settings.human_tutor_marketplace_acquisition_enabled is False
    assert settings.human_tutor_marketplace_pseudonym_key is None
    assert settings.human_tutor_marketplace_actor_allowlist == ()
    assert settings.human_tutor_google_calendar_enabled is False
    assert settings.human_tutor_messaging_enabled is False
    assert settings.human_tutor_message_retention_days is None
    assert settings.human_tutor_learning_bridge_enabled is False


def test_enabled_human_tutor_marketplace_requires_fail_closed_configuration() -> None:
    with pytest.raises(ValidationError, match="pseudonym key"):
        Settings(_env_file=None, human_tutor_marketplace_enabled=True)

    with pytest.raises(ValidationError, match="acquisition requires"):
        Settings(_env_file=None, human_tutor_marketplace_acquisition_enabled=True)


def test_enabled_human_tutor_marketplace_accepts_clerk_and_allowlist() -> None:
    settings = Settings(
        _env_file=None,
        human_tutor_marketplace_enabled=True,
        human_tutor_marketplace_pseudonym_key="m" * 32,
        human_tutor_marketplace_actor_allowlist=("user_tutor_123",),
        clerk_issuer="https://clerk.glidelingo.test",
        clerk_jwks_url="https://clerk.glidelingo.test/.well-known/jwks.json",
    )

    assert settings.human_tutor_marketplace_enabled is True


def test_enabled_google_calendar_requires_complete_minimal_scope_configuration() -> None:
    base: dict[str, Any] = {
        "_env_file": None,
        "human_tutor_marketplace_enabled": True,
        "human_tutor_marketplace_pseudonym_key": "m" * 32,
        "human_tutor_marketplace_actor_allowlist": ("user_tutor_123",),
        "clerk_issuer": "https://clerk.glidelingo.test",
        "clerk_jwks_url": "https://clerk.glidelingo.test/.well-known/jwks.json",
        "human_tutor_google_calendar_enabled": True,
    }
    with pytest.raises(ValidationError, match="client ID"):
        Settings(**base)

    settings = Settings(
        **base,
        human_tutor_google_calendar_client_id="google-calendar-client-id",
        human_tutor_google_calendar_client_secret="s" * 32,
        human_tutor_google_calendar_token_key=base64.urlsafe_b64encode(b"k" * 32).decode(),
        human_tutor_google_calendar_state_key="c" * 32,
        human_tutor_google_calendar_redirect_allowlist=(
            "https://app.glidelingo.test/oauth/google-calendar",
            "http://localhost:8081/oauth/google-calendar",
        ),
    )

    assert settings.human_tutor_google_calendar_enabled is True


def test_google_calendar_rejects_unsafe_redirects_and_bad_token_keys() -> None:
    common: dict[str, Any] = {
        "_env_file": None,
        "human_tutor_marketplace_enabled": True,
        "human_tutor_marketplace_pseudonym_key": "m" * 32,
        "human_tutor_marketplace_actor_allowlist": ("user_tutor_123",),
        "clerk_issuer": "https://clerk.glidelingo.test",
        "clerk_jwks_url": "https://clerk.glidelingo.test/.well-known/jwks.json",
        "human_tutor_google_calendar_enabled": True,
        "human_tutor_google_calendar_client_id": "google-calendar-client-id",
        "human_tutor_google_calendar_client_secret": "s" * 32,
        "human_tutor_google_calendar_state_key": "c" * 32,
    }
    with pytest.raises(ValidationError, match="exactly 32 bytes"):
        Settings(
            **common,
            human_tutor_google_calendar_token_key=base64.urlsafe_b64encode(b"too-short").decode(),
            human_tutor_google_calendar_redirect_allowlist=(
                "https://app.glidelingo.test/oauth/google-calendar",
            ),
        )
    with pytest.raises(ValidationError, match="exact HTTPS"):
        Settings(
            **common,
            human_tutor_google_calendar_token_key=base64.urlsafe_b64encode(b"k" * 32).decode(),
            human_tutor_google_calendar_redirect_allowlist=(
                "https://user:password@app.glidelingo.test/oauth/google-calendar",
            ),
        )


def test_tutor_messaging_requires_retention_and_exact_meeting_hosts() -> None:
    common: dict[str, Any] = {
        "_env_file": None,
        "human_tutor_marketplace_enabled": True,
        "human_tutor_marketplace_pseudonym_key": "m" * 32,
        "human_tutor_marketplace_actor_allowlist": ("user_tutor_123",),
        "clerk_issuer": "https://clerk.glidelingo.test",
        "clerk_jwks_url": "https://clerk.glidelingo.test/.well-known/jwks.json",
        "human_tutor_messaging_enabled": True,
    }
    with pytest.raises(ValidationError, match="retention"):
        Settings(**common)
    with pytest.raises(ValidationError, match="lowercase DNS"):
        Settings(
            **common,
            human_tutor_message_retention_days=90,
            human_tutor_approved_meeting_hosts=("*.Example.com",),
        )

    settings = Settings(
        **common,
        human_tutor_message_retention_days=90,
        human_tutor_approved_meeting_hosts=("meet.example.com",),
    )
    assert settings.human_tutor_messaging_enabled is True


def test_tutor_commerce_requires_environment_matched_server_configuration() -> None:
    with pytest.raises(ValidationError, match="payout execution requires tutor commerce"):
        Settings(_env_file=None, human_tutor_payout_execution_enabled=True)
    common: dict[str, Any] = {
        "_env_file": None,
        "human_tutor_marketplace_enabled": True,
        "human_tutor_marketplace_pseudonym_key": "m" * 32,
        "human_tutor_marketplace_actor_allowlist": ("user_tutor_123",),
        "clerk_issuer": "https://clerk.glidelingo.test",
        "clerk_jwks_url": "https://clerk.glidelingo.test/.well-known/jwks.json",
        "human_tutor_approved_meeting_hosts": ("meet.example.com",),
        "human_tutor_commerce_enabled": True,
        "human_tutor_payment_database_url": (
            "postgresql+psycopg://marketplace_payment@127.0.0.1:55433/glidelingo"
        ),
    }
    with pytest.raises(ValidationError, match="secret key"):
        Settings(**common)
    with pytest.raises(ValidationError, match="match the configured environment"):
        Settings(**common, human_tutor_stripe_secret_key="sk_live_wrong_environment")

    settings = Settings(
        **common,
        human_tutor_stripe_secret_key="sk_test_reviewed_sandbox_key",
        human_tutor_stripe_webhook_secret="whsec_reviewed_test_secret",
        human_tutor_stripe_platform_account_id="acct_reviewed123",
        human_tutor_stripe_connect_refresh_url="https://app.glidelingo.test/tutor/payouts",
        human_tutor_stripe_connect_return_url="https://app.glidelingo.test/tutor/payouts",
        human_tutor_checkout_success_url=("https://app.glidelingo.test/bookings?checkout=success"),
        human_tutor_checkout_cancel_url=("https://app.glidelingo.test/bookings?checkout=cancelled"),
    )

    assert settings.human_tutor_commerce_enabled is True
    assert settings.human_tutor_stripe_environment == "SANDBOX"


def test_tutor_learning_bridge_requires_marketplace_commerce() -> None:
    with pytest.raises(ValidationError, match="requires marketplace commerce"):
        Settings(_env_file=None, human_tutor_learning_bridge_enabled=True)


def test_desktop_minimum_supported_version_defaults_to_zero() -> None:
    assert Settings(_env_file=None).desktop_minimum_supported_version == "0.0.0"


def test_desktop_minimum_supported_version_loads_from_environment(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv("GLIDELINGO_DESKTOP_MINIMUM_SUPPORTED_VERSION", "12.34.56")

    assert Settings(_env_file=None).desktop_minimum_supported_version == "12.34.56"


@pytest.mark.parametrize(
    "version",
    [
        "1.2",
        "v1.2.3",
        "01.2.3",
        "1.2.3-beta",
        "1.2.3+build",
        " 1.2.3",
        f"1.2.{('3' * 65)}",
    ],
)
def test_desktop_minimum_supported_version_requires_numeric_semver(version: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, desktop_minimum_supported_version=version)


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
