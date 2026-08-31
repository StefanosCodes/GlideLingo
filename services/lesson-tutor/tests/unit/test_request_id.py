from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.core.request_id import REQUEST_ID_HEADER, REQUEST_ID_PATTERN, RequestIdMiddleware


def request_id_app() -> FastAPI:
    app = FastAPI()

    @app.get("/")
    async def read_request_id(request: Request) -> dict[str, str]:
        return {"request_id": request.state.request_id}

    app.add_middleware(RequestIdMiddleware)
    return app


def test_valid_api_request_id_is_preserved_across_the_private_boundary() -> None:
    forwarded = f"req_{'a' * 32}"

    with TestClient(request_id_app()) as client:
        response = client.get("/", headers={REQUEST_ID_HEADER: forwarded})

    assert response.json() == {"request_id": forwarded}
    assert response.headers[REQUEST_ID_HEADER] == forwarded


def test_invalid_request_id_is_replaced() -> None:
    with TestClient(request_id_app()) as client:
        response = client.get("/", headers={REQUEST_ID_HEADER: "attacker-controlled"})

    generated = response.json()["request_id"]
    assert generated != "attacker-controlled"
    assert REQUEST_ID_PATTERN.fullmatch(generated)
    assert response.headers[REQUEST_ID_HEADER] == generated
