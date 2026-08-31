const path = require('node:path');

const APP_SCHEME = 'glidelingo';
const APP_HOST = 'app';
const DEVELOPMENT_PORT = '8081';
const PRODUCTION_API_ORIGIN = 'https://glidelingo-api-50843312405.us-west1.run.app';
const PRODUCTION_CLERK_ORIGIN = 'https://vast-gator-9531.clerk.accounts.dev';
const AUTH_CALLBACK_PATHS = new Set(['/sign-in', '/sso-callback']);
const AUTH_PROVIDER_ORIGINS = new Set([
  PRODUCTION_CLERK_ORIGIN,
  'https://accounts.google.com',
  'https://appleid.apple.com',
]);

function buildContentSecurityPolicy() {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${PRODUCTION_CLERK_ORIGIN} https://challenges.cloudflare.com https://*.protect.clerk.com https://js.stripe.com https://cdn.paddle.com`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${PRODUCTION_CLERK_ORIGIN} https://img.clerk.com https://*.clerk.com https://*.stripe.com https://*.paddle.com https://*.revenuecat.com`,
    "font-src 'self' data:",
    `connect-src 'self' ${PRODUCTION_API_ORIGIN} ${PRODUCTION_CLERK_ORIGIN} https://api.clerk.com https://*.protect.clerk.com:* https://api.revenuecat.com https://e.revenue.cat https://sdk.revenuecat-static.com https://*.stripe.com https://*.paddle.com wss://${new URL(PRODUCTION_CLERK_ORIGIN).hostname}`,
    "media-src 'self' data: blob:",
    "object-src 'none'",
    `frame-src ${PRODUCTION_CLERK_ORIGIN} https://accounts.google.com https://appleid.apple.com https://challenges.cloudflare.com https://*.protect.clerk.com https://js.stripe.com https://hooks.stripe.com https://*.paddle.com`,
    `form-action 'self' ${PRODUCTION_CLERK_ORIGIN} https://accounts.google.com https://appleid.apple.com https://*.stripe.com https://*.paddle.com`,
    "base-uri 'self'",
    "worker-src 'self' blob:",
  ].join('; ');
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

  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== APP_HOST) {
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
      return target.protocol === `${APP_SCHEME}:` && target.hostname === APP_HOST;
    }

    return target.origin === renderer.origin;
  } catch {
    return false;
  }
}

function isSafeExternalUrl(targetUrl) {
  try {
    return new URL(targetUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

function isAllowedAuthWindowUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return false;

    return AUTH_PROVIDER_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
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
    url.protocol !== `${APP_SCHEME}:` ||
    url.hostname !== APP_HOST ||
    url.username ||
    url.password ||
    !AUTH_CALLBACK_PATHS.has(url.pathname)
  ) {
    return null;
  }

  const parameters = [...url.searchParams.entries()];
  if (parameters.length > 32) return null;
  if (new Set(parameters.map(([name]) => name)).size !== parameters.length) return null;
  if (
    parameters.some(
      ([name, value]) => !/^[A-Za-z0-9_.-]{1,80}$/.test(name) || value.length > 2048,
    )
  ) {
    return null;
  }

  return url.toString();
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
  PRODUCTION_API_ORIGIN,
  PRODUCTION_CLERK_ORIGIN,
  buildContentSecurityPolicy,
  findAuthCallbackUrl,
  isAllowedAuthWindowUrl,
  isAllowedNavigation,
  isSafeExternalUrl,
  parseAuthCallbackUrl,
  resolveRendererPath,
  validateDevelopmentUrl,
};
