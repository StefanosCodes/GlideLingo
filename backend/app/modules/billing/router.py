"""Authenticated entitlement status and RevenueCat webhook contracts."""

from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import ValidationError

from app.auth.clerk import CurrentClerkPrincipal
from app.core.errors import ErrorResponse
from app.modules.billing.schemas import ProEntitlementStatus, RevenueCatWebhookResponse
from app.modules.billing.service import (
    BillingService,
    InvalidRevenueCatWebhookError,
    RevenueCatWebhookPayload,
)

router = APIRouter(prefix="/v1/billing", tags=["billing"])


def get_billing_service(request: Request) -> BillingService:
    return cast(BillingService, request.app.state.billing_service)


BillingServiceDependency = Annotated[BillingService, Depends(get_billing_service)]


async def require_pro_entitlement(
    principal: CurrentClerkPrincipal,
    service: BillingServiceDependency,
) -> ProEntitlementStatus:
    return await service.require_pro(principal=principal)


CurrentProEntitlement = Annotated[ProEntitlementStatus, Depends(require_pro_entitlement)]


@router.get(
    "/entitlements/pro",
    operation_id="get_pro_entitlement_status",
    response_model=ProEntitlementStatus,
    responses={
        401: {"description": "The Clerk session token is missing or invalid."},
    },
)
async def get_pro_entitlement_status(
    principal: CurrentClerkPrincipal,
    service: BillingServiceDependency,
) -> ProEntitlementStatus:
    return await service.status(principal=principal)


@router.post(
    "/revenuecat/webhook",
    operation_id="receive_revenuecat_webhook",
    response_model=RevenueCatWebhookResponse,
    responses={
        401: {"description": "Webhook authorization or signature is invalid."},
        413: {"description": "Webhook payload exceeds the configured maximum."},
        422: {"description": "Webhook payload is invalid."},
        503: {"model": ErrorResponse},
    },
)
async def receive_revenuecat_webhook(
    request: Request,
    service: BillingServiceDependency,
    authorization: Annotated[str | None, Header()] = None,
    revenuecat_signature: Annotated[
        str | None, Header(alias="X-RevenueCat-Webhook-Signature")
    ] = None,
) -> RevenueCatWebhookResponse:
    raw_body = await _read_bounded_body(
        request,
        maximum_bytes=request.app.state.revenuecat_webhook_max_body_bytes,
    )
    try:
        service.verify_webhook(
            raw_body=raw_body,
            authorization=authorization,
            signature_header=revenuecat_signature,
        )
    except InvalidRevenueCatWebhookError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Webhook credentials are invalid.",
        ) from None
    try:
        payload = RevenueCatWebhookPayload.model_validate_json(raw_body)
    except ValidationError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Webhook payload is invalid.",
        ) from None
    return await service.process_webhook(payload)


async def _read_bounded_body(request: Request, *, maximum_bytes: int) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > maximum_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    detail="Webhook payload is too large.",
                )
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Content-Length is invalid.",
            ) from None
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > maximum_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Webhook payload is too large.",
            )
    return bytes(body)
