import { afterEach, expect, jest, test } from '@jest/globals';

import { setApiAccessTokenProvider } from '@/api/auth-token';
import {
  AuthSessionProofError,
  getAuthSessionProof,
} from '@/features/system-status/api';

const fetchMock = jest.spyOn(global, 'fetch');

afterEach(() => {
  fetchMock.mockReset();
});

function respondWith(body: unknown, status = 200) {
  fetchMock.mockImplementationOnce(async () =>
    ({
      headers: { get: (name: string) => (name === 'x-request-id' ? 'req_auth_proof' : null) },
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    }) as unknown as Response,
  );
}

test('authenticated session proof compares the verified API subject without returning credentials', async () => {
  const cleanup = setApiAccessTokenProvider(async () => 'secret-session-token');
  respondWith({ user_id: 'user_current' });

  try {
    const proof = await getAuthSessionProof('user_current');

    expect(proof).toEqual({
      matchesCurrentUser: true,
      requestId: 'req_auth_proof',
      status: 200,
    });
    expect(JSON.stringify(proof)).not.toContain('secret-session-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8123/v1/auth/session',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer secret-session-token',
        },
        method: 'GET',
      }),
    );
  } finally {
    cleanup();
  }
});

test('authenticated session proof fails closed on a different API subject', async () => {
  const cleanup = setApiAccessTokenProvider(async () => 'secret-session-token');
  respondWith({ user_id: 'user_other' });

  try {
    await expect(getAuthSessionProof('user_current')).resolves.toMatchObject({
      matchesCurrentUser: false,
    });
  } finally {
    cleanup();
  }
});

test('authenticated session proof classifies an API rejection without exposing its body', async () => {
  const cleanup = setApiAccessTokenProvider(async () => 'secret-session-token');
  respondWith({ error: { message: 'contains-sensitive-upstream-detail' } }, 401);

  try {
    await expect(getAuthSessionProof('user_current')).rejects.toMatchObject({
      kind: 'unauthorized',
      message: 'The authenticated API session proof did not complete successfully.',
      requestId: 'req_auth_proof',
      status: 401,
    } satisfies Partial<AuthSessionProofError>);
  } finally {
    cleanup();
  }
});
