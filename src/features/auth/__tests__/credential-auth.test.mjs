import assert from 'node:assert/strict';
import test from 'node:test';

import {
  codeValidationMessage,
  confirmationValidationMessage,
  emailValidationMessage,
  normalizeAuthEmail,
  passwordValidationMessage,
  safeAuthErrorMessage,
  unsupportedAuthStateMessage,
} from '../credential-auth.ts';

test('credential auth normalizes email without weakening validation', () => {
  assert.equal(normalizeAuthEmail('  Learner@Example.COM  '), 'learner@example.com');
  assert.equal(emailValidationMessage(''), 'Enter your email address.');
  assert.equal(emailValidationMessage('not-an-email'), 'Enter a valid email address.');
  assert.equal(emailValidationMessage('learner@example.com'), null);
});

test('credential auth validates password, confirmation, and codes', () => {
  assert.equal(passwordValidationMessage(''), 'Enter your password.');
  assert.equal(passwordValidationMessage('short'), 'Use a password with at least 8 characters.');
  assert.equal(passwordValidationMessage('long-enough'), null);
  assert.equal(confirmationValidationMessage('long-enough', ''), 'Confirm your password.');
  assert.equal(confirmationValidationMessage('long-enough', 'different'), 'The passwords do not match.');
  assert.equal(confirmationValidationMessage('long-enough', 'long-enough'), null);
  assert.equal(codeValidationMessage('  '), 'Enter the verification code.');
  assert.equal(codeValidationMessage('424242'), null);
});

test('credential auth maps stable error codes and never leaks raw SDK messages', () => {
  assert.equal(
    safeAuthErrorMessage({ code: 'form_password_incorrect', message: 'sensitive upstream detail' }, 'Fallback'),
    'That email or password is incorrect.',
  );
  assert.equal(
    safeAuthErrorMessage(
      {
        code: 'api_response_error',
        errors: [{ code: 'form_identifier_exists', message: 'sensitive upstream detail' }],
      },
      'Fallback',
    ),
    'An account already exists for that email. Sign in instead.',
  );
  assert.equal(
    safeAuthErrorMessage({ code: 'unknown_error', message: 'sensitive upstream detail' }, 'Safe fallback'),
    'Safe fallback',
  );
  assert.equal(safeAuthErrorMessage(new Error('sensitive exception'), 'Safe fallback'), 'Safe fallback');
  assert.doesNotMatch(unsupportedAuthStateMessage(), /Clerk|token|user id/i);
});
