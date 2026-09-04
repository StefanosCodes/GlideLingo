"""Public, database-free desktop update policy."""

from typing import Annotated, cast

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from app.core.config import NUMERIC_SEMVER_PATTERN, NumericSemVer

router = APIRouter(prefix="/v1/desktop", tags=["desktop"])


class DesktopUpdatePolicyResponse(BaseModel):
    minimum_supported_version: NumericSemVer


@router.get(
    "/update-policy",
    operation_id="getDesktopUpdatePolicy",
    response_model=DesktopUpdatePolicyResponse,
    summary="Get the minimum supported desktop version",
)
def get_desktop_update_policy(
    request: Request,
    _current_version: Annotated[
        str,
        Query(alias="current_version", max_length=64, pattern=NUMERIC_SEMVER_PATTERN),
    ],
) -> DesktopUpdatePolicyResponse:
    """Return policy without authentication, database access, or external I/O."""

    return DesktopUpdatePolicyResponse(
        minimum_supported_version=cast(
            str,
            request.app.state.desktop_minimum_supported_version,
        )
    )
