import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDesktopOAuthTransport,
  isExactDesktopOAuthCallback,
} from '../desktop-oauth-transport.ts';

test('desktop OAuth callback validation accepts only the exact app callback route', () => {
  assert.equal(
    isExactDesktopOAuthCallback(
      'glidelingo://app/sso-callback?rotating_token_nonce=nonce&__clerk_status=verified',
    ),
    true,
  );

  for (const value of [
    'glidelingo://app/sign-in',
    'glidelingo://other/sso-callback',
    'glidelingo://app:44/sso-callback',
    'https://app/sso-callback',
    'not-a-url',
  ]) {
    assert.equal(isExactDesktopOAuthCallback(value), false);
  }
});

test('desktop OAuth transport delegates only through the injected Electron bridge', async () => {
  assert.equal(getDesktopOAuthTransport(), undefined);

  const opened = [];
  globalThis.window = {
    glideLingoDesktopAuth: {
      open: async (url) => {
        opened.push(url);
        return { callbackUrl: 'glidelingo://app/sso-callback?rotating_token_nonce=nonce' };
      },
    },
    location: { origin: 'https://desktop.glidelingo.com' },
  };

  const transport = getDesktopOAuthTransport();
  assert.equal(transport.getRedirectUrl(), 'glidelingo://app/sso-callback');
  assert.deepEqual(
    await transport.open(new URL('https://accounts.google.com/o/oauth2/v2/auth')),
    { callbackUrl: 'glidelingo://app/sso-callback?rotating_token_nonce=nonce' },
  );
  assert.deepEqual(opened, ['https://accounts.google.com/o/oauth2/v2/auth']);

  delete globalThis.window;
});

test('desktop OAuth transport is not enabled for an ordinary development renderer', () => {
  globalThis.window = {
    glideLingoDesktopAuth: { open: async () => ({ callbackUrl: '' }) },
    location: { origin: 'http://localhost:8081' },
  };

  assert.equal(getDesktopOAuthTransport(), undefined);
  delete globalThis.window;
});
