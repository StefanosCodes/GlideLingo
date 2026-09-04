"""Typed durable billing-event records shared by intake and workers."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

type BillingEventConsumer = Literal["pro_entitlement", "affiliate_finance"]
type BillingEventDeliveryState = Literal[
    "pending", "processing", "retryable", "completed", "manual_review"
]
type IntakeStatus = Literal["accepted", "duplicate"]


@dataclass(frozen=True, slots=True)
class NormalizedBillingEvent:
    """Allowlisted provider facts accepted after provider-specific verification."""

    event_ref: UUID
    provider: str
    environment: str
    provider_account_ref: str
    provider_event_id: str
    event_type: str
    occurred_at: datetime
    received_at: datetime
    actor_ref: str | None
    provider_actor_ciphertext: bytes | None
    object_refs: dict[str, str]
    schema_version: int
    payload_sha256: str


@dataclass(frozen=True, slots=True)
class IntakeReceipt:
    status: IntakeStatus


@dataclass(frozen=True, slots=True)
class ClaimedBillingEventDelivery:
    """A delivery claimed under a bounded lease."""

    delivery_ref: UUID
    lease_token: UUID
    consumer: BillingEventConsumer
    attempt_count: int
    event_ref: UUID
    provider: str
    environment: str
    provider_account_ref: str
    provider_event_id: str
    event_type: str
    occurred_at: datetime
    actor_ref: str | None
    provider_actor_ciphertext: bytes | None
    object_refs: dict[str, str]
