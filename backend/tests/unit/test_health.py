from collections.abc import Callable, Iterator
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.health import get_database_probe
from app.core.config import Settings
from app.core.request_id import REQUEST_ID_HEADER
from app.db.engine import DatabaseUnavailableError
from app.main import create_app


@pytest.fixture
def client() -> Iterator[TestClient]:
    application = create_app(
        Settings(
            _env_file=None,
            cors_origins=("http://localhost:8081", "http://127.0.0.1:8081"),
        )
    )
    with TestClient(application) as test_client:
        yield test_client
    application.dependency_overrides.clear()


def override_database_probe(client: TestClient, probe: Callable[[], None]) -> None:
    application = cast(FastAPI, client.app)
    application.dependency_overrides[get_database_probe] = lambda: probe


def test_liveness_does_not_probe_database(client: TestClient) -> None:
    def fail_if_called() -> None:
        raise AssertionError("liveness must not query PostgreSQL")

    override_database_probe(client, fail_if_called)

    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "glidelingo-api"}
    assert response.headers[REQUEST_ID_HEADER].startswith("req_")


def test_readiness_reports_database_success(client: TestClient) -> None:
    calls = 0

    def successful_probe() -> None:
        nonlocal calls
        calls += 1

    override_database_probe(client, successful_probe)

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "service": "glidelingo-api",
        "checks": {"database": "ok"},
    }
    assert calls == 1


def test_readiness_returns_stable_error_and_correlated_request_id(
    client: TestClient,
) -> None:
    def unavailable_probe() -> None:
        raise DatabaseUnavailableError

    override_database_probe(client, unavailable_probe)

    response = client.get("/health/ready")

    request_id = response.headers[REQUEST_ID_HEADER]
    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "dependency_unavailable",
            "message": "A required dependency is unavailable.",
            "request_id": request_id,
        }
    }
    assert "postgres" not in response.text.lower()


def test_client_request_id_is_replaced(client: TestClient) -> None:
    hostile_id = "client-controlled-value"

    response = client.get(
        "/health/live",
        headers={REQUEST_ID_HEADER: hostile_id},
    )

    server_id = response.headers[REQUEST_ID_HEADER]
    assert response.status_code == 200
    assert server_id.startswith("req_")
    assert server_id != hostile_id
    assert "client-controlled" not in server_id


def test_not_found_response_has_request_id(client: TestClient) -> None:
    response = client.get("/missing")

    assert response.status_code == 404
    assert response.headers[REQUEST_ID_HEADER].startswith("req_")


def test_allowed_cors_origin_receives_explicit_headers(client: TestClient) -> None:
    response = client.options(
        "/health/live",
        headers={
            "Origin": "http://localhost:8081",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
    assert response.headers.get("access-control-allow-credentials") is None
    assert response.headers[REQUEST_ID_HEADER].startswith("req_")


def test_disallowed_cors_origin_is_not_authorized(client: TestClient) -> None:
    response = client.options(
        "/health/live",
        headers={
            "Origin": "https://attacker.example",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
    assert response.headers[REQUEST_ID_HEADER].startswith("req_")


def test_actual_cors_response_exposes_request_id(client: TestClient) -> None:
    response = client.get("/health/live", headers={"Origin": "http://localhost:8081"})

    assert response.status_code == 200
    assert response.headers["access-control-expose-headers"] == REQUEST_ID_HEADER


def test_unhandled_failure_returns_safe_correlated_cors_error(client: TestClient) -> None:
    def unexpected_probe() -> None:
        raise RuntimeError("postgresql://secret:password@private-host/database")

    override_database_probe(client, unexpected_probe)

    response = client.get("/health/ready", headers={"Origin": "http://localhost:8081"})

    request_id = response.headers[REQUEST_ID_HEADER]
    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "code": "internal_error",
            "message": "An unexpected error occurred.",
            "request_id": request_id,
        }
    }
    assert "secret" not in response.text
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
    assert response.headers["access-control-expose-headers"] == REQUEST_ID_HEADER


def test_openapi_documents_health_contracts(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()

    live_operation = schema["paths"]["/health/live"]["get"]
    ready_operation = schema["paths"]["/health/ready"]["get"]

    assert live_operation["operationId"] == "getHealthLiveness"
    assert ready_operation["operationId"] == "getHealthReadiness"
    assert live_operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/LivenessResponse"
    }
    assert ready_operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ReadinessResponse"
    }
    assert ready_operation["responses"]["503"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorResponse"
    }
