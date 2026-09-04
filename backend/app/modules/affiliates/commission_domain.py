"""Deterministic affiliate financial facts, calculations, and ledger projections."""

import base64
import binascii
import struct
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import UUID


class FinancialFactKind(StrEnum):
    PURCHASE = "purchase"
    REFUND = "refund"
    REFUND_REVERSAL = "refund_reversal"


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


class CommissionPolicyUnavailableError(Exception):
    """No explicit active policy and rule covers a qualifying financial fact."""


class CommissionSourceUnavailableError(Exception):
    """A reversal fact arrived before its immutable source entry."""


class CommissionFactConflictError(Exception):
    """A fact identity or transaction contradicts previously accepted evidence."""


class CommissionReversalConflictError(Exception):
    """A reversal contradicts the source amount, currency, sequence, or chronology."""


class InvalidCommissionCursorError(ValueError):
    """A ledger cursor is malformed or not from this pagination contract."""


@dataclass(frozen=True, slots=True)
class AuthenticatedFinancialFact:
    """Minimized fact supplied by a future authenticated Stripe reconciliation boundary."""

    environment: str
    provider_account_ref: str
    provider_event_id: str
    provider_transaction_ref: str
    kind: FinancialFactKind
    occurred_at: datetime
    currency_code: str
    gross_amount_minor: int
    payload_sha256: str
    principal_ref: str | None = None
    product_ref: str | None = None
    reverses_provider_transaction_ref: str | None = None


@dataclass(frozen=True, slots=True)
class CommissionApplyResult:
    status: CommissionApplyStatus


@dataclass(frozen=True, slots=True)
class CommissionCursor:
    occurred_at: datetime
    entry_id: UUID


@dataclass(frozen=True, slots=True)
class CommissionLedgerEntry:
    entry_id: UUID
    kind: CommissionEntryKind
    currency_code: str
    basis_amount_minor: int
    commission_amount_minor: int
    occurred_at: datetime


@dataclass(frozen=True, slots=True)
class CommissionLedgerPage:
    entries: tuple[CommissionLedgerEntry, ...]
    next_cursor: str | None


_CURSOR_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_CURSOR_BYTES = 24


def encode_commission_cursor(cursor: CommissionCursor) -> str:
    occurred_at = cursor.occurred_at.astimezone(UTC)
    delta = occurred_at - _CURSOR_EPOCH
    microseconds = delta.days * 86_400_000_000 + delta.seconds * 1_000_000 + delta.microseconds
    encoded = base64.urlsafe_b64encode(struct.pack(">q", microseconds) + cursor.entry_id.bytes)
    return encoded.decode("ascii").rstrip("=")


def decode_commission_cursor(value: str) -> CommissionCursor:
    try:
        raw = base64.b64decode(value, altchars=b"-_", validate=True)
        if len(raw) != _CURSOR_BYTES:
            raise ValueError
        microseconds = struct.unpack(">q", raw[:8])[0]
        occurred_at = _CURSOR_EPOCH + timedelta(microseconds=microseconds)
        entry_id = UUID(bytes=raw[8:])
    except (binascii.Error, OverflowError, ValueError) as error:
        raise InvalidCommissionCursorError("Invalid commission cursor") from error
    return CommissionCursor(occurred_at=occurred_at, entry_id=entry_id)


def commission_amount_minor(*, basis_amount_minor: int, rate_basis_points: int) -> int:
    """Round a positive settled amount to nearest minor unit, ties away from zero."""

    if basis_amount_minor <= 0:
        raise ValueError("Commission basis must be positive")
    if not 1 <= rate_basis_points <= 10_000:
        raise ValueError("Commission rate must be between 1 and 10000 basis points")
    numerator = basis_amount_minor * rate_basis_points
    rounded = (numerator + 5_000) // 10_000
    if rounded <= 0:
        raise ValueError("Commission policy rounds the entry to zero minor units")
    return rounded
