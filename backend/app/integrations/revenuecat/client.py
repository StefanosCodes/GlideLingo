"""Bounded RevenueCat subscriber reconciliation client."""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Annotated, Protocol
from urllib.parse import quote

import httpx
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
)

from app.modules.billing.schemas import RevenueCatEnvironment

ENTITLEMENT_ID = "pro"
MAX_CUSTOMER_INFO_BYTES = 1_048_576
AppUserId = Annotated[str, StringConstraints(min_length=1, max_length=100)]
ProductId = Annotated[str, StringConstraints(min_length=1, max_length=255)]


class RevenueCatUnavailableError(Exception):
    """RevenueCat could not return a usable subscriber snapshot."""


class RevenueCatIdentityMismatchError(RevenueCatUnavailableError):
    """RevenueCat returned a subscriber other than the requested App User ID."""


class _Entitlement(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    expires_date: datetime | None
    product_identifier: ProductId

    @field_validator("expires_date")
    @classmethod
    def require_aware_expiry(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("expires_date must include a timezone")
        return value


class _Subscription(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    is_sandbox: bool


class _NonSubscription(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    is_sandbox: bool


class _Subscriber(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    original_app_user_id: AppUserId
    entitlements: Annotated[dict[str, _Entitlement], Field(max_length=500)]
    subscriptions: Annotated[dict[str, _Subscription], Field(max_length=500)]
    non_subscriptions: Annotated[
        dict[str, Annotated[list[_NonSubscription], Field(max_length=500)]],
        Field(max_length=500),
    ]


class _CustomerInfo(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    request_date_ms: int = Field(ge=0, le=4_102_444_800_000)
    subscriber: _Subscriber


class RevenueCatSnapshot(BaseModel):
    """Allowlisted provider facts used by the entitlement store."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    is_active: bool
    environment: RevenueCatEnvironment
    expires_at: datetime | None
    observed_at: datetime


class RevenueCatProvider(Protocol):
    async def fetch_pro_entitlement(
        self, *, app_user_id: str, environment: RevenueCatEnvironment
    ) -> RevenueCatSnapshot: ...

    async def close(self) -> None: ...


class RevenueCatHttpClient:
    """Read one customer's current entitlement with a server-only API key."""

    def __init__(
        self,
        *,
        api_key: str,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._timeout_seconds = timeout_seconds
        self._client = httpx.AsyncClient(
            base_url="https://api.revenuecat.com",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
        )

    async def fetch_pro_entitlement(
        self, *, app_user_id: str, environment: RevenueCatEnvironment
    ) -> RevenueCatSnapshot:
        try:
            async with asyncio.timeout(self._timeout_seconds):
                async with self._client.stream(
                    "GET", f"/v1/subscribers/{quote(app_user_id, safe='')}"
                ) as response:
                    if response.status_code not in {200, 201}:
                        raise RevenueCatUnavailableError
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > MAX_CUSTOMER_INFO_BYTES:
                            raise RevenueCatUnavailableError
        except (TimeoutError, httpx.TimeoutException, httpx.HTTPError, OSError) as error:
            raise RevenueCatUnavailableError from error
        try:
            customer = _CustomerInfo.model_validate_json(content)
        except ValidationError as error:
            raise RevenueCatUnavailableError from error
        if customer.subscriber.original_app_user_id != app_user_id:
            raise RevenueCatIdentityMismatchError

        observed_at = datetime.fromtimestamp(customer.request_date_ms / 1000, tz=UTC)
        if observed_at > datetime.now(UTC) + timedelta(minutes=5):
            raise RevenueCatUnavailableError
        entitlement = customer.subscriber.entitlements.get(ENTITLEMENT_ID)
        if entitlement is None:
            return RevenueCatSnapshot(
                is_active=False,
                environment=environment,
                expires_at=None,
                observed_at=observed_at,
            )

        is_sandbox = self._resolve_product_environment(
            customer.subscriber,
            product_identifier=entitlement.product_identifier,
        )
        expected_sandbox = environment == "SANDBOX"
        if is_sandbox != expected_sandbox:
            return RevenueCatSnapshot(
                is_active=False,
                environment=environment,
                expires_at=entitlement.expires_date,
                observed_at=observed_at,
            )
        is_active = entitlement.expires_date is None or entitlement.expires_date > observed_at
        return RevenueCatSnapshot(
            is_active=is_active,
            environment=environment,
            expires_at=entitlement.expires_date,
            observed_at=observed_at,
        )

    @staticmethod
    def _resolve_product_environment(subscriber: _Subscriber, *, product_identifier: str) -> bool:
        subscription = subscriber.subscriptions.get(product_identifier)
        if subscription is not None:
            return subscription.is_sandbox
        purchases = subscriber.non_subscriptions.get(product_identifier)
        if purchases:
            environments = {purchase.is_sandbox for purchase in purchases}
            if len(environments) == 1:
                return environments.pop()
        raise RevenueCatUnavailableError

    async def close(self) -> None:
        await self._client.aclose()
