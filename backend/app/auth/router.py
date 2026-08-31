"""Authenticated session proof endpoint."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.auth.clerk import CurrentClerkPrincipal
from app.core.errors import ErrorResponse

router = APIRouter(prefix="/v1/auth", tags=["auth"])


class AuthSessionResponse(BaseModel):
    user_id: str


@router.get(
    "/session",
    operation_id="get_authenticated_session",
    response_model=AuthSessionResponse,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
        503: {"model": ErrorResponse, "description": "Authentication is not configured."},
    },
)
def get_authenticated_session(principal: CurrentClerkPrincipal) -> AuthSessionResponse:
    """Prove the caller's identity using the verified Clerk subject."""

    return AuthSessionResponse(user_id=principal.user_id)
