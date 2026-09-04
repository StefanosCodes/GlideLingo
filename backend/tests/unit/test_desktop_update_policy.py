from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def client() -> Iterator[TestClient]:
    application = create_app(
        Settings(
            _env_file=None,
            desktop_minimum_supported_version="1.2.3",
        )
    )
    application.state.database_probe = lambda: (_ for _ in ()).throw(
        AssertionError("update policy must not query PostgreSQL")
    )
    with TestClient(application) as test_client:
        yield test_client


def test_update_policy_is_public_and_database_free(client: TestClient) -> None:
    response = client.get("/v1/desktop/update-policy?current_version=1.0.0")

    assert response.status_code == 200
    assert response.json() == {"minimum_supported_version": "1.2.3"}


@pytest.mark.parametrize(
    "current_version",
    [
        None,
        "",
        "1.2",
        "v1.2.3",
        "01.2.3",
        "1.2.3-beta",
        "1.2.3+build",
        " 1.2.3",
        f"1.2.{('3' * 65)}",
    ],
)
def test_update_policy_rejects_non_numeric_semver(
    client: TestClient,
    current_version: str | None,
) -> None:
    path = "/v1/desktop/update-policy"
    if current_version is not None:
        path = f"{path}?current_version={current_version}"

    response = client.get(path)

    assert response.status_code == 422


def test_openapi_documents_the_public_update_policy_contract(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    operation = schema["paths"]["/v1/desktop/update-policy"]["get"]

    assert operation["operationId"] == "getDesktopUpdatePolicy"
    assert operation.get("security") is None
    assert operation["parameters"][0]["name"] == "current_version"
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/DesktopUpdatePolicyResponse"
    }
