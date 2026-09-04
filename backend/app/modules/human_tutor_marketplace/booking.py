"""Server-owned booking holds and Stripe Connect checkout coordination."""

import asyncio
import hashlib
import hmac
import json
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol, cast
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError, SQLAlchemyError

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    DependencyUnavailableError,
    HumanTutorMarketplaceForbiddenError,
    HumanTutorMarketplaceUnavailableError,
    TutorApplicationConflictError,
    TutorApplicationNotFoundError,
)
from app.modules.human_tutor_marketplace.discovery import MarketplaceDiscoveryService
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref
from app.modules.human_tutor_marketplace.messaging import validate_approved_meeting_url

Environment = Literal["SANDBOX", "PRODUCTION"]
BookingState = Literal[
    "held",
    "payment_pending",
    "payment_ambiguous",
    "payment_failed",
    "confirmed",
    "completed",
    "cancelled",
    "learner_no_show",
    "tutor_no_show",
    "disputed",
    "resolved_refund",
    "resolved_release",
    "expired",
]
WebhookOutcome = Literal["applied", "duplicate", "out_of_order", "ignored"]


class StripeOperationError(Exception):
    def __init__(self, *, code: str, ambiguous: bool) -> None:
        super().__init__(code)
        self.code = code
        self.ambiguous = ambiguous


@dataclass(frozen=True, slots=True)
class StripeConnectAccount:
    account_id: str
    livemode: bool
    details_submitted: bool
    charges_enabled: bool
    payouts_enabled: bool
    requirements_due: int
    observed_at: datetime


@dataclass(frozen=True, slots=True)
class StripeAccountLink:
    url: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class StripeCheckout:
    checkout_id: str
    url: str | None
    payment_intent_id: str | None
    status: Literal["open", "complete", "expired"]
    payment_status: Literal["unpaid", "paid", "no_payment_required"]
    livemode: bool
    booking_id: UUID
    platform_account_id: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class StripeMoneyResult:
    operation_id: str
    livemode: bool
    amount_minor: int
    currency: str


class StripeMarketplaceProvider(Protocol):
    async def get_platform_account_id(self) -> str: ...

    async def create_connect_account(self, *, idempotency_key: str) -> StripeConnectAccount: ...

    async def retrieve_connect_account(self, *, account_id: str) -> StripeConnectAccount: ...

    async def create_account_link(
        self, *, account_id: str, refresh_url: str, return_url: str
    ) -> StripeAccountLink: ...

    async def create_checkout(
        self,
        *,
        booking_id: UUID,
        amount_minor: int,
        currency: str,
        title: str,
        success_url: str,
        cancel_url: str,
        idempotency_key: str,
        platform_account_id: str,
        environment: Environment,
    ) -> StripeCheckout: ...

    async def retrieve_checkout(self, *, checkout_id: str) -> StripeCheckout: ...

    async def create_refund(
        self, *, payment_intent_id: str, amount_minor: int, idempotency_key: str
    ) -> StripeMoneyResult: ...

    async def create_transfer(
        self,
        *,
        destination_account_id: str,
        amount_minor: int,
        currency: str,
        booking_id: UUID,
        idempotency_key: str,
    ) -> StripeMoneyResult: ...

    async def create_reversal(
        self, *, transfer_id: str, amount_minor: int, idempotency_key: str
    ) -> StripeMoneyResult: ...

    async def close(self) -> None: ...


