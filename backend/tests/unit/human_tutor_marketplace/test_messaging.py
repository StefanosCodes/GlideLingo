import pytest

from app.core.errors import TutorApplicationConflictError
from app.modules.human_tutor_marketplace.messaging import (
    validate_approved_meeting_url,
    validate_message_body,
)


def test_prebooking_messages_reject_links_contact_coordinates_and_control_bytes() -> None:
    blocked = (
        "Email me at tutor@example.com",
        "Call +1 (312) 555-0199",
        "Use https://meet.example.com/secret",
        "Telegram: tutorname",
        "hidden\x00control",
    )

    for value in blocked:
        with pytest.raises(TutorApplicationConflictError):
            validate_message_body(value, prebooking=True)


def test_message_markup_remains_bounded_plain_text_instead_of_becoming_authority() -> None:
    body = '<script>alert("not executable")</script> payment_status=paid'

    assert validate_message_body(body, prebooking=True) == body


def test_post_booking_text_may_include_a_link_but_is_still_plain_text() -> None:
    body = "Reference: https://example.test/lesson"

    assert validate_message_body(body, prebooking=False) == body


def test_meeting_url_requires_an_exact_approved_https_host() -> None:
    approved = ("meet.example.com",)
    valid = "https://meet.example.com/room/opaque-token?auth=bounded"

    assert validate_approved_meeting_url(valid, approved_hosts=approved) == valid
    for value in (
        "http://meet.example.com/room",
        "https://attacker.test/room",
        "https://meet.example.com.attacker.test/room",
        "https://user:password@meet.example.com/room",
        "https://meet.example.com/room#leak",
    ):
        with pytest.raises(ValueError):
            validate_approved_meeting_url(value, approved_hosts=approved)
