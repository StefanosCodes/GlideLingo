from uuid import UUID

import pytest

from app.core.config import Settings
from app.modules.voice.scenario_resolver import AuthoredVoiceScenarioResolver
from app.modules.voice.schemas import CreatePrivateVoiceSessionRequest


def request(**changes: object) -> CreatePrivateVoiceSessionRequest:
    values: dict[str, object] = {
        "actor_ref": "vusr_v1_" + "a" * 43,
        "application_session_id": UUID("00000000-0000-4000-8000-000000000001"),
        "course_id": "el-from-zero",
        "scenario_id": "el-letters-1-voice-v1",
        "source_locale": "en",
        "target_locale": "el-GR",
        "conversation_mode": "guided",
        "captions_enabled": True,
        "offer_sdp": "v=0\r\na=offer-data-for-scenario-test",
    }
    values.update(changes)
    return CreatePrivateVoiceSessionRequest.model_validate(values)


def resolver() -> AuthoredVoiceScenarioResolver:
    return AuthoredVoiceScenarioResolver(content_root=Settings(_env_file=None).content_root)


def test_resolves_the_allowlisted_scenario_from_checked_in_lesson_content() -> None:
    resolved = resolver().resolve(request(), voice_id="configured-voice")

    assert resolved.spec.model_dump() == {
        "course_id": "el-from-zero",
        "course_version": "greek-foundations-v1",
        "scenario_id": "el-letters-1-voice-v1",
        "scenario_version": "1.0.0",
        "conversation_mode": "guided",
        "source_locale": "en",
        "target_locale": "el-GR",
        "persona_id": "greek-sound-guide-v1",
        "voice_id": "configured-voice",
        "learner_level": "A0-A1",
        "capability_ids": ["el-script-vowels-a-e-i"],
        "correction_policy_version": "gentle-pronunciation-recast-v1",
        "evidence_policy_version": "voice-practice-no-credit-v1",
        "maximum_duration_seconds": 300,
    }
    assert "The Greek sound map" in resolved.instructions
    assert "Recognize α, ε, and ι" in resolved.instructions
    assert "Never invent a score, mastery result" in resolved.instructions


@pytest.mark.parametrize(
    ("course_id", "scenario_id"),
    [
        ("other-course", "el-letters-1-voice-v1"),
        ("el-from-zero", "free-form-scenario"),
        ("el-from-zero", "el-greeting-introduction-v1"),
    ],
)
def test_rejects_every_course_and_scenario_outside_the_allowlist(
    course_id: str, scenario_id: str
) -> None:
    with pytest.raises(ValueError, match="not authored"):
        resolver().resolve(
            request(course_id=course_id, scenario_id=scenario_id),
            voice_id="configured-voice",
        )