class StripeHttpMarketplaceProvider:
    """Small Stripe API v1 adapter pinned to one reviewed API version."""

    def __init__(
        self,
        *,
        secret_key: str,
        api_version: str,
        timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._secret_key = secret_key
        self._api_version = api_version
        self._client = client or httpx.AsyncClient(
            base_url="https://api.stripe.com",
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=False,
        )

    async def get_platform_account_id(self) -> str:
        payload = await self._request("GET", "/v1/account")
        return _required_provider_id(payload, "id", "acct_")

    async def create_connect_account(self, *, idempotency_key: str) -> StripeConnectAccount:
        payload = await self._request(
            "POST", "/v1/accounts", data={"type": "express"}, idempotency_key=idempotency_key
        )
        return _parse_connect_account(payload)

    async def retrieve_connect_account(self, *, account_id: str) -> StripeConnectAccount:
        return _parse_connect_account(await self._request("GET", f"/v1/accounts/{account_id}"))

    async def create_account_link(
        self, *, account_id: str, refresh_url: str, return_url: str
    ) -> StripeAccountLink:
        payload = await self._request(
            "POST",
            "/v1/account_links",
            data={
                "account": account_id,
                "refresh_url": refresh_url,
                "return_url": return_url,
                "type": "account_onboarding",
                "collection_options[fields]": "currently_due",
            },
            idempotency_key=f"account-link:{account_id}:{uuid4()}",
        )
        url = payload.get("url")
        expires = payload.get("expires_at")
        if (
            not isinstance(url, str)
            or not _is_https_stripe_url(url)
            or not isinstance(expires, int)
        ):
            raise StripeOperationError(code="invalid_response", ambiguous=False)
        return StripeAccountLink(url=url, expires_at=datetime.fromtimestamp(expires, UTC))

    async def create_checkout(
        self,
        *,
        booking_id: UUID,
        amount_minor: int,
        currency: str,
        title: str,
        success_url: str,
        cancel_url: str,
        idempotency_key: str,
        platform_account_id: str,
        environment: Environment,
    ) -> StripeCheckout:
        data = {
            "mode": "payment",
            "client_reference_id": str(booking_id),
            "success_url": success_url,
            "cancel_url": cancel_url,
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": currency.lower(),
            "line_items[0][price_data][unit_amount]": str(amount_minor),
            "line_items[0][price_data][product_data][name]": title,
            "metadata[booking_id]": str(booking_id),
            "metadata[platform_account_id]": platform_account_id,
            "metadata[environment]": environment,
            "payment_intent_data[transfer_group]": f"booking_{booking_id}",
            "payment_intent_data[metadata][booking_id]": str(booking_id),
        }
        payload = await self._request(
            "POST", "/v1/checkout/sessions", data=data, idempotency_key=idempotency_key
        )
        return _parse_checkout(payload)

    async def retrieve_checkout(self, *, checkout_id: str) -> StripeCheckout:
        return _parse_checkout(await self._request("GET", f"/v1/checkout/sessions/{checkout_id}"))

    async def create_refund(
        self, *, payment_intent_id: str, amount_minor: int, idempotency_key: str
    ) -> StripeMoneyResult:
        payload = await self._request(
            "POST",
            "/v1/refunds",
            data={"payment_intent": payment_intent_id, "amount": str(amount_minor)},
            idempotency_key=idempotency_key,
        )
        return _parse_money_result(payload, prefix="re_")

    async def create_transfer(
        self,
        *,
        destination_account_id: str,
        amount_minor: int,
        currency: str,
        booking_id: UUID,
        idempotency_key: str,
    ) -> StripeMoneyResult:
        payload = await self._request(
            "POST",
            "/v1/transfers",
            data={
                "amount": str(amount_minor),
                "currency": currency.lower(),
                "destination": destination_account_id,
                "transfer_group": f"booking_{booking_id}",
                "metadata[booking_id]": str(booking_id),
            },
            idempotency_key=idempotency_key,
        )
        return _parse_money_result(payload, prefix="tr_")

    async def create_reversal(
        self, *, transfer_id: str, amount_minor: int, idempotency_key: str
    ) -> StripeMoneyResult:
        payload = await self._request(
            "POST",
            f"/v1/transfers/{transfer_id}/reversals",
            data={"amount": str(amount_minor)},
            idempotency_key=idempotency_key,
        )
        return _parse_money_result(payload, prefix="trr_")

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(
        self,
        method: Literal["GET", "POST"],
        path: str,
        *,
        data: dict[str, str] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, object]:
        headers = {
            "Authorization": f"Bearer {self._secret_key}",
            "Stripe-Version": self._api_version,
        }
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        try:
            response = await self._client.request(method, path, data=data, headers=headers)
        except (httpx.TimeoutException, httpx.NetworkError) as error:
            raise StripeOperationError(
                code="provider_timeout", ambiguous=method == "POST"
            ) from error
        if response.status_code >= 500 or response.status_code == 429:
            raise StripeOperationError(code="provider_unavailable", ambiguous=method == "POST")
        if response.status_code >= 400:
            raise StripeOperationError(code="provider_rejected", ambiguous=False)
        if len(response.content) > 262_144:
            raise StripeOperationError(code="oversized_response", ambiguous=False)
        try:
            payload = response.json()
        except ValueError as error:
            raise StripeOperationError(code="invalid_response", ambiguous=False) from error
        if not isinstance(payload, dict):
            raise StripeOperationError(code="invalid_response", ambiguous=False)
        return payload


@dataclass(frozen=True, slots=True)
class StoredConnectAccount:
    tutor_id: UUID
    tutor_actor_ref: str
    provider_account_id: str | None
    environment: Environment | None
    details_submitted: bool
    charges_enabled: bool
    payouts_enabled: bool
    requirements_due: int


@dataclass(frozen=True, slots=True)
class StoredBooking:
    booking_id: UUID
    learner_actor_ref: str
    tutor_id: UUID
    tutor_actor_ref: str
    offering_id: UUID
    state: BookingState
    starts_at: datetime
    ends_at: datetime
    hold_expires_at: datetime
    amount_minor: int
    currency: str
    commission_basis_points: int
    commission_amount_minor: int
    tutor_amount_minor: int
    provider_environment: Environment
    provider_platform_account_id: str
    provider_checkout_id: str | None
    checkout_url: str | None
    meeting_url_snapshot: str | None
    confirmed_at: datetime | None
    schedule_version: int
    money_state: str | None
    completed_at: datetime | None
    dispute_deadline_at: datetime | None


@dataclass(frozen=True, slots=True)
class BookingView:
    booking_id: UUID
    role: Literal["learner", "tutor", "operator"]
    tutor_id: UUID
    state: BookingState
    starts_at: datetime
    ends_at: datetime
    hold_expires_at: datetime
    amount_minor: int
    currency: str
    commission_amount_minor: int
    tutor_amount_minor: int
    checkout_url: str | None
    meeting_url: str | None
    ics: str | None
    schedule_version: int
    money_state: str | None
    dispute_deadline_at: datetime | None


class BookingRepository(Protocol):
    def get_connect_account(self, *, tutor_actor_ref: str) -> StoredConnectAccount | None: ...

    def store_connect_account(
        self, *, tutor_actor_ref: str, account: StripeConnectAccount, environment: Environment
    ) -> StoredConnectAccount | None: ...

    def save_meeting_url(self, *, tutor_actor_ref: str, url: str) -> bool: ...

    def create_hold(
        self,
        *,
        learner_actor_ref: str,
        tutor_id: UUID,
        starts_at: datetime,
        idempotency_key: UUID,
        now: datetime,
        hold_seconds: int,
        environment: Environment,
        platform_account_id: str,
    ) -> StoredBooking | None: ...

    def attach_checkout(
        self, *, booking_id: UUID, learner_actor_ref: str, checkout: StripeCheckout
    ) -> StoredBooking | None: ...

    def mark_checkout_ambiguous(
        self, *, booking_id: UUID, learner_actor_ref: str, reason_code: str
    ) -> StoredBooking | None: ...

    def list_bookings(self, *, actor_ref: str) -> tuple[StoredBooking, ...]: ...

    def get_booking(self, *, booking_id: UUID, actor_ref: str) -> StoredBooking | None: ...

    def apply_checkout_observation(
        self,
        *,
        checkout: StripeCheckout,
        payload_sha256: str | None,
        event_id: str | None,
        event_type: str,
        source: Literal["provider_webhook", "reconciliation"],
        environment: Environment,
        platform_account_id: str,
    ) -> tuple[WebhookOutcome, StoredBooking | None]: ...

    def expire_holds(self, *, now: datetime, limit: int) -> int: ...


class PostgresBookingRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def get_connect_account(self, *, tutor_actor_ref: str) -> StoredConnectAccount | None:
        try:
            with self._engine.connect() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                        SELECT profile.tutor_id, profile.actor_ref AS tutor_actor_ref,
                               account.provider_account_id, account.environment,
                               coalesce(account.details_submitted, false) AS details_submitted,
                               coalesce(account.charges_enabled, false) AS charges_enabled,
                               coalesce(account.payouts_enabled, false) AS payouts_enabled,
                               coalesce(account.safe_requirements_due, 0) AS requirements_due
                        FROM marketplace_tutor_profile AS profile
                        JOIN marketplace_tutor_application AS application
                          ON application.application_id = profile.application_id
                        LEFT JOIN marketplace_tutor_connect_account AS account
                          ON account.tutor_id = profile.tutor_id
                        WHERE profile.actor_ref = :actor_ref AND application.status = 'approved'
                        """
                        ),
                        {"actor_ref": tutor_actor_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                return StoredConnectAccount(**dict(row)) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def store_connect_account(
        self, *, tutor_actor_ref: str, account: StripeConnectAccount, environment: Environment
    ) -> StoredConnectAccount | None:
        expected_live = environment == "PRODUCTION"
        if account.livemode != expected_live:
            return None
        ready = account.details_submitted and account.charges_enabled and account.payouts_enabled
        try:
            with self._engine.begin() as connection:
                tutor_id = connection.execute(
                    text(
                        """
                        SELECT profile.tutor_id
                        FROM marketplace_tutor_profile AS profile
                        JOIN marketplace_tutor_application AS application
                          ON application.application_id = profile.application_id
                        WHERE profile.actor_ref = :actor_ref
                          AND application.status = 'approved'
                        FOR UPDATE OF profile, application
                        """
                    ),
                    {"actor_ref": tutor_actor_ref},
                ).scalar_one_or_none()
                if tutor_id is None:
                    return None
                stored_id = connection.execute(
                    text(
                        """
                        INSERT INTO marketplace_tutor_connect_account
                          (tutor_id, provider_account_id, environment, details_submitted,
                           charges_enabled, payouts_enabled, safe_requirements_due,
                           provider_observed_at)
                        VALUES (:tutor_id, :account_id, :environment, :details_submitted,
                                :charges_enabled, :payouts_enabled, :requirements_due, :observed_at)
                        ON CONFLICT (tutor_id) DO UPDATE SET
                          details_submitted = excluded.details_submitted,
                          charges_enabled = excluded.charges_enabled,
                          payouts_enabled = excluded.payouts_enabled,
                          safe_requirements_due = excluded.safe_requirements_due,
                          provider_observed_at = excluded.provider_observed_at,
                          updated_at = now()
                        WHERE marketplace_tutor_connect_account.provider_account_id =
                              excluded.provider_account_id
                          AND marketplace_tutor_connect_account.environment = excluded.environment
                        RETURNING tutor_id
                        """
                    ),
                    {
                        "tutor_id": tutor_id,
                        "account_id": account.account_id,
                        "environment": environment,
                        "details_submitted": account.details_submitted,
                        "charges_enabled": account.charges_enabled,
                        "payouts_enabled": account.payouts_enabled,
                        "requirements_due": account.requirements_due,
                        "observed_at": account.observed_at,
                    },
                ).scalar_one_or_none()
                if stored_id is None:
                    raise TutorApplicationConflictError
                connection.execute(
                    text("SELECT marketplace_set_connect_payout_readiness(:actor_ref, :ready)"),
                    {"actor_ref": tutor_actor_ref, "ready": ready},
                ).scalar_one()
            return self.get_connect_account(tutor_actor_ref=tutor_actor_ref)
        except IntegrityError as error:
            raise TutorApplicationConflictError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def save_meeting_url(self, *, tutor_actor_ref: str, url: str) -> bool:
        try:
            with self._engine.begin() as connection:
                return (
                    connection.execute(
                        text(
                            """
                        INSERT INTO marketplace_tutor_meeting_config
                          (tutor_id, approved_meeting_url)
                        SELECT profile.tutor_id, :url
                        FROM marketplace_tutor_profile AS profile
                        JOIN marketplace_tutor_application AS application
                          ON application.application_id = profile.application_id
                        WHERE profile.actor_ref = :actor_ref AND application.status = 'approved'
                        ON CONFLICT (tutor_id) DO UPDATE
                        SET approved_meeting_url = excluded.approved_meeting_url,
                            version = marketplace_tutor_meeting_config.version + 1,
                            updated_at = now()
                        RETURNING tutor_id
                        """
                        ),
                        {"actor_ref": tutor_actor_ref, "url": url},
                    ).scalar_one_or_none()
                    is not None
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def create_hold(
        self,
        *,
        learner_actor_ref: str,
        tutor_id: UUID,
        starts_at: datetime,
        idempotency_key: UUID,
        now: datetime,
        hold_seconds: int,
        environment: Environment,
        platform_account_id: str,
    ) -> StoredBooking | None:
        booking_id = uuid4()
        try:
            with self._engine.begin() as connection:
                existing = (
                    connection.execute(
                        text(
                            "SELECT * FROM marketplace_booking WHERE learner_actor_ref = :learner "
                            "AND client_idempotency_key = :key"
                        ),
                        {"learner": learner_actor_ref, "key": idempotency_key},
                    )
                    .mappings()
                    .one_or_none()
                )
                if existing is not None:
                    if existing["tutor_id"] != tutor_id or existing["starts_at"] != starts_at:
                        raise TutorApplicationConflictError
                    return self._booking(existing)
                row = (
                    connection.execute(
                        text(
                            """
                        INSERT INTO marketplace_booking (
                          booking_id, learner_actor_ref, tutor_id, tutor_actor_ref, offering_id,
                          client_idempotency_key, state, starts_at, ends_at, hold_expires_at,
                          amount_minor, currency, commission_basis_points,
                          commission_amount_minor, tutor_amount_minor,
                          commission_policy_id, cancellation_policy_id,
                          cancellation_cutoff_hours, dispute_window_hours,
                          provider_environment, provider_platform_account_id,
                          meeting_url_snapshot)
                        SELECT :booking_id, :learner, profile.tutor_id, profile.actor_ref,
                               offering.offering_id, :key, 'held', :starts_at,
                               :starts_at + make_interval(mins => offering.duration_minutes),
                               :hold_expires_at, offering.amount_minor, offering.currency,
                               commission.commission_basis_points,
                               (offering.amount_minor *
                                commission.commission_basis_points + 5000) / 10000,
                               offering.amount_minor -
                                 ((offering.amount_minor *
                                   commission.commission_basis_points + 5000) / 10000),
                               commission.policy_id, cancellation.policy_id,
                               cancellation.cancellation_cutoff_hours,
                               cancellation.dispute_window_hours, :environment, :platform_account,
                               meeting.approved_meeting_url
                        FROM marketplace_tutor_profile AS profile
                        JOIN marketplace_tutor_application AS application
                          ON application.application_id = profile.application_id
                        JOIN marketplace_tutor_offering AS offering
                          ON offering.tutor_id = profile.tutor_id
                        JOIN marketplace_policy_version AS commission
                          ON commission.policy_id = offering.commission_policy_id
                         AND commission.policy_type = 'commission'
                        JOIN marketplace_policy_version AS cancellation
                          ON cancellation.policy_id = offering.cancellation_policy_id
                         AND cancellation.policy_type = 'cancellation'
                        JOIN marketplace_tutor_connect_account AS account
                          ON account.tutor_id = profile.tutor_id
                        JOIN marketplace_tutor_meeting_config AS meeting
                          ON meeting.tutor_id = profile.tutor_id
                        LEFT JOIN marketplace_calendar_connection AS calendar
                          ON calendar.tutor_id = profile.tutor_id
                        WHERE profile.tutor_id = :tutor_id AND profile.actor_ref <> :learner
                          AND application.status = 'approved' AND profile.is_published
                          AND profile.payout_ready AND offering.state = 'active'
                          AND account.environment = :environment
                          AND account.details_submitted AND account.charges_enabled
                          AND account.payouts_enabled
                          AND (calendar.tutor_id IS NULL OR
                               (calendar.status = 'connected'
                                AND calendar.cache_expires_at > :now))
                        RETURNING *
                        """
                        ),
                        {
                            "booking_id": booking_id,
                            "learner": learner_actor_ref,
                            "tutor_id": tutor_id,
                            "key": idempotency_key,
                            "starts_at": starts_at,
                            "hold_expires_at": now + timedelta(seconds=hold_seconds),
                            "environment": environment,
                            "platform_account": platform_account_id,
                            "now": now,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                connection.execute(
                    text(
                        """
                        INSERT INTO marketplace_booking_transition_audit
                          (audit_id, booking_id, from_state, to_state, source,
                           reason_code, actor_ref)
                        VALUES (:audit_id, :booking_id, NULL, 'held', 'learner',
                                'checkout_requested', :actor_ref)
                        """
                    ),
                    {"audit_id": uuid4(), "booking_id": booking_id, "actor_ref": learner_actor_ref},
                )
                return self._booking(row)
        except TutorApplicationConflictError:
            raise
        except IntegrityError as error:
            raise TutorApplicationConflictError from error
        except DBAPIError as error:
            if getattr(error.orig, "sqlstate", None) == "P0001":
                raise TutorApplicationConflictError from error
            raise DependencyUnavailableError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def attach_checkout(
        self, *, booking_id: UUID, learner_actor_ref: str, checkout: StripeCheckout
    ) -> StoredBooking | None:
        if checkout.booking_id != booking_id:
            return None
        try:
            with self._engine.begin() as connection:
                previous_state = connection.execute(
                    text(
                        "SELECT state FROM marketplace_booking "
                        "WHERE booking_id = :booking_id AND learner_actor_ref = :learner "
                        "FOR UPDATE"
                    ),
                    {"booking_id": booking_id, "learner": learner_actor_ref},
                ).scalar_one_or_none()
                row = (
                    connection.execute(
                        text(
                            """
                        UPDATE marketplace_booking
                        SET state = 'payment_pending', provider_checkout_id = :checkout_id,
                            provider_payment_intent_id = :payment_intent_id,
                            checkout_url = :checkout_url, updated_at = now()
                        WHERE booking_id = :booking_id AND learner_actor_ref = :learner
                          AND state IN ('held', 'payment_ambiguous') AND hold_expires_at > now()
                          AND provider_environment = :environment
                          AND provider_platform_account_id = :platform_account
                        RETURNING *
                        """
                        ),
                        {
                            "booking_id": booking_id,
                            "learner": learner_actor_ref,
                            "checkout_id": checkout.checkout_id,
                            "payment_intent_id": checkout.payment_intent_id,
                            "checkout_url": checkout.url,
                            "environment": "PRODUCTION" if checkout.livemode else "SANDBOX",
                            "platform_account": checkout.platform_account_id,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                assert previous_state in {"held", "payment_ambiguous"}
                self._audit(
                    connection,
                    booking_id,
                    previous_state,
                    "payment_pending",
                    "learner",
                    "checkout_created",
                    learner_actor_ref,
                )
                return self._booking(row)
        except IntegrityError as error:
            raise TutorApplicationConflictError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def mark_checkout_ambiguous(
        self, *, booking_id: UUID, learner_actor_ref: str, reason_code: str
    ) -> StoredBooking | None:
        try:
            with self._engine.begin() as connection:
                existing = (
                    connection.execute(
                        text(
                            "SELECT * FROM marketplace_booking "
                            "WHERE booking_id = :booking_id AND learner_actor_ref = :learner "
                            "FOR UPDATE"
                        ),
                        {"booking_id": booking_id, "learner": learner_actor_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                if existing is not None and existing["state"] == "payment_ambiguous":
                    return self._booking(existing)
                row = (
                    connection.execute(
                        text(
                            """
                        UPDATE marketplace_booking
                        SET state = 'payment_ambiguous', updated_at = now()
                        WHERE booking_id = :booking_id AND learner_actor_ref = :learner
                          AND state = 'held' RETURNING *
                        """
                        ),
                        {"booking_id": booking_id, "learner": learner_actor_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                self._audit(
                    connection, booking_id, "held", "payment_ambiguous", "system", reason_code, None
                )
                connection.execute(
                    text(
                        "INSERT INTO marketplace_payment_reconciliation_job (job_id, booking_id) "
                        "VALUES (:job_id, :booking_id) ON CONFLICT (booking_id) DO NOTHING"
                    ),
                    {"job_id": uuid4(), "booking_id": booking_id},
                )
                return self._booking(row)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def list_bookings(self, *, actor_ref: str) -> tuple[StoredBooking, ...]:
        try:
            with self._engine.connect() as connection:
                operator = connection.execute(
                    text(
                        "SELECT 1 FROM marketplace_operator_capability "
                        "WHERE actor_ref = :actor AND capability = 'manage_bookings' "
                        "AND revoked_at IS NULL"
                    ),
                    {"actor": actor_ref},
                ).scalar_one_or_none()
                return tuple(
                    self._booking(row)
                    for row in connection.execute(
                        text(
                            "SELECT * FROM marketplace_booking WHERE :operator "
                            "OR learner_actor_ref = :actor OR tutor_actor_ref = :actor "
                            "ORDER BY starts_at DESC, booking_id LIMIT 100"
                        ),
                        {"actor": actor_ref, "operator": operator is not None},
                    ).mappings()
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_booking(self, *, booking_id: UUID, actor_ref: str) -> StoredBooking | None:
        try:
            with self._engine.connect() as connection:
                row = (
                    connection.execute(
                        text(
                            "SELECT * FROM marketplace_booking WHERE booking_id = :booking_id "
                            "AND (learner_actor_ref = :actor OR tutor_actor_ref = :actor "
                            "OR EXISTS ("
                            "SELECT 1 FROM marketplace_operator_capability "
                            "WHERE actor_ref = :actor AND capability = 'manage_bookings' "
                            "AND revoked_at IS NULL))"
                        ),
                        {"booking_id": booking_id, "actor": actor_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                return self._booking(row) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def apply_checkout_observation(
        self,
        *,
        checkout: StripeCheckout,
        payload_sha256: str | None,
        event_id: str | None,
        event_type: str,
        source: Literal["provider_webhook", "reconciliation"],
        environment: Environment,
        platform_account_id: str,
    ) -> tuple[WebhookOutcome, StoredBooking | None]:
        try:
            with self._engine.begin() as connection:
                if event_id is not None:
                    existing_hash = connection.execute(
                        text(
                            "SELECT payload_sha256 FROM marketplace_stripe_webhook_event "
                            "WHERE provider_event_id = :event_id"
                        ),
                        {"event_id": event_id},
                    ).scalar_one_or_none()
                    if existing_hash is not None:
                        if existing_hash != payload_sha256:
                            raise TutorApplicationConflictError
                        booking = (
                            connection.execute(
                                text(
                                    "SELECT * FROM marketplace_booking "
                                    "WHERE booking_id = :booking_id"
                                ),
                                {"booking_id": checkout.booking_id},
                            )
                            .mappings()
                            .one_or_none()
                        )
                        return "duplicate", self._booking(booking) if booking is not None else None
                row = (
                    connection.execute(
                        text(
                            "SELECT * FROM marketplace_booking "
                            "WHERE booking_id = :booking_id FOR UPDATE"
                        ),
                        {"booking_id": checkout.booking_id},
                    )
                    .mappings()
                    .one_or_none()
                )
                outcome: WebhookOutcome = "ignored"
                if row is not None and (
                    row["provider_environment"] == environment
                    and row["provider_platform_account_id"] == platform_account_id
                    and checkout.livemode == (environment == "PRODUCTION")
                    and checkout.platform_account_id == platform_account_id
                    and (
                        row["provider_checkout_id"] is None
                        or row["provider_checkout_id"] == checkout.checkout_id
                    )
                ):
                    if (
                        row["provider_event_at"] is not None
                        and checkout.created_at < row["provider_event_at"]
                    ):
                        outcome = "out_of_order"
                    else:
                        target: BookingState | None = None
                        if checkout.status == "complete" and checkout.payment_status == "paid":
                            target = "confirmed"
                        elif checkout.status == "expired":
                            target = "expired"
                        elif event_type == "checkout.session.async_payment_failed":
                            target = "payment_failed"
                        current: BookingState = row["state"]
                        allowed = current in {"payment_pending", "payment_ambiguous"}
                        if target is not None and allowed:
                            confirmed_at = checkout.created_at if target == "confirmed" else None
                            updated = (
                                connection.execute(
                                    text(
                                        """
                                    UPDATE marketplace_booking SET state = :state,
                                      provider_checkout_id = coalesce(
                                        provider_checkout_id, :checkout_id),
                                      provider_payment_intent_id = coalesce(
                                        provider_payment_intent_id, :payment_intent_id),
                                      provider_event_at = :event_at, confirmed_at = :confirmed_at,
                                      money_state = CASE WHEN :state = 'confirmed'
                                        THEN 'charged' ELSE money_state END,
                                      checkout_url = NULL, updated_at = now()
                                    WHERE booking_id = :booking_id RETURNING *
                                    """
                                    ),
                                    {
                                        "state": target,
                                        "checkout_id": checkout.checkout_id,
                                        "payment_intent_id": checkout.payment_intent_id,
                                        "event_at": checkout.created_at,
                                        "confirmed_at": confirmed_at,
                                        "booking_id": checkout.booking_id,
                                    },
                                )
                                .mappings()
                                .one()
                            )
                            self._audit(
                                connection,
                                checkout.booking_id,
                                current,
                                target,
                                source,
                                "verified_payment"
                                if target == "confirmed"
                                else "verified_provider_state",
                                None,
                            )
                            if target == "confirmed":
                                connection.execute(
                                    text(
                                        """
                                        INSERT INTO marketplace_money_ledger
                                          (entry_id, booking_id, operation_id,
                                           kind, amount_minor, currency)
                                        VALUES (:entry_id, :booking_id, NULL,
                                                'charge', :amount_minor, :currency)
                                        ON CONFLICT (booking_id) WHERE kind = 'charge'
                                        DO NOTHING
                                        """
                                    ),
                                    {
                                        "entry_id": uuid4(),
                                        "booking_id": checkout.booking_id,
                                        "amount_minor": row["amount_minor"],
                                        "currency": row["currency"],
                                    },
                                )
                                connection.execute(
                                    text(
                                        """
                                        INSERT INTO marketplace_booking_reminder_job
                                          (job_id, booking_id, kind, available_at)
                                        VALUES
                                          (:reminder_id, :booking_id, 'lesson_reminder',
                                           :starts_at - interval '24 hours'),
                                          (:completion_id, :booking_id, 'completion_prompt',
                                           :ends_at)
                                        ON CONFLICT (booking_id, kind) DO NOTHING
                                        """
                                    ),
                                    {
                                        "reminder_id": uuid4(),
                                        "completion_id": uuid4(),
                                        "booking_id": checkout.booking_id,
                                        "starts_at": row["starts_at"],
                                        "ends_at": row["ends_at"],
                                    },
                                )
                                self._record_confirmation_message(
                                    connection,
                                    booking_id=checkout.booking_id,
                                    learner_actor_ref=row["learner_actor_ref"],
                                    tutor_id=row["tutor_id"],
                                    tutor_actor_ref=row["tutor_actor_ref"],
                                )
                            row = updated
                            outcome = "applied"
                        elif target is not None:
                            outcome = "out_of_order"
                if event_id is not None:
                    assert payload_sha256 is not None
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_stripe_webhook_event
                              (provider_event_id, event_type, payload_sha256,
                               provider_created_at, outcome, booking_id)
                            VALUES (:event_id, :event_type, :payload_sha256,
                                    :created_at, :outcome, :booking_id)
                            """
                        ),
                        {
                            "event_id": event_id,
                            "event_type": event_type,
                            "payload_sha256": payload_sha256,
                            "created_at": checkout.created_at,
                            "outcome": outcome,
                            "booking_id": checkout.booking_id if row is not None else None,
                        },
                    )
                return outcome, self._booking(row) if row is not None else None
        except TutorApplicationConflictError:
            raise
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def expire_holds(self, *, now: datetime, limit: int) -> int:
        try:
            with self._engine.begin() as connection:
                rows = connection.execute(
                    text(
                        """
                        WITH expired AS (
                          SELECT booking_id, state FROM marketplace_booking
                          WHERE state IN ('held', 'payment_pending', 'payment_ambiguous')
                            AND hold_expires_at <= :now
                          ORDER BY hold_expires_at, booking_id FOR UPDATE SKIP LOCKED LIMIT :limit
                        )
                        UPDATE marketplace_booking AS booking
                        SET state = 'expired', checkout_url = NULL, updated_at = :now
                        FROM expired WHERE booking.booking_id = expired.booking_id
                        RETURNING booking.booking_id, expired.state
                        """
                    ),
                    {"now": now, "limit": limit},
                ).all()
                for booking_id, old_state in rows:
                    self._audit(
                        connection, booking_id, old_state, "expired", "system", "hold_expired", None
                    )
                return len(rows)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    @staticmethod
    def _record_confirmation_message(
        connection: object,
        *,
        booking_id: UUID,
        learner_actor_ref: str,
        tutor_id: UUID,
        tutor_actor_ref: str,
    ) -> None:
        from sqlalchemy.engine import Connection

        assert isinstance(connection, Connection)
        conversation_id = connection.execute(
            text(
                """
                UPDATE marketplace_conversation
                SET booking_id = :booking_id, updated_at = now()
                WHERE conversation_id = (
                  SELECT conversation_id FROM marketplace_conversation
                  WHERE learner_actor_ref = :learner AND tutor_id = :tutor_id
                    AND booking_id IS NULL
                  FOR UPDATE
                )
                RETURNING conversation_id
                """
            ),
            {
                "booking_id": booking_id,
                "learner": learner_actor_ref,
                "tutor_id": tutor_id,
            },
        ).scalar_one_or_none()
        if conversation_id is None:
            conversation_id = uuid4()
            connection.execute(
                text(
                    """
                    INSERT INTO marketplace_conversation
                      (conversation_id, learner_actor_ref, tutor_id,
                       tutor_actor_ref, booking_id)
                    VALUES (:conversation_id, :learner, :tutor_id,
                            :tutor_actor_ref, :booking_id)
                    ON CONFLICT (learner_actor_ref, tutor_id, booking_id) DO NOTHING
                    """
                ),
                {
                    "conversation_id": conversation_id,
                    "learner": learner_actor_ref,
                    "tutor_id": tutor_id,
                    "tutor_actor_ref": tutor_actor_ref,
                    "booking_id": booking_id,
                },
            )
            conversation_id = connection.execute(
                text(
                    "SELECT conversation_id FROM marketplace_conversation "
                    "WHERE learner_actor_ref = :learner AND tutor_id = :tutor_id "
                    "AND booking_id = :booking_id"
                ),
                {
                    "learner": learner_actor_ref,
                    "tutor_id": tutor_id,
                    "booking_id": booking_id,
                },
            ).scalar_one()
        connection.execute(
            text(
                """
                INSERT INTO marketplace_message
                  (message_id, conversation_id, sender_actor_ref,
                   kind, body, client_message_id)
                VALUES (:message_id, :conversation_id, NULL, 'system',
                        'Booking confirmed. Meeting details are available in the booking.',
                        :client_message_id)
                ON CONFLICT (conversation_id, client_message_id)
                  WHERE client_message_id IS NOT NULL
                DO NOTHING
                """
            ),
            {
                "message_id": uuid4(),
                "conversation_id": conversation_id,
                "client_message_id": booking_id,
            },
        )

    @staticmethod
    def _audit(
        connection: object,
        booking_id: UUID,
        old: str,
        new: str,
        source: str,
        reason: str,
        actor_ref: str | None,
    ) -> None:
        from sqlalchemy.engine import Connection

        assert isinstance(connection, Connection)
        connection.execute(
            text(
                "INSERT INTO marketplace_booking_transition_audit "
                "(audit_id, booking_id, from_state, to_state, source, reason_code, actor_ref) "
                "VALUES (:audit_id, :booking_id, :old, :new, :source, :reason, :actor_ref)"
            ),
            {
                "audit_id": uuid4(),
                "booking_id": booking_id,
                "old": old,
                "new": new,
                "source": source,
                "reason": reason,
                "actor_ref": actor_ref,
            },
        )

    @staticmethod
    def _booking(row: object) -> StoredBooking:
        from sqlalchemy.engine import RowMapping

        assert isinstance(row, RowMapping)
        return StoredBooking(
            booking_id=row["booking_id"],
            learner_actor_ref=row["learner_actor_ref"],
            tutor_id=row["tutor_id"],
            tutor_actor_ref=row["tutor_actor_ref"],
            offering_id=row["offering_id"],
            state=row["state"],
            starts_at=row["starts_at"],
            ends_at=row["ends_at"],
            hold_expires_at=row["hold_expires_at"],
            amount_minor=row["amount_minor"],
            currency=row["currency"],
            commission_basis_points=row["commission_basis_points"],
            commission_amount_minor=row["commission_amount_minor"],
            tutor_amount_minor=row["tutor_amount_minor"],
            provider_environment=row["provider_environment"],
            provider_platform_account_id=row["provider_platform_account_id"],
            provider_checkout_id=row["provider_checkout_id"],
            checkout_url=row["checkout_url"],
            meeting_url_snapshot=row["meeting_url_snapshot"],
            confirmed_at=row["confirmed_at"],
            schedule_version=row["schedule_version"],
            money_state=row["money_state"],
            completed_at=row["completed_at"],
            dispute_deadline_at=row["dispute_deadline_at"],
        )


