from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
SessionDescription = Annotated[str, StringConstraints(min_length=20, max_length=65536)]
IdempotencyKey = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=16, max_length=100, pattern=r"^[A-Za-z0-9._:-]+$"
    ),
]
type VoiceEndReason = Literal["completed", "cancelled", "timeout", "connection_lost", "failed"]
type VoiceEventType = Literal[
    "transcript.partial",
    "transcript.final",
    "response.started",
    "response.completed",
    "audio.started",
    "audio.stopped",
    "response.interrupted",
    "session.warning",
    "session.failed",
]


class VoiceSessionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_id: Identifier
    course_version: Identifier
    scenario_id: Identifier
    scenario_version: Identifier
    conversation_mode: Literal["guided"]
    source_locale: Identifier
    target_locale: Identifier
    persona_id: Identifier
    voice_id: Identifier
    learner_level: Identifier
    capability_ids: Annotated[list[Identifier], Field(min_length=1, max_length=8)]
    correction_policy_version: Identifier
    evidence_policy_version: Identifier
    maximum_duration_seconds: int = Field(ge=60, le=600)


class CreateVoiceSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_id: Identifier
    scenario_id: Identifier
    conversation_mode: Literal["guided"]
    source_locale: Literal["en"]
    target_locale: Literal["el-GR"]
    captions_enabled: bool
    retain_transcript: Literal[False]
    offer_sdp: SessionDescription
    client_capabilities: Annotated[
        list[Literal["audio", "captions", "interrupt", "reconnect"]],
        Field(min_length=1, max_length=4),
    ]

    @model_validator(mode="after")
    def validate_request(self) -> "CreateVoiceSessionRequest":
        if not self.offer_sdp.startswith("v=0") or "\x00" in self.offer_sdp:
            raise ValueError("offer_sdp must be a bounded WebRTC session description")
        if len(set(self.client_capabilities)) != len(self.client_capabilities):
            raise ValueError("client_capabilities must be unique")
        if "audio" not in self.client_capabilities:
            raise ValueError("audio capability is required")
        return self


class ReconnectVoiceSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    offer_sdp: SessionDescription

    @model_validator(mode="after")
    def validate_sdp(self) -> "ReconnectVoiceSessionRequest":
        if not self.offer_sdp.startswith("v=0") or "\x00" in self.offer_sdp:
            raise ValueError("offer_sdp must be a bounded WebRTC session description")
        return self


class VoiceConnection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["openai-webrtc-sdp"] = "openai-webrtc-sdp"
    answer_sdp: SessionDescription


class VoiceSessionAdmission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: UUID
    lifecycle: Literal["connecting"] = "connecting"
    expires_at: datetime
    spec: VoiceSessionSpec
    connection: VoiceConnection


class VoiceSessionEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9._:-]{8,120}$")]
    session_id: UUID
    turn_id: Annotated[str, StringConstraints(min_length=1, max_length=120)] | None = None
    sequence: int = Field(ge=1, le=10000)
    occurred_at: datetime
    type: VoiceEventType
    speaker: Literal["learner", "coach"] | None = None
    text: Annotated[str, StringConstraints(max_length=4000)] | None = None
    code: Annotated[str, StringConstraints(max_length=100)] | None = None

    @model_validator(mode="after")
    def validate_payload(self) -> "VoiceSessionEvent":
        if self.type.startswith("transcript.") and (self.speaker is None or self.text is None):
            raise ValueError("transcript events require a speaker and text")
        if not self.type.startswith("transcript.") and self.text is not None:
            raise ValueError("text is allowed only on transcript events")
        return self


class EndVoiceSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: VoiceEndReason
    events: Annotated[list[VoiceSessionEvent], Field(max_length=256)] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_events(self) -> "EndVoiceSessionRequest":
        sequences = [event.sequence for event in self.events]
        event_ids = [event.event_id for event in self.events]
        if sequences != sorted(sequences) or len(set(sequences)) != len(sequences):
            raise ValueError("event sequences must be strictly increasing")
        if len(set(event_ids)) != len(event_ids):
            raise ValueError("event IDs must be unique")
        return self


class VoiceEvidenceResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    applied: Literal[False] = False
    reason: Literal["authored_scenario_evidence_not_integrated"] = (
        "authored_scenario_evidence_not_integrated"
    )


class VoiceSessionRecap(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: UUID
    lifecycle: Literal["ended"] = "ended"
    end_reason: VoiceEndReason
    scenario_completed: Literal[False] = False
    transcript: list[VoiceSessionEvent]
    evidence: VoiceEvidenceResult = Field(default_factory=VoiceEvidenceResult)
