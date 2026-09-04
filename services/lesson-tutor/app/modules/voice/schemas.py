from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

ActorRef = Annotated[str, StringConstraints(pattern=r"^vusr_v1_[A-Za-z0-9_-]{43}$")]
Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
SessionDescription = Annotated[str, StringConstraints(min_length=20, max_length=65536)]


class VoiceSessionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_id: Identifier
    course_version: Identifier
    scenario_id: Identifier
    scenario_version: Identifier
    conversation_mode: Literal["guided"] = "guided"
    source_locale: Literal["en"] = "en"
    target_locale: Literal["el-GR"] = "el-GR"
    persona_id: Identifier
    voice_id: Identifier
    learner_level: Identifier
    capability_ids: list[Identifier] = Field(min_length=1, max_length=8)
    correction_policy_version: Identifier
    evidence_policy_version: Identifier
    maximum_duration_seconds: int = Field(default=300, ge=60, le=600)


class CreatePrivateVoiceSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actor_ref: ActorRef
    application_session_id: UUID
    course_id: Identifier
    scenario_id: Identifier
    source_locale: Literal["en"]
    target_locale: Literal["el-GR"]
    conversation_mode: Literal["guided"]
    captions_enabled: bool
    offer_sdp: SessionDescription

    @model_validator(mode="after")
    def validate_sdp(self) -> "CreatePrivateVoiceSessionRequest":
        if not self.offer_sdp.startswith("v=0") or "\x00" in self.offer_sdp:
            raise ValueError("offer_sdp must be a bounded WebRTC session description")
        return self


class CreatePrivateVoiceSessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    application_session_id: UUID
    provider_call_id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,200}$")]
    answer_sdp: SessionDescription
    spec: VoiceSessionSpec


class EndPrivateVoiceSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actor_ref: ActorRef
    application_session_id: UUID
    provider_call_id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,200}$")]


class EndPrivateVoiceSessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["stopped"] = "stopped"
