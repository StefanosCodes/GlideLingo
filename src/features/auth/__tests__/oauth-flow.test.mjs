import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_AUTH_REDIRECT_PROTOCOLS,
  CLERK_ALLOWED_OPAQUE_REDIRECT_ORIGINS,
  DESKTOP_AUTH_CALLBACK_URL,
  selectWebOauthFlow,
} from '../oauth-flow.ts';

test('Electron renderers use the system-browser redirect flow', () => {
  assert.equal(selectWebOauthFlow({ usesElectronNativeAuth: true }), 'redirect');
  assert.equal(DESKTOP_AUTH_CALLBACK_URL, 'glidelingo://app/');
});

test('ordinary web renderers without the Electron bridge use the popup flow', () => {
  assert.equal(selectWebOauthFlow({ usesElectronNativeAuth: false }), 'popup');
});

test('Clerk uses a coarse opaque-origin prefilter while Electron owns exact callback routing', () => {
  const callback = new URL(DESKTOP_AUTH_CALLBACK_URL);
  const unrelatedOpaqueUrl = new URL('untrusted-scheme://attacker/path');

  assert.equal(callback.origin, 'null');
  assert.deepEqual(ALLOWED_AUTH_REDIRECT_PROTOCOLS, ['glidelingo:']);
  assert.equal(
    CLERK_ALLOWED_OPAQUE_REDIRECT_ORIGINS.some((origin) => origin.test(callback.origin)),
    true,
  );
  assert.equal(
    CLERK_ALLOWED_OPAQUE_REDIRECT_ORIGINS.some((origin) =>
      origin.test(unrelatedOpaqueUrl.origin),
    ),
    true,
  );
  assert.equal(
    CLERK_ALLOWED_OPAQUE_REDIRECT_ORIGINS.some((origin) =>
      origin.test('https://attacker.example'),
    ),
    false,
  );
});
