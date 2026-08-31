import { afterEach, expect, jest, test } from '@jest/globals';

import { setApiAccessTokenProvider } from '@/api/auth-token';
import {
  loadServerProEntitlement,
  reconcileServerProEntitlement,
  serverEntitlementIsActive,
} from '@/features/billing/server-entitlement-client';

const fetchMock = jest.spyOn(global, 'fetch');

afterEach(() => {
  fetchMock.mockReset();
});

const activePayload = {
  entitlement_id: 'pro',
  state: 'active',
  is_pro: true,
  environment: 'SANDBOX',
  expires_at: '2026-09-30T12:00:00Z',
  verified_at: '2026-08-31T12:00:00Z',
};

function response(payload: unknown) {
  return {
    headers: { get: () => 'req_billing' },
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

test('forced reconciliation is an authenticated bodyless POST and parses active Pro', async () => {
  const cleanup = setApiAccessTokenProvider(async () => 'clerk-session-token');
  fetchMock.mockResolvedValue(response(activePayload));

  try {
    const entitlement = await reconcileServerProEntitlement();

    expect(serverEntitlementIsActive(entitlement)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8123/v1/billing/entitlements/pro/reconcile',
      expect.objectContaining({
        body: undefined,
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer clerk-session-token',
        },
        method: 'POST',
      }),
    );
  } finally {
    cleanup();
  }
});

test('status reads are authenticated and inactive stays fail closed', async () => {
  const cleanup = setApiAccessTokenProvider(async () => 'clerk-session-token');
  fetchMock.mockResolvedValue(response({
    ...activePayload,
    state: 'inactive',
    is_pro: false,
    expires_at: null,
  }));

  try {
    const entitlement = await loadServerProEntitlement();
    expect(serverEntitlementIsActive(entitlement)).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8123/v1/billing/entitlements/pro',
      expect.objectContaining({ method: 'GET' }),
    );
  } finally {
    cleanup();
  }
});

test('an inconsistent active response is rejected instead of granting Pro', async () => {
  fetchMock.mockResolvedValue(response({ ...activePayload, is_pro: false }));

  await expect(loadServerProEntitlement()).rejects.toMatchObject({ kind: 'invalid-response' });
});
