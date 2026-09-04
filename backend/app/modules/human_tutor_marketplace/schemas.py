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


class CreateTutorApplicationRequest(BaseModel):
    """Complete draft data required before an application may be submitted."""

    model_config = ConfigDict(extra="forbid", strict=True)

    headline: Headline
    biography: Biography
    time_zone: TimeZone
    languages: list[LanguageCode] = Field(min_length=1, max_length=8)
    specialties: list[Specialty] = Field(min_length=1, max_length=12)

    @field_validator("time_zone", mode="after")
    @classmethod
    def validate_time_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError):
            raise ValueError("time_zone must be a valid IANA time zone") from None
        return value

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


class TutorApplicationQueue(BaseModel):
    """Bounded operator queue ordered by submission time and stable ID."""

    model_config = ConfigDict(extra="forbid")

    items: list[TutorApplicationResponse]
    offset: int = Field(ge=0)
    limit: int = Field(ge=1, le=50)
    has_more: bool
