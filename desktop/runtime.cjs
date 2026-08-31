const path = require('node:path');

const APP_SCHEME = 'glidelingo';
const APP_HOST = 'app';
const DEVELOPMENT_PORT = '8081';

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

module.exports = {
  APP_HOST,
  APP_SCHEME,
  isAllowedNavigation,
  isSafeExternalUrl,
  resolveRendererPath,
  validateDevelopmentUrl,
};
