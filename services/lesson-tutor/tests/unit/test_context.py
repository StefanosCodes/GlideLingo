from pathlib import Path

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
