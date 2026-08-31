import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.mark.integration
def test_readiness_queries_real_postgresql() -> None:
    application = create_app(Settings())
    with TestClient(application) as client:
        response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "service": "glidelingo-api",
        "checks": {"database": "ok"},
    }
