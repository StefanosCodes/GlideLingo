const HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RESOLVE_PATH = '/v1/affiliates/referrals/resolve';
const REQUEST_TIMEOUT_MS = 5_000;

type ReferralEnvironment = {
  AFFILIATE_REFERRAL_ENABLED?: string;
  GLIDELINGO_API_BASE_URL?: string;
};

type ReferralContext = {
  env: ReferralEnvironment;
  params: { slug?: string | string[] };
  request: Request;
};

type ReferralHandlerDependencies = {
  fetch: (input: URL, init?: RequestInit) => Promise<Response>;
};
const DEFAULT_DEPENDENCIES: ReferralHandlerDependencies = { fetch };

export async function handleReferralRequest(
  context: ReferralContext,
  dependencies: ReferralHandlerDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  if (context.env.AFFILIATE_REFERRAL_ENABLED !== 'true') return notFound();

  const linkSlug = typeof context.params.slug === 'string' ? context.params.slug : '';
  const requestUrl = safeUrl(context.request.url);
  const campaigns = requestUrl?.searchParams.getAll('campaign') ?? [];
  const campaignSlug = campaigns[0];
  const hasUnexpectedQuery = requestUrl
    ? [...requestUrl.searchParams.keys()].some((name) => name !== 'campaign')
    : true;

  if (
    !requestUrl ||
    hasUnexpectedQuery ||
    !SLUG_PATTERN.test(linkSlug) ||
    campaigns.length > 1 ||
    (campaignSlug !== undefined && !SLUG_PATTERN.test(campaignSlug))
  ) {
    return notFound();
  }

  const apiOrigin = parseApiOrigin(context.env.GLIDELINGO_API_BASE_URL);
  if (!apiOrigin) return unavailable();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await dependencies.fetch(new URL(RESOLVE_PATH, apiOrigin), {
      body: JSON.stringify({
        link_slug: linkSlug,
        ...(campaignSlug === undefined ? {} : { campaign_slug: campaignSlug }),
      }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    });

    if (response.status === 404) return notFound();
    if (!response.ok) return unavailable();

    const payload = await response.json().catch(() => null);
    if (!isResolveResponse(payload)) return unavailable();

    return new Response(null, {
      headers: referralHeaders(`/referral/#handoff=${payload.handoff_token}`),
      status: 303,
    });
  } catch {
    return unavailable();
  } finally {
    clearTimeout(timeout);
  }
}

export const onRequestGet = (context: ReferralContext) => handleReferralRequest(context);

function isResolveResponse(value: unknown): value is {
  status: 'resolved';
  handoff_token: string;
  expires_at: string;
} {
  if (!isRecord(value) || Object.keys(value).length !== 3) return false;
  if (
    value.status !== 'resolved' ||
    typeof value.handoff_token !== 'string' ||
    !HANDOFF_TOKEN_PATTERN.test(value.handoff_token) ||
    typeof value.expires_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.expires_at)
  ) {
    return false;
  }

  const expiry = Date.parse(value.expires_at);
  return Number.isFinite(expiry) && expiry > Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseApiOrigin(value: string | undefined): URL | null {
  if (!value || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) return null;
    return url;
  } catch {
    return null;
  }
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function referralHeaders(location?: string): HeadersInit {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    ...(location ? { Location: location } : {}),
  };
}

function notFound() {
  return new Response('Not found', { headers: referralHeaders(), status: 404 });
}

function unavailable() {
  return new Response(null, {
    headers: referralHeaders('/referral/#status=unavailable'),
    status: 303,
  });
}
