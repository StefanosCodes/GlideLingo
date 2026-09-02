import { describe, expect, it } from 'vitest';
import { resolveReferralPageConfig } from './referral-config.mjs';

describe('referral page configuration', () => {
  it('defaults off and emits no app destination', () => {
    expect(resolveReferralPageConfig({})).toEqual({ appUrl: '', enabled: false });
    expect(resolveReferralPageConfig({ PUBLIC_AFFILIATE_REFERRALS_ENABLED: 'false' }))
      .toEqual({ appUrl: '', enabled: false });
  });

  it('requires the exact authenticated app referral route when enabled', () => {
    expect(resolveReferralPageConfig({
      PUBLIC_AFFILIATE_REFERRALS_ENABLED: 'true',
      PUBLIC_REFERRAL_APP_URL: 'https://app.glidelingo.com/referral',
    })).toEqual({ appUrl: 'https://app.glidelingo.com/referral', enabled: true });
    for (const value of [undefined, 'http://app.glidelingo.com/referral', 'https://app.glidelingo.com/', 'https://attacker.example/referral']) {
      expect(() => resolveReferralPageConfig({
        PUBLIC_AFFILIATE_REFERRALS_ENABLED: 'true', PUBLIC_REFERRAL_APP_URL: value,
      })).toThrow();
    }
  });
});
