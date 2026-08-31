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
