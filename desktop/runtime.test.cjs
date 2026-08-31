const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  createContentSecurityPolicy,
  isAllowedNavigation,
  isSafeExternalUrl,
  resolveRendererPath,
  validateDevelopmentUrl,
  validateProductionApiOrigin,
} = require('./runtime.cjs');

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
    isAllowedNavigation('http://127.0.0.1:8081/explore', 'http://127.0.0.1:8081/'),
    true,
  );
  assert.equal(isSafeExternalUrl('https://docs.expo.dev/'), true);
  assert.equal(isSafeExternalUrl('http://example.com/'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
});

test('packaged API access is restricted to one exact HTTPS origin', () => {
  assert.equal(validateProductionApiOrigin(undefined), null);
  assert.equal(
    validateProductionApiOrigin('https://api.glidelingo.com'),
    'https://api.glidelingo.com',
  );
  assert.equal(
    validateProductionApiOrigin('https://api.glidelingo.com:8443'),
    'https://api.glidelingo.com:8443',
  );

  for (const value of [
    'http://api.glidelingo.com',
    'https://user@example.com',
    'https://api.glidelingo.com/v1',
    'https://api.glidelingo.com?debug=true',
    ' https://api.glidelingo.com',
  ]) {
    assert.throws(() => validateProductionApiOrigin(value));
  }
});

test('packaged CSP permits only the configured API origin for network requests', () => {
  assert.match(createContentSecurityPolicy(null), /connect-src 'self';/);
  const connectDirective = createContentSecurityPolicy('https://api.glidelingo.com')
    .split('; ')
    .find((directive) => directive.startsWith('connect-src'));
  assert.equal(
    connectDirective,
    "connect-src 'self' https://api.glidelingo.com",
  );
});
