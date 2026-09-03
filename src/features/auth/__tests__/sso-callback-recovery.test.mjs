import assert from 'node:assert/strict';
import test from 'node:test';

import {
  rotatingTokenNonceFromSsoCallback,
  wasSsoCallbackCancelled,
} from '../sso-callback-recovery.ts';

test('SSO callback recovery recognizes provider cancellation in query or hash parameters', () => {
  assert.equal(
    wasSsoCallbackCancelled('http://localhost:8081/sso-callback?error=access_denied'),
    true,
  );
  assert.equal(
    wasSsoCallbackCancelled(
      'http://localhost:8081/#/sso-callback?error_description=The%20user%20cancelled',
    ),
    true,
  );
  assert.equal(
    wasSsoCallbackCancelled('glidelingo://app/sso-callback?error=user_cancelled'),
    true,
  );
  assert.equal(
    wasSsoCallbackCancelled(
      'glidelingo://app/sso-callback#/complete?error_description=Provider%20cancelled',
    ),
    true,
  );
});

test('SSO callback recovery does not misclassify ordinary errors or malformed URLs', () => {
  assert.equal(
    wasSsoCallbackCancelled('glidelingo://app/sso-callback?error=server_error'),
    false,
  );
  assert.equal(wasSsoCallbackCancelled('not a URL'), false);
});

test('SSO callback recovery extracts only a bounded rotating token nonce', () => {
  assert.equal(
    rotatingTokenNonceFromSsoCallback(
      'https://desktop.glidelingo.com/sso-callback?rotating_token_nonce=nonce-123',
    ),
    'nonce-123',
  );
  assert.equal(rotatingTokenNonceFromSsoCallback('not a URL'), null);
  assert.equal(
    rotatingTokenNonceFromSsoCallback(
      `https://desktop.glidelingo.com/sso-callback?rotating_token_nonce=${'x'.repeat(2049)}`,
    ),
    null,
  );
});
