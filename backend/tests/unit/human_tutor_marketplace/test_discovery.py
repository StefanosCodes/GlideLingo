import asyncio
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from typing import cast
from uuid import UUID, uuid5
from zoneinfo import ZoneInfo

import pytest

from app.auth.clerk import ClerkPrincipal
from app.core.errors import (
    HumanTutorMarketplaceForbiddenError,
    HumanTutorMarketplaceUnavailableError,
)
from app.modules.human_tutor_marketplace.calendar import (
    CalendarBusySnapshot,
    CalendarRepository,
)
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


class StaleCalendar:
    def get_busy_snapshot(self, *, tutor_id: UUID, now: datetime) -> CalendarBusySnapshot:
        return CalendarBusySnapshot("stale", (), now - timedelta(minutes=30))


class PagedRepository(Repository):
    def __init__(self) -> None:
        super().__init__()
        namespace = UUID("9948afe2-59ac-46f6-88cf-15c5f9999999")
        self.tutors = [
            replace(
                self.tutor,
                tutor_id=uuid5(namespace, f"tutor-{index}"),
                headline=f"Tutor {index:03d}",
                is_favorite=index == 220,
            )
            for index in range(250)
        ]

    def list_public_tutors(self, **kwargs: object) -> list[StoredPublicTutor]:
        after_headline = kwargs.get("after_headline")
        after_tutor_id = kwargs.get("after_tutor_id")
        limit = cast(int, kwargs["limit"])
        start = 0
        if isinstance(after_headline, str) and isinstance(after_tutor_id, UUID):
            start = next(
                index + 1
                for index, tutor in enumerate(self.tutors)
                if tutor.headline.casefold() == after_headline and tutor.tutor_id == after_tutor_id
            )
        return self.tutors[start : start + limit]


def service(
    repository: Repository,
    calendar: CalendarRepository | None = None,
    *,
    acquisition_enabled: bool = True,
) -> MarketplaceDiscoveryService:
    return MarketplaceDiscoveryService(
        repository=repository,
        calendar_busy_reader=calendar,
        pseudonym_key=KEY,
        actor_allowlist=(LEARNER.user_id,),
        acquisition_enabled=acquisition_enabled,
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


def test_stale_calendar_never_appears_as_current_or_returns_bookable_slots() -> None:
    starts_at = datetime.now(UTC) + timedelta(hours=2)
    result = asyncio.run(
        service(Repository(), cast(CalendarRepository, StaleCalendar())).list_slots(
            principal=LEARNER,
            tutor_id=TUTOR_ID,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(days=1),
            limit=20,
        )
    )

    assert result.source == "manual+google"
    assert result.freshness == "stale"
    assert result.slots == []


def test_acquisition_kill_switch_blocks_discovery_but_preserves_tutor_schedule_access() -> None:
    disabled = service(Repository(), acquisition_enabled=False)

    with pytest.raises(HumanTutorMarketplaceUnavailableError):
        asyncio.run(
            disabled.list_tutors(
                principal=LEARNER,
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

    assert asyncio.run(disabled.get_own_availability(principal=LEARNER)).profile_version == 3


def test_post_filter_pagination_scans_beyond_the_first_201_candidates() -> None:
    result = asyncio.run(
        service(PagedRepository()).list_tutors(
            principal=LEARNER,
            language=None,
            dialect=None,
            specialty=None,
            duration_minutes=None,
            maximum_amount_minor=None,
            verified_credential=False,
            favorite=True,
            available_before=None,
            cursor=None,
            limit=1,
        )
    )

    assert [item.headline for item in result.items] == ["Tutor 220"]
    assert result.next_cursor is None


def test_reschedule_validation_enforces_current_schedule_and_calendar_freshness() -> None:
    zone = ZoneInfo("America/Chicago")
    local_today = datetime.now(zone).date()
    days_until_friday = (4 - local_today.weekday()) % 7
    if days_until_friday < 2:
        days_until_friday += 7
    starts_at = datetime.combine(
        local_today + timedelta(days=days_until_friday), time(9, 5), zone
    ).astimezone(UTC)
    ends_at = starts_at + timedelta(minutes=25)

    current = asyncio.run(
        service(Repository()).validate_existing_booking_slot(
            principal=LEARNER,
            tutor_id=TUTOR_ID,
            booking_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9996789"),
            starts_at=starts_at,
            ends_at=ends_at,
        )
    )
    stale = asyncio.run(
        service(
            Repository(), cast(CalendarRepository, StaleCalendar())
        ).validate_existing_booking_slot(
            principal=LEARNER,
            tutor_id=TUTOR_ID,
            booking_id=UUID("9948afe2-59ac-46f6-88cf-15c5f9996789"),
            starts_at=starts_at,
            ends_at=ends_at,
        )
    )

    assert current == 3
    assert stale is None
