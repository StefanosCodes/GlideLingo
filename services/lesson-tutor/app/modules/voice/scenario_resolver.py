"""Fail-closed resolution of published, course-owned Realtime voice scenarios."""

import json
from hashlib import sha256
from pathlib import Path
from typing import Annotated, Literal, TypeVar

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from app.modules.lesson_tutor.context import LESSON_FILES, AuthoredLesson
from app.modules.voice.schemas import CreatePrivateVoiceSessionRequest, VoiceSessionSpec
from app.modules.voice.service import ResolvedVoiceScenario

Identifier = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=100,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
    ),
]
BoundedText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)
]
ContentHash = Annotated[str, StringConstraints(pattern=r"^sha256:[a-f0-9]{64}$")]
ModelT = TypeVar("ModelT", bound=BaseModel)

_PUBLICATION_PATH = Path("courses/en-el-GR/voice/publication.json")
_SCENARIO_PATHS = {
    "el-letters-1-voice-v1": Path("courses/en-el-GR/voice/scenarios/el-letters-1-voice-v1.json")
}
_REQUIRED_REVIEWS = {
    "curriculum",
    "instructionalDesign",
    "languagePragmatics",
    "accessibility",
}


class VoicePublication(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal[1]
    id: Literal["el-foundations-voice-publication"]
    courseId: Literal["el-from-zero"]
    courseVersion: Identifier
    status: Literal["draft", "published", "retired"]
    contentHash: ContentHash
    validatorStatus: Literal["pending", "passed", "failed"]
    publishedAt: AwareDatetime | None
    reviews: dict[str, Literal["pending", "approved", "rejected"]]
    knownLimitations: list[BoundedText] = Field(max_length=16)


class VoiceScenarioRole(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: BoundedText
    persona: BoundedText


class AuthoredVoiceScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal[1]
    id: Identifier
    version: Identifier
    courseId: Identifier
    lessonId: Identifier
    targetCapabilityIds: list[Identifier] = Field(min_length=1, max_length=8)
    setting: BoundedText
    learnerGoal: BoundedText
    role: VoiceScenarioRole
    languageLevel: Identifier
    allowedResources: list[BoundedText] = Field(min_length=1, max_length=32)
    authoredOpening: BoundedText
    correctionPolicy: Identifier
    maximumDurationSeconds: int = Field(ge=60, le=600)
    safeExits: list[BoundedText] = Field(min_length=1, max_length=8)
    conversationProfileId: Identifier


class AuthoredVoiceCapability(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Identifier


class AuthoredVoiceLesson(AuthoredLesson):
    capability: AuthoredVoiceCapability


def voice_publication_hash(content_root: Path, scenario_path: Path, lesson_path: Path) -> str:
    """Hash the exact authored files admitted by the publication record."""

    root = content_root.resolve()
    digest = sha256()
    for relative_path in sorted((scenario_path, lesson_path), key=lambda path: path.as_posix()):
        absolute_path = (root / relative_path).resolve()
        if not absolute_path.is_relative_to(root):
            raise ValueError("The authored voice content path escaped the content root")
        try:
            payload = absolute_path.read_bytes()
        except OSError as error:
            raise ValueError("The authored voice content could not be hashed") from error
        digest.update(relative_path.as_posix().encode())
        digest.update(b"\0")
        digest.update(payload)
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


class AuthoredVoiceScenarioResolver:
    """Resolve only allowlisted scenarios from a fully published authored Course slice."""

    def __init__(self, *, content_root: Path) -> None:
        self._content_root = content_root.resolve()

    def resolve(
        self, request: CreatePrivateVoiceSessionRequest, *, voice_id: str
    ) -> ResolvedVoiceScenario:
        scenario_path = _SCENARIO_PATHS.get(request.scenario_id)
        if request.course_id != "el-from-zero" or scenario_path is None:
            raise ValueError("The requested voice scenario is not authored")
        publication = self._published_publication()
        scenario = self._read(scenario_path, AuthoredVoiceScenario)
        lesson_path = LESSON_FILES.get(scenario.lessonId)
        if lesson_path is None:
            raise ValueError("The authored voice scenario lesson is not allowlisted")
        lesson = self._read(lesson_path, AuthoredVoiceLesson)
        if (
            scenario.id != request.scenario_id
            or scenario.courseId != request.course_id
            or lesson.lessonId != scenario.lessonId
            or scenario.targetCapabilityIds != [lesson.capability.id]
        ):
            raise ValueError("The authored voice scenario does not match its Course lesson")
        expected_hash = voice_publication_hash(self._content_root, scenario_path, lesson_path)
        if publication.contentHash != expected_hash:
            raise ValueError("The published voice content hash does not match the authored files")
        return ResolvedVoiceScenario(
            spec=VoiceSessionSpec(
                course_id=publication.courseId,
                course_version=publication.courseVersion,
                course_content_hash=publication.contentHash,
                scenario_id=scenario.id,
                scenario_version=scenario.version,
                conversation_mode=request.conversation_mode,
                source_locale=request.source_locale,
                target_locale=request.target_locale,
                persona_id=scenario.conversationProfileId,
                voice_id=voice_id,
                learner_level=scenario.languageLevel,
                capability_ids=scenario.targetCapabilityIds,
                correction_policy_version=scenario.correctionPolicy,
                evidence_policy_version="voice-practice-no-credit-v1",
                maximum_duration_seconds=scenario.maximumDurationSeconds,
            ),
            instructions=self._instructions(lesson, scenario),
        )

    def _published_publication(self) -> VoicePublication:
        publication = self._read(_PUBLICATION_PATH, VoicePublication)
        if publication.status == "retired":
            raise ValueError("The authored voice Course publication is retired")
        if publication.status != "published":
            raise ValueError("The authored voice Course content is not published")
        if publication.validatorStatus != "passed" or publication.publishedAt is None:
            raise ValueError("The authored voice Course publication is not validated")
        if set(publication.reviews) != _REQUIRED_REVIEWS or any(
            status != "approved" for status in publication.reviews.values()
        ):
            raise ValueError("The authored voice Course publication reviews are incomplete")
        return publication

    def _read(self, relative_path: Path, model: type[ModelT]) -> ModelT:
        try:
            payload = json.loads((self._content_root / relative_path).read_text(encoding="utf-8"))
            return model.model_validate(payload)
        except (OSError, json.JSONDecodeError, ValidationError) as error:
            raise ValueError("The authored voice Course content could not be loaded") from error

    @staticmethod
    def _instructions(lesson: AuthoredVoiceLesson, scenario: AuthoredVoiceScenario) -> str:
        return "\n".join(
            (
                f"You are GlideLingo's {scenario.role.name}: {scenario.role.persona}.",
                f"This is optional guided practice for the published lesson: {lesson.lessonTitle}.",
                f"Learning objective: {lesson.objective}",
                f"Setting: {scenario.setting}",
                f"Learner goal: {scenario.learnerGoal}",
                "",
                "Stay strictly within these authored resources: "
                f"{', '.join(scenario.allowedResources)}.",
                f"Opening: {scenario.authoredOpening}",
                "Use short English directions and brief Modern Greek examples. Practice only one "
                "authored sound, word, or syllable at a time.",
                f"Correction policy: {scenario.correctionPolicy}.",
                "After each learner turn, state one concrete thing you heard and offer at most one "
                "gentle correction. If uncertain, say that you could not hear clearly and invite "
                "one retry. Never invent a score, mastery result, completion result, learner "
                "history, or progress update.",
                "Keep every response to two short sentences or fewer. Do not introduce unrelated "
                "vocabulary. " + " ".join(scenario.safeExits),
            )
        )
