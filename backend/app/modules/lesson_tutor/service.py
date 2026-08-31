"""Authenticated public orchestration for one private tutor turn."""

import asyncio
import hashlib
import json
from typing import Protocol
from uuid import UUID, uuid4

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    LessonTutorNotSentError,
    LessonTutorTimeoutError,
    LessonTutorUnavailableError,
)
from app.integrations.lesson_tutor.client import PrivateLessonTutorTurn
from app.modules.lesson_tutor.guard import LessonTutorGuard
from app.modules.lesson_tutor.identity import derive_tutor_actor_ref
from app.modules.lesson_tutor.schemas import LessonTutorTurnRequest, LessonTutorTurnResponse


class LessonTutorGateway(Protocol):
    async def turn(
        self, request: PrivateLessonTutorTurn, *, request_id: str
    ) -> LessonTutorTurnResponse: ...

    async def close(self) -> None: ...


class LessonTutorService:
    def __init__(
        self,
        *,
        enabled: bool,
        gateway: LessonTutorGateway | None,
        guard: LessonTutorGuard | None,
        pseudonym_key: bytes | None,
        operation_deadline_seconds: float = 11,
    ) -> None:
        self._enabled = enabled
        self._gateway = gateway
        self._guard = guard
        self._pseudonym_key = pseudonym_key
        self._operation_deadline_seconds = operation_deadline_seconds

    async def turn(
        self,
        request: LessonTutorTurnRequest,
        *,
        principal: ClerkPrincipal,
        idempotency_key: str,
        request_id: str,
    ) -> LessonTutorTurnResponse:
        try:
            async with asyncio.timeout(self._operation_deadline_seconds):
                return await self._run_turn(
                    request,
                    principal=principal,
                    idempotency_key=idempotency_key,
                    request_id=request_id,
                )
        except TimeoutError as error:
            raise LessonTutorTimeoutError from error

    def ensure_available(self) -> None:
        if (
            not self._enabled
            or self._gateway is None
            or self._guard is None
            or self._pseudonym_key is None
        ):
            raise LessonTutorUnavailableError

    async def _run_turn(
        self,
        request: LessonTutorTurnRequest,
        *,
        principal: ClerkPrincipal,
        idempotency_key: str,
        request_id: str,
    ) -> LessonTutorTurnResponse:
        self.ensure_available()
        assert self._gateway is not None
        assert self._guard is not None
        assert self._pseudonym_key is not None

        actor_ref = derive_tutor_actor_ref(key=self._pseudonym_key, principal=principal)
        canonical_request = json.dumps(
            request.model_dump(mode="json"), sort_keys=True, separators=(",", ":")
        )
        fingerprint = hashlib.sha256(canonical_request.encode()).hexdigest()
        generated_turn_ref = uuid4()
        admission = await asyncio.to_thread(
            self._guard.admit,
            actor_ref=actor_ref,
            idempotency_key=idempotency_key,
            fingerprint=fingerprint,
            turn_ref=str(generated_turn_ref),
        )
        if admission.replay is not None:
            return admission.replay
        if admission.turn_ref is None:
            raise LessonTutorUnavailableError

        private_request = PrivateLessonTutorTurn.from_public(
            actor_ref=actor_ref,
            turn_ref=UUID(admission.turn_ref),
            request=request,
        )
        try:
            response = await self._gateway.turn(private_request, request_id=request_id)
        except asyncio.CancelledError:
            await asyncio.shield(
                asyncio.wait_for(
                    asyncio.to_thread(
                        self._guard.fail,
                        actor_ref=actor_ref,
                        idempotency_key=idempotency_key,
                        outcome="ambiguous",
                    ),
                    timeout=2.5,
                )
            )
            raise
        except LessonTutorTimeoutError:
            await asyncio.to_thread(
                self._guard.fail,
                actor_ref=actor_ref,
                idempotency_key=idempotency_key,
                outcome="ambiguous",
            )
            raise
        except LessonTutorNotSentError:
            await asyncio.to_thread(
                self._guard.fail,
                actor_ref=actor_ref,
                idempotency_key=idempotency_key,
                outcome="retryable",
            )
            raise
        except Exception:
            await asyncio.to_thread(
                self._guard.fail,
                actor_ref=actor_ref,
                idempotency_key=idempotency_key,
                outcome="ambiguous",
            )
            raise

        await asyncio.to_thread(
            self._guard.complete,
            actor_ref=actor_ref,
            idempotency_key=idempotency_key,
            response=response,
        )
        return response
