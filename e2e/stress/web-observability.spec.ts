import { expect, test } from '@playwright/test';

import { RuntimeObserver } from '../support/observability';

test('captures controlled renderer and request failures without fixed sleeps', async ({ page }, testInfo) => {
  const observer = new RuntimeObserver();
  observer.observePage(page, 'stress-web');

  try {
    await page.goto('/');
    await page.evaluate(() => {
      queueMicrotask(() => {
        throw new Error('E2E_CONTROLLED_RENDERER_FAILURE');
      });
    });
    await expect.poll(() => observer.contains('E2E_CONTROLLED_RENDERER_FAILURE')).toBe(true);

    await page.evaluate(async () => {
      try {
        await fetch('http://127.0.0.1:1/e2e-controlled-request-failure');
      } catch {
        // The RuntimeObserver must capture the browser-level request failure.
      }
    });
    await expect.poll(() => observer.contains('e2e-controlled-request-failure')).toBe(true);
  } finally {
    await observer.attach(testInfo);
  }
});