class BookingService:
    def __init__(
        self,
        *,
        enabled: bool,
        repository: BookingRepository,
        provider: StripeMarketplaceProvider | None,
        discovery: MarketplaceDiscoveryService,
        pseudonym_key: bytes | None,
        actor_allowlist: tuple[str, ...],
        environment: Environment,
        platform_account_id: str | None,
        connect_refresh_url: str | None,
        connect_return_url: str | None,
        checkout_success_url: str | None,
        checkout_cancel_url: str | None,
        meeting_hosts: tuple[str, ...],
        hold_seconds: int = 600,
    ) -> None:
        self._enabled = enabled
        self._repository = repository
        self._provider = provider
        self._discovery = discovery
        self._pseudonym_key = pseudonym_key
        self._actor_allowlist = frozenset(actor_allowlist)
        self._environment = environment
        self._platform_account_id = platform_account_id
        self._connect_refresh_url = connect_refresh_url
        self._connect_return_url = connect_return_url
        self._checkout_success_url = checkout_success_url
        self._checkout_cancel_url = checkout_cancel_url
        self._meeting_hosts = meeting_hosts
        self._hold_seconds = hold_seconds

    async def connect_status(
        self, *, principal: ClerkPrincipal, refresh: bool
    ) -> StoredConnectAccount:
        actor_ref = self._actor_ref(principal)
        stored = await asyncio.to_thread(
            self._repository.get_connect_account, tutor_actor_ref=actor_ref
        )
        if stored is None:
            raise TutorApplicationNotFoundError
        if stored.provider_account_id is None:
            account = await self._require_provider().create_connect_account(
                idempotency_key=f"connect-account:{stored.tutor_id}"
            )
            stored = await asyncio.to_thread(
                self._repository.store_connect_account,
                tutor_actor_ref=actor_ref,
                account=account,
                environment=self._environment,
            )
        elif refresh:
            account = await self._require_provider().retrieve_connect_account(
                account_id=stored.provider_account_id
            )
            stored = await asyncio.to_thread(
                self._repository.store_connect_account,
                tutor_actor_ref=actor_ref,
                account=account,
                environment=self._environment,
            )
        if stored is None:
            raise HumanTutorMarketplaceUnavailableError
        return stored

    async def onboarding_link(self, *, principal: ClerkPrincipal) -> StripeAccountLink:
        stored = await self.connect_status(principal=principal, refresh=False)
        if (
            stored.provider_account_id is None
            or self._connect_refresh_url is None
            or self._connect_return_url is None
        ):
            raise HumanTutorMarketplaceUnavailableError
        return await self._require_provider().create_account_link(
            account_id=stored.provider_account_id,
            refresh_url=self._connect_refresh_url,
            return_url=self._connect_return_url,
        )

    async def save_meeting_url(self, *, principal: ClerkPrincipal, url: str) -> None:
        safe = validate_approved_meeting_url(url, approved_hosts=self._meeting_hosts)
        if not await asyncio.to_thread(
            self._repository.save_meeting_url, tutor_actor_ref=self._actor_ref(principal), url=safe
        ):
            raise TutorApplicationNotFoundError

    async def create_checkout(
        self,
        *,
        principal: ClerkPrincipal,
        tutor_id: UUID,
        starts_at: datetime,
        idempotency_key: UUID,
    ) -> BookingView:
        actor_ref = self._actor_ref(principal)
        now = datetime.now(UTC)
        if starts_at.tzinfo is None or starts_at <= now or starts_at > now + timedelta(days=31):
            raise TutorApplicationConflictError
        slots = await self._discovery.list_slots(
            principal=principal,
            tutor_id=tutor_id,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=2),
            limit=8,
        )
        if not any(slot.starts_at == starts_at for slot in slots.slots):
            raise TutorApplicationConflictError
        platform = await self._verified_platform_account()
        booking = await asyncio.to_thread(
            self._repository.create_hold,
            learner_actor_ref=actor_ref,
            tutor_id=tutor_id,
            starts_at=starts_at,
            idempotency_key=idempotency_key,
            now=now,
            hold_seconds=self._hold_seconds,
            environment=self._environment,
            platform_account_id=platform,
        )
        if booking is None:
            raise TutorApplicationConflictError
        if booking.state not in {"held", "payment_ambiguous"}:
            return self._view(booking, actor_ref)
        if self._checkout_success_url is None or self._checkout_cancel_url is None:
            raise HumanTutorMarketplaceUnavailableError
        try:
            checkout = await self._require_provider().create_checkout(
                booking_id=booking.booking_id,
                amount_minor=booking.amount_minor,
                currency=booking.currency,
                title="GlideLingo human tutor lesson",
                success_url=self._checkout_success_url,
                cancel_url=self._checkout_cancel_url,
                idempotency_key=f"booking:{booking.booking_id}:checkout",
                platform_account_id=platform,
                environment=self._environment,
            )
        except StripeOperationError as error:
            if not error.ambiguous:
                raise HumanTutorMarketplaceUnavailableError from error
            ambiguous = await asyncio.to_thread(
                self._repository.mark_checkout_ambiguous,
                booking_id=booking.booking_id,
                learner_actor_ref=actor_ref,
                reason_code=error.code,
            )
            if ambiguous is None:
                raise TutorApplicationConflictError from error
            return self._view(ambiguous, actor_ref)
        attached = await asyncio.to_thread(
            self._repository.attach_checkout,
            booking_id=booking.booking_id,
            learner_actor_ref=actor_ref,
            checkout=checkout,
        )
        if attached is None:
            raise TutorApplicationConflictError
        return self._view(attached, actor_ref)

    async def list_bookings(self, *, principal: ClerkPrincipal) -> tuple[BookingView, ...]:
        actor_ref = self._actor_ref(principal)
        values = await asyncio.to_thread(self._repository.list_bookings, actor_ref=actor_ref)
        return tuple(self._view(value, actor_ref) for value in values)

    async def get_booking(self, *, principal: ClerkPrincipal, booking_id: UUID) -> BookingView:
        actor_ref = self._actor_ref(principal)
        booking = await asyncio.to_thread(
            self._repository.get_booking, booking_id=booking_id, actor_ref=actor_ref
        )
        if booking is None:
            raise TutorApplicationNotFoundError
        return self._view(booking, actor_ref)

    async def reconcile(self, *, principal: ClerkPrincipal, booking_id: UUID) -> BookingView:
        actor_ref = self._actor_ref(principal)
        booking = await asyncio.to_thread(
            self._repository.get_booking, booking_id=booking_id, actor_ref=actor_ref
        )
        if booking is None or booking.provider_checkout_id is None:
            raise TutorApplicationConflictError
        checkout = await self._require_provider().retrieve_checkout(
            checkout_id=booking.provider_checkout_id
        )
        _, updated = await asyncio.to_thread(
            self._repository.apply_checkout_observation,
            checkout=checkout,
            payload_sha256=None,
            event_id=None,
            event_type="reconciliation",
            source="reconciliation",
            environment=self._environment,
            platform_account_id=await self._verified_platform_account(),
        )
        if updated is None:
            raise HumanTutorMarketplaceUnavailableError
        return self._view(updated, actor_ref)

    async def apply_webhook(
        self, *, raw_body: bytes, signature: str, webhook_secret: bytes, tolerance_seconds: int
    ) -> WebhookOutcome:
        verify_stripe_signature(
            raw_body=raw_body,
            signature_header=signature,
            secret=webhook_secret,
            now=datetime.now(UTC),
            tolerance_seconds=tolerance_seconds,
        )
        event = parse_checkout_webhook(raw_body)
        if self._platform_account_id is None:
            raise HumanTutorMarketplaceUnavailableError
        outcome, _ = await asyncio.to_thread(
            self._repository.apply_checkout_observation,
            checkout=event.checkout,
            payload_sha256=hashlib.sha256(raw_body).hexdigest(),
            event_id=event.event_id,
            event_type=event.event_type,
            source="provider_webhook",
            environment=self._environment,
            platform_account_id=self._platform_account_id,
        )
        return outcome

    async def expire_holds(self, *, now: datetime, limit: int = 100) -> int:
        self._require_enabled()
        return await asyncio.to_thread(self._repository.expire_holds, now=now, limit=limit)

    async def _verified_platform_account(self) -> str:
        if self._platform_account_id is None:
            raise HumanTutorMarketplaceUnavailableError
        actual = await self._require_provider().get_platform_account_id()
        if not hmac.compare_digest(actual, self._platform_account_id):
            raise HumanTutorMarketplaceUnavailableError
        return actual

    def _actor_ref(self, principal: ClerkPrincipal) -> str:
        self._require_enabled()
        if principal.user_id not in self._actor_allowlist or self._pseudonym_key is None:
            raise HumanTutorMarketplaceForbiddenError
        return derive_marketplace_actor_ref(
            key=self._pseudonym_key, clerk_user_id=principal.user_id
        )

    def _require_enabled(self) -> None:
        if not self._enabled:
            raise HumanTutorMarketplaceUnavailableError

    def _require_provider(self) -> StripeMarketplaceProvider:
        self._require_enabled()
        if self._provider is None:
            raise HumanTutorMarketplaceUnavailableError
        return self._provider

    @staticmethod
    def _view(booking: StoredBooking, actor_ref: str) -> BookingView:
        role: Literal["learner", "tutor", "operator"] = (
            "learner"
            if booking.learner_actor_ref == actor_ref
            else "tutor"
            if booking.tutor_actor_ref == actor_ref
            else "operator"
        )
        confirmed = booking.state in {
            "confirmed",
            "completed",
            "learner_no_show",
            "disputed",
            "resolved_release",
        }
        return BookingView(
            booking_id=booking.booking_id,
            role=role,
            tutor_id=booking.tutor_id,
            state=booking.state,
            starts_at=booking.starts_at,
            ends_at=booking.ends_at,
            hold_expires_at=booking.hold_expires_at,
            amount_minor=booking.amount_minor,
            currency=booking.currency,
            commission_amount_minor=booking.commission_amount_minor,
            tutor_amount_minor=booking.tutor_amount_minor if role in {"tutor", "operator"} else 0,
            checkout_url=booking.checkout_url
            if role == "learner" and booking.state == "payment_pending"
            else None,
            meeting_url=booking.meeting_url_snapshot if confirmed else None,
            ics=build_booking_ics(booking) if confirmed else None,
            schedule_version=booking.schedule_version,
            money_state=booking.money_state,
            dispute_deadline_at=booking.dispute_deadline_at,
        )


