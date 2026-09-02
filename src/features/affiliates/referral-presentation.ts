export type ReferralPresentationState =
  | 'disabled'
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'waiting-auth'
  | 'bound'
  | 'no-attribution'
  | 'authentication'
  | 'retryable'
  | 'unavailable';

export function referralPresentation(state: ReferralPresentationState) {
  if (state === 'disabled') return {
    alert: false, title: 'Referrals are not available yet.',
    body: 'The ordinary GlideLingo sign-in and subscription experience is still available.', continueLabel: 'Continue normally',
  };
  if (state === 'waiting-auth') return {
    alert: false, title: 'Sign in to check your referral.',
    body: 'The handoff stays only in this app session and will be verified after authentication.', continueLabel: 'Continue to sign in',
  };
  if (state === 'bound') return {
    alert: false, title: 'Referral received.',
    body: 'Your referral was verified. Any eligible offer will come from the server and checkout provider.', continueLabel: 'Continue to subscription',
  };
  if (state === 'retryable') return {
    alert: true, title: 'The referral could not be checked.',
    body: 'Try again, or continue normally without referral attribution.', continueLabel: 'Continue normally',
  };
  if (state === 'authentication') return {
    alert: true, title: 'Please sign in again.',
    body: 'Your account session could not be verified. No referral or purchase was changed.', continueLabel: 'Continue normally',
  };
  if (state === 'missing') return {
    alert: true, title: 'No referral is waiting.',
    body: 'You can continue to sign in, learn, and subscribe normally.', continueLabel: 'Continue normally',
  };
  if (state === 'invalid') return {
    alert: true, title: 'This referral link is not valid.',
    body: 'No account or purchase was changed. You can continue normally.', continueLabel: 'Continue normally',
  };
  if (state === 'expired') return {
    alert: true, title: 'This referral link has expired.',
    body: 'Ask the creator for a new link, or continue normally without attribution.', continueLabel: 'Continue normally',
  };
  return {
    alert: true, title: 'This referral could not be applied.',
    body: 'It may have expired, already been used, or no longer be eligible. Your ordinary account and subscription flow remain available.',
    continueLabel: 'Continue normally',
  };
}
