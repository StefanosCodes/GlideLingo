import json
import logging

from app.core.logging import JsonFormatter


def test_structured_logging_emits_only_allowlisted_operational_dimensions() -> None:
    record = logging.LogRecord(
        name="glidelingo.marketplace.worker",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="marketplace poll",
        args=(),
        exc_info=None,
    )
    record.event = "marketplace_money_worker_poll"
    record.outcome = "processed"
    record.booking_id = "must-not-be-logged"
    record.message_body = "must-not-be-logged"

    payload = json.loads(JsonFormatter().format(record))

    assert payload["event"] == "marketplace_money_worker_poll"
    assert payload["outcome"] == "processed"
    assert "booking_id" not in payload
    assert "message_body" not in payload
