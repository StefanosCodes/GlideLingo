"""Typed application configuration loaded from the process environment."""

import re
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_DATABASE_URL = (
    "postgresql+psycopg://glidelingo:glidelingo_dev_only@127.0.0.1:55433/glidelingo"
)
DESKTOP_APP_ORIGIN = "https://desktop.glidelingo.com"


class Settings(BaseSettings):
    """Process-level settings for the API service."""

    model_config = SettingsConfigDict(
        env_prefix="GLIDELINGO_",
        env_file=("../.env", "../.env.local", ".env", ".env.local"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: SecretStr = SecretStr(DEFAULT_DATABASE_URL)
    cors_origins: tuple[str, ...] = (
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        DESKTOP_APP_ORIGIN,
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    database_pool_size: int = Field(default=5, ge=1, le=20)
    database_max_overflow: int = Field(default=5, ge=0, le=20)
    database_pool_timeout_seconds: float = Field(default=3.0, gt=0, le=30)
    database_connect_timeout_seconds: int = Field(default=3, ge=1, le=30)
    database_statement_timeout_seconds: int = Field(default=3, ge=1, le=30)
    database_pool_recycle_seconds: int = Field(default=1800, ge=30)
    lesson_tutor_enabled: bool = False
    lesson_tutor_service_url: str | None = None
    lesson_tutor_service_audience: str | None = None
    lesson_tutor_service_timeout_seconds: float = Field(default=6.0, gt=0, le=6)
    lesson_tutor_operation_deadline_seconds: float = Field(default=11.0, gt=0, le=11)
    lesson_tutor_pseudonym_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "GLIDELINGO_LESSON_TUTOR_PSEUDONYM_KEY",
            "LESSON_TUTOR_PSEUDONYM_KEY",
        ),
    )
    lesson_tutor_burst_limit: int = Field(default=4, ge=1, le=20)
    lesson_tutor_burst_window_seconds: int = Field(default=60, ge=10, le=600)
    lesson_tutor_concurrency_limit: int = Field(default=1, ge=1, le=3)
    lesson_tutor_daily_limit: int = Field(default=50, ge=1, le=1000)
    lesson_tutor_global_daily_turn_limit: int = Field(default=2000, ge=1, le=100000)
    revenuecat_enabled: bool = False
    revenuecat_environment: Literal["SANDBOX", "PRODUCTION"] = "SANDBOX"
    revenuecat_api_key: SecretStr | None = None
    revenuecat_pseudonym_key: SecretStr | None = None
    revenuecat_webhook_authorization: SecretStr | None = None
    revenuecat_webhook_signing_secret: SecretStr | None = None
    revenuecat_api_timeout_seconds: float = Field(default=2.5, gt=0, le=5)
    revenuecat_entitlement_freshness_seconds: int = Field(default=900, ge=60, le=3600)
    revenuecat_webhook_max_body_bytes: int = Field(default=65536, ge=1024, le=262144)
    revenuecat_webhook_signature_tolerance_seconds: int = Field(default=300, ge=30, le=600)
    human_tutor_marketplace_enabled: bool = False
    human_tutor_marketplace_acquisition_enabled: bool = False
    human_tutor_marketplace_pseudonym_key: SecretStr | None = None
    human_tutor_marketplace_actor_allowlist: tuple[str, ...] = ()
    human_tutor_google_calendar_enabled: bool = False
    human_tutor_google_calendar_client_id: str | None = None
    human_tutor_google_calendar_client_secret: SecretStr | None = None
    human_tutor_google_calendar_token_key: SecretStr | None = None
    human_tutor_google_calendar_state_key: SecretStr | None = None
    human_tutor_google_calendar_redirect_allowlist: tuple[str, ...] = ()
    human_tutor_google_calendar_timeout_seconds: float = Field(default=4.0, gt=0, le=6)
    human_tutor_messaging_enabled: bool = False
    human_tutor_message_retention_days: int | None = Field(default=None, ge=7, le=3650)
    human_tutor_approved_meeting_hosts: tuple[str, ...] = ()
    human_tutor_commerce_enabled: bool = False
    human_tutor_learning_bridge_enabled: bool = False
    human_tutor_stripe_environment: Literal["SANDBOX", "PRODUCTION"] = "SANDBOX"
    human_tutor_stripe_secret_key: SecretStr | None = None
    human_tutor_stripe_webhook_secret: SecretStr | None = None
    human_tutor_stripe_platform_account_id: str | None = None
    human_tutor_stripe_api_version: str = "2026-02-25.clover"
    human_tutor_stripe_timeout_seconds: float = Field(default=5.0, gt=0, le=8)
    human_tutor_stripe_webhook_max_body_bytes: int = Field(default=65536, ge=1024, le=262144)
    human_tutor_stripe_signature_tolerance_seconds: int = Field(default=300, ge=30, le=600)
    human_tutor_booking_hold_seconds: int = Field(default=600, ge=300, le=900)
    human_tutor_stripe_connect_refresh_url: str | None = None
    human_tutor_stripe_connect_return_url: str | None = None
    human_tutor_checkout_success_url: str | None = None
    human_tutor_checkout_cancel_url: str | None = None
    clerk_issuer: str | None = None
    clerk_jwks_url: str | None = None
    clerk_audience: str | None = None
    clerk_authorized_parties: tuple[str, ...] = ()

    @model_validator(mode="after")
    def validate_cors_origins(self) -> Self:
        for origin in self.cors_origins:
            if origin == DESKTOP_APP_ORIGIN:
                continue
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError(
                    "CORS origins must be HTTP(S) origins without credentials, paths, queries, "
                    "or fragments"
                )
        return self

    @model_validator(mode="after")
    def validate_lesson_tutor_configuration(self) -> Self:
        for name, value in (
            ("lesson tutor service URL", self.lesson_tutor_service_url),
            ("lesson tutor service audience", self.lesson_tutor_service_audience),
        ):
            if value is None:
                continue
            parsed = urlsplit(value)
            if (
                parsed.scheme != "https"
                or not parsed.netloc
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError(f"The {name} must be an HTTPS origin")
        if not self.lesson_tutor_enabled:
            return self
        if self.database_pool_timeout_seconds > 1 or self.database_statement_timeout_seconds > 2:
            raise ValueError(
                "Tutor activation requires database pool timeout <= 1s and statement timeout <= 2s"
            )
        if self.lesson_tutor_service_url is None or self.lesson_tutor_service_audience is None:
            raise ValueError("Tutor service URL and audience are required when enabled")
        if self.lesson_tutor_service_url.rstrip("/") != self.lesson_tutor_service_audience.rstrip(
            "/"
        ):
            raise ValueError("Tutor service URL and audience must match exactly")
        if (
            self.lesson_tutor_pseudonym_key is None
            or len(self.lesson_tutor_pseudonym_key.get_secret_value().encode()) < 32
        ):
            raise ValueError("A tutor pseudonym key of at least 32 bytes is required when enabled")
        if self.clerk_configuration is None:
            raise ValueError("Clerk authentication must be configured when the tutor is enabled")
        if (
            self.lesson_tutor_service_timeout_seconds
            >= self.lesson_tutor_operation_deadline_seconds
        ):
            raise ValueError("Tutor service timeout must be shorter than the operation deadline")
        return self

    @model_validator(mode="after")
    def validate_clerk_configuration(self) -> Self:
        required_values = (self.clerk_issuer, self.clerk_jwks_url)
        if all(value is None for value in required_values):
            if self.clerk_audience is not None or self.clerk_authorized_parties:
                raise ValueError(
                    "Clerk issuer and JWKS URL are required when token restrictions are configured"
                )
            return self
        if any(value is None or not value.strip() for value in required_values):
            raise ValueError("Clerk issuer and JWKS URL must be configured together")
        if self.clerk_audience is not None and not self.clerk_audience.strip():
            raise ValueError("Clerk audience cannot be blank")

        for authorized_party in self.clerk_authorized_parties:
            if authorized_party == DESKTOP_APP_ORIGIN:
                continue
            parsed_party = urlsplit(authorized_party)
            if (
                parsed_party.scheme not in {"http", "https"}
                or not parsed_party.netloc
                or parsed_party.username is not None
                or parsed_party.password is not None
                or parsed_party.path not in {"", "/"}
                or parsed_party.query
                or parsed_party.fragment
            ):
                raise ValueError(
                    "Clerk authorized parties must be HTTP(S) origins without "
                    "credentials, paths, queries, or fragments"
                )

        assert self.clerk_issuer is not None
        assert self.clerk_jwks_url is not None
        for name, value in (
            ("Clerk issuer", self.clerk_issuer),
            ("Clerk JWKS URL", self.clerk_jwks_url),
        ):
            parsed = urlsplit(value)
            if (
                parsed.scheme != "https"
                or not parsed.netloc
                or parsed.username is not None
                or parsed.password is not None
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError(f"{name} must be an HTTPS URL without credentials or query data")
        return self

    @model_validator(mode="after")
    def validate_revenuecat_configuration(self) -> Self:
        if not self.revenuecat_enabled:
            return self
        required_secrets = (
            ("RevenueCat API key", self.revenuecat_api_key, 8),
            ("RevenueCat pseudonym key", self.revenuecat_pseudonym_key, 32),
            ("RevenueCat webhook authorization", self.revenuecat_webhook_authorization, 16),
            ("RevenueCat webhook signing secret", self.revenuecat_webhook_signing_secret, 32),
        )
        for name, secret, minimum_length in required_secrets:
            if secret is None or len(secret.get_secret_value().encode()) < minimum_length:
                raise ValueError(f"{name} must be at least {minimum_length} bytes when enabled")
        assert self.revenuecat_api_key is not None
        if self.revenuecat_api_key.get_secret_value().startswith("sk_"):
            raise ValueError(
                "RevenueCat API key must be an app public SDK key for the read-only "
                "Customer Info endpoint, not a project secret key"
            )
        return self

    @model_validator(mode="after")
    def validate_human_tutor_marketplace_configuration(self) -> Self:
        if not self.human_tutor_marketplace_enabled:
            return self
        if (
            self.human_tutor_marketplace_pseudonym_key is None
            or len(self.human_tutor_marketplace_pseudonym_key.get_secret_value().encode()) < 32
        ):
            raise ValueError(
                "A human tutor marketplace pseudonym key of at least 32 bytes is required "
                "when enabled"
            )
        if not self.human_tutor_marketplace_actor_allowlist or any(
            not actor.strip() for actor in self.human_tutor_marketplace_actor_allowlist
        ):
            raise ValueError(
                "A non-empty human tutor marketplace actor allowlist is required when enabled"
            )
        if self.clerk_configuration is None:
            raise ValueError(
                "Clerk authentication must be configured when the human tutor marketplace "
                "is enabled"
            )
        return self

    @model_validator(mode="after")
    def validate_human_tutor_google_calendar_configuration(self) -> Self:
        if not self.human_tutor_google_calendar_enabled:
            return self
        if not self.human_tutor_marketplace_enabled:
            raise ValueError("Google Calendar requires the human tutor marketplace")
        if (
            self.human_tutor_google_calendar_client_id is None
            or len(self.human_tutor_google_calendar_client_id.strip()) < 8
        ):
            raise ValueError("Google Calendar client ID is required when enabled")
        for name, secret, minimum in (
            ("Google Calendar client secret", self.human_tutor_google_calendar_client_secret, 16),
            ("Google Calendar state key", self.human_tutor_google_calendar_state_key, 32),
        ):
            if secret is None or len(secret.get_secret_value().encode()) < minimum:
                raise ValueError(f"{name} must be at least {minimum} bytes when enabled")
        if self.human_tutor_google_calendar_token_key is None:
            raise ValueError("Google Calendar token encryption key is required when enabled")
        from app.modules.human_tutor_marketplace.calendar import decode_calendar_encryption_key

        decode_calendar_encryption_key(
            self.human_tutor_google_calendar_token_key.get_secret_value()
        )
        if not self.human_tutor_google_calendar_redirect_allowlist:
            raise ValueError("Google Calendar redirect allowlist is required when enabled")
        for redirect in self.human_tutor_google_calendar_redirect_allowlist:
            parsed = urlsplit(redirect)
            loopback = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
            native = (
                parsed.scheme == "glidelingo"
                and not parsed.netloc
                and parsed.path == "/tutor/availability"
            )
            if (
                (parsed.scheme != "https" and not loopback and not native)
                or (not native and not parsed.netloc)
                or parsed.username is not None
                or parsed.password is not None
                or not parsed.path.startswith("/")
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError(
                    "Google Calendar redirects must be exact HTTPS, loopback HTTP, "
                    "or the reviewed native URL"
                )
        return self

    @model_validator(mode="after")
    def validate_human_tutor_marketplace_acquisition_configuration(self) -> Self:
        if (
            self.human_tutor_marketplace_acquisition_enabled
            and not self.human_tutor_marketplace_enabled
        ):
            raise ValueError("Tutor acquisition requires the human tutor marketplace")
        return self

    @model_validator(mode="after")
    def validate_human_tutor_messaging_configuration(self) -> Self:
        if not self.human_tutor_messaging_enabled:
            return self
        if not self.human_tutor_marketplace_enabled:
            raise ValueError("Tutor messaging requires the human tutor marketplace")
        if self.human_tutor_message_retention_days is None:
            raise ValueError("Tutor messaging requires an approved message retention period")
        if not self.human_tutor_approved_meeting_hosts:
            raise ValueError("Tutor messaging requires at least one approved meeting host")
        host_pattern = re.compile(r"^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$")
        if any(
            host != host.lower() or "*" in host or host_pattern.fullmatch(host) is None
            for host in self.human_tutor_approved_meeting_hosts
        ):
            raise ValueError("Approved meeting hosts must be exact lowercase DNS names")
        return self

    @model_validator(mode="after")
    def validate_human_tutor_commerce_configuration(self) -> Self:
        if not self.human_tutor_commerce_enabled:
            return self
        if not self.human_tutor_marketplace_enabled:
            raise ValueError("Tutor commerce requires the human tutor marketplace")
        if not self.human_tutor_approved_meeting_hosts:
            raise ValueError("Tutor commerce requires an approved meeting-host allowlist")
        expected_prefix = (
            "sk_live_" if self.human_tutor_stripe_environment == "PRODUCTION" else "sk_test_"
        )
        if (
            self.human_tutor_stripe_secret_key is None
            or not self.human_tutor_stripe_secret_key.get_secret_value().startswith(expected_prefix)
        ):
            raise ValueError("Tutor Stripe secret key must match the configured environment")
        if (
            self.human_tutor_stripe_webhook_secret is None
            or not self.human_tutor_stripe_webhook_secret.get_secret_value().startswith("whsec_")
            or len(self.human_tutor_stripe_webhook_secret.get_secret_value()) < 24
        ):
            raise ValueError("Tutor Stripe webhook secret is required when commerce is enabled")
        if (
            self.human_tutor_stripe_platform_account_id is None
            or re.fullmatch(r"acct_[A-Za-z0-9]{8,}", self.human_tutor_stripe_platform_account_id)
            is None
        ):
            raise ValueError(
                "Tutor Stripe platform account ID is required when commerce is enabled"
            )
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.[a-z]+", self.human_tutor_stripe_api_version) is None:
            raise ValueError("Tutor Stripe API version must be explicitly date-pinned")
        for name, value in (
            ("Connect refresh URL", self.human_tutor_stripe_connect_refresh_url),
            ("Connect return URL", self.human_tutor_stripe_connect_return_url),
            ("checkout success URL", self.human_tutor_checkout_success_url),
            ("checkout cancel URL", self.human_tutor_checkout_cancel_url),
        ):
            if value is None:
                raise ValueError(f"Tutor Stripe {name} is required when commerce is enabled")
            parsed = urlsplit(value)
            loopback = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
            if (
                not (parsed.scheme == "https" or loopback)
                or not parsed.netloc
                or parsed.username is not None
                or parsed.password is not None
                or parsed.fragment
            ):
                raise ValueError(f"Tutor Stripe {name} must be an exact HTTPS or loopback URL")
        return self

    @model_validator(mode="after")
    def validate_human_tutor_learning_bridge_configuration(self) -> Self:
        if not self.human_tutor_learning_bridge_enabled:
            return self
        if not self.human_tutor_marketplace_enabled or not self.human_tutor_commerce_enabled:
            raise ValueError("Tutor learning context requires marketplace commerce")
        return self

    @property
    def normalized_cors_origins(self) -> list[str]:
        """Return origins in the exact format expected by CORS middleware."""

        return [origin.rstrip("/") for origin in self.cors_origins]

    @property
    def clerk_configuration(
        self,
    ) -> tuple[str, str, str | None, tuple[str, ...]] | None:
        """Return the complete Clerk verifier configuration when enabled."""

        if self.clerk_issuer is None or self.clerk_jwks_url is None:
            return None
        return (
            self.clerk_issuer.rstrip("/"),
            self.clerk_jwks_url,
            self.clerk_audience.strip() if self.clerk_audience is not None else None,
            tuple(origin.rstrip("/") for origin in self.clerk_authorized_parties),
        )
