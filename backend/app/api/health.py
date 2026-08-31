"""Process liveness and required-dependency readiness endpoints."""

import logging
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.core.errors import DependencyUnavailableError, ErrorResponse
from app.db.engine import DatabaseProbe, DatabaseUnavailableError

router = APIRouter(prefix="/health", tags=["health"])

logger = logging.getLogger("glidelingo.health")


class LivenessResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["glidelingo-api"]


class ReadinessChecks(BaseModel):
    database: Literal["ok"]


class ReadinessResponse(BaseModel):
    status: Literal["ready"]
    service: Literal["glidelingo-api"]
    checks: ReadinessChecks


def get_database_probe(request: Request) -> DatabaseProbe:
    return cast(DatabaseProbe, request.app.state.database_probe)


DatabaseProbeDependency = Annotated[DatabaseProbe, Depends(get_database_probe)]


@router.get(
    "/live",
    operation_id="getHealthLiveness",
    response_model=LivenessResponse,
    summary="Check API process liveness",
)
def get_liveness() -> LivenessResponse:
    """Report process liveness without querying external dependencies."""

    return LivenessResponse(status="ok", service="glidelingo-api")


@router.get(
    "/ready",
    operation_id="getHealthReadiness",
    response_model=ReadinessResponse,
    responses={
        503: {
            "description": "A required dependency is unavailable.",
            "model": ErrorResponse,
        }
    },
    summary="Check required dependencies",
)
def get_readiness(request: Request, database_probe: DatabaseProbeDependency) -> ReadinessResponse:
    """Run a cheap PostgreSQL probe and report whether the API can serve traffic."""

    try:
        database_probe()
    except DatabaseUnavailableError as error:
        logger.warning(
            "database readiness probe failed",
            extra={
                "request_id": request.state.request_id,
                "error_type": type(error.__cause__ or error).__name__,
            },
        )
        raise DependencyUnavailableError from None

    return ReadinessResponse(
        status="ready",
        service="glidelingo-api",
        checks=ReadinessChecks(database="ok"),
    )
