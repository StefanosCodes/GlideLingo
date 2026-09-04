"""Deterministic, course-owned Realtime voice scenarios."""

import json
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError

from app.modules.lesson_tutor.context import LESSON_FILES, AuthoredLesson
from app.modules.voice.schemas import CreatePrivateVoiceSessionRequest, VoiceSessionSpec
from app.modules.voice.service import ResolvedVoiceScenario


@dataclass(frozen=True, slots=True)
class AuthoredVoiceScenario:
    course_id: str
    course_version: str
    lesson_id: str
    scenario_id: str
    scenario_version: str
    persona_id: str
    learner_level: str
    capability_ids: tuple[str, ...]
    correction_policy_version: str
    evidence_policy_version: str
    maximum_duration_seconds: int


class AuthoredVoiceCapability(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str


class AuthoredVoiceLesson(AuthoredLesson):
    capability: AuthoredVoiceCapability


SOUND_MAP_SCENARIO = AuthoredVoiceScenario(
    course_id="el-from-zero",
    course_version="greek-foundations-v1",
    lesson_id="el-letters-1",
    scenario_id="el-letters-1-voice-v1",
    scenario_version="1.0.0",
    persona_id="greek-sound-guide-v1",
    learner_level="A0-A1",
    capability_ids=("el-script-vowels-a-e-i",),
    correction_policy_version="gentle-pronunciation-recast-v1",
    evidence_policy_version="voice-practice-no-credit-v1",
    maximum_duration_seconds=300,
)

_SCENARIOS = {
    (SOUND_MAP_SCENARIO.course_id, SOUND_MAP_SCENARIO.scenario_id): SOUND_MAP_SCENARIO,
}


class AuthoredVoiceScenarioResolver:
    """Resolve only explicitly allowlisted scenarios backed by checked-in course content."""

    def __init__(self, *, content_root: Path) -> None:
        self._content_root = content_root.resolve()

    def resolve(
        self, request: CreatePrivateVoiceSessionRequest, *, voice_id: str
    ) -> ResolvedVoiceScenario:
        authored = _SCENARIOS.get((request.course_id, request.scenario_id))
        if authored is None:
            raise ValueError("The requested voice scenario is not authored")
        lesson = self._load_lesson(authored.lesson_id)
        if authored.capability_ids != (lesson.capability.id,):
            raise ValueError("The authored voice capability does not match the lesson")
        return ResolvedVoiceScenario(
            spec=VoiceSessionSpec(
                course_id=authored.course_id,
                course_version=authored.course_version,
                scenario_id=authored.scenario_id,
                scenario_version=authored.scenario_version,
                conversation_mode=request.conversation_mode,
                source_locale=request.source_locale,
                target_locale=request.target_locale,
                persona_id=authored.persona_id,
                voice_id=voice_id,
                learner_level=authored.learner_level,
                capability_ids=list(authored.capability_ids),
                correction_policy_version=authored.correction_policy_version,
                evidence_policy_version=authored.evidence_policy_version,
                maximum_duration_seconds=authored.maximum_duration_seconds,
            ),
            instructions=self._instructions(lesson),
        )

    def _load_lesson(self, lesson_id: str) -> AuthoredVoiceLesson:
        relative_path = LESSON_FILES.get(lesson_id)
        if relative_path is None:
            raise ValueError("The voice scenario lesson is not allowlisted")
        try:
            lesson = AuthoredVoiceLesson.model_validate(
                json.loads((self._content_root / relative_path).read_text(encoding="utf-8"))
            )
        except (OSError, json.JSONDecodeError, ValidationError) as error:
            raise ValueError("The authored voice lesson could not be loaded") from error
        if lesson.lessonId != lesson_id:
            raise ValueError("The authored voice lesson ID did not match")
        return lesson

    @staticmethod
    def _instructions(lesson: AuthoredVoiceLesson) -> str:
        return "\n".join(
            (
                "You are GlideLingo's calm Modern Greek sound coach.",
                "This is an optional guided voice practice for the checked-in lesson: "
                f"{lesson.lessonTitle}.",
                f"Learning objective: {lesson.objective}",
                "",
                "Stay strictly within α, ε, ι, the sound contrasts taught in this lesson, "
                "καλημέρα, νερό, να, and με.",
                "Use short English directions and brief Modern Greek examples. Begin by inviting "
                "the learner to say α, ε, and ι one at a time. Then practice one short taught word "
                "or syllable at a time.",
                "After each learner turn, state one concrete thing you heard and offer at most one "
                "gentle correction. If uncertain, say that you could not hear clearly and invite "
                "one retry. Never invent a score, mastery result, completion result, or learner "
                "history. "
                "Never claim this optional conversation changes course progress.",
                "Keep every response to two short sentences or fewer. Do not introduce unrelated "
                "vocabulary. End warmly when the learner asks to stop or after the small sound-map "
                "practice is complete.",
            )
        )
