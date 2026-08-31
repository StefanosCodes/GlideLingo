import asyncio
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest

from app.core.config import Settings
from app.core.errors import LessonContextNotFoundError
from app.integrations.openai.lesson_tutor_agent import OpenAILessonTutorAgent
from app.modules.lesson_tutor.schemas import LessonTutorTurnRequest
from app.modules.lesson_tutor.service import LessonTutorService

CASES_PATH = Path(__file__).resolve().parents[2] / "evals" / "lesson_tutor" / "cases.json"
CASES: list[dict[str, Any]] = json.loads(CASES_PATH.read_text(encoding="utf-8"))
ACTOR_REF = "tusr_v1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"


@pytest.mark.live_agent
@pytest.mark.parametrize("case", CASES, ids=[str(case["id"]) for case in CASES])
def test_live_lesson_tutor_smoke_case(case: dict[str, Any]) -> None:
    settings = Settings()
    assert settings.enabled, "Set GLIDELINGO_TUTOR_ENABLED=true"
    assert settings.openai_api_key is not None, "Set OPENAI_API_KEY"
    agent = OpenAILessonTutorAgent(
        api_key=settings.openai_api_key.get_secret_value(),
        model=settings.openai_model,
        provider_timeout_seconds=settings.model_deadline_seconds,
    )
    service = LessonTutorService(
        enabled=True,
        agent=agent,
        content_root=settings.content_root,
        deadline_seconds=settings.service_deadline_seconds,
    )
    lesson_id = str(case.get("lesson_id", "el-letters-1"))
    request = LessonTutorTurnRequest(
        actor_ref=ACTOR_REF,
        turn_ref=uuid4(),
        lesson_id=lesson_id,
        visible_step_index=int(case["visible_step_index"]),
        selected_choice=case["selected_choice"],
        message=str(case["message"]),
        history=case["history"],
    )

    async def run_case() -> None:
        try:
            if lesson_id == "missing-lesson":
                with pytest.raises(LessonContextNotFoundError):
                    await service.turn(request)
                return
            response = await service.turn(request)
            assert response.prompt_version == "lesson-tutor-v1"
            assert 0 < len(response.reply) <= 3000
        finally:
            await agent.close()

    asyncio.run(run_case())
