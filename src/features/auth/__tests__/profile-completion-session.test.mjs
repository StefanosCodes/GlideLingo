import assert from 'node:assert/strict';
import test from 'node:test';

import { signOutFromProfileCompletion } from '../profile-completion-session.ts';

test('the incomplete-profile recovery path signs out for account switching', async () => {
  let signedOut = false;

  const error = await signOutFromProfileCompletion(async () => {
    signedOut = true;
  });

  assert.equal(signedOut, true);
  assert.equal(error, null);
});

test('the incomplete-profile recovery path surfaces a failed sign-out', async () => {
  const error = await signOutFromProfileCompletion(async () => {
    throw new Error('network unavailable');
  });

  assert.equal(error, 'We could not sign you out. Please try again.');
});
