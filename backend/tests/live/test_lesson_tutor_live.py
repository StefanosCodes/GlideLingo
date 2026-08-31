import asyncio
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest

from app.core.config import Settings
from app.integrations.openai.lesson_tutor_agent import OpenAILessonTutorAgent
from app.modules.lesson_tutor.schemas import LessonTutorTurnRequest
from app.modules.lesson_tutor.service import LessonTutorService

CASES_PATH = Path(__file__).resolve().parents[2] / "evals" / "lesson_tutor" / "cases.json"
CASES: list[dict[str, Any]] = json.loads(CASES_PATH.read_text(encoding="utf-8"))


@pytest.mark.live_agent
@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_live_lesson_tutor_case(case: dict[str, Any]) -> None:
    settings = Settings()
    assert settings.lesson_tutor_enabled, "Set GLIDELINGO_LESSON_TUTOR_ENABLED=true"
    assert settings.openai_api_key is not None, "Set OPENAI_API_KEY"
    agent = OpenAILessonTutorAgent(
        api_key=settings.openai_api_key.get_secret_value(),
        model=settings.openai_model,
    )
    service = LessonTutorService(
        enabled=True,
        agent=agent,
        content_root=settings.lesson_content_root,
        deadline_seconds=settings.lesson_tutor_deadline_seconds,
    )
    lesson_id = str(case.get("lesson_id", "el-letters-1"))
    request = LessonTutorTurnRequest(
        conversation_id=uuid4(),
        lesson_id=lesson_id,
        visible_step_index=int(case["visible_step_index"]),
        selected_choice=case["selected_choice"],
        message=str(case["message"]),
        history=case["history"],
    )

    if lesson_id == "missing-lesson":
        from app.core.errors import LessonContextNotFoundError

        with pytest.raises(LessonContextNotFoundError):
            asyncio.run(service.turn(request))
        return

    response = asyncio.run(service.turn(request))
    assert response.prompt_version == "lesson-tutor-v1"
    assert 0 < len(response.reply) <= 3000
