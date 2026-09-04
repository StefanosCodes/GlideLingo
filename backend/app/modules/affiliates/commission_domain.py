"""Deterministic commission calculations and minimized ledger projections."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID


class CommissionEntryKind(StrEnum):
    ACCRUAL = "accrual"
    REFUND = "refund"
    REINSTATEMENT = "reinstatement"


class CommissionApplyStatus(StrEnum):
    ACCRUED = "accrued"
    REFUNDED = "refunded"
    REINSTATED = "reinstated"
    DUPLICATE = "duplicate"
    INELIGIBLE = "ineligible"
    IGNORED = "ignored"


class CommissionPolicyUnavailableError(Exception):
    """No explicit active policy and rule covers a qualifying event."""


class CommissionSourceUnavailableError(Exception):
    """A refund or reinstatement arrived before its immutable source entry."""


@dataclass(frozen=True, slots=True)
class CommissionApplyResult:
    status: CommissionApplyStatus


@dataclass(frozen=True, slots=True)
class CommissionLedgerEntry:
    entry_id: UUID
    kind: CommissionEntryKind
    currency_code: str
    basis_amount_minor: int
    commission_amount_minor: int
    occurred_at: datetime


def commission_amount_minor(*, basis_amount_minor: int, rate_basis_points: int) -> int:
    """Round a positive integer basis amount to nearest minor unit, ties away from zero."""

    if basis_amount_minor <= 0:
        raise ValueError("Commission basis must be positive")
    if not 1 <= rate_basis_points <= 10_000:
        raise ValueError("Commission rate must be between 1 and 10000 basis points")
    numerator = basis_amount_minor * rate_basis_points
    rounded = (numerator + 5_000) // 10_000
    if rounded <= 0:
        raise ValueError("Commission policy rounds the entry to zero minor units")
    return rounded
