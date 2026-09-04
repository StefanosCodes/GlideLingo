import json
import shutil
from pathlib import Path

import pytest

from app.core.errors import LessonContextNotFoundError
from app.modules.lesson_tutor.context import load_lesson_context

CONTENT_ROOT = Path(__file__).resolve().parents[4] / "content"


def test_context_keeps_future_steps_hidden_and_preserves_answer_aliases() -> None:
    context = load_lesson_context(
        content_root=CONTENT_ROOT,
        lesson_id="el-letters-1",
        visible_step_index=5,
        selected_choice=None,
    )
    assert "Step 7" not in context.model_visible_context
    assert context.answer_attempted is False
    assert "alpha" in context.answer_disclosure_terms


def test_context_is_adapted_from_the_canonical_course_lesson() -> None:
    context = load_lesson_context(
        content_root=CONTENT_ROOT,
        lesson_id="el-letters-1",
        visible_step_index=6,
        selected_choice="na",
    )

    assert context.lesson_title == "The sound of Greek"
    assert context.module_title == "The Greek sound map"
    assert "Objective: Recognize α, ε, and ι" in context.model_visible_context
    assert "Step 8" not in context.model_visible_context
    assert context.canonical_answer == "na"
    assert context.answer_attempted is True


def test_context_fails_closed_when_canonical_lesson_metadata_mismatches(
    tmp_path: Path,
) -> None:
    content_root = tmp_path / "content"
    shutil.copytree(CONTENT_ROOT, content_root)
    mission_path = content_root / "courses/en-el-GR/missions/el-letters-sound-map.json"
    mission = json.loads(mission_path.read_text(encoding="utf-8"))
    mission["lessons"][0]["missionId"] = "stale-legacy-mission"
    mission_path.write_text(json.dumps(mission), encoding="utf-8")

    with pytest.raises(LessonContextNotFoundError):
        load_lesson_context(
            content_root=content_root,
            lesson_id="el-letters-1",
            visible_step_index=0,
            selected_choice=None,
        )


def test_context_fails_closed_when_canonical_package_is_missing(tmp_path: Path) -> None:
    with pytest.raises(LessonContextNotFoundError):
        load_lesson_context(
            content_root=tmp_path,
            lesson_id="el-letters-1",
            visible_step_index=0,
            selected_choice=None,
        )
