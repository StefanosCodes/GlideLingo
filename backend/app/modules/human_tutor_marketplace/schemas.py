"""Public contracts for the first human tutor marketplace vertical slice."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

type TutorApplicationStatus = Literal[
    "draft",
    "submitted",
    "under_review",
    "approved",
    "rejected",
    "suspended",
]
type TutorApplicationDecision = Literal["approved", "rejected"]
type TutorCredentialType = Literal["certificate", "degree", "teaching_license"]
type TutorCredentialDecision = Literal["verified", "rejected"]
type TutorCredentialStatus = Literal["unverified", "verified", "rejected"]
type TutorOfferingState = Literal["draft", "active"]
type TutorStatusAction = Literal["suspend", "reinstate"]
type PublicationBlocker = Literal[
    "application_not_approved",
    "payout_not_ready",
    "offering_missing",
]

Headline = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=80)]
Biography = Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=1000)]
TimeZone = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
LanguageCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$"),
]
Specialty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=64)]
DecisionReason = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=8, max_length=500),
]
CredentialTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=3, max_length=100)
]
CredentialIssuer = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)
]
OfferingTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=3, max_length=100)
]
Currency = Literal["USD"]


def validate_time_zone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError("time_zone must be a valid IANA time zone") from None
    return value


class TutorApplicationDraftFields(BaseModel):
    """Editable private application fields shared by create and update operations."""

    model_config = ConfigDict(extra="forbid", strict=True)

    headline: Headline
    biography: Biography
    time_zone: TimeZone
    languages: list[LanguageCode] = Field(min_length=1, max_length=8)
    specialties: list[Specialty] = Field(min_length=1, max_length=12)

    _validate_time_zone = field_validator("time_zone", mode="after")(validate_time_zone)

    @field_validator("languages", mode="after")
    @classmethod
    def normalize_languages(cls, values: list[str]) -> list[str]:
        normalized = [value.lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("languages must be unique")
        return normalized

    @field_validator("specialties", mode="after")
    @classmethod
    def normalize_specialties(cls, values: list[str]) -> list[str]:
        normalized = [" ".join(value.split()) for value in values]
        folded = [value.casefold() for value in normalized]
        if len(set(folded)) != len(folded):
            raise ValueError("specialties must be unique")
        return normalized


class CreateTutorApplicationRequest(TutorApplicationDraftFields):
    """Complete draft data required before an application may be submitted."""


class UpdateTutorApplicationDraftRequest(TutorApplicationDraftFields):
    """Optimistically replace the tutor-owned application draft."""

    expected_version: int = Field(ge=1)


class TutorApplicationResponse(BaseModel):
    """Private tutor-owned or operator-authorized application projection."""

    model_config = ConfigDict(extra="forbid")

    application_id: UUID
    status: TutorApplicationStatus
    version: int = Field(ge=1)
    headline: str
    biography: str
    time_zone: str
    languages: list[str]
    specialties: list[str]
    submitted_at: datetime | None = None
    reviewed_at: datetime | None = None
    decision_reason: str | None = None


class ApplicationVersionRequest(BaseModel):
    """Optimistic-concurrency input for one application transition."""

    model_config = ConfigDict(extra="forbid", strict=True)

    expected_version: int = Field(ge=1)


class DecideTutorApplicationRequest(ApplicationVersionRequest):
    """Capability-scoped operator decision with an auditable reason."""

    decision: TutorApplicationDecision
    reason: DecisionReason


class ChangeTutorStatusRequest(ApplicationVersionRequest):
    """Capability-scoped suspension or reinstatement."""

    action: TutorStatusAction
    reason: DecisionReason


class TutorApplicationQueue(BaseModel):
    """Bounded operator queue ordered by submission time and stable ID."""

    model_config = ConfigDict(extra="forbid")

    items: list[TutorApplicationResponse]
    offset: int = Field(ge=0)
    limit: int = Field(ge=1, le=50)
    has_more: bool


class UpdateTutorProfileDraftRequest(BaseModel):
    """Private profile content owned by an approved tutor."""

    model_config = ConfigDict(extra="forbid", strict=True)

    expected_version: int = Field(ge=1)
    headline: Headline
    biography: Biography
    time_zone: TimeZone

    _validate_time_zone = field_validator("time_zone", mode="after")(validate_time_zone)


class SaveTutorCredentialRequest(BaseModel):
    """Create with expected version zero or edit an unverified credential."""

    model_config = ConfigDict(extra="forbid", strict=True)

    expected_version: int = Field(ge=0)
    credential_type: TutorCredentialType
    title: CredentialTitle
    issuer: CredentialIssuer


class DecideTutorCredentialRequest(BaseModel):
    """Capability-scoped credential verification decision."""

    model_config = ConfigDict(extra="forbid", strict=True)

    expected_version: int = Field(ge=1)
    decision: TutorCredentialDecision
    reason: DecisionReason


class SaveTutorOfferingRequest(BaseModel):
    """Create with expected version zero or edit the tutor's single draft offering."""

    model_config = ConfigDict(extra="forbid", strict=True)

    expected_version: int = Field(ge=0)
    title: OfferingTitle
    duration_minutes: Literal[25, 50]
    amount_minor: int = Field(ge=500, le=50_000)
    currency: Currency


class SetTutorPublicationRequest(BaseModel):
    """Explicitly publish or unpublish an eligible private tutor workspace."""

    model_config = ConfigDict(extra="forbid", strict=True)

    expected_profile_version: int = Field(ge=1)
    expected_offering_version: int = Field(ge=1)
    publish: bool


class TutorCredentialResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential_id: UUID
    version: int = Field(ge=1)
    credential_type: TutorCredentialType
    title: str
    issuer: str
    verification_status: TutorCredentialStatus
    verification_reason: str | None = None
    reviewed_at: datetime | None = None


class MarketplacePolicyVersionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy_id: UUID
    policy_type: Literal["commission", "cancellation"]
    version: int = Field(ge=1)
    commission_basis_points: int | None = Field(default=None, ge=0, le=10_000)
    cancellation_cutoff_hours: int | None = Field(default=None, ge=0, le=168)
    dispute_window_hours: int | None = Field(default=None, ge=1, le=168)
    effective_at: datetime


class TutorOfferingResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    offering_id: UUID
    version: int = Field(ge=1)
    title: str
    duration_minutes: Literal[25, 50]
    amount_minor: int = Field(ge=500, le=50_000)
    currency: Currency
    state: TutorOfferingState
    commission_policy: MarketplacePolicyVersionResponse
    cancellation_policy: MarketplacePolicyVersionResponse


class TutorProfileResponse(BaseModel):
    """Private owner projection. There is deliberately no public projection in milestone one."""

    model_config = ConfigDict(extra="forbid")

    tutor_id: UUID
    application_id: UUID
    application_status: TutorApplicationStatus
    version: int = Field(ge=1)
    headline: str
    biography: str
    time_zone: str
    is_published: bool
    payout_ready: bool
    publication_blockers: list[PublicationBlocker]
    credential: TutorCredentialResponse | None = None
    offering: TutorOfferingResponse | None = None
