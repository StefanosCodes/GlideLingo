import { describe, expect, it, vi } from 'vitest';

import { handleReferralRequest } from './[slug]';

const token = 'a'.repeat(43);
const baseContext = {
  env: {
    AFFILIATE_REFERRAL_ENABLED: 'true',
    GLIDELINGO_API_BASE_URL: 'https://api.glidelingo.com',
  },
  params: { slug: 'creator-link' },
  request: new Request('https://glidelingo.com/r/creator-link?campaign=launch-video'),
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('Cloudflare referral route', () => {
  it('is a generic 404 and makes no API call when the flag is absent', async () => {
    const fetchMock = vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>();
    const response = await handleReferralRequest({ ...baseContext, env: {} }, { fetch: fetchMock });
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(token);
  });

  it('posts the exact resolve contract and redirects with only a fragment handoff', async () => {
    const fetchMock = vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>().mockResolvedValue(jsonResponse({
      status: 'resolved', handoff_token: token, expires_at: '2099-09-02T01:00:00Z',
    }));
    const response = await handleReferralRequest(baseContext, { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.glidelingo.com/v1/affiliates/referrals/resolve'),
      expect.objectContaining({
        body: JSON.stringify({ link_slug: 'creator-link', campaign_slug: 'launch-video' }),
        method: 'POST',
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`/referral/#handoff=${token}`);
    expect(new URL(response.headers.get('location')!, 'https://glidelingo.com').search).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it.each([
    { params: { slug: '../admin' }, url: 'https://glidelingo.com/r/bad' },
    { params: { slug: 'creator-link' }, url: 'https://glidelingo.com/r/creator-link?campaign=one&campaign=two' },
    { params: { slug: 'creator-link' }, url: 'https://glidelingo.com/r/creator-link?campaign=BAD!' },
    { params: { slug: 'creator-link' }, url: 'https://glidelingo.com/r/creator-link?next=evil' },
  ])('rejects malformed or ambiguous route input without calling the API', async ({ params, url }) => {
    const fetchMock = vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>();
    const response = await handleReferralRequest(
      { ...baseContext, params, request: new Request(url) },
      { fetch: fetchMock },
    );
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'resolved', handoff_token: 'x'.repeat(42), expires_at: '2099-09-02T01:00:00Z' },
    { status: 'resolved', handoff_token: `${'x'.repeat(42)}=`, expires_at: '2099-09-02T01:00:00Z' },
    { status: 'resolved', handoff_token: 'x'.repeat(44), expires_at: '2099-09-02T01:00:00Z' },
    { status: 'resolved', handoff_token: token, expires_at: '2020-09-02T01:00:00Z' },
    { status: 'resolved', handoff_token: token, expires_at: '2099-09-02T01:00:00Z', creator_id: 'must-not-leak' },
  ])('fails closed on malformed or stale upstream payloads', async (payload) => {
    const fetchMock = vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>().mockResolvedValue(jsonResponse(payload));
    const response = await handleReferralRequest(baseContext, { fetch: fetchMock });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/referral/#status=unavailable');
    expect(await response.text()).not.toContain(token);
  });

  it('maps an unknown link to 404 and an unavailable backend to generic recovery', async () => {
    const missing = vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>().mockResolvedValue(jsonResponse({ code: 'affiliate_referral_not_found' }, 404));
    const disabled = vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>().mockResolvedValue(jsonResponse({ code: 'affiliate_unavailable' }, 503));
    expect((await handleReferralRequest(baseContext, { fetch: missing })).status).toBe(404);
    expect((await handleReferralRequest(baseContext, { fetch: disabled })).status).toBe(303);
  });

  it('requires an exact HTTPS API origin when enabled', async () => {
    const fetchMock = vi.fn<(input: URL, init?: RequestInit) => Promise<Response>>();
    for (const api of ['', 'http://api.glidelingo.com', 'https://user@api.glidelingo.com', 'https://api.glidelingo.com/v1']) {
      const response = await handleReferralRequest(
        { ...baseContext, env: { ...baseContext.env, GLIDELINGO_API_BASE_URL: api } },
        { fetch: fetchMock },
      );
      expect(response.status).toBe(303);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