@dataclass(frozen=True, slots=True)
class CheckoutWebhook:
    event_id: str
    event_type: str
    checkout: StripeCheckout


def verify_stripe_signature(
    *,
    raw_body: bytes,
    signature_header: str,
    secret: bytes,
    now: datetime,
    tolerance_seconds: int,
) -> None:
    parts: dict[str, list[str]] = {}
    for item in signature_header.split(","):
        key, separator, value = item.partition("=")
        if separator:
            parts.setdefault(key, []).append(value)
    try:
        timestamp = int(parts["t"][0])
    except (KeyError, ValueError):
        raise HumanTutorMarketplaceForbiddenError from None
    if abs(int(now.timestamp()) - timestamp) > tolerance_seconds:
        raise HumanTutorMarketplaceForbiddenError
    signed = str(timestamp).encode() + b"." + raw_body
    expected = hmac.new(secret, signed, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, candidate) for candidate in parts.get("v1", ())):
        raise HumanTutorMarketplaceForbiddenError


def parse_checkout_webhook(raw_body: bytes) -> CheckoutWebhook:
    try:
        value = json.loads(raw_body)
        event_id = _required_provider_id(value, "id", "evt_")
        event_type = value["type"]
        created = value["created"]
        data_object = value["data"]["object"]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, StripeOperationError):
        raise TutorApplicationConflictError from None
    if (
        event_type
        not in {
            "checkout.session.completed",
            "checkout.session.async_payment_succeeded",
            "checkout.session.async_payment_failed",
            "checkout.session.expired",
        }
        or not isinstance(created, int)
        or not isinstance(data_object, dict)
    ):
        raise TutorApplicationConflictError
    checkout = replace(
        _parse_checkout(data_object, fallback_created=created),
        created_at=datetime.fromtimestamp(created, UTC),
    )
    return CheckoutWebhook(event_id=event_id, event_type=event_type, checkout=checkout)


