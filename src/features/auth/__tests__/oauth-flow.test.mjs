import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_AUTH_REDIRECT_ORIGINS,
  ALLOWED_AUTH_REDIRECT_PROTOCOLS,
  DESKTOP_AUTH_CALLBACK_URL,
  selectWebOauthFlow,
} from '../oauth-flow.ts';
import { SIGN_IN_METHODS_COPY } from '../sign-in-copy.ts';

test('packaged Electron uses the system-browser redirect flow', () => {
  assert.equal(
    selectWebOauthFlow({ protocol: 'https:', userAgent: 'GlideLingo Electron/44.0.0' }),
    'redirect',
  );
});

test('development Electron retains the in-app popup flow', () => {
  assert.equal(
    selectWebOauthFlow({ protocol: 'http:', userAgent: 'GlideLingo Electron/44.0.0' }),
    'popup',
  );
});

test('ordinary web renderers use the popup flow', () => {
  assert.equal(selectWebOauthFlow({ protocol: 'https:', userAgent: 'Mozilla/5.0' }), 'popup');
});

test('Clerk allows only the desktop custom callback protocol and opaque origin', () => {
  const callback = new URL(DESKTOP_AUTH_CALLBACK_URL);

  assert.equal(callback.origin, 'null');
  assert.deepEqual(ALLOWED_AUTH_REDIRECT_PROTOCOLS, ['glidelingo:']);
  assert.equal(ALLOWED_AUTH_REDIRECT_ORIGINS.some((origin) => origin.test(callback.origin)), true);
  assert.equal(ALLOWED_AUTH_REDIRECT_ORIGINS.some((origin) => origin.test('https://attacker.example')), false);
});

test('desktop sign-in copy names every configured MVP method', () => {
  for (const method of ['Google', 'Apple', 'email', 'phone']) {
    assert.match(SIGN_IN_METHODS_COPY, new RegExp(`\\b${method}\\b`));
  }
});
