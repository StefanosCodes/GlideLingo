from datetime import UTC, date, datetime, time

import pytest

from app.modules.human_tutor_marketplace.availability import (
    AvailabilityException,
    AvailabilityRule,
    TimeInterval,
    derive_slots,
)


def rule(
    *,
    weekday: int,
    start: time = time(9),
    end: time = time(11),
    zone: str = "America/Chicago",
) -> AvailabilityRule:
    return AvailabilityRule(
        weekday=weekday,
        start_local=start,
        end_local=end,
        effective_from=date(2026, 1, 1),
        effective_until=None,
        time_zone=zone,
    )


def test_slots_apply_lead_time_buffers_exceptions_and_busy_ranges() -> None:
    slots = derive_slots(
        rules=(rule(weekday=4),),
        exceptions=(
            AvailabilityException(
                local_date=date(2026, 9, 4),
                start_local=time(9, 50),
                end_local=time(10, 20),
                kind="unavailable",
                time_zone="America/Chicago",
            ),
        ),
        window_start=datetime(2026, 9, 4, 13, tzinfo=UTC),
        window_end=datetime(2026, 9, 4, 18, tzinfo=UTC),
        duration_minutes=25,
        now=datetime(2026, 9, 4, 13, tzinfo=UTC),
        lead_time_minutes=60,
        buffer_before_minutes=5,
        buffer_after_minutes=5,
        busy_intervals=(
            TimeInterval(
                datetime(2026, 9, 4, 15, 45, tzinfo=UTC),
                datetime(2026, 9, 4, 16, 10, tzinfo=UTC),
            ),
        ),
    )

    assert [(slot.starts_at.isoformat(), slot.ends_at.isoformat()) for slot in slots] == [
        ("2026-09-04T14:05:00+00:00", "2026-09-04T14:30:00+00:00"),
    ]


def test_nonexistent_dst_window_is_skipped_and_repeated_hour_is_deterministic() -> None:
    spring = derive_slots(
        rules=(rule(weekday=6, start=time(2), end=time(3)),),
        exceptions=(),
        window_start=datetime(2026, 3, 8, tzinfo=UTC),
        window_end=datetime(2026, 3, 9, tzinfo=UTC),
        duration_minutes=25,
        now=datetime(2026, 3, 1, tzinfo=UTC),
        lead_time_minutes=60,
        buffer_before_minutes=0,
        buffer_after_minutes=0,
    )
    repeated = derive_slots(
        rules=(rule(weekday=6, start=time(1), end=time(2)),),
        exceptions=(),
        window_start=datetime(2026, 11, 1, tzinfo=UTC),
        window_end=datetime(2026, 11, 2, tzinfo=UTC),
        duration_minutes=50,
        now=datetime(2026, 10, 1, tzinfo=UTC),
        lead_time_minutes=60,
        buffer_before_minutes=0,
        buffer_after_minutes=0,
    )

    assert spring == ()
    assert [slot.starts_at.isoformat() for slot in repeated] == [
        "2026-11-01T06:00:00+00:00",
        "2026-11-01T06:50:00+00:00",
    ]


def test_slot_queries_are_bounded() -> None:
    with pytest.raises(ValueError, match="31-day"):
        derive_slots(
            rules=(),
            exceptions=(),
            window_start=datetime(2026, 1, 1, tzinfo=UTC),
            window_end=datetime(2026, 2, 2, tzinfo=UTC),
            duration_minutes=25,
            now=datetime(2025, 1, 1, tzinfo=UTC),
            lead_time_minutes=60,
            buffer_before_minutes=0,
            buffer_after_minutes=0,
        )
