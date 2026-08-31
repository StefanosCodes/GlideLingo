from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

TutorText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
ActorRef = Annotated[str, StringConstraints(pattern=r"^tusr_v1_[A-Za-z0-9_-]{43}$")]


class TutorHistoryMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: TutorText


class LessonTutorTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actor_ref: ActorRef
    turn_ref: UUID
    lesson_id: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    visible_step_index: int
    selected_choice: Annotated[str, StringConstraints(min_length=1, max_length=200)] | None
    message: TutorText
    history: Annotated[list[TutorHistoryMessage], Field(max_length=8)] = Field(default_factory=list)


class LessonTutorTurnResponse(BaseModel):
    reply: str
    prompt_version: Literal["lesson-tutor-v1"]
