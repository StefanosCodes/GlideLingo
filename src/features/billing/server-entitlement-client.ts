import { getJson, postJson } from '@/api/client';

export type ServerProEntitlementState = 'active' | 'inactive' | 'stale' | 'unavailable';

export type ServerProEntitlement = {
  entitlementId: 'pro';
  state: ServerProEntitlementState;
  isPro: boolean;
  environment: 'SANDBOX' | 'PRODUCTION';
  expiresAt: string | null;
  verifiedAt: string | null;
};

export async function loadServerProEntitlement(signal?: AbortSignal) {
  const response = await getJson({
    parse: parseServerProEntitlement,
    path: '/v1/billing/entitlements/pro',
    signal,
    timeoutMs: 10_000,
  });
  return response.data;
}

/** Force the server to bypass a fresh inactive cache after checkout/restore. */
export async function reconcileServerProEntitlement(signal?: AbortSignal) {
  const response = await postJson({
    body: undefined,
    parse: parseServerProEntitlement,
    path: '/v1/billing/entitlements/pro/reconcile',
    signal,
    timeoutMs: 12_000,
  });
  return response.data;
}

export function serverEntitlementIsActive(entitlement: ServerProEntitlement) {
  return entitlement.state === 'active' && entitlement.isPro;
}

function parseServerProEntitlement(value: unknown): ServerProEntitlement | null {
  if (!isRecord(value)) return null;
  if (
    value.entitlement_id !== 'pro' ||
    !isEntitlementState(value.state) ||
    typeof value.is_pro !== 'boolean' ||
    !isEnvironment(value.environment) ||
    !isOptionalTimestamp(value.expires_at) ||
    !isOptionalTimestamp(value.verified_at)
  ) {
    return null;
  }

  // The server contract must never describe an active state as non-Pro (or
  // vice versa). Rejecting inconsistent data keeps the client fail closed.
  if (value.is_pro !== (value.state === 'active')) return null;

  return {
    entitlementId: 'pro',
    state: value.state,
    isPro: value.is_pro,
    environment: value.environment,
    expiresAt: value.expires_at,
    verifiedAt: value.verified_at,
  };
}

function isEntitlementState(value: unknown): value is ServerProEntitlementState {
  return value === 'active' || value === 'inactive' || value === 'stale' || value === 'unavailable';
}

function isEnvironment(value: unknown): value is ServerProEntitlement['environment'] {
  return value === 'SANDBOX' || value === 'PRODUCTION';
}

function isOptionalTimestamp(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