def _parse_connect_account(value: dict[str, object]) -> StripeConnectAccount:
    account_id = _required_provider_id(value, "id", "acct_")
    livemode = value.get("livemode")
    details = value.get("details_submitted")
    charges = value.get("charges_enabled")
    payouts = value.get("payouts_enabled")
    requirements = value.get("requirements")
    if not all(isinstance(item, bool) for item in (livemode, details, charges, payouts)):
        raise StripeOperationError(code="invalid_response", ambiguous=False)
    due = requirements.get("currently_due", []) if isinstance(requirements, dict) else []
    if not isinstance(due, list) or len(due) > 100:
        raise StripeOperationError(code="invalid_response", ambiguous=False)
    return StripeConnectAccount(
        account_id,
        bool(livemode),
        bool(details),
        bool(charges),
        bool(payouts),
        len(due),
        datetime.now(UTC),
    )


def _parse_money_result(value: dict[str, object], *, prefix: str) -> StripeMoneyResult:
    operation_id = _required_provider_id(value, "id", prefix)
    livemode = value.get("livemode")
    amount = value.get("amount")
    currency = value.get("currency")
    if (
        not isinstance(livemode, bool)
        or not isinstance(amount, int)
        or amount <= 0
        or amount > 50_000
        or currency != "usd"
    ):
        raise StripeOperationError(code="invalid_response", ambiguous=False)
    return StripeMoneyResult(operation_id, livemode, amount, currency.upper())


