import { expect, test } from '@playwright/test';

import { exerciseCredentialRecoveryJourney } from './support/credential-journey';
import { RuntimeObserver } from './support/observability';

test('a signed-out user can recover from invalid input and navigate the credential flow', async ({ page }, testInfo) => {
  const observer = new RuntimeObserver();
  observer.observePage(page, 'expo-web');

  try {
    await page.goto('/');
    await exerciseCredentialRecoveryJourney(page);
  } finally {
    await observer.attach(testInfo);
  }

  expect(observer.errors(), observer.format(observer.errors())).toEqual([]);
});
