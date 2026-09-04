"""Public contracts for the first human tutor marketplace vertical slice."""

from datetime import date, datetime, time
from typing import Annotated, Literal, Self
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

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


class AvailabilityRuleInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    weekday: int = Field(ge=0, le=6)
    start_local: time
    end_local: time
    effective_from: date
    effective_until: date | None = None

    @field_validator("end_local", mode="after")
    @classmethod
    def validate_interval(cls, value: time, info: object) -> time:
        start = getattr(info, "data", {}).get("start_local")
        if isinstance(start, time) and value <= start:
            raise ValueError("end_local must be after start_local")
        return value


class AvailabilityExceptionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    local_date: date
    start_local: time
    end_local: time
    kind: Literal["available", "unavailable"]

    @field_validator("end_local", mode="after")
    @classmethod
    def validate_interval(cls, value: time, info: object) -> time:
        start = getattr(info, "data", {}).get("start_local")
        if isinstance(start, time) and value <= start:
            raise ValueError("end_local must be after start_local")
        return value


class ReplaceManualAvailabilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    expected_profile_version: int = Field(ge=1)
    lead_time_minutes: int = Field(ge=60, le=10080)
    buffer_before_minutes: int = Field(ge=0, le=120)
    buffer_after_minutes: int = Field(ge=0, le=120)
    dialects: list[LanguageCode] = Field(default_factory=list, max_length=8)
    rules: list[AvailabilityRuleInput] = Field(max_length=28)
    exceptions: list[AvailabilityExceptionInput] = Field(default_factory=list, max_length=64)

    @field_validator("dialects", mode="after")
    @classmethod
    def normalize_dialects(cls, values: list[str]) -> list[str]:
        normalized = [value.lower() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("dialects must be unique")
        if any("-" not in value for value in normalized):
            raise ValueError("dialects must identify a language variety")
        return normalized


class AvailabilityRuleResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_id: UUID
    weekday: int = Field(ge=0, le=6)
    start_local: time
    end_local: time
    effective_from: date
    effective_until: date | None
    time_zone: str


class AvailabilityExceptionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exception_id: UUID
    local_date: date
    start_local: time
    end_local: time
    kind: Literal["available", "unavailable"]
    time_zone: str


class ManualAvailabilityResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tutor_id: UUID
    profile_version: int = Field(ge=1)
    time_zone: str
    lead_time_minutes: int
    buffer_before_minutes: int
    buffer_after_minutes: int
    dialects: list[str]
    rules: list[AvailabilityRuleResponse]
    exceptions: list[AvailabilityExceptionResponse]


class TutorSlotResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    starts_at: datetime
    ends_at: datetime


class TutorSlotsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tutor_id: UUID
    time_zone: str
    source: Literal["manual", "manual+google"] = "manual"
    freshness: Literal["current", "stale", "reconnect_required"] = "current"
    slots: list[TutorSlotResponse]


class CalendarOAuthStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    redirect_uri: str = Field(min_length=12, max_length=500)


class CalendarOAuthStartResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    authorization_url: str
    expires_at: datetime


class CalendarOAuthCallbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: str = Field(min_length=32, max_length=2048)
    code: str = Field(min_length=1, max_length=4096)
    redirect_uri: str = Field(min_length=12, max_length=500)


class CalendarConnectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["disconnected", "connected", "stale", "reconnect_required"]
    freshness: Literal["not_connected", "current", "stale", "reconnect_required"]
    last_refreshed_at: datetime | None
    safe_failure_code: str | None


class CreateConversationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tutor_id: UUID


class ConversationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: UUID
    tutor_id: UUID
    participant_role: Literal["learner", "tutor"]
    state: Literal["open", "closed"]
    updated_at: datetime


class ConversationListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ConversationResponse]


class SendMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_message_id: UUID
    body: str = Field(min_length=1, max_length=2000)


class MessageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: UUID
    kind: Literal["user", "system"]
    sender_role: Literal["learner", "tutor", "system"]
    body: str
    is_own: bool
    created_at: datetime


class MessagePageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[MessageResponse]
    next_cursor: str | None


class MarketplaceActionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: Literal[True] = True


class MessageNotificationPreferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email_enabled: bool


class MessageNotificationPreferenceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email_enabled: bool


class CreateMessageReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: UUID | None = None
    reason: Literal["harassment", "spam", "unsafe", "other"]
    details: str | None = Field(default=None, min_length=8, max_length=1000)

    @model_validator(mode="after")
    def require_other_details(self) -> Self:
        if self.reason == "other" and self.details is None:
            raise ValueError("details are required for another report reason")
        return self


class MessageReportResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report_id: UUID
    conversation_id: UUID
    message_id: UUID | None
    reason: Literal["harassment", "spam", "unsafe", "other"]
    details: str | None
    status: Literal["open", "resolved"]
    created_at: datetime
    messages: list[MessageResponse] = Field(default_factory=list)


class MessageReportListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[MessageReportResponse]


class ResolveMessageReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=8, max_length=1000)


class PublicTutorResponse(BaseModel):
    """Safe discovery projection with no application, actor, payout, or private-review facts."""

    model_config = ConfigDict(extra="forbid")

    tutor_id: UUID
    headline: str
    biography: str
    time_zone: str
    languages: list[str]
    dialects: list[str]
    specialties: list[str]
    verified_credentials: list[str]
    offering_id: UUID
    offering_title: str
    duration_minutes: Literal[25, 50]
    amount_minor: int
    currency: Currency
    rating: float | None
    rating_count: int = Field(ge=0)
    is_favorite: bool


class TutorSearchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[PublicTutorResponse]
    next_cursor: str | None


class SetTutorFavoriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    favorite: bool
