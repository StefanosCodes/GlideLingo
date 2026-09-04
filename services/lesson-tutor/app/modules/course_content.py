"""Fail-closed reader for the allowlisted canonical Course v1 lesson package."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TypeVar

from pydantic import BaseModel, ConfigDict, ValidationError


class CourseContentError(ValueError):
    """Canonical content is absent, invalid, or internally inconsistent."""


ModelT = TypeVar("ModelT", bound=BaseModel)


class CanonicalCourse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    schemaVersion: Literal[1]
    id: str
    version: str
    moduleOrder: list[str]


class CanonicalModule(BaseModel):
    model_config = ConfigDict(extra="ignore")
    schemaVersion: Literal[1]
    id: str
    version: str
    courseId: str
    targetCapabilityIds: list[str]
    missionIds: list[str]


class CanonicalModules(BaseModel):
    model_config = ConfigDict(extra="ignore")
    schemaVersion: Literal[1]
    modules: list[CanonicalModule]


class CanonicalChoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    text: str


class CanonicalActivity(BaseModel):
    model_config = ConfigDict(extra="ignore")
    schemaVersion: Literal[1]
    id: str
    rendererType: str
    phase: str
    prompt: str
    targetCapabilityIds: list[str]
    text: str | None = None
    audioId: str | None = None
    choices: list[CanonicalChoice] | None = None
    acceptedChoiceIds: list[str] | None = None
    answerAliases: list[str] | None = None


class CanonicalLesson(BaseModel):
    model_config = ConfigDict(extra="ignore")
    schemaVersion: Literal[1]
    id: str
    version: str
    missionId: str
    title: str
    immediateOutcome: str
    activities: list[CanonicalActivity]


class CanonicalMission(BaseModel):
    model_config = ConfigDict(extra="ignore")
    schemaVersion: Literal[1]
    id: str
    version: str
    courseId: str
    moduleId: str
    title: str
    targetCapabilityIds: list[str]
    lessonOrder: list[str]
    lessons: list[CanonicalLesson]


@dataclass(frozen=True, slots=True)
class CanonicalLessonBundle:
    course: CanonicalCourse
    module: CanonicalModule
    mission: CanonicalMission
    lesson: CanonicalLesson


_COURSE_PATH = Path("courses/en-el-GR/course.json")
_MODULES_PATH = Path("courses/en-el-GR/modules.json")
_MISSION_PATHS = {
    "el-letters-sound-map": Path("courses/en-el-GR/missions/el-letters-sound-map.json")
}


class CourseV1ContentRepository:
    """Loads the bounded canonical package and validates runtime-critical references."""

    def __init__(self, *, content_root: Path) -> None:
        self._content_root = content_root.resolve()

    def _read(self, relative_path: Path, model: type[ModelT]) -> ModelT:
        try:
            payload = json.loads((self._content_root / relative_path).read_text(encoding="utf-8"))
            return model.model_validate(payload)
        except (OSError, json.JSONDecodeError, ValidationError) as error:
            raise CourseContentError(
                f"Canonical Course v1 content could not be loaded: {relative_path.as_posix()}"
            ) from error

    def _course_and_modules(self) -> tuple[CanonicalCourse, list[CanonicalModule]]:
        course = self._read(_COURSE_PATH, CanonicalCourse)
        modules = self._read(_MODULES_PATH, CanonicalModules)
        if course.id != "el-from-zero":
            raise CourseContentError("Canonical course ID does not match the runtime allowlist")
        ordered_ids = [module.id for module in modules.modules]
        if ordered_ids != course.moduleOrder:
            raise CourseContentError("Canonical module order does not match modules metadata")
        if any(module.courseId != course.id for module in modules.modules):
            raise CourseContentError("Canonical module course reference does not match")
        return course, modules.modules

    def _mission(self, course: CanonicalCourse, module: CanonicalModule) -> CanonicalMission:
        if len(module.missionIds) != 1:
            raise CourseContentError("The allowlisted runtime module must contain one mission")
        mission_id = module.missionIds[0]
        relative_path = _MISSION_PATHS.get(mission_id)
        if relative_path is None:
            raise CourseContentError("Canonical mission is not allowlisted for the runtime")
        mission = self._read(relative_path, CanonicalMission)
        if (
            mission.id != mission_id
            or mission.courseId != course.id
            or mission.moduleId != module.id
            or mission.targetCapabilityIds != module.targetCapabilityIds
        ):
            raise CourseContentError("Canonical mission references do not match course metadata")
        if [lesson.id for lesson in mission.lessons] != mission.lessonOrder:
            raise CourseContentError("Canonical lesson order does not match mission metadata")
        if any(lesson.missionId != mission.id for lesson in mission.lessons):
            raise CourseContentError("Canonical lesson mission reference does not match")
        return mission

    def load_lesson(self, lesson_id: str) -> CanonicalLessonBundle:
        course, modules = self._course_and_modules()
        matches: list[CanonicalLessonBundle] = []
        for module in modules:
            mission = self._mission(course, module)
            matches.extend(
                CanonicalLessonBundle(course, module, mission, lesson)
                for lesson in mission.lessons
                if lesson.id == lesson_id
            )
        if len(matches) != 1:
            raise CourseContentError("Canonical lesson is missing or ambiguous")
        return matches[0]
