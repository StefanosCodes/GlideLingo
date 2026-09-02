"""Server-owned Pro state, reconciliation, and RevenueCat webhook processing."""

import asyncio
import hashlib
import hmac
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    BillingUnavailableError,
    DependencyUnavailableError,
    ProRequiredError,
)
from app.integrations.revenuecat.client import (
    RevenueCatProvider,
    RevenueCatUnavailableError,
)
from app.modules.billing.identity import derive_billing_actor_ref
from app.modules.billing.repository import EntitlementRepository, StoredProEntitlement
from app.modules.billing.schemas import (
    ProEntitlementStatus,
    RevenueCatEnvironment,
    RevenueCatWebhookResponse,
)

EventId = Annotated[str, StringConstraints(min_length=1, max_length=255)]
EventType = Annotated[str, StringConstraints(min_length=1, max_length=64)]
AppUserId = Annotated[str, StringConstraints(min_length=1, max_length=100)]


class RevenueCatWebhookEvent(BaseModel):
    """Stable event fields needed to trigger a current-subscriber fetch."""

    model_config = ConfigDict(extra="ignore", strict=True)

    id: EventId
    type: EventType
    event_timestamp_ms: int = Field(ge=0, le=4_102_444_800_000)
    environment: RevenueCatEnvironment | None = None
    app_user_id: AppUserId | None = None


