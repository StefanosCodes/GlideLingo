"""Tutor application state machine and authorization boundary."""

import asyncio
from typing import Literal, cast
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
    StoredTutorProfile,
    TutorApplicationRepository,
)
from app.modules.human_tutor_marketplace.schemas import (
    ChangeTutorStatusRequest,
    CreateTutorApplicationRequest,
    DecideTutorApplicationRequest,
    DecideTutorCredentialRequest,
    MarketplacePolicyVersionResponse,
    PublicationBlocker,
    SaveTutorCredentialRequest,
    SaveTutorOfferingRequest,
    SetTutorPublicationRequest,
    TutorApplicationDraftFields,
    TutorApplicationQueue,
    TutorApplicationResponse,
    TutorCredentialResponse,
    TutorOfferingResponse,
    TutorProfileResponse,
    UpdateTutorApplicationDraftRequest,
    UpdateTutorProfileDraftRequest,
)

REVIEW_CAPABILITY = "review_tutor_applications"
STATUS_CAPABILITY = "manage_tutor_status"
CREDENTIAL_CAPABILITY = "verify_tutor_credentials"


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

    async def update_application_draft(
        self,
        *,
        principal: ClerkPrincipal,
        request: UpdateTutorApplicationDraftRequest,
    ) -> TutorApplicationResponse:
        actor_ref = self._actor_ref(principal)
        application = await asyncio.to_thread(
            self._repository.update_draft,
            actor_ref=actor_ref,
            request=request,
        )
        if application is not None:
            return self._response(application)
        current = await asyncio.to_thread(self._repository.get_by_actor, actor_ref=actor_ref)
        if current is None:
            raise TutorApplicationNotFoundError
        if (
            current.status == "draft"
            and current.version == request.expected_version + 1
            and self._matches(current, request)
        ):
            return self._response(current)
        raise TutorApplicationConflictError

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
        await self._operator_ref(principal, capability=REVIEW_CAPABILITY)
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
        operator_ref = await self._operator_ref(principal, capability=REVIEW_CAPABILITY)
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
        operator_ref = await self._operator_ref(principal, capability=REVIEW_CAPABILITY)
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

    async def get_own_profile(self, *, principal: ClerkPrincipal) -> TutorProfileResponse:
        actor_ref = self._actor_ref(principal)
        profile = await asyncio.to_thread(
            self._repository.get_profile_by_actor,
            actor_ref=actor_ref,
        )
        if profile is None:
            raise TutorApplicationNotFoundError
        return self._profile_response(profile)

    async def get_profile_for_operations(
        self,
        *,
        principal: ClerkPrincipal,
        application_id: UUID,
    ) -> TutorProfileResponse:
        await self._operator_ref(principal, capability=REVIEW_CAPABILITY)
        profile = await asyncio.to_thread(
            self._repository.get_profile_by_application_id,
            application_id=application_id,
        )
        if profile is None:
            raise TutorApplicationNotFoundError
        return self._profile_response(profile)

    async def update_profile_draft(
        self,
        *,
        principal: ClerkPrincipal,
        request: UpdateTutorProfileDraftRequest,
    ) -> TutorProfileResponse:
        actor_ref = self._actor_ref(principal)
        profile = await asyncio.to_thread(
            self._repository.update_profile_draft,
            actor_ref=actor_ref,
            request=request,
        )
        if profile is not None:
            return self._profile_response(profile)
        current = await self._current_profile_or_raise(actor_ref)
        if (
            current.version == request.expected_version + 1
            and current.headline == request.headline
            and current.biography == request.biography
            and current.time_zone == request.time_zone
        ):
            return self._profile_response(current)
        raise TutorApplicationConflictError

    async def save_credential(
        self,
        *,
        principal: ClerkPrincipal,
        request: SaveTutorCredentialRequest,
    ) -> TutorProfileResponse:
        actor_ref = self._actor_ref(principal)
        profile = await asyncio.to_thread(
            self._repository.save_credential,
            actor_ref=actor_ref,
            request=request,
        )
        if profile is not None:
            return self._profile_response(profile)
        current = await self._current_profile_or_raise(actor_ref)
        credential = current.credential
        if (
            credential is not None
            and credential.version == request.expected_version + 1
            and credential.verification_status == "unverified"
            and credential.credential_type == request.credential_type
            and credential.title == request.title
            and credential.issuer == request.issuer
        ):
            return self._profile_response(current)
        raise TutorApplicationConflictError

    async def decide_credential(
        self,
        *,
        principal: ClerkPrincipal,
        credential_id: UUID,
        request: DecideTutorCredentialRequest,
    ) -> TutorProfileResponse:
        operator_ref = await self._operator_ref(
            principal,
            capability=CREDENTIAL_CAPABILITY,
        )
        current = await asyncio.to_thread(
            self._repository.get_profile_by_credential_id,
            credential_id=credential_id,
        )
        if current is None:
            raise TutorApplicationNotFoundError
        if current.actor_ref == operator_ref:
            raise HumanTutorMarketplaceForbiddenError
        profile = await asyncio.to_thread(
            self._repository.decide_credential,
            credential_id=credential_id,
            operator_actor_ref=operator_ref,
            request_version=request.expected_version,
            decision=request.decision,
            reason=request.reason,
        )
        if profile is not None:
            return self._profile_response(profile)
        current = await asyncio.to_thread(
            self._repository.get_profile_by_credential_id,
            credential_id=credential_id,
        )
        credential = current.credential if current is not None else None
        if (
            credential is not None
            and credential.version == request.expected_version + 1
            and credential.verification_status == request.decision
            and credential.verification_reason == request.reason
            and credential.verified_by_actor_ref == operator_ref
        ):
            assert current is not None
            return self._profile_response(current)
        raise TutorApplicationConflictError

    async def save_offering(
        self,
        *,
        principal: ClerkPrincipal,
        request: SaveTutorOfferingRequest,
    ) -> TutorProfileResponse:
        actor_ref = self._actor_ref(principal)
        profile = await asyncio.to_thread(
            self._repository.save_offering,
            actor_ref=actor_ref,
            request=request,
        )
        if profile is not None:
            return self._profile_response(profile)
        current = await self._current_profile_or_raise(actor_ref)
        offering = current.offering
        if (
            offering is not None
            and offering.version == request.expected_version + 1
            and offering.state == "draft"
            and offering.title == request.title
            and offering.duration_minutes == request.duration_minutes
            and offering.amount_minor == request.amount_minor
            and offering.currency == request.currency
        ):
            return self._profile_response(current)
        raise TutorApplicationConflictError

    async def set_publication(
        self,
        *,
        principal: ClerkPrincipal,
        request: SetTutorPublicationRequest,
    ) -> TutorProfileResponse:
        actor_ref = self._actor_ref(principal)
        profile = await asyncio.to_thread(
            self._repository.set_publication,
            actor_ref=actor_ref,
            expected_profile_version=request.expected_profile_version,
            expected_offering_version=request.expected_offering_version,
            publish=request.publish,
        )
        if profile is not None:
            return self._profile_response(profile)
        current = await self._current_profile_or_raise(actor_ref)
        offering = current.offering
        if (
            offering is not None
            and current.version == request.expected_profile_version + 1
            and offering.version == request.expected_offering_version + 1
            and current.is_published is request.publish
            and (offering.state == "active") is request.publish
        ):
            return self._profile_response(current)
        raise TutorApplicationConflictError

    async def change_tutor_status(
        self,
        *,
        principal: ClerkPrincipal,
        application_id: UUID,
        request: ChangeTutorStatusRequest,
    ) -> TutorApplicationResponse:
        operator_ref = await self._operator_ref(principal, capability=STATUS_CAPABILITY)
        current = await self._current_application_or_raise(application_id)
        if current.actor_ref == operator_ref:
            raise HumanTutorMarketplaceForbiddenError
        application = await asyncio.to_thread(
            self._repository.change_tutor_status,
            application_id=application_id,
            operator_actor_ref=operator_ref,
            request=request,
        )
        if application is not None:
            return self._response(application)
        current = await self._current_application_or_raise(application_id)
        desired = "suspended" if request.action == "suspend" else "approved"
        if (
            current.status == desired
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

    async def _operator_ref(self, principal: ClerkPrincipal, *, capability: str) -> str:
        actor_ref = self._actor_ref(principal)
        allowed = await asyncio.to_thread(
            self._repository.has_operator_capability,
            actor_ref=actor_ref,
            capability=capability,
        )
        if not allowed:
            raise HumanTutorMarketplaceForbiddenError
        return actor_ref

    async def _current_application_or_raise(self, application_id: UUID) -> StoredTutorApplication:
        current = await asyncio.to_thread(self._repository.get_by_id, application_id=application_id)
        if current is None:
            raise TutorApplicationNotFoundError
        return current

    async def _current_profile_or_raise(self, actor_ref: str) -> StoredTutorProfile:
        current = await asyncio.to_thread(
            self._repository.get_profile_by_actor,
            actor_ref=actor_ref,
        )
        if current is None:
            raise TutorApplicationNotFoundError
        return current

    @staticmethod
    def _matches(
        application: StoredTutorApplication,
        request: TutorApplicationDraftFields,
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

    @staticmethod
    def _profile_response(profile: StoredTutorProfile) -> TutorProfileResponse:
        blockers: list[PublicationBlocker] = []
        if profile.application_status != "approved":
            blockers.append("application_not_approved")
        if not profile.payout_ready:
            blockers.append("payout_not_ready")
        if profile.offering is None:
            blockers.append("offering_missing")

        credential = profile.credential
        offering = profile.offering
        return TutorProfileResponse(
            tutor_id=profile.tutor_id,
            application_id=profile.application_id,
            application_status=profile.application_status,
            version=profile.version,
            headline=profile.headline,
            biography=profile.biography,
            time_zone=profile.time_zone,
            is_published=profile.is_published,
            payout_ready=profile.payout_ready,
            publication_blockers=blockers,
            credential=(
                TutorCredentialResponse(
                    credential_id=credential.credential_id,
                    version=credential.version,
                    credential_type=credential.credential_type,
                    title=credential.title,
                    issuer=credential.issuer,
                    verification_status=credential.verification_status,
                    verification_reason=credential.verification_reason,
                    reviewed_at=credential.reviewed_at,
                )
                if credential is not None
                else None
            ),
            offering=(
                TutorOfferingResponse(
                    offering_id=offering.offering_id,
                    version=offering.version,
                    title=offering.title,
                    duration_minutes=cast(Literal[25, 50], offering.duration_minutes),
                    amount_minor=offering.amount_minor,
                    currency=offering.currency,
                    state=offering.state,
                    commission_policy=MarketplacePolicyVersionResponse(
                        policy_id=offering.commission_policy.policy_id,
                        policy_type="commission",
                        version=offering.commission_policy.version,
                        commission_basis_points=(
                            offering.commission_policy.commission_basis_points
                        ),
                        cancellation_cutoff_hours=None,
                        dispute_window_hours=None,
                        effective_at=offering.commission_policy.effective_at,
                    ),
                    cancellation_policy=MarketplacePolicyVersionResponse(
                        policy_id=offering.cancellation_policy.policy_id,
                        policy_type="cancellation",
                        version=offering.cancellation_policy.version,
                        commission_basis_points=None,
                        cancellation_cutoff_hours=(
                            offering.cancellation_policy.cancellation_cutoff_hours
                        ),
                        dispute_window_hours=(offering.cancellation_policy.dispute_window_hours),
                        effective_at=offering.cancellation_policy.effective_at,
                    ),
                )
                if offering is not None
                else None
            ),
        )
