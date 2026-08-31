"""Minimal structured application logging."""

import json
import logging
from datetime import UTC, datetime
from typing import Any


class JsonFormatter(logging.Formatter):
    """Render predictable JSON without request bodies or configuration values."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None)
        if request_id is not None:
            payload["request_id"] = request_id
        error_type = getattr(record, "error_type", None)
        if error_type is not None:
            payload["error_type"] = error_type
        return json.dumps(payload, separators=(",", ":"))


def configure_logging(level: str) -> None:
    """Configure only the service logger so embedding applications keep control."""

    logger = logging.getLogger("glidelingo")
    logger.setLevel(level)
    logger.propagate = False
    if logger.handlers:
        return

    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
