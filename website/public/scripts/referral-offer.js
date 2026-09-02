const HANDOFF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_KEY = 'glidelingo.referral-handoff.v1';
const SESSION_TTL_MS = 15 * 60 * 1000;
let memoryEntry = null;

export function captureReferralHash(hash, storage, now = Date.now()) {
  const parsed = parseReferralHash(hash);
  if (parsed.status !== 'ready') {
    clearReferralSession(storage);
    return parsed;
  }
  const entry = { capturedAt: now, expiresAt: now + SESSION_TTL_MS, handoff: parsed.handoff };
  memoryEntry = entry;
  try { storage?.setItem(SESSION_KEY, JSON.stringify(entry)); } catch { /* memory fallback */ }
  return { status: 'ready', handoff: entry.handoff };
}

export function readReferralSession(storage, now = Date.now()) {
  let entry = memoryEntry;
  if (!entry) {
    try {
      const raw = storage?.getItem(SESSION_KEY);
      entry = raw ? parseStoredEntry(raw) : null;
      if (raw && !entry) storage?.removeItem(SESSION_KEY);
    } catch { entry = null; }
  }
  if (!entry) return { status: 'missing' };
  if (entry.capturedAt > now || entry.expiresAt > now + SESSION_TTL_MS) {
    clearReferralSession(storage);
    return { status: 'invalid' };
  }
  if (entry.expiresAt <= now) {
    clearReferralSession(storage);
    return { status: 'expired' };
  }
  return { status: 'ready', handoff: entry.handoff };
}

export function clearReferralSession(storage) {
  memoryEntry = null;
  try { storage?.removeItem(SESSION_KEY); } catch { /* ordinary navigation stays available */ }
}

export function initializeReferralOffer({ document, history, location, sessionStorage }) {
  const root = document.querySelector('[data-referral-offer]');
  if (!root) return;
  const enabled = root.getAttribute('data-referral-enabled') === 'true';
  const appUrl = root.getAttribute('data-referral-app-url') ?? '';
  const fragment = location.hash;
  if (fragment) history.replaceState(null, '', `${location.pathname}${location.search}`);
  if (!enabled) {
    clearReferralSession(sessionStorage);
    showState(root, 'disabled');
    return;
  }

  let result;
  if (fragment) {
    const status = new URLSearchParams(fragment.slice(1)).get('status');
    if (status === 'unavailable') {
      clearReferralSession(sessionStorage);
      result = { status: 'unavailable' };
    } else {
      result = captureReferralHash(fragment, sessionStorage);
    }
  } else {
    result = readReferralSession(sessionStorage);
  }
  if (result.status !== 'ready') {
    showState(root, result.status);
    return;
  }

  const browserLink = root.querySelector('[data-referral-browser]');
  const desktopLink = root.querySelector('[data-referral-desktop]');
  if (!(browserLink instanceof HTMLAnchorElement) || !(desktopLink instanceof HTMLAnchorElement)) {
    clearReferralSession(sessionStorage);
    showState(root, 'unavailable');
    return;
  }
  browserLink.href = `${appUrl}#handoff=${result.handoff}`;
  desktopLink.href = `glidelingo://app/referral?handoff=${result.handoff}`;
  showState(root, 'ready');
}

function parseReferralHash(hash) {
  if (typeof hash !== 'string' || hash.length > 64 || !hash.startsWith('#')) return { status: 'invalid' };
  const entries = [...new URLSearchParams(hash.slice(1)).entries()];
  if (entries.length !== 1 || entries[0][0] !== 'handoff' || !HANDOFF_PATTERN.test(entries[0][1])) {
    return { status: 'invalid' };
  }
  return { status: 'ready', handoff: entries[0][1] };
}

function parseStoredEntry(raw) {
  if (raw.length > 256) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !HANDOFF_PATTERN.test(value.handoff) ||
      !Number.isSafeInteger(value.capturedAt) || !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt - value.capturedAt !== SESSION_TTL_MS) return null;
    return value;
  } catch { return null; }
}

function showState(root, state) {
  for (const section of root.querySelectorAll('[data-referral-state]')) {
    section.hidden = section.getAttribute('data-referral-state') !== state;
  }
  root.setAttribute('data-referral-current-state', state);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  initializeReferralOffer({
    document,
    history: window.history,
    location: window.location,
    sessionStorage: browserSessionStorage(window),
  });
}

function browserSessionStorage(window) {
  try { return window.sessionStorage; } catch { return null; }
}
