import assert from 'node:assert/strict';
import test from 'node:test';

import {
  codeValidationMessage,
  confirmationValidationMessage,
  emailValidationMessage,
  normalizeAuthEmail,
  passwordValidationMessage,
  safeAuthErrorMessage,
  safeAuthIssue,
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

test('credential auth explains current Clerk password and captcha failures', () => {
  const cases = [
    ['captcha_missing_token', 'Complete the security check, then try again.'],
    ['captcha_unavailable', 'The security check could not load. Refresh the page or try another browser.'],
    ['form_password_matches_identifier', 'Your password cannot match your email address. Choose a different password.'],
    ['form_password_no_number', 'Add at least one number.'],
    ['form_password_size_in_bytes_exceeded', 'That password is too long. Choose a shorter one.'],
  ];

  for (const [code, expected] of cases) {
    assert.equal(
      safeAuthErrorMessage(
        { code: 'api_response_error', errors: [{ code, message: 'sensitive upstream detail' }] },
        'Safe fallback',
      ),
      expected,
    );
  }
});

test('credential auth uses non-blaming fallbacks for unknown and connectivity failures', () => {
  assert.equal(
    safeAuthErrorMessage({ code: 'network_error', message: 'sensitive upstream detail' }, 'Safe fallback'),
    'We could not connect. Check your internet connection and try again.',
  );
  assert.equal(
    safeAuthErrorMessage({ code: 'unexpected_new_code', message: 'sensitive upstream detail' }, 'Please try again.'),
    'Please try again.',
  );
});

test('credential auth targets actionable errors to the field that can resolve them', () => {
  assert.deepEqual(
    safeAuthIssue(
      { code: 'api_response_error', errors: [{ code: 'form_identifier_exists' }] },
      'Could not create account.',
    ),
    { field: 'email', message: 'An account already exists for that email. Sign in instead.' },
  );
  assert.deepEqual(
    safeAuthIssue(
      { code: 'api_response_error', errors: [{ code: 'form_password_pwned' }] },
      'Could not create account.',
    ),
    { field: 'password', message: 'That password has appeared in a data breach. Choose another one.' },
  );
  assert.deepEqual(
    safeAuthIssue(
      { code: 'api_response_error', errors: [{ code: 'new_password_rule', meta: { paramName: 'password' } }] },
      'Could not create account.',
    ),
    { field: 'password', message: 'Check your password and try again.' },
  );
  assert.deepEqual(
    safeAuthIssue(
      { code: 'api_response_error', errors: [{ code: 'form_param_format_invalid', meta: { paramName: 'email_address' } }] },
      'Could not create account.',
    ),
    { field: 'email', message: 'Check the highlighted information and try again.' },
  );
  assert.deepEqual(
    safeAuthIssue({ code: 'new_global_error' }, 'We could not create your account right now. Please try again.'),
    { field: null, message: 'We could not create your account right now. Please try again.' },
  );
});
