import { afterEach, describe, expect, test } from '@jest/globals';

import {
  affiliateReferralsEnabled,
  captureReferralHandoff,
  clearReferralHandoff,
  isReferralHandoffToken,
  readReferralHandoff,
  REFERRAL_SESSION_TTL_MS,
  type ReferralSessionStorage,
} from '@/features/affiliates/referral-session';

const token = 'T'.repeat(43);

function createStorage({ throws = false } = {}) {
  const values = new Map<string, string>();
  const storage: ReferralSessionStorage = {
    getItem(key) {
      if (throws) throw new Error('blocked');
      return values.get(key) ?? null;
    },
    removeItem(key) {
      if (throws) throw new Error('blocked');
      values.delete(key);
    },
    setItem(key, value) {
      if (throws) throw new Error('blocked');
      values.set(key, value);
    },
  };
  return { storage, values };
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_AFFILIATE_REFERRALS_ENABLED;
  clearReferralHandoff(createStorage().storage);
});

describe('referral session', () => {
  test('the client feature flag defaults off and requires exact true', () => {
    expect(affiliateReferralsEnabled()).toBe(false);
    process.env.EXPO_PUBLIC_AFFILIATE_REFERRALS_ENABLED = 'false';
    expect(affiliateReferralsEnabled()).toBe(false);
    process.env.EXPO_PUBLIC_AFFILIATE_REFERRALS_ENABLED = 'true';
    expect(affiliateReferralsEnabled()).toBe(true);
  });

  test('accepts only the backend 256-bit unpadded base64url token shape', () => {
    expect(isReferralHandoffToken(token)).toBe(true);
    expect(isReferralHandoffToken(`${'T'.repeat(42)}=`)).toBe(false);
    expect(isReferralHandoffToken('T'.repeat(42))).toBe(false);
    expect(isReferralHandoffToken('T'.repeat(44))).toBe(false);
    expect(isReferralHandoffToken(`${'T'.repeat(42)}+`)).toBe(false);
  });

  test('stores only a bounded session entry and expires it after fifteen minutes', () => {
    const { storage } = createStorage();
    expect(captureReferralHandoff(`#handoff=${token}`, storage, 10_000))
      .toEqual({ status: 'ready', handoffToken: token });
    expect(readReferralHandoff(storage, 10_000 + REFERRAL_SESSION_TTL_MS - 1))
      .toEqual({ status: 'ready', handoffToken: token });
    expect(readReferralHandoff(storage, 10_000 + REFERRAL_SESSION_TTL_MS))
      .toEqual({ status: 'expired' });
  });

  test.each([
    '',
    '#handoff=',
    `#handoff=${'x'.repeat(42)}`,
    `#handoff=${'x'.repeat(44)}`,
    `#handoff=${'x'.repeat(42)}=`,
    `#handoff=${token}&handoff=${token}`,
    `#handoff=${token}&next=evil`,
  ])('rejects malformed, oversized, duplicate, and extra fragment values', (fragment) => {
    expect(captureReferralHandoff(fragment, createStorage().storage)).toEqual({ status: 'invalid' });
  });

  test('uses bounded memory when sessionStorage throws', () => {
    const { storage } = createStorage({ throws: true });
    expect(captureReferralHandoff(`#handoff=${token}`, storage, 1_000).status).toBe('ready');
    expect(readReferralHandoff(storage, 1_001)).toEqual({ status: 'ready', handoffToken: token });
  });

  test('removes a malformed stored entry before returning ordinary recovery', () => {
    const { storage, values } = createStorage();
    storage.setItem('glidelingo.referral-handoff.v1', JSON.stringify({ handoffToken: 'x'.repeat(200) }));

    expect(readReferralHandoff(storage)).toEqual({ status: 'missing' });
    expect(values.size).toBe(0);
  });
});
