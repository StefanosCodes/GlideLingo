import asyncio
from dataclasses import replace
from datetime import date, time
from uuid import UUID

import pytest

from app.auth.clerk import ClerkPrincipal
from app.core.errors import HumanTutorMarketplaceForbiddenError
from app.modules.human_tutor_marketplace.discovery import (
    MarketplaceDiscoveryService,
    StoredAvailabilityRule,
    StoredManualAvailability,
    StoredPublicTutor,
)
from app.modules.human_tutor_marketplace.identity import derive_marketplace_actor_ref

KEY = b"marketplace-discovery-key-at-least-32-bytes"
LEARNER = ClerkPrincipal(user_id="user_learner", issuer="https://clerk.test")
TUTOR_ID = UUID("9948afe2-59ac-46f6-88cf-15c5f9991234")


class Repository:
    def __init__(self) -> None:
        self.favorite = False
        self.tutor = StoredPublicTutor(
            tutor_id=TUTOR_ID,
            headline="Calm Greek conversation",
            biography="A public biography with no private application or payout details.",
            time_zone="America/Chicago",
            languages=("el", "en"),
            dialects=("el-cy",),
            specialties=("Conversation",),
            verified_credentials=("Language teaching certificate",),
            offering_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9992345"),
            offering_title="Greek conversation",
            duration_minutes=25,
            amount_minor=2500,
            currency="USD",
            rating=None,
            rating_count=0,
            is_favorite=False,
        )
        self.schedule = StoredManualAvailability(
            tutor_id=TUTOR_ID,
            profile_version=3,
            time_zone="America/Chicago",
            lead_time_minutes=60,
            buffer_before_minutes=5,
            buffer_after_minutes=5,
            dialects=("el-cy",),
            rules=(
                StoredAvailabilityRule(
                    rule_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9993456"),
                    weekday=4,
                    start_local=time(9),
                    end_local=time(11),
                    effective_from=date(2026, 1, 1),
                    effective_until=None,
                    time_zone="America/Chicago",
                ),
            ),
            exceptions=(),
            duration_minutes=25,
        )

    def get_manual_availability_by_actor(
        self, *, actor_ref: str
    ) -> StoredManualAvailability | None:
        return self.schedule

    def get_manual_availability_by_tutor(
        self, *, tutor_id: UUID, require_public: bool
    ) -> StoredManualAvailability | None:
        return self.schedule if tutor_id == TUTOR_ID else None

    def replace_manual_availability(self, *, actor_ref: str, request: object) -> None:
        return None

    def list_public_tutors(self, **kwargs: object) -> list[StoredPublicTutor]:
        return [replace(self.tutor, is_favorite=self.favorite)]

    def get_public_tutor(
        self, *, learner_actor_ref: str, tutor_id: UUID
    ) -> StoredPublicTutor | None:
        return replace(self.tutor, is_favorite=self.favorite) if tutor_id == TUTOR_ID else None

    def set_favorite(self, *, learner_actor_ref: str, tutor_id: UUID, favorite: bool) -> bool:
        if tutor_id != TUTOR_ID:
            return False
        self.favorite = favorite
        return True


def service(repository: Repository) -> MarketplaceDiscoveryService:
    return MarketplaceDiscoveryService(
        repository=repository,
        pseudonym_key=KEY,
        actor_allowlist=(LEARNER.user_id,),
    )


def test_public_projection_is_bounded_safe_and_favorites_are_actor_scoped() -> None:
    repository = Repository()
    first = asyncio.run(
        service(repository).list_tutors(
            principal=LEARNER,
            language="el",
            dialect="el-cy",
            specialty="Conversation",
            duration_minutes=25,
            maximum_amount_minor=3000,
            verified_credential=True,
            favorite=False,
            available_before=None,
            cursor=None,
            limit=20,
        )
    )
    favorite = asyncio.run(
        service(repository).set_favorite(
            principal=LEARNER,
            tutor_id=TUTOR_ID,
            favorite=True,
        )
    )

    assert len(first.items) == 1
    assert favorite.is_favorite is True
    projection = favorite.model_dump()
    assert not {"actor_ref", "application_id", "payout_ready"} & projection.keys()
    assert derive_marketplace_actor_ref(key=KEY, clerk_user_id=LEARNER.user_id)


def test_discovery_rejects_non_allowlisted_actor_before_repository_access() -> None:
    outsider = ClerkPrincipal(user_id="user_outsider", issuer="https://clerk.test")
    with pytest.raises(HumanTutorMarketplaceForbiddenError):
        asyncio.run(
            service(Repository()).list_tutors(
                principal=outsider,
                language=None,
                dialect=None,
                specialty=None,
                duration_minutes=None,
                maximum_amount_minor=None,
                verified_credential=False,
                favorite=False,
                available_before=None,
                cursor=None,
                limit=20,
            )
        )