class RevenueCatWebhookPayload(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    api_version: str = Field(pattern=r"^1\.0$", max_length=16)
    event: RevenueCatWebhookEvent


class InvalidRevenueCatWebhookError(Exception):
    """A webhook request failed authentication or signature verification."""


class BillingService:
    def __init__(
        self,
        *,
        enabled: bool,
        repository: EntitlementRepository,
        provider: RevenueCatProvider | None,
        pseudonym_key: bytes | None,
        environment: RevenueCatEnvironment,
        freshness_seconds: int,
        webhook_authorization: str | None,
        webhook_signing_secret: str | None,
        webhook_signature_tolerance_seconds: int,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._enabled = enabled
        self._repository = repository
        self._provider = provider
        self._pseudonym_key = pseudonym_key
        self._environment = environment
        self._freshness = timedelta(seconds=freshness_seconds)
        self._webhook_authorization = webhook_authorization
        self._webhook_signing_secret = webhook_signing_secret
        self._signature_tolerance = webhook_signature_tolerance_seconds
        self._now = now or (lambda: datetime.now(UTC))

    async def status(self, *, principal: ClerkPrincipal) -> ProEntitlementStatus:
        return await self._resolve_status(principal=principal, force_reconcile=False)

    async def reconcile(self, *, principal: ClerkPrincipal) -> ProEntitlementStatus:
        """Force a bounded provider refresh for the verified Clerk principal."""

        return await self._resolve_status(principal=principal, force_reconcile=True)

    async def _resolve_status(
        self,
        *,
        principal: ClerkPrincipal,
        force_reconcile: bool,
    ) -> ProEntitlementStatus:
        if not self._enabled or self._pseudonym_key is None:
            return self._unavailable()
        actor_ref = derive_billing_actor_ref(
            key=self._pseudonym_key,
            app_user_id=principal.user_id,
        )
        try:
            stored = await asyncio.to_thread(
                self._repository.get_pro,
                actor_ref=actor_ref,
                environment=self._environment,
            )
        except DependencyUnavailableError:
            return self._unavailable()
        if not force_reconcile and stored is not None and self._is_fresh(stored):
            return self._from_stored(stored)
        if self._provider is None:
            return self._stale_or_unavailable(stored)

        try:
            snapshot = await self._provider.fetch_pro_entitlement(
                app_user_id=principal.user_id,
                environment=self._environment,
            )
            if snapshot.environment != self._environment:
                return self._stale_or_unavailable(stored)
            stored = await asyncio.to_thread(
                self._repository.store_reconciliation,
                actor_ref=actor_ref,
                environment=self._environment,
                is_active=snapshot.is_active,
                expires_at=snapshot.expires_at,
                observed_at=snapshot.observed_at,
            )
        except (RevenueCatUnavailableError, DependencyUnavailableError):
            return self._stale_or_unavailable(stored)
        if not self._is_fresh(stored):
            return self._stale_or_unavailable(stored)
        return self._from_stored(stored)

    async def require_pro(self, *, principal: ClerkPrincipal) -> ProEntitlementStatus:
        status = await self.status(principal=principal)
        if status.state == "inactive":
            raise ProRequiredError
        if status.state != "active" or not status.is_pro:
            raise BillingUnavailableError
        return status

    def verify_webhook(
        self,
        *,
        raw_body: bytes,
        authorization: str | None,
        signature_header: str | None,
    ) -> None:
        if (
            not self._enabled
            or self._webhook_authorization is None
            or self._webhook_signing_secret is None
        ):
            raise DependencyUnavailableError
        if authorization is None or not hmac.compare_digest(
            authorization.encode(), self._webhook_authorization.encode()
        ):
            raise InvalidRevenueCatWebhookError
        timestamp, supplied_signature = self._parse_signature(signature_header)
        signed_payload = str(timestamp).encode() + b"." + raw_body
        expected_signature = hmac.new(
            self._webhook_signing_secret.encode(),
            signed_payload,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected_signature, supplied_signature):
            raise InvalidRevenueCatWebhookError
        if abs(int(self._now().timestamp()) - timestamp) > self._signature_tolerance:
            raise InvalidRevenueCatWebhookError

    async def process_webhook(self, payload: RevenueCatWebhookPayload) -> RevenueCatWebhookResponse:
        event = payload.event
        if (
            event.type == "TEST"
            or event.environment != self._environment
            or event.app_user_id is None
        ):
            return RevenueCatWebhookResponse(status="ignored")
        if self._pseudonym_key is None or self._provider is None:
            raise DependencyUnavailableError
        event_at = datetime.fromtimestamp(event.event_timestamp_ms / 1000, tz=UTC)
        if event_at > self._now() + timedelta(minutes=5):
            return RevenueCatWebhookResponse(status="ignored")
        if await asyncio.to_thread(
            self._repository.has_webhook_event,
            event_id=event.id,
        ):
            return RevenueCatWebhookResponse(status="duplicate")

        try:
            snapshot = await self._provider.fetch_pro_entitlement(
                app_user_id=event.app_user_id,
                environment=self._environment,
            )
        except RevenueCatUnavailableError as error:
            raise DependencyUnavailableError from error
        if snapshot.environment != self._environment:
            raise DependencyUnavailableError
        actor_ref = derive_billing_actor_ref(
            key=self._pseudonym_key,
            app_user_id=event.app_user_id,
        )
        result = await asyncio.to_thread(
            self._repository.record_webhook_snapshot,
            event_id=event.id,
            actor_ref=actor_ref,
            environment=self._environment,
            event_at=event_at,
            snapshot_at=snapshot.observed_at,
            is_active=snapshot.is_active,
            expires_at=snapshot.expires_at,
        )
        return RevenueCatWebhookResponse(status=result)

    def _parse_signature(self, header: str | None) -> tuple[int, str]:
        if header is None or len(header) > 256:
            raise InvalidRevenueCatWebhookError
        parts: dict[str, str] = {}
        for part in header.split(","):
            key, separator, value = part.partition("=")
            if not separator or key in parts:
                raise InvalidRevenueCatWebhookError
            parts[key] = value
        timestamp = parts.get("t")
        signature = parts.get("v1")
        if (
            set(parts) != {"t", "v1"}
            or timestamp is None
            or not timestamp.isascii()
            or not timestamp.isdigit()
            or signature is None
            or len(signature) != 64
            or any(character not in "0123456789abcdef" for character in signature)
        ):
            raise InvalidRevenueCatWebhookError
        return int(timestamp), signature

    def _is_fresh(self, stored: StoredProEntitlement) -> bool:
        return stored.verified_at >= self._now() - self._freshness

    def _from_stored(self, stored: StoredProEntitlement) -> ProEntitlementStatus:
        active = stored.is_active and (stored.expires_at is None or stored.expires_at > self._now())
        return ProEntitlementStatus(
            state="active" if active else "inactive",
            is_pro=active,
            environment=self._environment,
            expires_at=stored.expires_at,
            verified_at=stored.verified_at,
        )

    def _stale_or_unavailable(self, stored: StoredProEntitlement | None) -> ProEntitlementStatus:
        if stored is None:
            return self._unavailable()
        return ProEntitlementStatus(
            state="stale",
            is_pro=False,
            environment=self._environment,
            expires_at=stored.expires_at,
            verified_at=stored.verified_at,
        )

    def _unavailable(self) -> ProEntitlementStatus:
        return ProEntitlementStatus(
            state="unavailable",
            is_pro=False,
            environment=self._environment,
        )
