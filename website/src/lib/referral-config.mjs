const REFERRAL_APP_URL = 'https://app.glidelingo.com/referral';

/** @param {Record<string, string | undefined>} environment */
export function resolveReferralPageConfig(environment = import.meta.env) {
  const enabled = environment.PUBLIC_AFFILIATE_REFERRALS_ENABLED === 'true';
  const configuredUrl = environment.PUBLIC_REFERRAL_APP_URL?.trim();
  if (!enabled) return { appUrl: '', enabled: false };
  if (configuredUrl !== REFERRAL_APP_URL) {
    throw new Error(`Enabled referral pages require PUBLIC_REFERRAL_APP_URL=${REFERRAL_APP_URL}.`);
  }
  return { appUrl: REFERRAL_APP_URL, enabled: true };
}
