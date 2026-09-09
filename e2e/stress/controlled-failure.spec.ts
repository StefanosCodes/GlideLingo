import { expect, test } from '@playwright/test';

import { RuntimeObserver } from '../support/observability';

test('produces the expected failure artifacts for a broken visible outcome', async ({ page }, testInfo) => {
  test.skip(process.env.E2E_CONTROLLED_FAILURE !== '1', 'Run explicitly to verify red-path evidence.');
  const observer = new RuntimeObserver();
  observer.observePage(page, 'controlled-failure');

  try {
    await page.goto('/');
    await expect(page.getByText('E2E intentionally absent outcome')).toBeVisible({ timeout: 1_000 });
  } finally {
    await observer.attach(testInfo);
  }
});
