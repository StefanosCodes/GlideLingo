"""PostgreSQL persistence for the minimum server-owned entitlement state."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import DependencyUnavailableError
from app.modules.billing.schemas import RevenueCatEnvironment

type WebhookApplyStatus = Literal["applied", "duplicate", "out_of_order"]


@dataclass(frozen=True, slots=True)
class StoredProEntitlement:
    actor_ref: str
    environment: RevenueCatEnvironment
    is_active: bool
    expires_at: datetime | None
    provider_event_at: datetime
    verified_at: datetime


class EntitlementRepository(Protocol):
    def get_pro(
        self, *, actor_ref: str, environment: RevenueCatEnvironment
    ) -> StoredProEntitlement | None: ...

    def has_webhook_event(self, *, event_id: str) -> bool: ...

    def store_reconciliation(
        self,
        *,
        actor_ref: str,
        environment: RevenueCatEnvironment,
        is_active: bool,
        expires_at: datetime | None,
        observed_at: datetime,
    ) -> StoredProEntitlement: ...

    def record_webhook_snapshot(
        self,
        *,
        event_id: str,
        actor_ref: str,
        environment: RevenueCatEnvironment,
        event_at: datetime,
        is_active: bool,
        expires_at: datetime | None,
        verified_at: datetime,
    ) -> WebhookApplyStatus: ...


class PostgresEntitlementRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def get_pro(
        self, *, actor_ref: str, environment: RevenueCatEnvironment
    ) -> StoredProEntitlement | None:
        try:
            with self._engine.connect() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            SELECT actor_ref, environment, is_active, expires_at,
                                   provider_event_at, verified_at
                            FROM revenuecat_entitlement_state
                            WHERE actor_ref = :actor_ref
                              AND entitlement_id = 'pro'
                              AND environment = :environment
                            """
                        ),
                        {"actor_ref": actor_ref, "environment": environment},
                    )
                    .mappings()
                    .one_or_none()
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
        if row is None:
            return None
        return StoredProEntitlement(
            actor_ref=row["actor_ref"],
            environment=row["environment"],
            is_active=row["is_active"],
            expires_at=row["expires_at"],
            provider_event_at=row["provider_event_at"],
            verified_at=row["verified_at"],
        )

    def has_webhook_event(self, *, event_id: str) -> bool:
        try:
            with self._engine.connect() as connection:
                return bool(
                    connection.execute(
                        text(
                            "SELECT EXISTS (SELECT 1 FROM revenuecat_webhook_event "
                            "WHERE event_id = :event_id)"
                        ),
                        {"event_id": event_id},
                    ).scalar_one()
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def store_reconciliation(
        self,
        *,
        actor_ref: str,
        environment: RevenueCatEnvironment,
        is_active: bool,
        expires_at: datetime | None,
        observed_at: datetime,
    ) -> StoredProEntitlement:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            INSERT INTO revenuecat_entitlement_state
                              (actor_ref, entitlement_id, environment, is_active, expires_at,
                               provider_event_at, verified_at)
                            VALUES
                              (:actor_ref, 'pro', :environment, :is_active, :expires_at,
                               :observed_at, :observed_at)
                            ON CONFLICT (actor_ref, entitlement_id, environment) DO UPDATE
                            SET is_active = EXCLUDED.is_active,
                                expires_at = EXCLUDED.expires_at,
                                provider_event_at = EXCLUDED.provider_event_at,
                                verified_at = EXCLUDED.verified_at,
                                updated_at = now()
                            WHERE revenuecat_entitlement_state.provider_event_at
                                  <= EXCLUDED.provider_event_at
                            RETURNING actor_ref, environment, is_active, expires_at,
                                      provider_event_at, verified_at
                            """
                        ),
                        {
                            "actor_ref": actor_ref,
                            "environment": environment,
                            "is_active": is_active,
                            "expires_at": expires_at,
                            "observed_at": observed_at,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    row = (
                        connection.execute(
                            text(
                                """
                                SELECT actor_ref, environment, is_active, expires_at,
                                       provider_event_at, verified_at
                                FROM revenuecat_entitlement_state
                                WHERE actor_ref = :actor_ref
                                  AND entitlement_id = 'pro'
                                  AND environment = :environment
                                """
                            ),
                            {"actor_ref": actor_ref, "environment": environment},
                        )
                        .mappings()
                        .one()
                    )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
        return StoredProEntitlement(
            actor_ref=row["actor_ref"],
            environment=row["environment"],
            is_active=row["is_active"],
            expires_at=row["expires_at"],
            provider_event_at=row["provider_event_at"],
            verified_at=row["verified_at"],
        )

    def record_webhook_snapshot(
        self,
        *,
        event_id: str,
        actor_ref: str,
        environment: RevenueCatEnvironment,
        event_at: datetime,
        is_active: bool,
        expires_at: datetime | None,
        verified_at: datetime,
    ) -> WebhookApplyStatus:
        try:
            with self._engine.begin() as connection:
                event_inserted = connection.execute(
                    text(
                        """
                        INSERT INTO revenuecat_webhook_event
                          (event_id, environment, actor_ref, event_at)
                        VALUES (:event_id, :environment, :actor_ref, :event_at)
                        ON CONFLICT (event_id) DO NOTHING
                        """
                    ),
                    {
                        "event_id": event_id,
                        "environment": environment,
                        "actor_ref": actor_ref,
                        "event_at": event_at,
                    },
                )
                if event_inserted.rowcount == 0:
                    return "duplicate"
                state_result = connection.execute(
                    text(
                        """
                        INSERT INTO revenuecat_entitlement_state
                          (actor_ref, entitlement_id, environment, is_active, expires_at,
                           provider_event_at, verified_at)
                        VALUES
                          (:actor_ref, 'pro', :environment, :is_active, :expires_at,
                           :event_at, :verified_at)
                        ON CONFLICT (actor_ref, entitlement_id, environment) DO UPDATE
                        SET is_active = EXCLUDED.is_active,
                            expires_at = EXCLUDED.expires_at,
                            provider_event_at = EXCLUDED.provider_event_at,
                            verified_at = EXCLUDED.verified_at,
                            updated_at = now()
                        WHERE revenuecat_entitlement_state.provider_event_at
                              <= EXCLUDED.provider_event_at
                        """
                    ),
                    {
                        "actor_ref": actor_ref,
                        "environment": environment,
                        "is_active": is_active,
                        "expires_at": expires_at,
                        "event_at": event_at,
                        "verified_at": verified_at,
                    },
                )
                return "applied" if state_result.rowcount == 1 else "out_of_order"
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
