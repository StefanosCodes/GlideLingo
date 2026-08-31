"""Environment-owned configuration for the IAM-private tutor."""

from pathlib import Path
from typing import Literal, Self

from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_CONTENT_ROOT = Path(__file__).resolve().parents[4] / "content"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="GLIDELINGO_TUTOR_",
        env_file=("../../.env", ".env"),
        case_sensitive=False,
        extra="ignore",
    )

    enabled: bool = False
    openai_model: str = "gpt-5.6-terra"
    openai_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENAI_API_KEY", "GLIDELINGO_TUTOR_OPENAI_API_KEY"),
    )
    model_deadline_seconds: float = Field(default=4.0, gt=0, le=4)
    service_deadline_seconds: float = Field(default=5.0, gt=0, le=5)
    content_root: Path = DEFAULT_CONTENT_ROOT
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    @model_validator(mode="after")
    def validate_enabled(self) -> Self:
        if self.enabled and (
            self.openai_api_key is None or not self.openai_api_key.get_secret_value().strip()
        ):
            raise ValueError("OPENAI_API_KEY is required when the private tutor is enabled")
        if self.model_deadline_seconds >= self.service_deadline_seconds:
            raise ValueError("The provider deadline must be shorter than the service deadline")
        return self
