import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';

import { setApiAccessTokenProvider } from '@/api/auth-token';
import { bindReferralAttribution } from '@/features/affiliates/referral-client';

const token = 'B'.repeat(43);
const fetchMock = jest.spyOn(global, 'fetch');

beforeEach(() => {
  process.env.EXPO_PUBLIC_AFFILIATE_REFERRALS_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_AFFILIATE_REFERRALS_ENABLED;
  fetchMock.mockReset();
});

function response(payload: unknown, status = 200) {
  return {
    headers: { get: () => 'req_referral' },
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

test.each(['bound', 'invalid', 'expired', 'already_consumed', 'locked'] as const)(
  'posts the handoff only in the authenticated body and parses %s',
  async (status) => {
    const cleanup = setApiAccessTokenProvider(async () => 'clerk-session-token');
    fetchMock.mockResolvedValue(response({ status }));
    try {
      await expect(bindReferralAttribution(token)).resolves.toEqual({ status });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8123/v1/affiliates/attribution/bind',
        expect.objectContaining({
          body: JSON.stringify({ handoff_token: token }),
          headers: expect.objectContaining({ Authorization: 'Bearer clerk-session-token' }),
          method: 'POST',
        }),
      );
      expect(fetchMock.mock.calls[0][0]).not.toContain(token);
    } finally {
      cleanup();
    }
  },
);

test('rejects extra response data and malformed local tokens', async () => {
  fetchMock.mockResolvedValue(response({ status: 'bound', creator_id: 'must-not-leak' }));
  await expect(bindReferralAttribution(token)).rejects.toMatchObject({ kind: 'invalid-response' });
  await expect(bindReferralAttribution('not-valid')).rejects.toThrow('Invalid referral handoff token.');
});

test('does not call the attribution endpoint while the client flag is disabled', async () => {
  delete process.env.EXPO_PUBLIC_AFFILIATE_REFERRALS_ENABLED;

  await expect(bindReferralAttribution(token)).rejects.toThrow('Affiliate referrals are disabled.');
  expect(fetchMock).not.toHaveBeenCalled();
});
