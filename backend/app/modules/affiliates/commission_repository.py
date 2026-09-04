"""Transactional affiliate financial-fact intake and append-only commission ledger."""

import json
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID, uuid4

from sqlalchemy import Connection, Engine, RowMapping, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import DependencyUnavailableError
from app.modules.affiliates.commission_domain import (
    AuthenticatedFinancialFact,
    CommissionApplyResult,
    CommissionApplyStatus,
    CommissionCursor,
    CommissionEntryKind,
    CommissionFactConflictError,
    CommissionLedgerEntry,
    CommissionLedgerPage,
    CommissionPolicyUnavailableError,
    CommissionReversalConflictError,
    CommissionSourceUnavailableError,
    FinancialFactKind,
    commission_amount_minor,
    encode_commission_cursor,
)


class AffiliateCommissionRepository(Protocol):
    def accept_financial_fact(
        self, *, fact: AuthenticatedFinancialFact, processed_at: datetime
    ) -> CommissionApplyResult: ...

    def list_creator_entries(
        self, *, creator_id: UUID, cursor: CommissionCursor | None, limit: int
    ) -> CommissionLedgerPage: ...


class PostgresAffiliateCommissionRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def accept_financial_fact(
        self, *, fact: AuthenticatedFinancialFact, processed_at: datetime
    ) -> CommissionApplyResult:
        """Accept only an authenticated Stripe fact; no provider call occurs here."""

        try:
            with self._engine.begin() as connection:
                self._lock_fact_scopes(connection=connection, fact=fact)
                stored, exact_replay = self._accept_fact(
                    connection=connection,
                    fact=fact,
                    processed_at=processed_at,
                )
                if exact_replay:
                    return CommissionApplyResult(status=CommissionApplyStatus.DUPLICATE)
                if stored["fact_kind"] == FinancialFactKind.PURCHASE:
                    return self._accrue(
                        connection=connection,
                        fact=stored,
                        processed_at=processed_at,
                    )
                return self._reverse(
                    connection=connection,
                    fact=stored,
                    processed_at=processed_at,
                    reinstatement=stored["fact_kind"] == FinancialFactKind.REFUND_REVERSAL,
                )
        except (
            CommissionFactConflictError,
            CommissionPolicyUnavailableError,
            CommissionReversalConflictError,
            CommissionSourceUnavailableError,
        ):
            raise
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    @staticmethod
    def _lock_fact_scopes(*, connection: Connection, fact: AuthenticatedFinancialFact) -> None:
        event_scope = json.dumps(
            ["stripe-event", fact.environment, fact.provider_account_ref, fact.provider_event_id],
            separators=(",", ":"),
        )
        connection.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:scope, 3))"),
            {"scope": event_scope},
        )
        transaction_refs = {fact.provider_transaction_ref}
        if fact.reverses_provider_transaction_ref is not None:
            transaction_refs.add(fact.reverses_provider_transaction_ref)
        for transaction_ref in sorted(transaction_refs):
            transaction_scope = json.dumps(
                [
                    "stripe-transaction",
                    fact.environment,
                    fact.provider_account_ref,
                    transaction_ref,
                ],
                separators=(",", ":"),
            )
            connection.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:scope, 4))"),
                {"scope": transaction_scope},
            )

    @staticmethod
    def _accept_fact(
        *,
        connection: Connection,
        fact: AuthenticatedFinancialFact,
        processed_at: datetime,
    ) -> tuple[RowMapping, bool]:
        values = {
            "id": uuid4(),
            "environment": fact.environment,
            "provider_account_ref": fact.provider_account_ref,
            "provider_event_id": fact.provider_event_id,
            "provider_transaction_ref": fact.provider_transaction_ref,
            "fact_kind": fact.kind,
            "occurred_at": fact.occurred_at,
            "principal_ref": fact.principal_ref,
            "product_ref": fact.product_ref,
            "currency_code": fact.currency_code,
            "gross_amount_minor": fact.gross_amount_minor,
            "reverses_provider_transaction_ref": fact.reverses_provider_transaction_ref,
            "payload_sha256": fact.payload_sha256,
            "recorded_at": processed_at,
        }
        inserted = (
            connection.execute(
                text(
                    """
                    INSERT INTO affiliate_financial_fact
                      (id, provider, environment, provider_account_ref, provider_event_id,
                       provider_transaction_ref, fact_kind, occurred_at, principal_ref,
                       product_ref, currency_code, gross_amount_minor,
                       reverses_provider_transaction_ref, payload_sha256, recorded_at)
                    VALUES
                      (:id, 'stripe', :environment, :provider_account_ref, :provider_event_id,
                       :provider_transaction_ref, :fact_kind, :occurred_at, :principal_ref,
                       :product_ref, :currency_code, :gross_amount_minor,
                       :reverses_provider_transaction_ref, :payload_sha256, :recorded_at)
                    ON CONFLICT DO NOTHING
                    RETURNING *
                    """
                ),
                values,
            )
            .mappings()
            .one_or_none()
        )
        if inserted is not None:
            return inserted, False

        by_event = (
            connection.execute(
                text(
                    """
                    SELECT * FROM affiliate_financial_fact
                    WHERE provider = 'stripe'
                      AND environment = :environment
                      AND provider_account_ref = :provider_account_ref
                      AND provider_event_id = :provider_event_id
                    FOR SHARE
                    """
                ),
                values,
            )
            .mappings()
            .one_or_none()
        )
        if by_event is not None:
            if PostgresAffiliateCommissionRepository._fact_matches(stored=by_event, fact=fact):
                return by_event, True
            raise CommissionFactConflictError

        by_transaction = connection.execute(
            text(
                """
                SELECT 1 FROM affiliate_financial_fact
                WHERE provider = 'stripe'
                  AND environment = :environment
                  AND provider_account_ref = :provider_account_ref
                  AND provider_transaction_ref = :provider_transaction_ref
                """
            ),
            values,
        ).first()
        if by_transaction is not None:
            raise CommissionFactConflictError
        raise DependencyUnavailableError

    @staticmethod
    def _fact_matches(*, stored: RowMapping, fact: AuthenticatedFinancialFact) -> bool:
        return all(
            (
                stored["fact_kind"] == fact.kind,
                stored["provider_transaction_ref"] == fact.provider_transaction_ref,
                stored["occurred_at"] == fact.occurred_at,
                stored["principal_ref"] == fact.principal_ref,
                stored["product_ref"] == fact.product_ref,
                stored["currency_code"] == fact.currency_code,
                stored["gross_amount_minor"] == fact.gross_amount_minor,
                stored["reverses_provider_transaction_ref"]
                == fact.reverses_provider_transaction_ref,
                stored["payload_sha256"] == fact.payload_sha256,
            )
        )

    @staticmethod
    def _accrue(
        *, connection: Connection, fact: RowMapping, processed_at: datetime
    ) -> CommissionApplyResult:
        principal_ref = fact["principal_ref"]
        product_ref = fact["product_ref"]
        if not isinstance(principal_ref, str) or not isinstance(product_ref, str):
            raise CommissionFactConflictError
        # Referral binding uses this same principal-scoped lock. The fact's occurrence
        # time selects the half-open attribution interval, even when reconciliation
        # happens after a newer attribution has replaced it.
        connection.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:principal_ref, 0))"),
            {"principal_ref": principal_ref},
        )
        attribution = (
            connection.execute(
                text(
                    """
                    SELECT id, creator_id, program_version_id, state, locked_at
                    FROM affiliate_attribution
                    WHERE principal_ref = :principal_ref
                      AND bound_at <= :occurred_at
                      AND (replaced_at IS NULL OR replaced_at > :occurred_at)
                    ORDER BY bound_at DESC, id DESC
                    LIMIT 1
                    FOR UPDATE
                    """
                ),
                {
                    "principal_ref": principal_ref,
                    "occurred_at": fact["occurred_at"],
                },
            )
            .mappings()
            .one_or_none()
        )
        if attribution is None:
            return CommissionApplyResult(status=CommissionApplyStatus.INELIGIBLE)

        if attribution["locked_at"] is None:
            next_state = "locked" if attribution["state"] == "bound" else attribution["state"]
            attribution = (
                connection.execute(
                    text(
                        """
                        UPDATE affiliate_attribution
                        SET state = :next_state, locked_at = :occurred_at,
                            lock_reference = :lock_reference, updated_at = :processed_at
                        WHERE id = :attribution_id
                          AND locked_at IS NULL
                        RETURNING id, creator_id, program_version_id, state, locked_at
                        """
                    ),
                    {
                        "attribution_id": attribution["id"],
                        "next_state": next_state,
                        "occurred_at": fact["occurred_at"],
                        "processed_at": processed_at,
                        "lock_reference": f"financial_fact:{fact['id']}",
                    },
                )
                .mappings()
                .one()
            )

        # Policy rotation uses this program-version lock. Delayed facts therefore
        # observe one committed set of half-open policy intervals.
        connection.execute(
            text(
                "SELECT pg_advisory_xact_lock("
                "hashtextextended(CAST(:program_version_id AS text), 1))"
            ),
            {"program_version_id": attribution["program_version_id"]},
        )

        rule = (
            connection.execute(
                text(
                    """
                    SELECT policy.id AS policy_id, rule.id AS rule_id,
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
                    "occurred_at": fact["occurred_at"],
                    "product_ref": product_ref,
                },
            )
            .mappings()
            .one_or_none()
        )
        if rule is None:
            raise CommissionPolicyUnavailableError
        try:
            commission_minor = commission_amount_minor(
                basis_amount_minor=fact["gross_amount_minor"],
                rate_basis_points=rule["commission_rate_basis_points"],
            )
        except ValueError as error:
            raise CommissionPolicyUnavailableError from error
        connection.execute(
            text(
                """
                INSERT INTO affiliate_commission_entry
                  (id, source_fact_ref, attribution_id, creator_id, program_version_id,
                   policy_id, rule_id, provider, environment, provider_account_ref,
                   provider_transaction_ref, entry_kind, currency_code, basis_amount_minor,
                   commission_rate_basis_points, commission_amount_minor, occurred_at,
                   recorded_at)
                VALUES
                  (:id, :source_fact_ref, :attribution_id, :creator_id, :program_version_id,
                   :policy_id, :rule_id, 'stripe', :environment, :provider_account_ref,
                   :provider_transaction_ref, 'accrual', :currency_code, :basis_amount_minor,
                   :commission_rate_basis_points, :commission_amount_minor, :occurred_at,
                   :recorded_at)
                """
            ),
            {
                "id": uuid4(),
                "source_fact_ref": fact["id"],
                "attribution_id": attribution["id"],
                "creator_id": attribution["creator_id"],
                "program_version_id": attribution["program_version_id"],
                "policy_id": rule["policy_id"],
                "rule_id": rule["rule_id"],
                "environment": fact["environment"],
                "provider_account_ref": fact["provider_account_ref"],
                "provider_transaction_ref": fact["provider_transaction_ref"],
                "currency_code": fact["currency_code"],
                "basis_amount_minor": fact["gross_amount_minor"],
                "commission_rate_basis_points": rule["commission_rate_basis_points"],
                "commission_amount_minor": commission_minor,
                "occurred_at": fact["occurred_at"],
                "recorded_at": processed_at,
            },
        )
        return CommissionApplyResult(status=CommissionApplyStatus.ACCRUED)

    @staticmethod
    def _reverse(
        *,
        connection: Connection,
        fact: RowMapping,
        processed_at: datetime,
        reinstatement: bool,
    ) -> CommissionApplyResult:
        source_kind = "refund" if reinstatement else "accrual"
        target_kind = "reinstatement" if reinstatement else "refund"
        source = (
            connection.execute(
                text(
                    """
                    SELECT * FROM affiliate_commission_entry
                    WHERE provider = 'stripe'
                      AND environment = :environment
                      AND provider_account_ref = :provider_account_ref
                      AND provider_transaction_ref = :source_transaction_ref
                    FOR SHARE
                    """
                ),
                {
                    "environment": fact["environment"],
                    "provider_account_ref": fact["provider_account_ref"],
                    "source_transaction_ref": fact["reverses_provider_transaction_ref"],
                },
            )
            .mappings()
            .one_or_none()
        )
        if source is None:
            raise CommissionSourceUnavailableError
        if source["entry_kind"] != source_kind:
            raise CommissionReversalConflictError
        existing_reversal = connection.execute(
            text(
                "SELECT source_fact_ref FROM affiliate_commission_entry "
                "WHERE reverses_entry_id = :source_entry_id FOR SHARE"
            ),
            {"source_entry_id": source["id"]},
        ).scalar_one_or_none()
        if existing_reversal is not None:
            raise CommissionReversalConflictError
        if (
            fact["currency_code"] != source["currency_code"]
            or fact["gross_amount_minor"] != abs(source["basis_amount_minor"])
            or fact["occurred_at"] < source["occurred_at"]
        ):
            raise CommissionReversalConflictError
        sign = 1 if reinstatement else -1
        connection.execute(
            text(
                """
                INSERT INTO affiliate_commission_entry
                  (id, source_fact_ref, attribution_id, creator_id, program_version_id,
                   policy_id, rule_id, provider, environment, provider_account_ref,
                   provider_transaction_ref, entry_kind, currency_code, basis_amount_minor,
                   commission_rate_basis_points, commission_amount_minor, reverses_entry_id,
                   occurred_at, recorded_at)
                VALUES
                  (:id, :source_fact_ref, :attribution_id, :creator_id, :program_version_id,
                   :policy_id, :rule_id, 'stripe', :environment, :provider_account_ref,
                   :provider_transaction_ref, :entry_kind, :currency_code, :basis_amount_minor,
                   :commission_rate_basis_points, :commission_amount_minor, :reverses_entry_id,
                   :occurred_at, :recorded_at)
                """
            ),
            {
                "id": uuid4(),
                "source_fact_ref": fact["id"],
                "attribution_id": source["attribution_id"],
                "creator_id": source["creator_id"],
                "program_version_id": source["program_version_id"],
                "policy_id": source["policy_id"],
                "rule_id": source["rule_id"],
                "environment": fact["environment"],
                "provider_account_ref": fact["provider_account_ref"],
                "provider_transaction_ref": fact["provider_transaction_ref"],
                "entry_kind": target_kind,
                "currency_code": fact["currency_code"],
                "basis_amount_minor": sign * fact["gross_amount_minor"],
                "commission_rate_basis_points": source["commission_rate_basis_points"],
                "commission_amount_minor": sign * abs(source["commission_amount_minor"]),
                "reverses_entry_id": source["id"],
                "occurred_at": fact["occurred_at"],
                "recorded_at": processed_at,
            },
        )
        return CommissionApplyResult(
            status=(
                CommissionApplyStatus.REINSTATED
                if reinstatement
                else CommissionApplyStatus.REFUNDED
            )
        )

    def list_creator_entries(
        self, *, creator_id: UUID, cursor: CommissionCursor | None, limit: int
    ) -> CommissionLedgerPage:
        parameters: dict[str, Any] = {"creator_id": creator_id, "fetch_limit": limit + 1}
        cursor_clause = ""
        if cursor is not None:
            cursor_clause = "AND (occurred_at, id) < (:cursor_at, :cursor_id)"
            parameters.update({"cursor_at": cursor.occurred_at, "cursor_id": cursor.entry_id})
        try:
            with self._engine.connect() as connection:
                rows = (
                    connection.execute(
                        text(
                            f"""
                            SELECT id, entry_kind, currency_code, basis_amount_minor,
                                   commission_amount_minor, occurred_at
                            FROM affiliate_commission_entry
                            WHERE creator_id = :creator_id
                              {cursor_clause}
                            ORDER BY occurred_at DESC, id DESC
                            LIMIT :fetch_limit
                            """
                        ),
                        parameters,
                    )
                    .mappings()
                    .all()
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error
        has_more = len(rows) > limit
        visible_rows: Sequence[RowMapping] = rows[:limit]
        entries = tuple(
            CommissionLedgerEntry(
                entry_id=row["id"],
                kind=CommissionEntryKind(row["entry_kind"]),
                currency_code=row["currency_code"],
                basis_amount_minor=row["basis_amount_minor"],
                commission_amount_minor=row["commission_amount_minor"],
                occurred_at=row["occurred_at"],
            )
            for row in visible_rows
        )
        next_cursor = None
        if has_more and entries:
            last = entries[-1]
            next_cursor = encode_commission_cursor(
                CommissionCursor(occurred_at=last.occurred_at, entry_id=last.entry_id)
            )
        return CommissionLedgerPage(entries=entries, next_cursor=next_cursor)
