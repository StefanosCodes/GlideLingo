import pytest

from app.modules.affiliates.commission_domain import commission_amount_minor


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
