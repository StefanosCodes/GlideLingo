export const REFERRAL_HANDOFF_LENGTH = 43;
export const REFERRAL_SESSION_TTL_MS = 15 * 60 * 1000;

const HANDOFF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STORAGE_KEY = 'glidelingo.referral-handoff.v1';

export type ReferralSessionState =
  | { status: 'ready'; handoffToken: string }
  | { status: 'missing' | 'invalid' | 'expired' };

type ReferralSessionEntry = {
  capturedAt: number;
  expiresAt: number;
  handoffToken: string;
};

export type ReferralSessionStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

let memoryEntry: ReferralSessionEntry | null = null;

export function affiliateReferralsEnabled() {
  return process.env.EXPO_PUBLIC_AFFILIATE_REFERRALS_ENABLED === 'true';
}

export function isReferralHandoffToken(value: unknown): value is string {
  return typeof value === 'string' && HANDOFF_PATTERN.test(value);
}

export function captureReferralHandoff(
  fragment: string,
  storage: ReferralSessionStorage | null = browserSessionStorage(),
  now = Date.now(),
): ReferralSessionState {
  const parsed = parseReferralFragment(fragment);
  if (parsed.status !== 'ready') {
    clearReferralHandoff(storage);
    return parsed;
  }

  const entry: ReferralSessionEntry = {
    capturedAt: now,
    expiresAt: now + REFERRAL_SESSION_TTL_MS,
    handoffToken: parsed.handoffToken,
  };
  memoryEntry = entry;
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Privacy-restricted browsers may deny sessionStorage; module memory is sufficient.
  }
  return parsed;
}

export function captureCurrentReferralHandoff(now = Date.now()): ReferralSessionState {
  if (typeof window === 'undefined') return readReferralHandoff(null, now);

  const fragment = window.location.hash;
  if (fragment) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return captureReferralHandoff(fragment, browserSessionStorage(), now);
  }
  return readReferralHandoff(browserSessionStorage(), now);
}

export function discardCurrentReferralHandoff() {
  if (typeof window !== 'undefined' && window.location.hash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
  clearReferralHandoff();
}

export function readReferralHandoff(
  storage: ReferralSessionStorage | null = browserSessionStorage(),
  now = Date.now(),
): ReferralSessionState {
  let entry = memoryEntry;
  if (!entry) {
    try {
      const stored = storage?.getItem(STORAGE_KEY);
      entry = stored ? parseStoredEntry(stored) : null;
      if (stored && !entry) storage?.removeItem(STORAGE_KEY);
    } catch {
      entry = null;
    }
  }

  if (!entry) return { status: 'missing' };
  if (entry.capturedAt > now || entry.expiresAt > now + REFERRAL_SESSION_TTL_MS) {
    clearReferralHandoff(storage);
    return { status: 'invalid' };
  }
  if (entry.expiresAt <= now) {
    clearReferralHandoff(storage);
    return { status: 'expired' };
  }
  return { status: 'ready', handoffToken: entry.handoffToken };
}

export function clearReferralHandoff(
  storage: ReferralSessionStorage | null = browserSessionStorage(),
) {
  memoryEntry = null;
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Clearing an unavailable session store must not block ordinary app use.
  }
}

export function referralAuthReturnPath() {
  return affiliateReferralsEnabled() && readReferralHandoff().status === 'ready' ? '/referral' : '/';
}

function parseReferralFragment(fragment: string): ReferralSessionState {
  if (!fragment.startsWith('#') || fragment.length > 64) return { status: 'invalid' };
  const entries = [...new URLSearchParams(fragment.slice(1)).entries()];
  if (
    entries.length !== 1 ||
    entries[0][0] !== 'handoff' ||
    !isReferralHandoffToken(entries[0][1])
  ) {
    return { status: 'invalid' };
  }
  return { status: 'ready', handoffToken: entries[0][1] };
}

function parseStoredEntry(raw: string): ReferralSessionEntry | null {
  if (raw.length > 256) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      !isReferralHandoffToken(value.handoffToken) ||
      !Number.isSafeInteger(value.capturedAt) ||
      !Number.isSafeInteger(value.expiresAt) ||
      (value.expiresAt as number) - (value.capturedAt as number) !== REFERRAL_SESSION_TTL_MS
    ) {
      return null;
    }
    return value as ReferralSessionEntry;
  } catch {
    return null;
  }
}

function browserSessionStorage(): ReferralSessionStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
