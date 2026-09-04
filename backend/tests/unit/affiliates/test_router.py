from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.auth.clerk import ClerkPrincipal
from app.core.config import Settings
from app.main import create_app
from app.modules.affiliates.commission_domain import (
    CommissionEntryKind,
    CommissionLedgerEntry,
    CommissionLedgerPage,
)
from app.modules.affiliates.commission_repository import AffiliateCommissionRepository
from app.modules.affiliates.domain import BindStatus
from app.modules.affiliates.repository import AffiliateRepository
from app.modules.affiliates.service import AffiliateService

from .test_service import KEY, NOW, TOKEN, MemoryAffiliateRepository


class AcceptingVerifier:
    def verify(self, token: str) -> ClerkPrincipal:
        assert token == "valid-affiliate-token"
        return ClerkPrincipal(user_id="user_verified", issuer="https://clerk.test")


class MemoryCommissionRepository:
    def __init__(self) -> None:
        self.listed: dict[str, Any] | None = None

    def list_creator_entries(self, **kwargs: Any) -> CommissionLedgerPage:
        self.listed = kwargs
        return CommissionLedgerPage(
            entries=(
                CommissionLedgerEntry(
                    entry_id=UUID("00000000-0000-0000-0000-000000000001"),
                    kind=CommissionEntryKind.ACCRUAL,
                    currency_code="USD",
                    basis_amount_minor=1999,
                    commission_amount_minor=250,
                    occurred_at=NOW,
                ),
            ),
            next_cursor="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        )


def make_client(
    repository: MemoryAffiliateRepository,
    *,
    enabled: bool = True,
    commission_repository: MemoryCommissionRepository | None = None,
) -> TestClient:
    service = AffiliateService(
        repository=cast(AffiliateRepository, repository),
        affiliates_enabled=enabled,
        referral_resolution_enabled=enabled,
        attribution_binding_enabled=enabled,
        membership_admin_enabled=enabled,
        principal_pseudonym_key=KEY if enabled else None,
        commissions_enabled=enabled and commission_repository is not None,
        commission_repository=cast(AffiliateCommissionRepository, commission_repository),
        now=lambda: NOW,
        token_factory=lambda: TOKEN,
    )
    application = create_app(Settings(_env_file=None), affiliate_service=service)
    application.state.clerk_token_verifier = AcceptingVerifier()
    return TestClient(application)


def test_public_resolve_contract_contains_only_opaque_handoff_and_expiry() -> None:
    repository = MemoryAffiliateRepository()
    with make_client(repository) as client:
        response = client.post(
            "/v1/affiliates/referrals/resolve",
            json={"link_slug": "creator-link", "campaign_slug": "campaign-one"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "status": "resolved",
        "handoff_token": TOKEN,
        "expires_at": "2026-09-02T12:15:00Z",
    }


@pytest.mark.parametrize(
    "bind_status",
    [
        BindStatus.BOUND,
        BindStatus.INVALID,
        BindStatus.EXPIRED,
        BindStatus.ALREADY_CONSUMED,
        BindStatus.LOCKED,
    ],
)
def test_bind_contract_returns_minimal_recoverable_status(bind_status: BindStatus) -> None:
    repository = MemoryAffiliateRepository()
    repository.bind_status = bind_status
    with make_client(repository) as client:
        response = client.post(
            "/v1/affiliates/attribution/bind",
            json={"handoff_token": TOKEN},
            headers={"Authorization": "Bearer valid-affiliate-token"},
        )

    assert response.status_code == 200
    assert response.json() == {"status": bind_status.value}


def test_bind_rejects_missing_authentication_and_overposted_authority() -> None:
    repository = MemoryAffiliateRepository()
    with make_client(repository) as client:
        missing = client.post(
            "/v1/affiliates/attribution/bind",
            json={"handoff_token": TOKEN},
        )
        overposted = client.post(
            "/v1/affiliates/attribution/bind",
            json={
                "handoff_token": TOKEN,
                "creator_id": "00000000-0000-0000-0000-000000000000",
                "clerk_user_id": "user_attacker",
            },
            headers={"Authorization": "Bearer valid-affiliate-token"},
        )

    assert missing.status_code == 401
    assert overposted.status_code == 422
    assert repository.bind_values is None


def test_resolve_disabled_and_unknown_referrals_have_stable_errors() -> None:
    repository = MemoryAffiliateRepository()
    with make_client(repository, enabled=False) as client:
        disabled = client.post(
            "/v1/affiliates/referrals/resolve",
            json={"link_slug": "creator-link"},
        )
    assert disabled.status_code == 503
    assert disabled.json()["error"]["code"] == "affiliate_unavailable"

    repository.referral_exists = False
    with make_client(repository) as client:
        missing = client.post(
            "/v1/affiliates/referrals/resolve",
            json={"link_slug": "creator-link"},
        )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "affiliate_referral_not_found"


def test_openapi_does_not_accept_or_return_authority_identifiers_for_binding() -> None:
    repository = MemoryAffiliateRepository()
    with make_client(repository) as client:
        schema = client.get("/openapi.json").json()

    bind = schema["paths"]["/v1/affiliates/attribution/bind"]["post"]
    request_schema_name = bind["requestBody"]["content"]["application/json"]["schema"][
        "$ref"
    ].split("/")[-1]
    response_schema_name = bind["responses"]["200"]["content"]["application/json"]["schema"][
        "$ref"
    ].split("/")[-1]
    assert set(schema["components"]["schemas"][request_schema_name]["properties"]) == {
        "handoff_token"
    }
    assert set(schema["components"]["schemas"][response_schema_name]["properties"]) == {"status"}


def test_creator_commission_projection_is_role_scoped_and_minimized() -> None:
    repository = MemoryAffiliateRepository()
    repository.creator_allowed = True
    commission_repository = MemoryCommissionRepository()
    creator_id = uuid4()
    with make_client(repository, commission_repository=commission_repository) as client:
        response = client.get(
            f"/v1/affiliates/creators/{creator_id}/commissions?limit=10",
            headers={"Authorization": "Bearer valid-affiliate-token"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "creator_id": str(creator_id),
        "entries": [
            {
                "entry_id": "00000000-0000-0000-0000-000000000001",
                "kind": "accrual",
                "currency_code": "USD",
                "basis_amount_minor": 1999,
                "commission_amount_minor": 250,
                "occurred_at": "2026-09-02T12:00:00Z",
            }
        ],
        "next_cursor": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    }
    assert commission_repository.listed == {
        "creator_id": creator_id,
        "cursor": None,
        "limit": 10,
    }
    assert "transaction" not in response.text
    assert "policy" not in response.text


def test_creator_commission_projection_fails_before_read_without_role() -> None:
    repository = MemoryAffiliateRepository()
    commission_repository = MemoryCommissionRepository()
    with make_client(repository, commission_repository=commission_repository) as client:
        response = client.get(
            f"/v1/affiliates/creators/{uuid4()}/commissions",
            headers={"Authorization": "Bearer valid-affiliate-token"},
        )

    assert response.status_code == 403
    assert commission_repository.listed is None


def test_creator_commission_projection_rejects_invalid_opaque_cursor() -> None:
    repository = MemoryAffiliateRepository()
    repository.creator_allowed = True
    commission_repository = MemoryCommissionRepository()
    with make_client(repository, commission_repository=commission_repository) as client:
        response = client.get(
            f"/v1/affiliates/creators/{uuid4()}/commissions?cursor={'!' * 32}",
            headers={"Authorization": "Bearer valid-affiliate-token"},
        )

    assert response.status_code == 422
    assert commission_repository.listed is None
