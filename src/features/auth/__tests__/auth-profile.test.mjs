import assert from 'node:assert/strict';
import test from 'node:test';

import { accountIdentity, hasFirstName, normalizedFirstName } from '../auth-profile.ts';

test('first-name completion rejects whitespace and stores a trimmed value', () => {
  assert.equal(hasFirstName('   '), false);
  assert.equal(hasFirstName('Stefanos'), true);
  assert.equal(normalizedFirstName('  Stefanos  '), 'Stefanos');
});

test('account identity prefers the verified primary email and first name', () => {
  assert.deepEqual(
    accountIdentity({
      firstName: 'Stefanos',
      primaryEmailAddress: { emailAddress: 'learner@example.test', verification: { status: 'verified' } },
      primaryPhoneNumber: null,
    }),
    {
      contact: 'learner@example.test',
      displayName: 'Stefanos',
      verificationLabel: 'VERIFIED',
      verified: true,
    },
  );
});

test('account identity supports a phone-only account', () => {
  const identity = accountIdentity({
    firstName: null,
    fullName: null,
    primaryEmailAddress: null,
    primaryPhoneNumber: { phoneNumber: '+15555550100', verification: { status: 'verified' } },
  });

  assert.equal(identity.contact, '+15555550100');
  assert.equal(identity.displayName, 'GlideLingo learner');
  assert.equal(identity.verified, true);
});
