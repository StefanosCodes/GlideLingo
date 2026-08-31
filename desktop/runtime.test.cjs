const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  isAllowedNavigation,
  isSafeExternalUrl,
  resolveRendererPath,
  validateDevelopmentUrl,
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
