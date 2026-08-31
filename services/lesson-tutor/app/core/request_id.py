"""Opaque request correlation without request-body logging."""

import re
from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
REQUEST_ID_PATTERN = re.compile(r"^req_[a-f0-9]{32}$")


def resolve_request_id(scope: Scope) -> str:
    """Keep the trusted API correlation ID when it matches the server-owned format."""

    forwarded = Headers(scope=scope).get(REQUEST_ID_HEADER)
    if forwarded is not None and REQUEST_ID_PATTERN.fullmatch(forwarded):
        return forwarded
    return f"req_{uuid4().hex}"


class RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = resolve_request_id(scope)
        scope.setdefault("state", {})["request_id"] = request_id

        async def add_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        await self.app(scope, receive, add_header)
