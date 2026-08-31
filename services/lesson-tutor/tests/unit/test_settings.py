import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.main as main_module
from app.core.config import Settings
from app.main import create_app


def test_private_tutor_is_disabled_by_default() -> None:
    settings = Settings(_env_file=None)
    assert settings.enabled is False
    assert settings.model_deadline_seconds == 4
    assert settings.service_deadline_seconds == 5
    assert settings.openai_api_key is None


def test_enabled_private_tutor_requires_openai_key() -> None:
    with pytest.raises(ValidationError, match="OPENAI_API_KEY"):
        Settings(_env_file=None, enabled=True)


def test_enabled_service_constructs_and_closes_private_adapter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeAdapter:
        def __init__(self, *, api_key: str, model: str, provider_timeout_seconds: float) -> None:
            assert api_key == "test-only-key"
            assert model == "gpt-5.6-terra"
            assert provider_timeout_seconds == 4
            self.closed = False
            instances.append(self)

        async def reply(self, **_kwargs: object) -> str:
            return "A bounded reply."

        async def close(self) -> None:
            self.closed = True

    instances: list[FakeAdapter] = []
    monkeypatch.setattr(main_module, "OpenAILessonTutorAgent", FakeAdapter)
    settings = Settings(_env_file=None, enabled=True, openai_api_key="test-only-key")

    with TestClient(create_app(settings)) as client:
        assert client.get("/health/live").status_code == 200
        assert len(instances) == 1
        assert instances[0].closed is False

    assert instances[0].closed is True
