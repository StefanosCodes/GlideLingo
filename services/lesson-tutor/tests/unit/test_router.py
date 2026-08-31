from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.modules.lesson_tutor.service import LessonTutorService

PAYLOAD = {
    "actor_ref": "tusr_v1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "turn_ref": "00000000-0000-4000-8000-000000000001",
    "lesson_id": "el-letters-1",
    "visible_step_index": 2,
    "selected_choice": None,
    "message": "Why?",
    "history": [],
}


class FakeAgent:
    async def reply(self, **_kwargs: object) -> str:
        return "A bounded reply."


def test_private_contract_rejects_raw_identity_and_conversation_fields() -> None:
    service = LessonTutorService(
        enabled=True,
        agent=FakeAgent(),
        content_root=Path(__file__).resolve().parents[4] / "content",
        deadline_seconds=5,
    )
    with TestClient(create_app(Settings(_env_file=None), lesson_tutor_service=service)) as client:
        response = client.post(
            "/internal/v1/lesson-tutor/turns",
            json={**PAYLOAD, "user_id": "user_raw", "conversation_id": PAYLOAD["turn_ref"]},
        )
    assert response.status_code == 422


def test_disabled_private_route_makes_no_agent_call() -> None:
    with TestClient(create_app(Settings(_env_file=None))) as client:
        response = client.post("/internal/v1/lesson-tutor/turns", json=PAYLOAD)
    assert response.status_code == 503
