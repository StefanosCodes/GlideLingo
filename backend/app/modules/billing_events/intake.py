"""Provider-neutral intake mapping after provider-specific request verification."""

from collections.abc import Sequence

from app.modules.billing_events.models import BillingEventConsumer

# RevenueCat documents these as subscription-lifecycle events. A new provider event
# type is deliberately retained without deliveries until this allowlist is reviewed.
REVENUECAT_PURCHASE_LIFECYCLE_EVENTS = frozenset(
    {
        "BILLING_ISSUE",
        "CANCELLATION",
        "EXPIRATION",
        "INITIAL_PURCHASE",
        "INVOICE_ISSUANCE",
        "NON_RENEWING_PURCHASE",
        "PRODUCT_CHANGE",
        "REFUND_REVERSED",
        "RENEWAL",
        "SUBSCRIPTION_EXTENDED",
        "SUBSCRIPTION_PAUSED",
        "UNCANCELLATION",
    }
)


def revenuecat_consumers(
    *, event_type: str, has_provider_actor: bool
) -> Sequence[BillingEventConsumer]:
    """Return reviewed consumers; unknown or actorless events have no side effects."""

    if event_type not in REVENUECAT_PURCHASE_LIFECYCLE_EVENTS or not has_provider_actor:
        return ()
    return ("pro_entitlement", "affiliate_finance")
