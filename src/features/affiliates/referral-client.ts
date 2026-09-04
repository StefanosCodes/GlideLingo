import { ApiClientError, postJson } from '@/api/client';
import {
  affiliateReferralsEnabled,
  isReferralHandoffToken,
} from '@/features/affiliates/referral-session';

export type ReferralBindStatus = 'bound' | 'invalid' | 'expired' | 'already_consumed' | 'locked';
export type ReferralBindFailure = 'authentication' | 'unavailable' | 'retryable';

export async function bindReferralAttribution(handoffToken: string, signal?: AbortSignal) {
  if (!affiliateReferralsEnabled()) throw new Error('Affiliate referrals are disabled.');
  if (!isReferralHandoffToken(handoffToken)) throw new Error('Invalid referral handoff token.');
  const response = await postJson({
    body: { handoff_token: handoffToken },
    parse: parseReferralBindResponse,
    path: '/v1/affiliates/attribution/bind',
    signal,
    timeoutMs: 10_000,
  });
  return response.data;
}

export function classifyReferralBindFailure(error: unknown): ReferralBindFailure {
  if (!(error instanceof ApiClientError)) return 'unavailable';
  if (error.status === 401) return 'authentication';
  if (error.kind === 'cancelled' || error.kind === 'network' || error.kind === 'timeout') {
    return 'retryable';
  }
  return 'unavailable';
}

function parseReferralBindResponse(value: unknown): { status: ReferralBindStatus } | null {
  if (!isRecord(value) || !isBindStatus(value.status) || Object.keys(value).length !== 1) return null;
  return { status: value.status };
}

function isBindStatus(value: unknown): value is ReferralBindStatus {
  return value === 'bound' || value === 'invalid' || value === 'expired' ||
    value === 'already_consumed' || value === 'locked';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