def _parse_checkout(
    value: dict[str, object], *, fallback_created: int | None = None
) -> StripeCheckout:
    checkout_id = _required_provider_id(value, "id", "cs_")
    url = value.get("url")
    payment_intent = value.get("payment_intent")
    status = value.get("status")
    payment_status = value.get("payment_status")
    livemode = value.get("livemode")
    metadata = value.get("metadata")
    created = value.get("created", fallback_created)
    if (
        not (url is None or isinstance(url, str) and _is_https_stripe_url(url))
        or not (
            payment_intent is None
            or isinstance(payment_intent, str)
            and payment_intent.startswith("pi_")
        )
        or status not in {"open", "complete", "expired"}
        or payment_status not in {"unpaid", "paid", "no_payment_required"}
        or not isinstance(livemode, bool)
        or not isinstance(metadata, dict)
        or not isinstance(created, int)
    ):
        raise StripeOperationError(code="invalid_response", ambiguous=False)
    try:
        booking_id = UUID(str(metadata["booking_id"]))
        platform = str(metadata["platform_account_id"])
        environment = str(metadata["environment"])
    except (KeyError, ValueError):
        raise StripeOperationError(code="invalid_response", ambiguous=False) from None
    if (
        not platform.startswith("acct_")
        or environment not in {"SANDBOX", "PRODUCTION"}
        or (environment == "PRODUCTION") != livemode
    ):
        raise StripeOperationError(code="invalid_response", ambiguous=False)
    return StripeCheckout(
        checkout_id,
        url,
        payment_intent,
        cast(Literal["open", "complete", "expired"], status),
        cast(Literal["unpaid", "paid", "no_payment_required"], payment_status),
        livemode,
        booking_id,
        platform,
        datetime.fromtimestamp(created, UTC),
    )


def _required_provider_id(value: object, key: str, prefix: str) -> str:
    if not isinstance(value, dict):
        raise StripeOperationError(code="invalid_response", ambiguous=False)
    result = value.get(key)
    if not isinstance(result, str) or not result.startswith(prefix) or not 8 <= len(result) <= 255:
        raise StripeOperationError(code="invalid_response", ambiguous=False)
    return result


def _is_https_stripe_url(value: str) -> bool:
    parsed = urlsplit(value)
    return parsed.scheme == "https" and parsed.hostname in {
        "checkout.stripe.com",
        "connect.stripe.com",
    }


def build_booking_ics(booking: StoredBooking) -> str:
    def stamp(value: datetime) -> str:
        return value.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")

    return "\r\n".join(
        (
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//GlideLingo//Human Tutor//EN",
            "BEGIN:VEVENT",
            f"UID:{booking.booking_id}@glidelingo.com",
            f"DTSTART:{stamp(booking.starts_at)}",
            f"DTEND:{stamp(booking.ends_at)}",
            "SUMMARY:GlideLingo human tutor lesson",
            "END:VEVENT",
            "END:VCALENDAR",
            "",
        )
    )
