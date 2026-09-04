const path = require('node:path');

const APP_SCHEME = 'glidelingo';
const APP_HOST = 'app';
const PACKAGED_RENDERER_ORIGIN = 'https://desktop.glidelingo.com';
const DEVELOPMENT_PORT = '8081';
const DEVELOPMENT_CLERK_ORIGIN = 'https://vast-gator-9531.clerk.accounts.dev';
const PRODUCTION_API_ORIGIN = 'https://glidelingo-api-production-50843312405.us-west1.run.app';
const PRODUCTION_CLERK_ORIGIN = 'https://clerk.glidelingo.com';
const REVENUECAT_WEB_SDK_ORIGIN = 'https://sdk.revenuecat-static.com';
const REVENUECAT_BRANDING_ORIGIN = 'https://da08ctfrofx1b.cloudfront.net';
const AUTH_CALLBACK_PATHS = new Set(['/sign-in', '/sso-callback']);
const REFERRAL_PATH = '/referral';
const REFERRAL_HANDOFF_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const AUTH_CALLBACK_DESTINATIONS = new Set([
  `${APP_SCHEME}://${APP_HOST}/sign-in`,
  `${APP_SCHEME}://${APP_HOST}/sso-callback`,
]);
const STATIC_AUTH_PROVIDER_ORIGINS = new Set([
  'https://accounts.google.com',
  'https://appleid.apple.com',
]);

function isExactAppUrl(value) {
  let url;

  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }

  return (
    url.protocol === `${APP_SCHEME}:` &&
    url.hostname === APP_HOST &&
    !url.port &&
    !url.username &&
    !url.password
  );
}

function isExactPackagedRendererUrl(value) {
  let url;

  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }

  return (
    url.protocol === 'https:' &&
    url.origin === PACKAGED_RENDERER_ORIGIN &&
    !url.port &&
    !url.username &&
    !url.password
  );
}

function buildContentSecurityPolicy({
  apiOrigin = PRODUCTION_API_ORIGIN,
  clerkOrigin = PRODUCTION_CLERK_ORIGIN,
} = {}) {
  const exactApiOrigin = validateProductionApiOrigin(apiOrigin);
  const exactClerkOrigin = validateProductionClerkOrigin(clerkOrigin);

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${exactClerkOrigin} https://challenges.cloudflare.com https://*.protect.clerk.com ${REVENUECAT_WEB_SDK_ORIGIN} https://js.stripe.com https://cdn.paddle.com`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${exactClerkOrigin} https://img.clerk.com https://*.clerk.com ${REVENUECAT_BRANDING_ORIGIN} https://*.stripe.com https://*.paddle.com https://*.revenuecat.com`,
    `font-src 'self' data: ${REVENUECAT_BRANDING_ORIGIN}`,
    `connect-src 'self' ${exactApiOrigin} ${exactClerkOrigin} https://api.clerk.com https://*.protect.clerk.com:* https://api.revenuecat.com https://e.revenue.cat ${REVENUECAT_WEB_SDK_ORIGIN} https://*.stripe.com https://*.paddle.com wss://${new URL(exactClerkOrigin).hostname}`,
    "media-src 'self' data: blob:",
    "object-src 'none'",
    `frame-src ${exactClerkOrigin} https://accounts.google.com https://appleid.apple.com https://challenges.cloudflare.com https://*.protect.clerk.com https://js.stripe.com https://hooks.stripe.com https://*.paddle.com`,
    `form-action 'self' ${exactClerkOrigin} https://accounts.google.com https://appleid.apple.com https://*.stripe.com https://*.paddle.com`,
    "base-uri 'self'",
    "worker-src 'self' blob:",
  ].join('; ');
}

function validateProductionApiOrigin(value) {
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new Error('The packaged API origin must be a trimmed HTTPS origin.');
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error('The packaged API origin must be a valid absolute URL.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('The packaged API origin must be an HTTPS origin without credentials or a path.');
  }

  return url.origin;
}

