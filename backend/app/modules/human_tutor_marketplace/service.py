"""Tutor application state machine and authorization boundary."""

import asyncio
from uuid import UUID, uuid4

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    HumanTutorMarketplaceForbiddenError,
    HumanTutorMarketplaceUnavailableError,
    TutorApplicationConflictError,
    TutorApplicationNotFoundError,
)
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref
from app.modules.human_tutor_marketplace.repository import (
    ApplicationAlreadyExistsError,
    StoredTutorApplication,
    TutorApplicationRepository,
)
from app.modules.human_tutor_marketplace.schemas import (
    CreateTutorApplicationRequest,
    DecideTutorApplicationRequest,
    TutorApplicationQueue,
    TutorApplicationResponse,
)

REVIEW_CAPABILITY = "review_tutor_applications"


class HumanTutorMarketplaceService:
    def __init__(
        self,
        *,
        enabled: bool,
        repository: TutorApplicationRepository,
        pseudonym_key: bytes | None,
        actor_allowlist: tuple[str, ...],
    ) -> None:
        self._enabled = enabled
        self._repository = repository
        self._pseudonym_key = pseudonym_key
        self._actor_allowlist = frozenset(actor_allowlist)

    async def create_application(
        self,
        *,
        principal: ClerkPrincipal,
        request: CreateTutorApplicationRequest,
    ) -> TutorApplicationResponse:
        actor_ref = self._actor_ref(principal)
        existing = await asyncio.to_thread(self._repository.get_by_actor, actor_ref=actor_ref)
        if existing is not None:
            if existing.status == "draft" and self._matches(existing, request):
                return self._response(existing)
            raise TutorApplicationConflictError
        try:
            created = await asyncio.to_thread(
                self._repository.create_draft,
                application_id=uuid4(),
                actor_ref=actor_ref,
                request=request,
            )
        except ApplicationAlreadyExistsError:
            raced = await asyncio.to_thread(self._repository.get_by_actor, actor_ref=actor_ref)
            if raced is not None and raced.status == "draft" and self._matches(raced, request):
                return self._response(raced)
            raise TutorApplicationConflictError from None
        return self._response(created)

    async def get_own_application(self, *, principal: ClerkPrincipal) -> TutorApplicationResponse:
        actor_ref = self._actor_ref(principal)
        application = await asyncio.to_thread(self._repository.get_by_actor, actor_ref=actor_ref)
        if application is None:
            raise TutorApplicationNotFoundError
        return self._response(application)

    async def submit_application(
        self,
        *,
        principal: ClerkPrincipal,
        expected_version: int,
    ) -> TutorApplicationResponse:
        actor_ref = self._actor_ref(principal)
        application = await asyncio.to_thread(
            self._repository.submit,
            actor_ref=actor_ref,
            expected_version=expected_version,
        )
        if application is not None:
            return self._response(application)
        current = await asyncio.to_thread(self._repository.get_by_actor, actor_ref=actor_ref)
        if current is None:
            raise TutorApplicationNotFoundError
        if current.status != "draft" and current.version > expected_version:
            return self._response(current)
        raise TutorApplicationConflictError

    async def list_review_queue(
        self,
        *,
        principal: ClerkPrincipal,
        offset: int,
        limit: int,
    ) -> TutorApplicationQueue:
        await self._operator_ref(principal)
        applications, has_more = await asyncio.to_thread(
            self._repository.list_review_queue,
            offset=offset,
            limit=limit,
        )
        return TutorApplicationQueue(
            items=[self._response(application) for application in applications],
            offset=offset,
            limit=limit,
            has_more=has_more,
        )

    async def start_review(
        self,
        *,
        principal: ClerkPrincipal,
        application_id: UUID,
        expected_version: int,
    ) -> TutorApplicationResponse:
        operator_ref = await self._operator_ref(principal)
        current = await self._current_application_or_raise(application_id)
        if current.actor_ref == operator_ref:
            raise HumanTutorMarketplaceForbiddenError
        application = await asyncio.to_thread(
            self._repository.start_review,
            application_id=application_id,
            operator_actor_ref=operator_ref,
            expected_version=expected_version,
        )
        if application is not None:
            return self._response(application)
        current = await self._current_application_or_raise(application_id)
        if (
            current.status == "under_review"
            and current.reviewer_actor_ref == operator_ref
            and current.version == expected_version + 1
        ):
            return self._response(current)
        raise TutorApplicationConflictError

    async def decide_application(
        self,
        *,
        principal: ClerkPrincipal,
        application_id: UUID,
        request: DecideTutorApplicationRequest,
    ) -> TutorApplicationResponse:
        operator_ref = await self._operator_ref(principal)
        current = await self._current_application_or_raise(application_id)
        if current.actor_ref == operator_ref:
            raise HumanTutorMarketplaceForbiddenError
        application = await asyncio.to_thread(
            self._repository.decide,
            application_id=application_id,
            operator_actor_ref=operator_ref,
            decision=request.decision,
            reason=request.reason,
            expected_version=request.expected_version,
        )
        if application is not None:
            return self._response(application)
        current = await self._current_application_or_raise(application_id)
        if (
            current.status == request.decision
            and current.reviewer_actor_ref == operator_ref
            and current.decision_reason == request.reason
            and current.version == request.expected_version + 1
        ):
            return self._response(current)
        raise TutorApplicationConflictError

    def _actor_ref(self, principal: ClerkPrincipal) -> str:
        if not self._enabled or self._pseudonym_key is None:
            raise HumanTutorMarketplaceUnavailableError
        if principal.user_id not in self._actor_allowlist:
            raise HumanTutorMarketplaceForbiddenError
        return derive_marketplace_actor_ref(
            key=self._pseudonym_key,
            clerk_user_id=principal.user_id,
        )

    async def _operator_ref(self, principal: ClerkPrincipal) -> str:
        actor_ref = self._actor_ref(principal)
        allowed = await asyncio.to_thread(
            self._repository.has_operator_capability,
            actor_ref=actor_ref,
            capability=REVIEW_CAPABILITY,
        )
        if not allowed:
            raise HumanTutorMarketplaceForbiddenError
        return actor_ref

    async def _current_application_or_raise(self, application_id: UUID) -> StoredTutorApplication:
        current = await asyncio.to_thread(self._repository.get_by_id, application_id=application_id)
        if current is None:
            raise TutorApplicationNotFoundError
        return current

    @staticmethod
    def _matches(
        application: StoredTutorApplication,
        request: CreateTutorApplicationRequest,
    ) -> bool:
        return (
            application.headline == request.headline
            and application.biography == request.biography
            and application.time_zone == request.time_zone
            and application.languages == tuple(request.languages)
            and application.specialties == tuple(request.specialties)
        )

    @staticmethod
    def _response(application: StoredTutorApplication) -> TutorApplicationResponse:
        return TutorApplicationResponse(
            application_id=application.application_id,
            status=application.status,
            version=application.version,
            headline=application.headline,
            biography=application.biography,
            time_zone=application.time_zone,
            languages=list(application.languages),
            specialties=list(application.specialties),
            submitted_at=application.submitted_at,
            reviewed_at=application.reviewed_at,
            decision_reason=application.decision_reason,
        )
