import type { BillingPurchaseState } from '@/features/billing/billing-types';

// Stable public values from react-native-purchases' PURCHASES_ERROR_CODE.
// Keeping the classifier dependency-free lets the fail-state contract run in
// Node tests without initializing the native/web SDK.
const PURCHASE_CANCELLED_ERROR = '1';
const PURCHASE_NOT_ALLOWED_ERROR = '3';
const PURCHASE_INVALID_ERROR = '4';

type RevenueCatErrorLike = {
  code?: unknown;
  message?: unknown;
  userCancelled?: unknown;
};

function errorLike(error: unknown): RevenueCatErrorLike | null {
  return error !== null && typeof error === 'object' ? (error as RevenueCatErrorLike) : null;
}

export function classifyPurchaseFailure(error: unknown): BillingPurchaseState {
  const candidate = errorLike(error);
  const code = typeof candidate?.code === 'string' ? candidate.code : undefined;

  if (candidate?.userCancelled === true || code === PURCHASE_CANCELLED_ERROR) {
    return {
      packageIdentifier: null,
      status: 'cancelled',
      message: 'Checkout was cancelled. Your access and payment details were not changed.',
    };
  }

  if (code === PURCHASE_NOT_ALLOWED_ERROR || code === PURCHASE_INVALID_ERROR) {
    return {
      packageIdentifier: null,
      status: 'declined',
      message: 'The payment could not be accepted. Check the payment method and try again.',
    };
  }

  return {
    packageIdentifier: null,
    status: 'error',
    message: 'We could not confirm the purchase. Refresh access before trying again.',
  };
}

export function safeManagementUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'itms-apps:' ? url.toString() : null;
  } catch {
    return null;
  }
}
