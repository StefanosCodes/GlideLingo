import json
import shutil
from pathlib import Path
from typing import cast
from uuid import UUID

import pytest

from app.core.config import Settings
from app.modules.voice.scenario_resolver import (
    AuthoredVoiceScenarioResolver,
    voice_publication_hash,
)
from app.modules.voice.schemas import CreatePrivateVoiceSessionRequest

SCENARIO_PATH = Path("courses/en-el-GR/voice/scenarios/el-letters-1-voice-v1.json")
LESSON_PATH = Path("courses/en-el-GR/missions/el-letters-1.json")
PUBLICATION_PATH = Path("courses/en-el-GR/voice/publication.json")


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


def copy_content(tmp_path: Path) -> Path:
    root = tmp_path / "content"
    shutil.copytree(Settings(_env_file=None).content_root, root)
    return root


def publish(root: Path, **changes: object) -> dict[str, object]:
    path = root / PUBLICATION_PATH
    publication = cast(dict[str, object], json.loads(path.read_text(encoding="utf-8")))
    publication.update(
        {
            "status": "published",
            "validatorStatus": "passed",
            "publishedAt": "2026-09-04T12:00:00Z",
            "reviews": {
                "curriculum": "approved",
                "instructionalDesign": "approved",
                "languagePragmatics": "approved",
                "accessibility": "approved",
            },
            "contentHash": voice_publication_hash(root, SCENARIO_PATH, LESSON_PATH),
            **changes,
        }
    )
    path.write_text(json.dumps(publication), encoding="utf-8")
    return publication


def resolver(root: Path) -> AuthoredVoiceScenarioResolver:
    return AuthoredVoiceScenarioResolver(content_root=root)


def test_resolves_only_a_published_hash_bound_scenario(tmp_path: Path) -> None:
    root = copy_content(tmp_path)
    publication = publish(root)

    resolved = resolver(root).resolve(request(), voice_id="configured-voice")

    assert resolved.spec.model_dump() == {
        "course_id": "el-from-zero",
        "course_version": "greek-foundations-v1",
        "course_content_hash": publication["contentHash"],
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


def test_checked_in_draft_content_is_rejected_by_default() -> None:
    root = Settings(_env_file=None).content_root
    with pytest.raises(ValueError, match="not published"):
        resolver(root).resolve(request(), voice_id="configured-voice")


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
    root = Settings(_env_file=None).content_root
    with pytest.raises(ValueError, match="not authored"):
        resolver(root).resolve(
            request(course_id=course_id, scenario_id=scenario_id),
            voice_id="configured-voice",
        )


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"status": "retired"}, "retired"),
        ({"status": "draft"}, "not published"),
        ({"validatorStatus": "pending"}, "not validated"),
        ({"publishedAt": None}, "not validated"),
        (
            {
                "reviews": {
                    "curriculum": "approved",
                    "instructionalDesign": "approved",
                    "languagePragmatics": "approved",
                }
            },
            "incomplete",
        ),
        (
            {
                "reviews": {
                    "curriculum": "pending",
                    "instructionalDesign": "approved",
                    "languagePragmatics": "approved",
                    "accessibility": "approved",
                }
            },
            "incomplete",
        ),
    ],
)
def test_rejects_unpublishable_course_states(
    tmp_path: Path, changes: dict[str, object], message: str
) -> None:
    root = copy_content(tmp_path)
    publish(root, **changes)
    with pytest.raises(ValueError, match=message):
        resolver(root).resolve(request(), voice_id="configured-voice")


def test_rejects_an_invalid_publication_timestamp(tmp_path: Path) -> None:
    root = copy_content(tmp_path)
    publish(root, publishedAt="not-a-timestamp")
    with pytest.raises(ValueError, match="could not be loaded"):
        resolver(root).resolve(request(), voice_id="configured-voice")


def test_rejects_content_changed_after_publication(tmp_path: Path) -> None:
    root = copy_content(tmp_path)
    publish(root)
    scenario_path = root / SCENARIO_PATH
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario["learnerGoal"] = "Tampered after publication"
    scenario_path.write_text(json.dumps(scenario), encoding="utf-8")
    with pytest.raises(ValueError, match="hash does not match"):
        resolver(root).resolve(request(), voice_id="configured-voice")


def test_rejects_missing_or_mismatched_authored_lesson_content(tmp_path: Path) -> None:
    missing_root = copy_content(tmp_path / "missing")
    publish(missing_root)
    (missing_root / LESSON_PATH).unlink()
    with pytest.raises(ValueError, match="could not be loaded"):
        resolver(missing_root).resolve(request(), voice_id="configured-voice")

    mismatch_root = copy_content(tmp_path / "mismatch")
    lesson_path = mismatch_root / LESSON_PATH
    lesson = json.loads(lesson_path.read_text(encoding="utf-8"))
    lesson["capability"]["id"] = "placeholder-capability"
    lesson_path.write_text(json.dumps(lesson), encoding="utf-8")
    publish(mismatch_root)
    with pytest.raises(ValueError, match="does not match"):
        resolver(mismatch_root).resolve(request(), voice_id="configured-voice")
