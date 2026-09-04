"""Public billing contracts."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

type RevenueCatEnvironment = Literal["SANDBOX", "PRODUCTION"]
type EntitlementState = Literal["active", "inactive", "stale", "unavailable"]


class ProEntitlementStatus(BaseModel):
    """Fail-closed server view of the authenticated user's Pro access."""

    model_config = ConfigDict(extra="forbid")

    entitlement_id: Literal["pro"] = "pro"
    state: EntitlementState
    is_pro: bool
    environment: RevenueCatEnvironment
    expires_at: datetime | None = None
    verified_at: datetime | None = None


class RevenueCatWebhookResponse(BaseModel):
    """Small idempotent acknowledgement returned to RevenueCat."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["accepted", "applied", "duplicate", "out_of_order", "ignored"]
