const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  PRODUCTION_API_ORIGIN,
  PRODUCTION_CLERK_ORIGIN,
  buildContentSecurityPolicy,
  findAuthCallbackUrl,
  isAllowedAuthWindowUrl,
  isAllowedNavigation,
  isExactAppUrl,
  isSafeExternalUrl,
  parseAuthCallbackUrl,
  resolveRendererPath,
  validateDevelopmentUrl,
} = require('./runtime.cjs');

test('authentication popups are restricted to Clerk, Google, and Apple HTTPS origins', () => {
  assert.equal(isAllowedAuthWindowUrl('https://vast-gator-9531.clerk.accounts.dev/v1/oauth_callback'), true);
  assert.equal(isAllowedAuthWindowUrl('https://accounts.google.com/o/oauth2/v2/auth'), true);
  assert.equal(isAllowedAuthWindowUrl('https://appleid.apple.com/auth/authorize'), true);
  assert.equal(isAllowedAuthWindowUrl('https://clerk.accounts.dev.attacker.example/'), false);
  assert.equal(isAllowedAuthWindowUrl('https://another-instance.clerk.accounts.dev/'), false);
  assert.equal(isAllowedAuthWindowUrl('http://accounts.google.com/'), false);
  assert.equal(isAllowedAuthWindowUrl('javascript:alert(1)'), false);
});

test('packaged CSP includes exact API and Clerk origins plus web checkout providers', () => {
  const policy = buildContentSecurityPolicy();

  assert.match(policy, new RegExp(PRODUCTION_API_ORIGIN.replaceAll('.', '\\.')));
  assert.match(policy, new RegExp(PRODUCTION_CLERK_ORIGIN.replaceAll('.', '\\.')));
  assert.match(policy, /https:\/\/js\.stripe\.com/);
  assert.match(policy, /https:\/\/cdn\.paddle\.com/);
  assert.doesNotMatch(policy, /\*\.clerk\.accounts\.dev/);
});

test('OS authentication callbacks require the exact app origin, route, and bounded parameters', () => {
  const valid = 'glidelingo://app/sign-in?__clerk_status=verified&state=opaque';

  assert.equal(parseAuthCallbackUrl(valid), valid);
  assert.equal(findAuthCallbackUrl(['/Applications/GlideLingo.app', valid]), valid);
  assert.equal(parseAuthCallbackUrl('glidelingo://other/sign-in?state=opaque'), null);
  assert.equal(parseAuthCallbackUrl('glidelingo://app:123/sign-in?state=opaque'), null);
  assert.equal(parseAuthCallbackUrl('glidelingo://user:pass@app/sign-in?state=opaque'), null);
  assert.equal(parseAuthCallbackUrl('glidelingo://app/progress?state=opaque'), null);
  assert.equal(parseAuthCallbackUrl('https://app/sign-in?state=opaque'), null);
  assert.equal(parseAuthCallbackUrl('glidelingo://app/sign-in?state=one&state=two'), null);
  assert.equal(parseAuthCallbackUrl(`glidelingo://app/sign-in?state=${'x'.repeat(3000)}`), null);
});

test('packaged renderer URLs require the exact custom-protocol authority', () => {
  assert.equal(isExactAppUrl('glidelingo://app/sign-in'), true);
  assert.equal(isExactAppUrl('glidelingo://app:123/sign-in'), false);
  assert.equal(isExactAppUrl('glidelingo://user:pass@app/sign-in'), false);
  assert.equal(isExactAppUrl('glidelingo://other/sign-in'), false);
});

test('development renderer URL is restricted to the local Expo server', () => {
  assert.equal(validateDevelopmentUrl('http://127.0.0.1:8081'), 'http://127.0.0.1:8081/');
  assert.equal(validateDevelopmentUrl('http://localhost:8081'), 'http://localhost:8081/');
  assert.throws(() => validateDevelopmentUrl('https://example.com'));
  assert.throws(() => validateDevelopmentUrl('http://localhost:3000'));
  assert.throws(() => validateDevelopmentUrl('http://localhost:8081/unexpected'));
});

test('custom protocol maps routes and assets inside the exported web directory', () => {
  const root = path.resolve('/tmp/glidelingo-dist');

  assert.equal(resolveRendererPath(root, 'glidelingo://app/'), path.join(root, 'index.html'));
  assert.equal(
    resolveRendererPath(root, 'glidelingo://app/explore'),
    path.join(root, 'explore.html'),
  );
  assert.equal(
    resolveRendererPath(root, 'glidelingo://app/_expo/static/app.js'),
    path.join(root, '_expo/static/app.js'),
  );
});

test('custom protocol rejects other hosts and traversal attempts', () => {
  const root = path.resolve('/tmp/glidelingo-dist');

  assert.equal(resolveRendererPath(root, 'glidelingo://other/index.html'), null);
  assert.equal(resolveRendererPath(root, 'glidelingo://app:123/index.html'), null);
  assert.equal(resolveRendererPath(root, 'glidelingo://user:pass@app/index.html'), null);
  assert.equal(resolveRendererPath(root, 'https://app/index.html'), null);
  assert.equal(resolveRendererPath(root, 'glidelingo://app/%2e%2e/secret.txt'), null);
  assert.equal(resolveRendererPath(root, 'glidelingo://app/%E0%A4%A'), null);
});

test('navigation stays in the renderer and only HTTPS links may open externally', () => {
  assert.equal(
    isAllowedNavigation('glidelingo://app/explore', 'glidelingo://app/'),
    true,
  );
  assert.equal(
    isAllowedNavigation('glidelingo://other/explore', 'glidelingo://app/'),
    false,
  );
  assert.equal(
    isAllowedNavigation('glidelingo://app:123/explore', 'glidelingo://app/'),
    false,
  );
  assert.equal(
    isAllowedNavigation('glidelingo://user:pass@app/explore', 'glidelingo://app/'),
    false,
  );
  assert.equal(
    isAllowedNavigation('http://127.0.0.1:8081/explore', 'http://127.0.0.1:8081/'),
    true,
  );
  assert.equal(isSafeExternalUrl('https://docs.expo.dev/'), true);
  assert.equal(isSafeExternalUrl('http://example.com/'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
});
