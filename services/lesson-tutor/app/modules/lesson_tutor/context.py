"""Trusted authored lesson lookup and model-visibility rules."""

import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import LessonContextNotFoundError
from app.modules.course_content import (
    CanonicalActivity,
    CourseContentError,
    CourseV1ContentRepository,
)


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


def _answer_aliases(answer: str) -> list[str]:
    if len(answer) != 1:
        return []
    try:
        name = unicodedata.name(answer)
    except ValueError:
        return []
    marker = "GREEK SMALL LETTER "
    return [name.removeprefix(marker).lower()] if name.startswith(marker) else []


def _adapt_activity(activity: CanonicalActivity) -> Beat:
    if activity.rendererType == "explain" and activity.audioId and activity.text:
        return HearBeat(type="hear", greek=activity.prompt, gloss=activity.text)
    if activity.rendererType == "explain" and activity.text:
        return NoticeBeat(type="notice", text=activity.text)
    if (
        activity.rendererType == "script_recognition"
        and activity.choices
        and activity.acceptedChoiceIds
    ):
        choices_by_id = {choice.id: choice.text for choice in activity.choices}
        answer = choices_by_id.get(activity.acceptedChoiceIds[0])
        if answer is None:
            raise CourseContentError("Canonical activity has no accepted authored choice")
        return CheckBeat(
            type="check",
            prompt=activity.prompt,
            choices=[choice.text for choice in activity.choices],
            answer=answer,
            answerAliases=_answer_aliases(answer),
            greek=activity.text,
        )
    raise CourseContentError("Canonical activity is unsupported by the lesson tutor adapter")


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
    try:
        bundle = CourseV1ContentRepository(content_root=content_root).load_lesson(lesson_id)
        beats = [
            _adapt_activity(activity)
            for activity in bundle.lesson.activities
            if activity.phase != "revisit"
        ]
    except CourseContentError as error:
        raise LessonContextNotFoundError from error
    if not 0 <= visible_step_index < len(beats):
        raise LessonContextNotFoundError
    current_beat = beats[visible_step_index]
    validated_choice = (
        selected_choice
        if isinstance(current_beat, CheckBeat) and selected_choice in current_beat.choices
        else None
    )
    lines = [
        f"Lesson: {bundle.lesson.title}",
        f"Module: {bundle.mission.title}",
        f"Objective: {bundle.lesson.immediateOutcome}",
    ]
    for index, beat in enumerate(beats[: visible_step_index + 1]):
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
        lesson_title=bundle.lesson.title,
        module_title=bundle.mission.title,
        objective=bundle.lesson.immediateOutcome,
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
