import { expect, test } from '@jest/globals';

import { referralPresentation } from '@/features/affiliates/referral-presentation';

test.each(['invalid', 'expired', 'no-attribution', 'unavailable'] as const)(
  'terminal %s state preserves an ordinary path without exposing token details',
  (state) => {
    const presentation = referralPresentation(state);
    expect(presentation.alert).toBe(true);
    expect(presentation.continueLabel).toBe('Continue normally');
    expect(`${presentation.title} ${presentation.body}`).not.toMatch(/[A-Za-z0-9_-]{43}/);
  },
);

test('successful binding defers offer facts to server and provider truth', () => {
  const presentation = referralPresentation('bound');
  expect(presentation.body).toContain('server and checkout provider');
  expect(presentation.body).not.toMatch(/\d+%|\$\d/);
});
