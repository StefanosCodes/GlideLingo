"""PostgreSQL persistence for tutor applications and operator review."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID, uuid4

from sqlalchemy import Engine, text
from sqlalchemy.engine import Connection, RowMapping
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.errors import DependencyUnavailableError
from app.modules.human_tutor_marketplace.schemas import (
    ChangeTutorStatusRequest,
    CreateTutorApplicationRequest,
    Currency,
    SaveTutorCredentialRequest,
    SaveTutorOfferingRequest,
    TutorApplicationDecision,
    TutorApplicationStatus,
    TutorCredentialDecision,
    TutorCredentialStatus,
    TutorCredentialType,
    TutorOfferingState,
    UpdateTutorApplicationDraftRequest,
    UpdateTutorProfileDraftRequest,
)


@dataclass(frozen=True, slots=True)
class StoredTutorApplication:
    application_id: UUID
    actor_ref: str
    status: TutorApplicationStatus
    version: int
    headline: str
    biography: str
    time_zone: str
    languages: tuple[str, ...]
    specialties: tuple[str, ...]
    submitted_at: datetime | None
    reviewed_at: datetime | None
    decision_reason: str | None
    reviewer_actor_ref: str | None


@dataclass(frozen=True, slots=True)
class StoredMarketplacePolicyVersion:
    policy_id: UUID
    policy_type: str
    version: int
    commission_basis_points: int | None
    cancellation_cutoff_hours: int | None
    dispute_window_hours: int | None
    effective_at: datetime


@dataclass(frozen=True, slots=True)
class StoredTutorCredential:
    credential_id: UUID
    version: int
    credential_type: TutorCredentialType
    title: str
    issuer: str
    verification_status: TutorCredentialStatus
    verification_reason: str | None
    reviewed_at: datetime | None
    verified_by_actor_ref: str | None


@dataclass(frozen=True, slots=True)
class StoredTutorOffering:
    offering_id: UUID
    version: int
    title: str
    duration_minutes: int
    amount_minor: int
    currency: Currency
    state: TutorOfferingState
    commission_policy: StoredMarketplacePolicyVersion
    cancellation_policy: StoredMarketplacePolicyVersion


@dataclass(frozen=True, slots=True)
class StoredTutorProfile:
    tutor_id: UUID
    application_id: UUID
    actor_ref: str
    application_status: TutorApplicationStatus
    version: int
    headline: str
    biography: str
    time_zone: str
    payout_ready: bool
    is_published: bool
    credential: StoredTutorCredential | None
    offering: StoredTutorOffering | None


class ApplicationAlreadyExistsError(Exception):
    """A different application already belongs to this actor."""


class TutorApplicationRepository(Protocol):
    def get_by_actor(self, *, actor_ref: str) -> StoredTutorApplication | None: ...

    def get_by_id(self, *, application_id: UUID) -> StoredTutorApplication | None: ...

    def create_draft(
        self,
        *,
        application_id: UUID,
        actor_ref: str,
        request: CreateTutorApplicationRequest,
    ) -> StoredTutorApplication: ...

    def update_draft(
        self,
        *,
        actor_ref: str,
        request: UpdateTutorApplicationDraftRequest,
    ) -> StoredTutorApplication | None: ...

    def submit(self, *, actor_ref: str, expected_version: int) -> StoredTutorApplication | None: ...

    def has_operator_capability(self, *, actor_ref: str, capability: str) -> bool: ...

    def list_review_queue(
        self, *, offset: int, limit: int
    ) -> tuple[list[StoredTutorApplication], bool]: ...

    def start_review(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        expected_version: int,
    ) -> StoredTutorApplication | None: ...

    def decide(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        decision: TutorApplicationDecision,
        reason: str,
        expected_version: int,
    ) -> StoredTutorApplication | None: ...

    def get_profile_by_actor(self, *, actor_ref: str) -> StoredTutorProfile | None: ...

    def get_profile_by_credential_id(self, *, credential_id: UUID) -> StoredTutorProfile | None: ...

    def get_profile_by_application_id(
        self, *, application_id: UUID
    ) -> StoredTutorProfile | None: ...

    def update_profile_draft(
        self,
        *,
        actor_ref: str,
        request: UpdateTutorProfileDraftRequest,
    ) -> StoredTutorProfile | None: ...

    def save_credential(
        self,
        *,
        actor_ref: str,
        request: SaveTutorCredentialRequest,
    ) -> StoredTutorProfile | None: ...

    def decide_credential(
        self,
        *,
        credential_id: UUID,
        operator_actor_ref: str,
        request_version: int,
        decision: TutorCredentialDecision,
        reason: str,
    ) -> StoredTutorProfile | None: ...

    def save_offering(
        self,
        *,
        actor_ref: str,
        request: SaveTutorOfferingRequest,
    ) -> StoredTutorProfile | None: ...

    def set_publication(
        self,
        *,
        actor_ref: str,
        expected_profile_version: int,
        expected_offering_version: int,
        publish: bool,
    ) -> StoredTutorProfile | None: ...

    def change_tutor_status(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        request: ChangeTutorStatusRequest,
    ) -> StoredTutorApplication | None: ...


class PostgresTutorApplicationRepository:
    def __init__(self, *, engine: Engine) -> None:
        self._engine = engine

    def get_by_actor(self, *, actor_ref: str) -> StoredTutorApplication | None:
        try:
            with self._engine.connect() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            SELECT application_id, actor_ref, status, version, headline,
                                   biography, time_zone, submitted_at, reviewed_at,
                                   decision_reason, reviewer_actor_ref
                            FROM marketplace_tutor_application
                            WHERE actor_ref = :actor_ref
                            """
                        ),
                        {"actor_ref": actor_ref},
                    )
                    .mappings()
                    .one_or_none()
                )
                return self._hydrate(connection, row) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_profile_by_actor(self, *, actor_ref: str) -> StoredTutorProfile | None:
        try:
            with self._engine.connect() as connection:
                return self._get_profile(connection, actor_ref=actor_ref)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_profile_by_credential_id(self, *, credential_id: UUID) -> StoredTutorProfile | None:
        try:
            with self._engine.connect() as connection:
                actor_ref = connection.execute(
                    text(
                        """
                        SELECT profile.actor_ref
                        FROM marketplace_tutor_credential AS credential
                        JOIN marketplace_tutor_profile AS profile
                          ON profile.tutor_id = credential.tutor_id
                        WHERE credential.credential_id = :credential_id
                        """
                    ),
                    {"credential_id": credential_id},
                ).scalar_one_or_none()
                return (
                    self._get_profile(connection, actor_ref=actor_ref)
                    if actor_ref is not None
                    else None
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_profile_by_application_id(self, *, application_id: UUID) -> StoredTutorProfile | None:
        try:
            with self._engine.connect() as connection:
                actor_ref = connection.execute(
                    text(
                        "SELECT actor_ref FROM marketplace_tutor_profile "
                        "WHERE application_id = :application_id"
                    ),
                    {"application_id": application_id},
                ).scalar_one_or_none()
                return (
                    self._get_profile(connection, actor_ref=actor_ref)
                    if actor_ref is not None
                    else None
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def update_profile_draft(
        self,
        *,
        actor_ref: str,
        request: UpdateTutorProfileDraftRequest,
    ) -> StoredTutorProfile | None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_profile AS profile
                            SET headline = :headline,
                                biography = :biography,
                                time_zone = :time_zone,
                                version = profile.version + 1,
                                updated_at = now()
                            FROM marketplace_tutor_application AS application
                            WHERE profile.application_id = application.application_id
                              AND profile.actor_ref = :actor_ref
                              AND profile.version = :expected_version
                              AND application.status = 'approved'
                              AND profile.is_published = false
                            RETURNING profile.application_id
                            """
                        ),
                        {
                            "actor_ref": actor_ref,
                            "expected_version": request.expected_version,
                            "headline": request.headline,
                            "biography": request.biography,
                            "time_zone": request.time_zone,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                self._insert_audit(
                    connection,
                    application_id=row["application_id"],
                    actor_ref=actor_ref,
                    action="profile_draft_updated",
                    from_status="private",
                    to_status="private",
                    reason=None,
                )
                return self._get_profile(connection, actor_ref=actor_ref)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def save_credential(
        self,
        *,
        actor_ref: str,
        request: SaveTutorCredentialRequest,
    ) -> StoredTutorProfile | None:
        try:
            with self._engine.begin() as connection:
                profile = self._get_profile_row(
                    connection,
                    actor_ref=actor_ref,
                    for_update=True,
                )
                if (
                    profile is None
                    or profile["application_status"] != "approved"
                    or profile["is_published"]
                ):
                    return None
                existing = (
                    connection.execute(
                        text(
                            """
                            SELECT credential_id, version, verification_status
                            FROM marketplace_tutor_credential
                            WHERE tutor_id = :tutor_id
                            FOR UPDATE
                            """
                        ),
                        {"tutor_id": profile["tutor_id"]},
                    )
                    .mappings()
                    .one_or_none()
                )
                if existing is None:
                    if request.expected_version != 0:
                        return None
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_tutor_credential
                              (credential_id, application_id, tutor_id, credential_type, title,
                               issuer)
                            VALUES
                              (:credential_id, :application_id, :tutor_id, :credential_type,
                               :title, :issuer)
                            """
                        ),
                        {
                            "credential_id": uuid4(),
                            "application_id": profile["application_id"],
                            "tutor_id": profile["tutor_id"],
                            "credential_type": request.credential_type,
                            "title": request.title,
                            "issuer": request.issuer,
                        },
                    )
                else:
                    if (
                        existing["version"] != request.expected_version
                        or existing["verification_status"] != "unverified"
                    ):
                        return None
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_credential
                            SET credential_type = :credential_type,
                                title = :title,
                                issuer = :issuer,
                                version = version + 1,
                                updated_at = now()
                            WHERE credential_id = :credential_id
                            """
                        ),
                        {
                            "credential_id": existing["credential_id"],
                            "credential_type": request.credential_type,
                            "title": request.title,
                            "issuer": request.issuer,
                        },
                    )
                self._insert_audit(
                    connection,
                    application_id=profile["application_id"],
                    actor_ref=actor_ref,
                    action="credential_draft_saved",
                    from_status="unverified",
                    to_status="unverified",
                    reason=None,
                )
                return self._get_profile(connection, actor_ref=actor_ref)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def decide_credential(
        self,
        *,
        credential_id: UUID,
        operator_actor_ref: str,
        request_version: int,
        decision: TutorCredentialDecision,
        reason: str,
    ) -> StoredTutorProfile | None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_credential AS credential
                            SET verification_status = :decision,
                                verified_by_actor_ref = :operator_actor_ref,
                                verification_reason = :reason,
                                reviewed_at = now(),
                                version = credential.version + 1,
                                updated_at = now()
                            FROM marketplace_tutor_profile AS profile,
                                 marketplace_tutor_application AS application
                            WHERE credential.tutor_id = profile.tutor_id
                              AND profile.application_id = application.application_id
                              AND credential.credential_id = :credential_id
                              AND credential.version = :request_version
                              AND credential.verification_status = 'unverified'
                              AND application.status = 'approved'
                              AND application.actor_ref <> :operator_actor_ref
                              AND EXISTS (
                                SELECT 1 FROM marketplace_operator_capability
                                WHERE actor_ref = :operator_actor_ref
                                  AND capability = 'verify_tutor_credentials'
                                  AND revoked_at IS NULL
                              )
                            RETURNING profile.actor_ref, application.application_id
                            """
                        ),
                        {
                            "credential_id": credential_id,
                            "operator_actor_ref": operator_actor_ref,
                            "request_version": request_version,
                            "decision": decision,
                            "reason": reason,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                self._insert_audit(
                    connection,
                    application_id=row["application_id"],
                    actor_ref=operator_actor_ref,
                    action="credential_decided",
                    from_status="unverified",
                    to_status=decision,
                    reason=reason,
                )
                return self._get_profile(connection, actor_ref=row["actor_ref"])
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def save_offering(
        self,
        *,
        actor_ref: str,
        request: SaveTutorOfferingRequest,
    ) -> StoredTutorProfile | None:
        try:
            with self._engine.begin() as connection:
                profile = self._get_profile_row(
                    connection,
                    actor_ref=actor_ref,
                    for_update=True,
                )
                if (
                    profile is None
                    or profile["application_status"] != "approved"
                    or profile["is_published"]
                ):
                    return None
                existing = (
                    connection.execute(
                        text(
                            """
                            SELECT offering_id, version, state
                            FROM marketplace_tutor_offering
                            WHERE tutor_id = :tutor_id
                            FOR UPDATE
                            """
                        ),
                        {"tutor_id": profile["tutor_id"]},
                    )
                    .mappings()
                    .one_or_none()
                )
                if existing is None:
                    if request.expected_version != 0:
                        return None
                    policies = self._current_policies(connection)
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_tutor_offering
                              (offering_id, application_id, tutor_id, title,
                               duration_minutes, amount_minor, currency,
                               commission_policy_id, cancellation_policy_id)
                            VALUES
                              (:offering_id, :application_id, :tutor_id, :title,
                               :duration_minutes, :amount_minor, :currency,
                               :commission_policy_id, :cancellation_policy_id)
                            """
                        ),
                        {
                            "offering_id": uuid4(),
                            "application_id": profile["application_id"],
                            "tutor_id": profile["tutor_id"],
                            "title": request.title,
                            "duration_minutes": request.duration_minutes,
                            "amount_minor": request.amount_minor,
                            "currency": request.currency,
                            "commission_policy_id": policies["commission"].policy_id,
                            "cancellation_policy_id": policies["cancellation"].policy_id,
                        },
                    )
                else:
                    if (
                        existing["version"] != request.expected_version
                        or existing["state"] != "draft"
                    ):
                        return None
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_offering
                            SET title = :title,
                                duration_minutes = :duration_minutes,
                                amount_minor = :amount_minor,
                                currency = :currency,
                                version = version + 1,
                                updated_at = now()
                            WHERE offering_id = :offering_id
                            """
                        ),
                        {
                            "offering_id": existing["offering_id"],
                            "title": request.title,
                            "duration_minutes": request.duration_minutes,
                            "amount_minor": request.amount_minor,
                            "currency": request.currency,
                        },
                    )
                self._insert_audit(
                    connection,
                    application_id=profile["application_id"],
                    actor_ref=actor_ref,
                    action="offering_draft_saved",
                    from_status="draft",
                    to_status="draft",
                    reason=None,
                )
                return self._get_profile(connection, actor_ref=actor_ref)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def set_publication(
        self,
        *,
        actor_ref: str,
        expected_profile_version: int,
        expected_offering_version: int,
        publish: bool,
    ) -> StoredTutorProfile | None:
        try:
            with self._engine.begin() as connection:
                application_id = connection.execute(
                    text(
                        """
                        SELECT marketplace_set_tutor_publication(
                          :actor_ref, :expected_profile_version,
                          :expected_offering_version, :publish
                        )
                        """
                    ),
                    {
                        "actor_ref": actor_ref,
                        "expected_profile_version": expected_profile_version,
                        "expected_offering_version": expected_offering_version,
                        "publish": publish,
                    },
                ).scalar_one()
                if application_id is None:
                    return None
                self._insert_audit(
                    connection,
                    application_id=application_id,
                    actor_ref=actor_ref,
                    action="profile_published" if publish else "profile_unpublished",
                    from_status="private" if publish else "published",
                    to_status="published" if publish else "private",
                    reason=None,
                )
                return self._get_profile(connection, actor_ref=actor_ref)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def change_tutor_status(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        request: ChangeTutorStatusRequest,
    ) -> StoredTutorApplication | None:
        from_status = "approved" if request.action == "suspend" else "suspended"
        to_status = "suspended" if request.action == "suspend" else "approved"
        capability = "manage_tutor_status"
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_application
                            SET status = :to_status,
                                reviewer_actor_ref = :operator_actor_ref,
                                reviewed_at = now(),
                                decision_reason = :reason,
                                version = version + 1,
                                updated_at = now()
                            WHERE application_id = :application_id
                              AND status = :from_status
                              AND version = :expected_version
                              AND actor_ref <> :operator_actor_ref
                              AND EXISTS (
                                SELECT 1 FROM marketplace_operator_capability
                                WHERE actor_ref = :operator_actor_ref
                                  AND capability = :capability
                                  AND revoked_at IS NULL
                              )
                            RETURNING application_id, actor_ref, status, version, headline,
                                      biography, time_zone, submitted_at, reviewed_at,
                                      decision_reason, reviewer_actor_ref
                            """
                        ),
                        {
                            "application_id": application_id,
                            "operator_actor_ref": operator_actor_ref,
                            "from_status": from_status,
                            "to_status": to_status,
                            "expected_version": request.expected_version,
                            "reason": request.reason,
                            "capability": capability,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                if request.action == "suspend":
                    connection.execute(
                        text("SELECT marketplace_make_suspended_tutor_private(:application_id)"),
                        {"application_id": application_id},
                    )
                self._insert_audit(
                    connection,
                    application_id=application_id,
                    actor_ref=operator_actor_ref,
                    action=(
                        "application_suspended"
                        if request.action == "suspend"
                        else "application_reinstated"
                    ),
                    from_status=from_status,
                    to_status=to_status,
                    reason=request.reason,
                )
                return self._hydrate(connection, row)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def update_draft(
        self,
        *,
        actor_ref: str,
        request: UpdateTutorApplicationDraftRequest,
    ) -> StoredTutorApplication | None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_application
                            SET headline = :headline,
                                biography = :biography,
                                time_zone = :time_zone,
                                version = version + 1,
                                updated_at = now()
                            WHERE actor_ref = :actor_ref
                              AND status = 'draft'
                              AND version = :expected_version
                            RETURNING application_id, actor_ref, status, version, headline,
                                      biography, time_zone, submitted_at, reviewed_at,
                                      decision_reason, reviewer_actor_ref
                            """
                        ),
                        {
                            "actor_ref": actor_ref,
                            "expected_version": request.expected_version,
                            "headline": request.headline,
                            "biography": request.biography,
                            "time_zone": request.time_zone,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                application_id = row["application_id"]
                connection.execute(
                    text(
                        "DELETE FROM marketplace_tutor_application_language "
                        "WHERE application_id = :application_id"
                    ),
                    {"application_id": application_id},
                )
                connection.execute(
                    text(
                        "DELETE FROM marketplace_tutor_application_specialty "
                        "WHERE application_id = :application_id"
                    ),
                    {"application_id": application_id},
                )
                self._insert_ranked_values(
                    connection,
                    table="marketplace_tutor_application_language",
                    column="language_code",
                    application_id=application_id,
                    values=request.languages,
                )
                self._insert_ranked_values(
                    connection,
                    table="marketplace_tutor_application_specialty",
                    column="specialty",
                    application_id=application_id,
                    values=request.specialties,
                )
                self._insert_audit(
                    connection,
                    application_id=application_id,
                    actor_ref=actor_ref,
                    action="application_draft_updated",
                    from_status="draft",
                    to_status="draft",
                    reason=None,
                )
                return self._hydrate(connection, row)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def get_by_id(self, *, application_id: UUID) -> StoredTutorApplication | None:
        try:
            with self._engine.connect() as connection:
                row = self._get_row(connection, application_id=application_id)
                return self._hydrate(connection, row) if row is not None else None
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def create_draft(
        self,
        *,
        application_id: UUID,
        actor_ref: str,
        request: CreateTutorApplicationRequest,
    ) -> StoredTutorApplication:
        try:
            with self._engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        INSERT INTO marketplace_tutor_application
                          (application_id, actor_ref, headline, biography, time_zone)
                        VALUES
                          (:application_id, :actor_ref, :headline, :biography, :time_zone)
                        """
                    ),
                    {
                        "application_id": application_id,
                        "actor_ref": actor_ref,
                        "headline": request.headline,
                        "biography": request.biography,
                        "time_zone": request.time_zone,
                    },
                )
                self._insert_ranked_values(
                    connection,
                    table="marketplace_tutor_application_language",
                    column="language_code",
                    application_id=application_id,
                    values=request.languages,
                )
                self._insert_ranked_values(
                    connection,
                    table="marketplace_tutor_application_specialty",
                    column="specialty",
                    application_id=application_id,
                    values=request.specialties,
                )
                self._insert_audit(
                    connection,
                    application_id=application_id,
                    actor_ref=actor_ref,
                    action="application_created",
                    from_status=None,
                    to_status="draft",
                    reason=None,
                )
                row = self._get_row(connection, application_id=application_id)
                assert row is not None
                return self._hydrate(connection, row)
        except IntegrityError as error:
            raise ApplicationAlreadyExistsError from error
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def submit(self, *, actor_ref: str, expected_version: int) -> StoredTutorApplication | None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_application
                            SET status = 'submitted',
                                submitted_at = now(),
                                version = version + 1,
                                updated_at = now()
                            WHERE actor_ref = :actor_ref
                              AND status = 'draft'
                              AND version = :expected_version
                            RETURNING application_id, actor_ref, status, version, headline,
                                      biography, time_zone, submitted_at, reviewed_at,
                                      decision_reason, reviewer_actor_ref
                            """
                        ),
                        {"actor_ref": actor_ref, "expected_version": expected_version},
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                self._insert_audit(
                    connection,
                    application_id=row["application_id"],
                    actor_ref=actor_ref,
                    action="application_submitted",
                    from_status="draft",
                    to_status="submitted",
                    reason=None,
                )
                return self._hydrate(connection, row)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def has_operator_capability(self, *, actor_ref: str, capability: str) -> bool:
        try:
            with self._engine.connect() as connection:
                return bool(
                    connection.execute(
                        text(
                            """
                            SELECT EXISTS (
                              SELECT 1
                              FROM marketplace_operator_capability
                              WHERE actor_ref = :actor_ref
                                AND capability = :capability
                                AND revoked_at IS NULL
                            )
                            """
                        ),
                        {"actor_ref": actor_ref, "capability": capability},
                    ).scalar_one()
                )
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def list_review_queue(
        self, *, offset: int, limit: int
    ) -> tuple[list[StoredTutorApplication], bool]:
        try:
            with self._engine.connect() as connection:
                rows = (
                    connection.execute(
                        text(
                            """
                            SELECT application_id, actor_ref, status, version, headline,
                                   biography, time_zone, submitted_at, reviewed_at,
                                   decision_reason, reviewer_actor_ref
                            FROM marketplace_tutor_application
                            WHERE status IN ('submitted', 'under_review', 'approved', 'suspended')
                            ORDER BY submitted_at ASC, application_id ASC
                            OFFSET :offset
                            LIMIT :fetch_limit
                            """
                        ),
                        {"offset": offset, "fetch_limit": limit + 1},
                    )
                    .mappings()
                    .all()
                )
                hydrated = [self._hydrate(connection, row) for row in rows[:limit]]
                return hydrated, len(rows) > limit
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def start_review(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        expected_version: int,
    ) -> StoredTutorApplication | None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_application
                            SET status = 'under_review',
                                reviewer_actor_ref = :operator_actor_ref,
                                version = version + 1,
                                updated_at = now()
                            WHERE application_id = :application_id
                              AND status = 'submitted'
                              AND version = :expected_version
                              AND actor_ref <> :operator_actor_ref
                              AND EXISTS (
                                SELECT 1
                                FROM marketplace_operator_capability
                                WHERE actor_ref = :operator_actor_ref
                                  AND capability = 'review_tutor_applications'
                                  AND revoked_at IS NULL
                              )
                            RETURNING application_id, actor_ref, status, version, headline,
                                      biography, time_zone, submitted_at, reviewed_at,
                                      decision_reason, reviewer_actor_ref
                            """
                        ),
                        {
                            "application_id": application_id,
                            "operator_actor_ref": operator_actor_ref,
                            "expected_version": expected_version,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                self._insert_audit(
                    connection,
                    application_id=application_id,
                    actor_ref=operator_actor_ref,
                    action="application_review_started",
                    from_status="submitted",
                    to_status="under_review",
                    reason=None,
                )
                return self._hydrate(connection, row)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    def decide(
        self,
        *,
        application_id: UUID,
        operator_actor_ref: str,
        decision: TutorApplicationDecision,
        reason: str,
        expected_version: int,
    ) -> StoredTutorApplication | None:
        try:
            with self._engine.begin() as connection:
                row = (
                    connection.execute(
                        text(
                            """
                            UPDATE marketplace_tutor_application
                            SET status = :decision,
                                reviewed_at = now(),
                                decision_reason = :reason,
                                reviewer_actor_ref = :operator_actor_ref,
                                version = version + 1,
                                updated_at = now()
                            WHERE application_id = :application_id
                              AND status = 'under_review'
                              AND version = :expected_version
                              AND actor_ref <> :operator_actor_ref
                              AND EXISTS (
                                SELECT 1
                                FROM marketplace_operator_capability
                                WHERE actor_ref = :operator_actor_ref
                                  AND capability = 'review_tutor_applications'
                                  AND revoked_at IS NULL
                              )
                            RETURNING application_id, actor_ref, status, version, headline,
                                      biography, time_zone, submitted_at, reviewed_at,
                                      decision_reason, reviewer_actor_ref
                            """
                        ),
                        {
                            "application_id": application_id,
                            "operator_actor_ref": operator_actor_ref,
                            "decision": decision,
                            "reason": reason,
                            "expected_version": expected_version,
                        },
                    )
                    .mappings()
                    .one_or_none()
                )
                if row is None:
                    return None
                if decision == "approved":
                    connection.execute(
                        text(
                            """
                            INSERT INTO marketplace_tutor_profile
                              (tutor_id, application_id, actor_ref, headline, biography, time_zone)
                            VALUES
                              (:tutor_id, :application_id, :actor_ref, :headline, :biography,
                               :time_zone)
                            ON CONFLICT (application_id) DO NOTHING
                            """
                        ),
                        {
                            "tutor_id": uuid4(),
                            "application_id": application_id,
                            "actor_ref": row["actor_ref"],
                            "headline": row["headline"],
                            "biography": row["biography"],
                            "time_zone": row["time_zone"],
                        },
                    )
                self._insert_audit(
                    connection,
                    application_id=application_id,
                    actor_ref=operator_actor_ref,
                    action="application_decided",
                    from_status="under_review",
                    to_status=decision,
                    reason=reason,
                )
                return self._hydrate(connection, row)
        except SQLAlchemyError as error:
            raise DependencyUnavailableError from error

    @classmethod
    def _get_profile(
        cls,
        connection: Connection,
        *,
        actor_ref: str,
    ) -> StoredTutorProfile | None:
        row = cls._get_profile_row(connection, actor_ref=actor_ref)
        if row is None:
            return None
        credential_row = (
            connection.execute(
                text(
                    """
                    SELECT credential_id, version, credential_type, title, issuer,
                           verification_status, verification_reason, reviewed_at,
                           verified_by_actor_ref
                    FROM marketplace_tutor_credential
                    WHERE tutor_id = :tutor_id
                    """
                ),
                {"tutor_id": row["tutor_id"]},
            )
            .mappings()
            .one_or_none()
        )
        offering_row = (
            connection.execute(
                text(
                    """
                    SELECT offering_id, version, title, duration_minutes, amount_minor,
                           currency, state, commission_policy_id, cancellation_policy_id
                    FROM marketplace_tutor_offering
                    WHERE tutor_id = :tutor_id
                    """
                ),
                {"tutor_id": row["tutor_id"]},
            )
            .mappings()
            .one_or_none()
        )
        credential = (
            StoredTutorCredential(
                credential_id=credential_row["credential_id"],
                version=credential_row["version"],
                credential_type=credential_row["credential_type"],
                title=credential_row["title"],
                issuer=credential_row["issuer"],
                verification_status=credential_row["verification_status"],
                verification_reason=credential_row["verification_reason"],
                reviewed_at=credential_row["reviewed_at"],
                verified_by_actor_ref=credential_row["verified_by_actor_ref"],
            )
            if credential_row is not None
            else None
        )
        offering = None
        if offering_row is not None:
            policy_rows = (
                connection.execute(
                    text(
                        """
                        SELECT policy_id, policy_type, version, commission_basis_points,
                               cancellation_cutoff_hours, dispute_window_hours, effective_at
                        FROM marketplace_policy_version
                        WHERE policy_id IN (:commission_policy_id, :cancellation_policy_id)
                        """
                    ),
                    {
                        "commission_policy_id": offering_row["commission_policy_id"],
                        "cancellation_policy_id": offering_row["cancellation_policy_id"],
                    },
                )
                .mappings()
                .all()
            )
            policies = {
                policy_row["policy_type"]: cls._hydrate_policy(policy_row)
                for policy_row in policy_rows
            }
            offering = StoredTutorOffering(
                offering_id=offering_row["offering_id"],
                version=offering_row["version"],
                title=offering_row["title"],
                duration_minutes=offering_row["duration_minutes"],
                amount_minor=offering_row["amount_minor"],
                currency=offering_row["currency"],
                state=offering_row["state"],
                commission_policy=policies["commission"],
                cancellation_policy=policies["cancellation"],
            )
        return StoredTutorProfile(
            tutor_id=row["tutor_id"],
            application_id=row["application_id"],
            actor_ref=row["actor_ref"],
            application_status=row["application_status"],
            version=row["version"],
            headline=row["headline"],
            biography=row["biography"],
            time_zone=row["time_zone"],
            payout_ready=row["payout_ready"],
            is_published=row["is_published"],
            credential=credential,
            offering=offering,
        )

    @staticmethod
    def _get_profile_row(
        connection: Connection,
        *,
        actor_ref: str,
        for_update: bool = False,
    ) -> RowMapping | None:
        suffix = " FOR UPDATE OF profile" if for_update else ""
        return (
            connection.execute(
                text(
                    """
                    SELECT profile.tutor_id, profile.application_id, profile.actor_ref,
                           application.status AS application_status, profile.version,
                           profile.headline, profile.biography, profile.time_zone,
                           profile.payout_ready, profile.is_published
                    FROM marketplace_tutor_profile AS profile
                    JOIN marketplace_tutor_application AS application
                      ON application.application_id = profile.application_id
                    WHERE profile.actor_ref = :actor_ref
                    """
                    + suffix
                ),
                {"actor_ref": actor_ref},
            )
            .mappings()
            .one_or_none()
        )

    @classmethod
    def _current_policies(cls, connection: Connection) -> dict[str, StoredMarketplacePolicyVersion]:
        rows = (
            connection.execute(
                text(
                    """
                    SELECT DISTINCT ON (policy_type)
                           policy_id, policy_type, version, commission_basis_points,
                           cancellation_cutoff_hours, dispute_window_hours, effective_at
                    FROM marketplace_policy_version
                    WHERE effective_at <= now()
                    ORDER BY policy_type, version DESC
                    """
                )
            )
            .mappings()
            .all()
        )
        policies = {row["policy_type"]: cls._hydrate_policy(row) for row in rows}
        if set(policies) != {"commission", "cancellation"}:
            raise DependencyUnavailableError
        return policies

    @staticmethod
    def _hydrate_policy(row: RowMapping) -> StoredMarketplacePolicyVersion:
        return StoredMarketplacePolicyVersion(
            policy_id=row["policy_id"],
            policy_type=row["policy_type"],
            version=row["version"],
            commission_basis_points=row["commission_basis_points"],
            cancellation_cutoff_hours=row["cancellation_cutoff_hours"],
            dispute_window_hours=row["dispute_window_hours"],
            effective_at=row["effective_at"],
        )

    @staticmethod
    def _get_row(connection: Connection, *, application_id: UUID) -> RowMapping | None:
        return (
            connection.execute(
                text(
                    """
                SELECT application_id, actor_ref, status, version, headline, biography,
                       time_zone, submitted_at, reviewed_at, decision_reason,
                       reviewer_actor_ref
                FROM marketplace_tutor_application
                WHERE application_id = :application_id
                """
                ),
                {"application_id": application_id},
            )
            .mappings()
            .one_or_none()
        )

    @classmethod
    def _hydrate(cls, connection: Connection, row: RowMapping) -> StoredTutorApplication:
        languages = cls._ranked_values(
            connection,
            table="marketplace_tutor_application_language",
            column="language_code",
            application_id=row["application_id"],
        )
        specialties = cls._ranked_values(
            connection,
            table="marketplace_tutor_application_specialty",
            column="specialty",
            application_id=row["application_id"],
        )
        return StoredTutorApplication(
            application_id=row["application_id"],
            actor_ref=row["actor_ref"],
            status=row["status"],
            version=row["version"],
            headline=row["headline"],
            biography=row["biography"],
            time_zone=row["time_zone"],
            languages=languages,
            specialties=specialties,
            submitted_at=row["submitted_at"],
            reviewed_at=row["reviewed_at"],
            decision_reason=row["decision_reason"],
            reviewer_actor_ref=row["reviewer_actor_ref"],
        )

    @staticmethod
    def _ranked_values(
        connection: Connection,
        *,
        table: str,
        column: str,
        application_id: UUID,
    ) -> tuple[str, ...]:
        result = connection.execute(
            text(
                f"SELECT {column} FROM {table} "
                "WHERE application_id = :application_id ORDER BY position ASC"
            ),
            {"application_id": application_id},
        )
        return tuple(result.scalars().all())

    @staticmethod
    def _insert_ranked_values(
        connection: Connection,
        *,
        table: str,
        column: str,
        application_id: UUID,
        values: list[str],
    ) -> None:
        statement = text(
            f"INSERT INTO {table} (application_id, position, {column}) "
            f"VALUES (:application_id, :position, :{column})"
        )
        connection.execute(
            statement,
            [
                {"application_id": application_id, "position": index, column: value}
                for index, value in enumerate(values)
            ],
        )

    @staticmethod
    def _insert_audit(
        connection: Connection,
        *,
        application_id: UUID,
        actor_ref: str,
        action: str,
        from_status: str | None,
        to_status: str,
        reason: str | None,
    ) -> None:
        connection.execute(
            text(
                """
                INSERT INTO marketplace_audit_event
                  (audit_id, application_id, actor_ref, action, from_status, to_status, reason)
                VALUES
                  (:audit_id, :application_id, :actor_ref, :action, :from_status, :to_status,
                   :reason)
                """
            ),
            {
                "audit_id": uuid4(),
                "application_id": application_id,
                "actor_ref": actor_ref,
                "action": action,
                "from_status": from_status,
                "to_status": to_status,
                "reason": reason,
            },
        )
