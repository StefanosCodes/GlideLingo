"""Typed application configuration loaded from the process environment."""

from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_DATABASE_URL = (
    "postgresql+psycopg://glidelingo:glidelingo_dev_only@127.0.0.1:55433/glidelingo"
)
DESKTOP_APP_ORIGIN = "glidelingo://app"


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
    lesson_tutor_deadline_seconds: float = Field(default=12.0, gt=0, le=14)
    lesson_content_root: Path = Path("../content")
    openai_model: str = "gpt-5.6-terra"
    openai_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENAI_API_KEY", "GLIDELINGO_OPENAI_API_KEY"),
    )
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
        if self.lesson_tutor_enabled and (
            self.openai_api_key is None or not self.openai_api_key.get_secret_value().strip()
        ):
            raise ValueError("OPENAI_API_KEY is required when the lesson tutor is enabled")
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
                    "Clerk authorized parties must be HTTP(S) origins or the exact packaged "
                    "desktop origin without credentials, paths, queries, or fragments"
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
