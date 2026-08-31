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


def test_lesson_tutor_is_disabled_by_default() -> None:
    settings = Settings(_env_file=None)

    assert settings.lesson_tutor_enabled is False
    assert settings.openai_model == "gpt-5.6-terra"
    assert settings.openai_api_key is None


def test_enabled_lesson_tutor_requires_api_key() -> None:
    with pytest.raises(ValidationError, match="OPENAI_API_KEY is required"):
        Settings(_env_file=None, lesson_tutor_enabled=True)


def test_enabled_lesson_tutor_accepts_process_secret(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("GLIDELINGO_LESSON_TUTOR_ENABLED", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret")

    settings = Settings(_env_file=None)

    assert settings.lesson_tutor_enabled is True
    assert settings.openai_api_key is not None
    assert settings.openai_api_key.get_secret_value() == "test-secret"
