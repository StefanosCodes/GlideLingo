from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.modules.affiliates.commission_domain import (
    CommissionCursor,
    commission_amount_minor,
    decode_commission_cursor,
    encode_commission_cursor,
)


@pytest.mark.parametrize(
    ("basis_minor", "rate_basis_points", "expected"),
    [
        (1000, 1000, 100),
        (1999, 1250, 250),
        (5, 1000, 1),
        (1, 10_000, 1),
        (9_999_999, 10_000, 9_999_999),
    ],
)
def test_commission_uses_integer_half_up_rounding(
    basis_minor: int, rate_basis_points: int, expected: int
) -> None:
    assert (
        commission_amount_minor(
            basis_amount_minor=basis_minor,
            rate_basis_points=rate_basis_points,
        )
        == expected
    )


@pytest.mark.parametrize(
    ("basis_minor", "rate_basis_points"),
    [(0, 1000), (-1, 1000), (1, 0), (1, 10_001), (1, 1)],
)
def test_commission_rejects_invalid_or_zero_minor_results(
    basis_minor: int, rate_basis_points: int
) -> None:
    with pytest.raises(ValueError):
        commission_amount_minor(
            basis_amount_minor=basis_minor,
            rate_basis_points=rate_basis_points,
        )


def test_commission_cursor_round_trips_timestamp_and_tie_breaker() -> None:
    cursor = CommissionCursor(
        occurred_at=datetime(2026, 9, 2, 12, 0, 1, 234567, tzinfo=UTC),
        entry_id=UUID("00000000-0000-0000-0000-000000000123"),
    )

    encoded = encode_commission_cursor(cursor)

    assert len(encoded) == 32
    assert decode_commission_cursor(encoded) == cursor


@pytest.mark.parametrize("value", ["", "not-a-cursor", "!" * 32, "A" * 31])
def test_commission_cursor_rejects_malformed_values(value: str) -> None:
    with pytest.raises(ValueError, match="Invalid commission cursor"):
        decode_commission_cursor(value)
