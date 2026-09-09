import { expect, test } from '@playwright/test';

import { exerciseCredentialRecoveryJourney } from './support/credential-journey';
import { closeGlideLingoElectron, launchGlideLingoElectron, type ElectronRuntime } from './support/electron-runtime';
import { RuntimeObserver } from './support/observability';

test('a signed-out user completes the credential recovery journey in the secure Electron window', async ({}, testInfo) => {
  const observer = new RuntimeObserver();
  let runtime: ElectronRuntime | undefined;

  try {
    runtime = await launchGlideLingoElectron();
    observer.observeElectron(runtime.app);
    const page = await runtime.app.firstWindow({ timeout: 30_000 });
    observer.observePage(page, 'electron-renderer');

    const launchSecurity = await runtime.app.evaluate(({ app }) => {
      return {
        bypassedSandbox: app.commandLine.hasSwitch('no-sandbox'),
        enabledSandbox: app.commandLine.hasSwitch('enable-sandbox'),
      };
    });
    const rendererSecurity = await page.evaluate(() => ({
      nodeProcess: typeof (globalThis as typeof globalThis & { process?: unknown }).process,
      nodeRequire: typeof (globalThis as typeof globalThis & { require?: unknown }).require,
    }));

    expect(launchSecurity).toEqual({
      bypassedSandbox: false,
      enabledSandbox: true,
    });
    expect(rendererSecurity).toEqual({
      nodeProcess: 'undefined',
      nodeRequire: 'undefined',
    });

    await expect(page).toHaveURL('https://desktop.glidelingo.com/');
    const documentResponse = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(documentResponse?.status()).toBe(200);
    await expect.poll(async () => documentResponse?.headerValue('content-security-policy')).toContain(
      "default-src 'self'",
    );

    await exerciseCredentialRecoveryJourney(page);
  } finally {
    await closeGlideLingoElectron(runtime);
    await observer.attach(testInfo);
  }

  expect(observer.errors(), observer.format(observer.errors())).toEqual([]);
});
