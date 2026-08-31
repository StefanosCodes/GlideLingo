import assert from 'node:assert/strict';
import test from 'node:test';

import { selectWebOauthFlow } from '../oauth-flow.ts';
import { SIGN_IN_METHODS_COPY } from '../sign-in-copy.ts';

test('packaged Electron uses the system-browser redirect flow', () => {
  assert.equal(
    selectWebOauthFlow({ protocol: 'glidelingo:', userAgent: 'GlideLingo Electron/44.0.0' }),
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

test('desktop sign-in copy names every configured MVP method', () => {
  for (const method of ['Google', 'Apple', 'email', 'phone']) {
    assert.match(SIGN_IN_METHODS_COPY, new RegExp(`\\b${method}\\b`));
  }
});
