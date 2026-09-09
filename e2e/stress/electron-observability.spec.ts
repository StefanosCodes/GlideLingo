import { expect, test } from '@playwright/test';

import { closeGlideLingoElectron, launchGlideLingoElectron, type ElectronRuntime } from '../support/electron-runtime';
import { RuntimeObserver } from '../support/observability';

test('captures controlled Electron main and renderer failures and then tears down', async ({}, testInfo) => {
  const observer = new RuntimeObserver();
  let runtime: ElectronRuntime | undefined;

  try {
    runtime = await launchGlideLingoElectron();
    observer.observeElectron(runtime.app);
    const page = await runtime.app.firstWindow({ timeout: 30_000 });
    observer.observePage(page, 'electron-renderer');

    await runtime.app.evaluate(() => {
      console.error('E2E_CONTROLLED_MAIN_FAILURE');
    });
    await expect.poll(() => observer.contains('E2E_CONTROLLED_MAIN_FAILURE')).toBe(true);

    await page.evaluate(() => {
      queueMicrotask(() => {
        throw new Error('E2E_CONTROLLED_ELECTRON_RENDERER_FAILURE');
      });
    });
    await expect.poll(() => observer.contains('E2E_CONTROLLED_ELECTRON_RENDERER_FAILURE')).toBe(true);
  } finally {
    await closeGlideLingoElectron(runtime);
    await observer.attach(testInfo);
  }
});
