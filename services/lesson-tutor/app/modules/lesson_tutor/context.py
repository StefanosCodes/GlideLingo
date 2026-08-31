"""Trusted authored lesson lookup and model-visibility rules."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.errors import LessonContextNotFoundError

LESSON_FILES = {"el-letters-1": Path("courses/en-el-GR/missions/el-letters-1.json")}


class HearBeat(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: Literal["hear"]
    greek: str
    gloss: str


class NoticeBeat(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: Literal["notice"]
    text: str


class CheckBeat(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: Literal["check"]
    prompt: str
    choices: list[str]
    answer: str
    answer_aliases: list[str] = Field(default_factory=list, validation_alias="answerAliases")
    greek: str | None = None


Beat = Annotated[HearBeat | NoticeBeat | CheckBeat, Field(discriminator="type")]


class AuthoredLesson(BaseModel):
    model_config = ConfigDict(extra="ignore")
    lessonId: str
    lessonTitle: str
    moduleTitle: str
    objective: str
    beats: list[Beat]


@dataclass(frozen=True)
class LessonTutorContext:
    lesson_id: str
    lesson_title: str
    module_title: str
    objective: str
    visible_step_index: int
    model_visible_context: str
    canonical_answer: str | None
    answer_disclosure_terms: tuple[str, ...]
    answer_attempted: bool


def _describe_beat(
    beat: Beat, *, step_index: int, current: bool, selected_choice: str | None
) -> list[str]:
    lines = [f"Step {step_index + 1} ({'current' if current else 'previous'}):"]
    if isinstance(beat, HearBeat):
        lines.extend((f"- Activity: hear {beat.greek}", f"- Learner-facing gloss: {beat.gloss}"))
    elif isinstance(beat, NoticeBeat):
        lines.extend(("- Activity: notice", f"- Learner-facing text: {beat.text}"))
    else:
        lines.extend(
            (
                "- Activity: check",
                f"- Prompt: {beat.prompt}",
                f"- Choices: {', '.join(beat.choices)}",
            )
        )
        if beat.greek:
            lines.append(f"- Greek shown: {beat.greek}")
        if not current:
            lines.append(f"- Correct answer already encountered: {beat.answer}")
        elif selected_choice is not None:
            lines.extend(
                (
                    f"- Learner selected: {selected_choice}",
                    "- Attempt result: "
                    f"{'correct' if selected_choice == beat.answer else 'incorrect'}",
                    f"- Correct answer: {beat.answer}",
                )
            )
        else:
            lines.append("- Attempt state: not attempted; give hints and do not state the answer")
    return lines


def load_lesson_context(
    *, content_root: Path, lesson_id: str, visible_step_index: int, selected_choice: str | None
) -> LessonTutorContext:
    relative_path = LESSON_FILES.get(lesson_id)
    if relative_path is None:
        raise LessonContextNotFoundError
    try:
        lesson = AuthoredLesson.model_validate(
            json.loads((content_root.resolve() / relative_path).read_text(encoding="utf-8"))
        )
    except (OSError, json.JSONDecodeError, ValidationError) as error:
        raise LessonContextNotFoundError from error
    if lesson.lessonId != lesson_id or not 0 <= visible_step_index < len(lesson.beats):
        raise LessonContextNotFoundError
    current_beat = lesson.beats[visible_step_index]
    validated_choice = (
        selected_choice
        if isinstance(current_beat, CheckBeat) and selected_choice in current_beat.choices
        else None
    )
    lines = [
        f"Lesson: {lesson.lessonTitle}",
        f"Module: {lesson.moduleTitle}",
        f"Objective: {lesson.objective}",
    ]
    for index, beat in enumerate(lesson.beats[: visible_step_index + 1]):
        lines.extend(
            _describe_beat(
                beat,
                step_index=index,
                current=index == visible_step_index,
                selected_choice=validated_choice if index == visible_step_index else None,
            )
        )
    return LessonTutorContext(
        lesson_id=lesson_id,
        lesson_title=lesson.lessonTitle,
        module_title=lesson.moduleTitle,
        objective=lesson.objective,
        visible_step_index=visible_step_index,
        model_visible_context="\n".join(lines),
        canonical_answer=current_beat.answer if isinstance(current_beat, CheckBeat) else None,
        answer_disclosure_terms=(
            tuple(dict.fromkeys((current_beat.answer, *current_beat.answer_aliases)))
            if isinstance(current_beat, CheckBeat)
            else ()
        ),
        answer_attempted=validated_choice is not None,
    )
