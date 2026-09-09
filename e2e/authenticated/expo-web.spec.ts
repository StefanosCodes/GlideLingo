import { expect, test } from '@playwright/test';

import {
  completeFirstLesson,
  expectCompletedCourseHome,
  prepareClerkPage,
  registerAndReachHome,
  signOutAndSignBackIn,
  signOutForCleanup,
  verifySignUpErrorGuidance,
} from '../support/authenticated-journey';
import { createClerkTestAccount, deleteClerkTestAccount } from '../support/clerk-test-account';
import { RuntimeObserver } from '../support/observability';

test('a learner can register, onboard, finish a lesson, and return to the same web account', async ({ page }, testInfo) => {
  const account = createClerkTestAccount();
  const observer = new RuntimeObserver();
  observer.observePage(page, 'authenticated-web');

  try {
    await prepareClerkPage(page);
    await registerAndReachHome(page, account);
    await completeFirstLesson(page);
    await signOutAndSignBackIn(page, account);
    await page.reload();
    await expectCompletedCourseHome(page);
    await signOutForCleanup(page);
    expect(observer.errors(), observer.format(observer.errors())).toEqual([]);
    await verifySignUpErrorGuidance(page, account);
  } finally {
    await deleteClerkTestAccount(account.email);
    await observer.attach(testInfo);
  }

  expect(observer.errors(), observer.format(observer.errors())).toEqual([
    expect.objectContaining({
      source: 'authenticated-web:console',
      message: 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)',
    }),
  ]);
});
