import { beforeEach, describe, expect, it } from 'vitest';
import { captureReferralHash, clearReferralSession, readReferralSession } from '../../public/scripts/referral-offer.js';

const token = 'A'.repeat(43);
function createStorage({ throws = false } = {}) {
  /** @type {Map<string, string>} */
  const values = new Map();
  return { values,
    /** @param {string} key */
    getItem(key) { if (throws) throw new Error('blocked'); return values.get(key) ?? null; },
    /** @param {string} key */
    removeItem(key) { if (throws) throw new Error('blocked'); values.delete(key); },
    /** @param {string} key @param {string} value */
    setItem(key, value) { if (throws) throw new Error('blocked'); values.set(key, value); },
  };
}
beforeEach(() => clearReferralSession(createStorage()));

describe('marketing referral session', () => {
  it('retains a valid handoff only for the bounded session', () => {
    const storage = createStorage();
    expect(captureReferralHash(`#handoff=${token}`, storage, 1_000)).toEqual({ status: 'ready', handoff: token });
    expect(readReferralSession(storage, 900_999)).toEqual({ status: 'ready', handoff: token });
    expect(readReferralSession(storage, 901_000)).toEqual({ status: 'expired' });
  });
  it.each(['', '#handoff=', `#handoff=${'a'.repeat(42)}`, `#handoff=${'a'.repeat(44)}`,
    `#handoff=${'a'.repeat(42)}=`, `#handoff=${token}&handoff=${token}`, `#handoff=${token}&next=evil`])
  ('rejects malformed or ambiguous fragments', (hash) => {
    expect(captureReferralHash(hash, createStorage())).toEqual({ status: 'invalid' });
  });
  it('falls back to bounded memory when sessionStorage is unavailable', () => {
    const storage = createStorage({ throws: true });
    expect(captureReferralHash(`#handoff=${token}`, storage, 5_000).status).toBe('ready');
    expect(readReferralSession(storage, 5_001)).toEqual({ status: 'ready', handoff: token });
  });
  it('removes a malformed stored entry before returning ordinary recovery', () => {
    const storage = createStorage();
    storage.setItem('glidelingo.referral-handoff.v1', JSON.stringify({ handoff: 'oversized'.repeat(40) }));

    expect(readReferralSession(storage)).toEqual({ status: 'missing' });
    expect(storage.values.size).toBe(0);
  });
});
