import asyncio

import pytest

from app.auth.clerk import ClerkPrincipal
from app.core.errors import LessonTutorNotSentError, LessonTutorTimeoutError
from app.integrations.lesson_tutor.client import PrivateLessonTutorTurn
from app.modules.lesson_tutor.guard import GuardAdmission
from app.modules.lesson_tutor.schemas import LessonTutorTurnRequest, LessonTutorTurnResponse
from app.modules.lesson_tutor.service import LessonTutorService

REQUEST = LessonTutorTurnRequest(
    conversation_id="00000000-0000-4000-8000-000000000001",
    lesson_id="el-letters-1",
    visible_step_index=2,
    selected_choice=None,
    message="Why?",
    history=[],
)
PRINCIPAL = ClerkPrincipal(user_id="user_secret", issuer="https://clerk.test")


class FakeGuard:
    def __init__(self, admission: GuardAdmission) -> None:
        self.admission = admission
        self.failures: list[str] = []
        self.completed = 0

    def admit(self, **_kwargs: object) -> GuardAdmission:
        return self.admission

    def complete(self, **_kwargs: object) -> None:
        self.completed += 1

    def fail(self, *, outcome: str, **_kwargs: object) -> None:
        self.failures.append(outcome)


class FakeGateway:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls = 0
        self.request: PrivateLessonTutorTurn | None = None

    async def turn(
        self, request: PrivateLessonTutorTurn, *, request_id: str
    ) -> LessonTutorTurnResponse:
        self.calls += 1
        self.request = request
        if self.error is not None:
            raise self.error
        return LessonTutorTurnResponse(reply="Safe reply", prompt_version="lesson-tutor-v1")

    async def close(self) -> None:
        return None


def service(guard: FakeGuard, gateway: FakeGateway) -> LessonTutorService:
    return LessonTutorService(
        enabled=True,
        guard=guard,
        gateway=gateway,
        pseudonym_key=b"gateway-service-test-key-at-least-32-bytes",
    )


def run_turn(guard: FakeGuard, gateway: FakeGateway) -> LessonTutorTurnResponse:
    return asyncio.run(
        service(guard, gateway).turn(
            REQUEST,
            principal=PRINCIPAL,
            idempotency_key="test-idempotency-key-0001",
            request_id="req_test",
        )
    )


def test_completed_replay_makes_zero_private_calls() -> None:
    replay = LessonTutorTurnResponse(reply="Prior", prompt_version="lesson-tutor-v1")
    guard = FakeGuard(GuardAdmission(turn_ref=None, replay=replay))
    gateway = FakeGateway()
    assert run_turn(guard, gateway) == replay
    assert gateway.calls == 0


@pytest.mark.parametrize(
    ("error", "outcome"),
    [
        (LessonTutorNotSentError(), "retryable"),
        (LessonTutorTimeoutError(), "ambiguous"),
        (RuntimeError("post-send failure"), "ambiguous"),
    ],
)
def test_failure_classification_is_conservative(error: Exception, outcome: str) -> None:
    guard = FakeGuard(GuardAdmission(turn_ref="00000000-0000-4000-8000-000000000002"))
    gateway = FakeGateway(error)
    with pytest.raises(type(error)):
        run_turn(guard, gateway)
    assert guard.failures == [outcome]


def test_private_request_has_pseudonym_but_no_public_identity_or_conversation_id() -> None:
    guard = FakeGuard(GuardAdmission(turn_ref="00000000-0000-4000-8000-000000000002"))
    gateway = FakeGateway()
    run_turn(guard, gateway)
    assert gateway.request is not None
    payload = gateway.request.model_dump(mode="json")
    assert payload["actor_ref"].startswith("tusr_v1_")
    assert "conversation_id" not in payload
    assert PRINCIPAL.user_id not in str(payload)
    assert guard.completed == 1
