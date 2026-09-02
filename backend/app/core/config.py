"""Typed application configuration loaded from the process environment."""

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
    revenuecat_webhook_app_id: str | None = Field(default=None, min_length=1, max_length=255)
    revenuecat_webhook_authorization: SecretStr | None = None
    revenuecat_webhook_signing_secret: SecretStr | None = None
    revenuecat_api_timeout_seconds: float = Field(default=2.5, gt=0, le=5)
    revenuecat_entitlement_freshness_seconds: int = Field(default=900, ge=60, le=3600)
    revenuecat_webhook_max_body_bytes: int = Field(default=65536, ge=1024, le=262144)
    revenuecat_webhook_signature_tolerance_seconds: int = Field(default=300, ge=30, le=600)
    affiliates_enabled: bool = False
    affiliate_referral_resolution_enabled: bool = False
    affiliate_attribution_binding_enabled: bool = False
    affiliate_membership_admin_enabled: bool = False
    affiliate_principal_pseudonym_key: SecretStr | None = None
    billing_event_intake_enabled: bool = False
    billing_event_worker_poll_seconds: float = Field(default=1.0, gt=0, le=60)
    billing_event_worker_lease_seconds: int = Field(default=30, ge=10, le=300)
    billing_event_worker_maximum_attempts: int = Field(default=8, ge=1, le=20)
    billing_event_worker_retry_base_seconds: int = Field(default=5, ge=1, le=300)
    billing_event_worker_retry_max_seconds: int = Field(default=3600, ge=5, le=86400)
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
        if (
            self.billing_event_worker_retry_base_seconds
            > self.billing_event_worker_retry_max_seconds
        ):
            raise ValueError("Billing event retry base cannot exceed the retry maximum")
        if self.billing_event_intake_enabled and not self.revenuecat_enabled:
            raise ValueError("RevenueCat must be enabled before billing event intake")
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
        if self.billing_event_intake_enabled and self.revenuecat_webhook_app_id is None:
            raise ValueError("RevenueCat webhook app ID is required for billing event intake")
        return self

    @model_validator(mode="after")
    def validate_affiliate_configuration(self) -> Self:
        route_flags = (
            self.affiliate_referral_resolution_enabled,
            self.affiliate_attribution_binding_enabled,
            self.affiliate_membership_admin_enabled,
        )
        if any(route_flags) and not self.affiliates_enabled:
            raise ValueError("Affiliate route flags require the master affiliate flag")
        if not self.affiliates_enabled:
            return self
        if (
            self.affiliate_principal_pseudonym_key is None
            or len(self.affiliate_principal_pseudonym_key.get_secret_value().encode()) < 32
        ):
            raise ValueError(
                "An affiliate principal pseudonym key of at least 32 bytes is required when enabled"
            )
        if (
            self.affiliate_attribution_binding_enabled or self.affiliate_membership_admin_enabled
        ) and self.clerk_configuration is None:
            raise ValueError(
                "Clerk authentication must be configured when authenticated affiliate routes "
                "are enabled"
            )
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
