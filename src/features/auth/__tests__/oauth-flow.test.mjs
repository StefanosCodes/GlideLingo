import assert from 'node:assert/strict';
import test from 'node:test';

import { selectWebOauthFlow } from '../oauth-flow.ts';

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
