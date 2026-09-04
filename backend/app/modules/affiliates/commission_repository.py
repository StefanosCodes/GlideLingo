"""Transactional, append-only affiliate commission ledger persistence."""

import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID, uuid4

from sqlalchemy import Connection, Engine, RowMapping, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import DependencyUnavailableError
from app.modules.affiliates.commission_domain import (
    CommissionApplyResult,
    CommissionApplyStatus,
    CommissionEntryKind,
    CommissionLedgerEntry,
    CommissionPolicyUnavailableError,
    CommissionSourceUnavailableError,
    commission_amount_minor,
)

PURCHASE_EVENTS = frozenset({"INITIAL_PURCHASE", "NON_RENEWING_PURCHASE", "RENEWAL"})
REFUND_EVENT = "REFUND"
REINSTATEMENT_EVENT = "REFUND_REVERSED"


class AffiliateCommissionRepository(Protocol):
    def apply_billing_event(
        self, *, event_ref: UUID, principal_ref: str | None, processed_at: datetime
    ) -> CommissionApplyResult: ...

    def list_creator_entries(
        self, *, creator_id: UUID, before: datetime | None, limit: int
    ) -> Sequence[CommissionLedgerEntry]: ...


class PostgresAffiliateCommissionRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def apply_billing_event(
        self, *, event_ref: UUID, principal_ref: str | None, processed_at: datetime
    ) -> CommissionApplyResult:
        try:
            with self._engine.begin() as connection:
                if connection.execute(
                    text(
                        "SELECT EXISTS (SELECT 1 FROM affiliate_commission_entry "
                        "WHERE source_event_ref = :event_ref)"
                    ),
                    {"event_ref": event_ref},
                ).scalar_one():
                    return CommissionApplyResult(status=CommissionApplyStatus.DUPLICATE)

                event = (
                    connection.execute(
                        text(
                            """
                            SELECT provider, environment, provider_account_ref, event_type,
                                   occurred_at, object_refs
                            FROM billing_event_inbox
                            WHERE event_ref = :event_ref
                            FOR SHARE
                            """
                        ),
                        {"event_ref": event_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                if event is None:
                    raise CommissionSourceUnavailableError
                event_type = event["event_type"]
                if event_type not in PURCHASE_EVENTS | {REFUND_EVENT, REINSTATEMENT_EVENT}:
                    return CommissionApplyResult(status=CommissionApplyStatus.IGNORED)

                object_refs = dict(event["object_refs"])
                transaction_ref = object_refs.get("transaction")
                if not isinstance(transaction_ref, str) or not transaction_ref:
                    raise CommissionSourceUnavailableError
                connection.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:transaction_scope, 2))"),
                    {
                        "transaction_scope": json.dumps(
                            [
                                event["provider"],
                                event["environment"],
                                event["provider_account_ref"],
                                transaction_ref,
                            ],
                            ensure_ascii=True,
                            separators=(",", ":"),
                        )
                    },
                )

                if event_type in PURCHASE_EVENTS:
                    if principal_ref is None:
                        raise CommissionSourceUnavailableError
                    return self._accrue(
                        connection=connection,
                        event_ref=event_ref,
                        principal_ref=principal_ref,
                        event=event,
                        object_refs=object_refs,
                        transaction_ref=transaction_ref,
                        processed_at=processed_at,
                    )
                return self._reverse(
                    connection=connection,
                    event_ref=event_ref,
                    event=event,
                    transaction_ref=transaction_ref,
                    processed_at=processed_at,
                    reinstatement=event_type == REINSTATEMENT_EVENT,
                )
        except (CommissionPolicyUnavailableError, CommissionSourceUnavailableError):
            raise
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    @staticmethod
    def _accrue(
        *,
        connection: Connection,
        event_ref: UUID,
        principal_ref: str,
        event: RowMapping,
        object_refs: dict[str, Any],
        transaction_ref: str,
        processed_at: datetime,
    ) -> CommissionApplyResult:
        execute = connection.execute
        attribution = (
            execute(
                text(
                    """
                    UPDATE affiliate_attribution
                    SET state = 'locked', locked_at = :occurred_at,
                        lock_reference = :lock_reference, updated_at = :processed_at
                    WHERE principal_ref = :principal_ref
                      AND state = 'bound'
                      AND locked_at IS NULL
                      AND bound_at <= :occurred_at
                    RETURNING id, creator_id, program_version_id
                    """
                ),
                {
                    "principal_ref": principal_ref,
                    "occurred_at": event["occurred_at"],
                    "processed_at": processed_at,
                    "lock_reference": f"billing_event:{event_ref}",
                },
            )
            .mappings()
            .one_or_none()
        )
        if attribution is None:
            attribution = (
                execute(
                    text(
                        """
                        SELECT id, creator_id, program_version_id
                        FROM affiliate_attribution
                        WHERE principal_ref = :principal_ref
                          AND state IN ('locked', 'corrected')
                          AND locked_at IS NOT NULL
                          AND bound_at <= :occurred_at
                        FOR SHARE
                        """
                    ),
                    {
                        "principal_ref": principal_ref,
                        "occurred_at": event["occurred_at"],
                    },
                )
                .mappings()
                .one_or_none()
            )
        if attribution is None:
            return CommissionApplyResult(status=CommissionApplyStatus.INELIGIBLE)

        product_ref = object_refs.get("product")
        if not isinstance(product_ref, str) or not product_ref:
            raise CommissionPolicyUnavailableError
        rule = (
            execute(
                text(
                    """
                    SELECT policy.id AS policy_id, rule.id AS rule_id,
                           rule.currency_code, rule.basis_amount_minor,
                           rule.commission_rate_basis_points
                    FROM affiliate_commission_policy AS policy
                    JOIN affiliate_commission_rule AS rule ON rule.policy_id = policy.id
                    WHERE policy.program_version_id = :program_version_id
                      AND policy.status = 'active'
                      AND policy.effective_from <= :occurred_at
                      AND (policy.effective_until IS NULL OR policy.effective_until > :occurred_at)
                      AND rule.product_ref = :product_ref
                    """
                ),
                {
                    "program_version_id": attribution["program_version_id"],
                    "occurred_at": event["occurred_at"],
                    "product_ref": product_ref,
                },
            )
            .mappings()
            .one_or_none()
        )
        if rule is None:
            raise CommissionPolicyUnavailableError
        commission_minor = commission_amount_minor(
            basis_amount_minor=rule["basis_amount_minor"],
            rate_basis_points=rule["commission_rate_basis_points"],
        )
        inserted = execute(
            text(
                """
                INSERT INTO affiliate_commission_entry
                  (id, source_event_ref, attribution_id, creator_id, program_version_id,
                   policy_id, rule_id, provider, environment, provider_account_ref,
                   provider_transaction_ref, entry_kind, currency_code, basis_amount_minor,
                   commission_rate_basis_points, commission_amount_minor, occurred_at,
                   recorded_at)
                VALUES
                  (:id, :source_event_ref, :attribution_id, :creator_id, :program_version_id,
                   :policy_id, :rule_id, :provider, :environment, :provider_account_ref,
                   :provider_transaction_ref, 'accrual', :currency_code, :basis_amount_minor,
                   :commission_rate_basis_points, :commission_amount_minor, :occurred_at,
                   :recorded_at)
                ON CONFLICT DO NOTHING
                RETURNING id
                """
            ),
            {
                "id": uuid4(),
                "source_event_ref": event_ref,
                "attribution_id": attribution["id"],
                "creator_id": attribution["creator_id"],
                "program_version_id": attribution["program_version_id"],
                "policy_id": rule["policy_id"],
                "rule_id": rule["rule_id"],
                "provider": event["provider"],
                "environment": event["environment"],
                "provider_account_ref": event["provider_account_ref"],
                "provider_transaction_ref": transaction_ref,
                "currency_code": rule["currency_code"],
                "basis_amount_minor": rule["basis_amount_minor"],
                "commission_rate_basis_points": rule["commission_rate_basis_points"],
                "commission_amount_minor": commission_minor,
                "occurred_at": event["occurred_at"],
                "recorded_at": processed_at,
            },
        ).scalar_one_or_none()
        return CommissionApplyResult(
            status=(
                CommissionApplyStatus.ACCRUED
                if inserted is not None
                else CommissionApplyStatus.DUPLICATE
            )
        )

    @staticmethod
    def _reverse(
        *,
        connection: Connection,
        event_ref: UUID,
        event: RowMapping,
        transaction_ref: str,
        processed_at: datetime,
        reinstatement: bool,
    ) -> CommissionApplyResult:
        execute = connection.execute
        source_kind = "refund" if reinstatement else "accrual"
        target_kind = "reinstatement" if reinstatement else "refund"
        source = (
            execute(
                text(
                    """
                    SELECT *
                    FROM affiliate_commission_entry
                    WHERE provider = :provider
                      AND environment = :environment
                      AND provider_account_ref = :provider_account_ref
                      AND provider_transaction_ref = :provider_transaction_ref
                      AND entry_kind = :source_kind
                    FOR SHARE
                    """
                ),
                {
                    "provider": event["provider"],
                    "environment": event["environment"],
                    "provider_account_ref": event["provider_account_ref"],
                    "provider_transaction_ref": transaction_ref,
                    "source_kind": source_kind,
                },
            )
            .mappings()
            .one_or_none()
        )
        if source is None:
            raise CommissionSourceUnavailableError
        inserted = execute(
            text(
                """
                INSERT INTO affiliate_commission_entry
                  (id, source_event_ref, attribution_id, creator_id, program_version_id,
                   policy_id, rule_id, provider, environment, provider_account_ref,
                   provider_transaction_ref, entry_kind, currency_code, basis_amount_minor,
                   commission_rate_basis_points, commission_amount_minor, reverses_entry_id,
                   occurred_at, recorded_at)
                VALUES
                  (:id, :source_event_ref, :attribution_id, :creator_id, :program_version_id,
                   :policy_id, :rule_id, :provider, :environment, :provider_account_ref,
                   :provider_transaction_ref, :entry_kind, :currency_code, :basis_amount_minor,
                   :commission_rate_basis_points, :commission_amount_minor, :reverses_entry_id,
                   :occurred_at, :recorded_at)
                ON CONFLICT DO NOTHING
                RETURNING id
                """
            ),
            {
                "id": uuid4(),
                "source_event_ref": event_ref,
                "attribution_id": source["attribution_id"],
                "creator_id": source["creator_id"],
                "program_version_id": source["program_version_id"],
                "policy_id": source["policy_id"],
                "rule_id": source["rule_id"],
                "provider": source["provider"],
                "environment": source["environment"],
                "provider_account_ref": source["provider_account_ref"],
                "provider_transaction_ref": source["provider_transaction_ref"],
                "entry_kind": target_kind,
                "currency_code": source["currency_code"],
                "basis_amount_minor": -source["basis_amount_minor"],
                "commission_rate_basis_points": source["commission_rate_basis_points"],
                "commission_amount_minor": -source["commission_amount_minor"],
                "reverses_entry_id": source["id"],
                "occurred_at": event["occurred_at"],
                "recorded_at": processed_at,
            },
        ).scalar_one_or_none()
        if inserted is None:
            return CommissionApplyResult(status=CommissionApplyStatus.DUPLICATE)
        return CommissionApplyResult(
            status=(
                CommissionApplyStatus.REINSTATED
                if reinstatement
                else CommissionApplyStatus.REFUNDED
            )
        )

    def list_creator_entries(
        self, *, creator_id: UUID, before: datetime | None, limit: int
    ) -> Sequence[CommissionLedgerEntry]:
        try:
            with self._engine.connect() as connection:
                rows = (
                    connection.execute(
                        text(
                            """
                            SELECT id, entry_kind, currency_code, basis_amount_minor,
                                   commission_amount_minor, occurred_at
                            FROM affiliate_commission_entry
                            WHERE creator_id = :creator_id
                              AND (CAST(:before AS timestamptz) IS NULL OR occurred_at < :before)
                            ORDER BY occurred_at DESC, id DESC
                            LIMIT :limit
                            """
                        ),
                        {"creator_id": creator_id, "before": before, "limit": limit},
                    )
                    .mappings()
                    .all()
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
        return [
            CommissionLedgerEntry(
                entry_id=row["id"],
                kind=CommissionEntryKind(row["entry_kind"]),
                currency_code=row["currency_code"],
                basis_amount_minor=row["basis_amount_minor"],
                commission_amount_minor=row["commission_amount_minor"],
                occurred_at=row["occurred_at"],
            )
            for row in rows
        ]
