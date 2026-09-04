"""Deterministic manual-availability and slot derivation rules."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

MAX_SLOT_HORIZON_DAYS = 31
MAX_SLOT_RESULTS = 256


@dataclass(frozen=True, slots=True)
class AvailabilityRule:
    weekday: int
    start_local: time
    end_local: time
    effective_from: date
    effective_until: date | None
    time_zone: str


@dataclass(frozen=True, slots=True)
class AvailabilityException:
    local_date: date
    start_local: time
    end_local: time
    kind: str
    time_zone: str


@dataclass(frozen=True, slots=True)
class TimeInterval:
    starts_at: datetime
    ends_at: datetime


def derive_slots(
    *,
    rules: tuple[AvailabilityRule, ...],
    exceptions: tuple[AvailabilityException, ...],
    window_start: datetime,
    window_end: datetime,
    duration_minutes: int,
    now: datetime,
    lead_time_minutes: int,
    buffer_before_minutes: int,
    buffer_after_minutes: int,
    busy_intervals: tuple[TimeInterval, ...] = (),
    limit: int = MAX_SLOT_RESULTS,
) -> tuple[TimeInterval, ...]:
    """Return bounded UTC slots from local recurrence without inventing DST instants."""

    for value in (window_start, window_end, now):
        if value.tzinfo is None:
            raise ValueError("slot derivation requires timezone-aware instants")
    if window_start >= window_end:
        raise ValueError("slot window must have positive duration")
    if window_end - window_start > timedelta(days=MAX_SLOT_HORIZON_DAYS):
        raise ValueError("slot window exceeds the 31-day horizon")
    if duration_minutes not in {25, 50}:
        raise ValueError("unsupported lesson duration")
    if not 1 <= limit <= MAX_SLOT_RESULTS:
        raise ValueError("slot limit is out of bounds")

    search_start = max(
        window_start.astimezone(UTC),
        now.astimezone(UTC) + timedelta(minutes=lead_time_minutes),
    )
    search_end = window_end.astimezone(UTC)
    teaching_windows: list[TimeInterval] = []

    for rule in rules:
        zone = ZoneInfo(rule.time_zone)
        first_local = window_start.astimezone(zone).date() - timedelta(days=1)
        last_local = window_end.astimezone(zone).date() + timedelta(days=1)
        current = max(first_local, rule.effective_from)
        final = min(last_local, rule.effective_until or last_local)
        while current <= final:
            if current.weekday() == rule.weekday:
                interval = _local_interval(current, rule.start_local, rule.end_local, zone)
                if interval is not None:
                    teaching_windows.append(interval)
            current += timedelta(days=1)

    for exception in exceptions:
        interval = _local_interval(
            exception.local_date,
            exception.start_local,
            exception.end_local,
            ZoneInfo(exception.time_zone),
        )
        if interval is None:
            continue
        if exception.kind == "available":
            teaching_windows.append(interval)
        elif exception.kind == "unavailable":
            teaching_windows = _subtract(teaching_windows, interval)
        else:
            raise ValueError("unsupported availability exception")

    duration = timedelta(minutes=duration_minutes)
    before = timedelta(minutes=buffer_before_minutes)
    after = timedelta(minutes=buffer_after_minutes)
    slots: list[TimeInterval] = []
    for teaching in _merge(teaching_windows):
        cursor = teaching.starts_at + before
        last_start = teaching.ends_at - duration - after
        while cursor <= last_start:
            candidate = TimeInterval(cursor, cursor + duration)
            if (
                candidate.starts_at >= search_start
                and candidate.ends_at <= search_end
                and not any(
                    candidate.starts_at - before < busy.ends_at
                    and candidate.ends_at + after > busy.starts_at
                    for busy in busy_intervals
                )
            ):
                slots.append(candidate)
                if len(slots) >= limit:
                    return tuple(slots)
            cursor += duration
    return tuple(slots)


def _local_interval(
    local_date: date,
    start_local: time,
    end_local: time,
    zone: ZoneInfo,
) -> TimeInterval | None:
    starts = _valid_utc_instants(datetime.combine(local_date, start_local), zone)
    ends = _valid_utc_instants(datetime.combine(local_date, end_local), zone)
    if not starts or not ends:
        return None
    starts_at = min(starts)
    ends_at = max(ends)
    return TimeInterval(starts_at, ends_at) if starts_at < ends_at else None


def _valid_utc_instants(local_value: datetime, zone: ZoneInfo) -> tuple[datetime, ...]:
    candidates: set[datetime] = set()
    for fold in (0, 1):
        aware = local_value.replace(tzinfo=zone, fold=fold)
        utc_value = aware.astimezone(UTC)
        if utc_value.astimezone(zone).replace(tzinfo=None) == local_value:
            candidates.add(utc_value)
    return tuple(sorted(candidates))


def _subtract(intervals: list[TimeInterval], blocked: TimeInterval) -> list[TimeInterval]:
    result: list[TimeInterval] = []
    for interval in intervals:
        if blocked.ends_at <= interval.starts_at or blocked.starts_at >= interval.ends_at:
            result.append(interval)
            continue
        if blocked.starts_at > interval.starts_at:
            result.append(TimeInterval(interval.starts_at, blocked.starts_at))
        if blocked.ends_at < interval.ends_at:
            result.append(TimeInterval(blocked.ends_at, interval.ends_at))
    return result


def _merge(intervals: list[TimeInterval]) -> list[TimeInterval]:
    merged: list[TimeInterval] = []
    for interval in sorted(intervals, key=lambda value: (value.starts_at, value.ends_at)):
        if not merged or interval.starts_at > merged[-1].ends_at:
            merged.append(interval)
        else:
            merged[-1] = TimeInterval(
                merged[-1].starts_at,
                max(merged[-1].ends_at, interval.ends_at),
            )
    return merged
