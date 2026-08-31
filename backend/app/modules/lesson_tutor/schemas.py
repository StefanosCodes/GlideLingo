"""Public HTTP models for lesson tutor turns."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

TutorText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
SelectedChoice = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
]


class TutorHistoryMessage(BaseModel):
    """A bounded prior message supplied by the current lesson sitting."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: TutorText


class LessonTutorTurnRequest(BaseModel):
    """One complete tutor turn."""

    model_config = ConfigDict(extra="forbid")

    conversation_id: UUID
    lesson_id: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    ]
    visible_step_index: int
    selected_choice: SelectedChoice | None = None
    message: TutorText
    history: Annotated[list[TutorHistoryMessage], Field(max_length=8)] = Field(
        default_factory=list
    )


class LessonTutorTurnResponse(BaseModel):
    """A safe SDK-independent tutor result."""

    reply: str
    prompt_version: Literal["lesson-tutor-v1"]