function validateProductionClerkOrigin(value) {
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new Error('The packaged Clerk origin must be a trimmed HTTPS origin.');
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error('The packaged Clerk origin must be a valid absolute URL.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('The packaged Clerk origin must be an HTTPS origin without credentials or a path.');
  }

  return url.origin;
}

function validateDevelopmentUrl(value) {
  if (!value) {
    return null;
  }

  const url = new URL(value);
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

  if (
    url.protocol !== 'http:' ||
    !loopbackHosts.has(url.hostname) ||
    url.port !== DEVELOPMENT_PORT ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `ELECTRON_RENDERER_URL must be http://localhost:${DEVELOPMENT_PORT} or ` +
        `http://127.0.0.1:${DEVELOPMENT_PORT}`,
    );
  }

  return url.toString();
}

function resolveRendererPath(distDirectory, requestUrl) {
  let decodedRequestPath;

  try {
    const requestWithoutQuery = requestUrl.split(/[?#]/, 1)[0];
    const authorityEnd = requestWithoutQuery.indexOf('/', requestWithoutQuery.indexOf('://') + 3);
    const rawPath = authorityEnd === -1 ? '/' : requestWithoutQuery.slice(authorityEnd);
    decodedRequestPath = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  if (decodedRequestPath.split('/').includes('..')) {
    return null;
  }

  let url;

  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }

  if (!isExactPackagedRendererUrl(url)) {
    return null;
  }

  let pathname;

  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  if (pathname.includes('\0')) {
    return null;
  }

  let relativePath = pathname.replace(/^\/+/, '');

  if (!relativePath) {
    relativePath = 'index.html';
  } else if (!path.extname(relativePath)) {
    relativePath = `${relativePath}.html`;
  }

  const root = path.resolve(distDirectory);
  const candidate = path.resolve(root, relativePath);

  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  return candidate;
}

function isAllowedNavigation(targetUrl, rendererUrl) {
  try {
    const target = new URL(targetUrl);
    const renderer = new URL(rendererUrl);

    if (renderer.protocol === `${APP_SCHEME}:`) {
      return isExactAppUrl(renderer) && isExactAppUrl(target);
    }

    return (
      target.protocol === renderer.protocol &&
      target.origin === renderer.origin &&
      !target.username &&
      !target.password
    );
  } catch {
    return false;
  }
}

function mapAuthCallbackToRendererUrl(
  targetUrl,
  rendererOrigin = PACKAGED_RENDERER_ORIGIN,
) {
  const callbackUrl = parseAuthCallbackUrl(targetUrl);
  if (!callbackUrl) return null;

  let renderer;
  try {
    renderer = new URL(rendererOrigin);
  } catch {
    return null;
  }
  const isPackagedRenderer = isExactPackagedRendererUrl(renderer);
  let isDevelopmentRenderer = false;
  try {
    isDevelopmentRenderer = Boolean(validateDevelopmentUrl(rendererOrigin));
  } catch {
    isDevelopmentRenderer = false;
  }
  if (!isPackagedRenderer && !isDevelopmentRenderer) return null;

  const callback = new URL(callbackUrl);
  const translated = new URL(callback.pathname, renderer);
  translated.search = callback.search;
  translated.hash = callback.hash;
  return translated.toString();
}

function parseReferralAppUrl(targetUrl) {
  if (typeof targetUrl !== 'string' || targetUrl.length > 128) return null;
  const match = targetUrl.match(
    /^glidelingo:\/\/app\/referral\?handoff=([A-Za-z0-9_-]{43})$/,
  );
  if (!match) return null;

  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    return null;
  }
  if (
    !isExactAppUrl(url) ||
    url.pathname !== REFERRAL_PATH ||
    url.hash ||
    !REFERRAL_HANDOFF_PATTERN.test(match[1])
  ) return null;
  return url.toString();
}

function mapReferralAppUrlToRendererUrl(
  targetUrl,
  rendererOrigin = PACKAGED_RENDERER_ORIGIN,
) {
  const accepted = parseReferralAppUrl(targetUrl);
  if (!accepted) return null;

  let renderer;
  try {
    renderer = new URL(rendererOrigin);
  } catch {
    return null;
  }
  const isPackagedRenderer = isExactPackagedRendererUrl(renderer);
  let isDevelopmentRenderer = false;
  try {
    isDevelopmentRenderer = Boolean(validateDevelopmentUrl(rendererOrigin));
  } catch {
    isDevelopmentRenderer = false;
  }
  if (!isPackagedRenderer && !isDevelopmentRenderer) return null;

  const referral = new URL(accepted);
  const translated = new URL(REFERRAL_PATH, renderer);
  translated.hash = `handoff=${referral.searchParams.get('handoff')}`;
  return translated.toString();
}

function parseSupportedAppUrl(targetUrl, { referralsEnabled = false } = {}) {
  const authUrl = parseAuthCallbackUrl(targetUrl);
  if (authUrl) return { kind: 'auth', url: authUrl };
  if (!referralsEnabled) return null;
  const referralUrl = parseReferralAppUrl(targetUrl);
  return referralUrl ? { kind: 'referral', url: referralUrl } : null;
}

function resolveAffiliateReferralsEnabled({ developmentUrl, environmentValue, packagedValue }) {
  return developmentUrl
    ? environmentValue === 'true'
    : packagedValue === true || packagedValue === 'true';
}

function findSupportedAppUrl(argv, options) {
  for (const argument of argv) {
    const appUrl = parseSupportedAppUrl(argument, options);
    if (appUrl) return appUrl;
  }
  return null;
}

function mapSupportedAppUrlToRendererUrl(appUrl, rendererOrigin = PACKAGED_RENDERER_ORIGIN) {
  if (!appUrl || typeof appUrl !== 'object') return null;
  if (appUrl.kind === 'auth') return mapAuthCallbackToRendererUrl(appUrl.url, rendererOrigin);
  if (appUrl.kind === 'referral') return mapReferralAppUrlToRendererUrl(appUrl.url, rendererOrigin);
  return null;
}

function dispatchSupportedAppUrl(targetUrl, {
  activateWindow,
  hasWindow,
  loadRendererUrl,
  referralsEnabled = false,
  rendererOrigin = PACKAGED_RENDERER_ORIGIN,
  storePendingUrl,
}) {
  const acceptedAppUrl = typeof targetUrl === 'string'
    ? parseSupportedAppUrl(targetUrl, { referralsEnabled })
    : targetUrl;
  const rendererUrl = mapSupportedAppUrlToRendererUrl(acceptedAppUrl, rendererOrigin);
  if (!acceptedAppUrl || !rendererUrl) return false;

  if (!hasWindow()) {
    storePendingUrl(acceptedAppUrl);
    return true;
  }

  activateWindow();
  loadRendererUrl(rendererUrl);
  return true;
}

function redactUrlForLogging(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

function isSafeExternalUrl(targetUrl) {
  try {
    return new URL(targetUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

function isAllowedAuthWindowUrl(targetUrl, clerkOrigin = PRODUCTION_CLERK_ORIGIN) {
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return false;

    return (
      url.origin === validateProductionClerkOrigin(clerkOrigin) ||
      STATIC_AUTH_PROVIDER_ORIGINS.has(url.origin)
    );
  } catch {
    return false;
  }
}

function isAllowedAuthPopupNavigation(
  targetUrl,
  rendererUrl,
  clerkOrigin = PRODUCTION_CLERK_ORIGIN,
) {
  if (isAllowedAuthWindowUrl(targetUrl, clerkOrigin)) return true;

  try {
    const target = new URL(targetUrl);
    const renderer = new URL(rendererUrl);

    return (
      renderer.protocol === 'http:' &&
      target.protocol === 'http:' &&
      target.origin === renderer.origin &&
      !target.username &&
      !target.password
    );
  } catch {
    return false;
  }
}

function installAuthPopupNavigationSecurity(
  webContents,
  { rendererUrl, clerkOrigin = PRODUCTION_CLERK_ORIGIN, openExternalUrl },
) {
  const enforceAllowlist = (event, targetUrl) => {
    if (isAllowedAuthPopupNavigation(targetUrl, rendererUrl, clerkOrigin)) return;

    event.preventDefault();
    openExternalUrl(targetUrl);
  };

  webContents.on('will-navigate', enforceAllowlist);
  webContents.on('will-redirect', enforceAllowlist);
}

function parseAuthCallbackUrl(targetUrl) {
  if (typeof targetUrl !== 'string' || targetUrl.length > 4096) return null;

  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    return null;
  }

  if (
    !isExactAppUrl(url) ||
    !AUTH_CALLBACK_PATHS.has(url.pathname)
  ) {
    return null;
  }

  const parameters = authCallbackParameters(url);
  if (parameters.length > 32) return null;
  const normalizedParameterNames = parameters.map(([name]) => normalizeAuthParameterName(name));
  if (new Set(normalizedParameterNames).size !== parameters.length) return null;
  if (
    parameters.some(
      ([name, value]) =>
        !/^[A-Za-z0-9_.-]{1,80}$/.test(name) ||
        value.length > 2048 ||
        (isAuthRedirectParameter(name) && !isExactAuthCallbackDestination(value)),
    )
  ) {
    return null;
  }

  return url.toString();
}

function authCallbackParameters(url) {
  const parameters = [...url.searchParams.entries()];
  const hash = url.hash.slice(1);
  const queryStart = hash.indexOf('?');
  const hashQuery =
    queryStart >= 0
      ? hash.slice(queryStart + 1)
      : !hash.startsWith('/') && hash.includes('=')
        ? hash
        : null;

  if (hashQuery !== null) {
    parameters.push(...new URLSearchParams(hashQuery).entries());
  }
  return parameters;
}

function normalizeAuthParameterName(name) {
  return name.replaceAll(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function isAuthRedirectParameter(name) {
  const normalized = normalizeAuthParameterName(name);
  return (
    (normalized.includes('redirect') && normalized.includes('url')) ||
    (normalized.startsWith('after') && normalized.endsWith('url'))
  );
}

function isExactAuthCallbackDestination(value) {
  let decoded = value;

  // URLSearchParams has already decoded the query value once. Decode any
  // remaining nested encoding before comparing the complete destination.
  for (let depth = 0; depth < 16; depth += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return false;
    }
    if (next === decoded) return AUTH_CALLBACK_DESTINATIONS.has(decoded);
    decoded = next;
  }

  return false;
}

function findAuthCallbackUrl(argv) {
  for (const argument of argv) {
    const callbackUrl = parseAuthCallbackUrl(argument);
    if (callbackUrl) return callbackUrl;
  }
  return null;
}

module.exports = {
  APP_HOST,
  APP_SCHEME,
  DEVELOPMENT_CLERK_ORIGIN,
  PACKAGED_RENDERER_ORIGIN,
  PRODUCTION_API_ORIGIN,
  PRODUCTION_CLERK_ORIGIN,
  REVENUECAT_BRANDING_ORIGIN,
  REVENUECAT_WEB_SDK_ORIGIN,
  buildContentSecurityPolicy,
  dispatchSupportedAppUrl,
  findAuthCallbackUrl,
  isAllowedAuthPopupNavigation,
  isAllowedAuthWindowUrl,
  isAllowedNavigation,
  isExactAppUrl,
  isExactPackagedRendererUrl,
  isSafeExternalUrl,
  installAuthPopupNavigationSecurity,
  mapAuthCallbackToRendererUrl,
  mapReferralAppUrlToRendererUrl,
  mapSupportedAppUrlToRendererUrl,
  parseAuthCallbackUrl,
  parseReferralAppUrl,
  parseSupportedAppUrl,
  findSupportedAppUrl,
  redactUrlForLogging,
  resolveRendererPath,
  resolveAffiliateReferralsEnabled,
  validateDevelopmentUrl,
  validateProductionApiOrigin,
  validateProductionClerkOrigin,
};
