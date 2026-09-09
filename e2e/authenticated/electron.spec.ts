import { expect, test } from '@playwright/test';

import {
  completeFirstLesson,
  expectCompletedCourseHome,
  prepareClerkPage,
  registerAndReachHome,
  signOutAndSignBackIn,
  signOutForCleanup,
} from '../support/authenticated-journey';
import { createClerkTestAccount, deleteClerkTestAccount } from '../support/clerk-test-account';
import {
  closeGlideLingoElectron,
  launchGlideLingoElectron,
  type ElectronRuntime,
} from '../support/electron-runtime';
import { RuntimeObserver } from '../support/observability';

test('a learner can register, onboard, finish a lesson, and relaunch the secure Electron app', async ({}, testInfo) => {
  const account = createClerkTestAccount();
  const observer = new RuntimeObserver();
  let runtime: ElectronRuntime | undefined;

  try {
    runtime = await launchGlideLingoElectron({ rendererUrl: 'http://localhost:8081' });
    observer.observeElectron(runtime.app);
    let page = await runtime.app.firstWindow({ timeout: 30_000 });
    observer.observePage(page, 'authenticated-electron-renderer');
    await prepareClerkPage(page);
    await page.reload();

    const launchSecurity = await runtime.app.evaluate(({ app }) => ({
      bypassedSandbox: app.commandLine.hasSwitch('no-sandbox'),
      enabledSandbox: app.commandLine.hasSwitch('enable-sandbox'),
    }));
    const rendererSecurity = await page.evaluate(() => ({
      nodeRequire: typeof (globalThis as typeof globalThis & { require?: unknown }).require,
      nodeVersion: (globalThis as typeof globalThis & {
        process?: { versions?: { node?: string } };
      }).process?.versions?.node,
    }));
    expect(launchSecurity).toEqual({ bypassedSandbox: false, enabledSandbox: true });
    expect(rendererSecurity).toEqual({ nodeRequire: 'undefined', nodeVersion: undefined });

    await registerAndReachHome(page, account);
    await completeFirstLesson(page);
    await signOutAndSignBackIn(page, account);

    const profileDirectory = runtime.profileDirectory;
    await closeGlideLingoElectron(runtime, { preserveProfile: true });
    runtime = undefined;
    runtime = await launchGlideLingoElectron({
      profileDirectory,
      rendererUrl: 'http://localhost:8081',
    });
    observer.observeElectron(runtime.app);
    page = await runtime.app.firstWindow({ timeout: 30_000 });
    observer.observePage(page, 'authenticated-electron-relaunch');
    await prepareClerkPage(page);
    await page.reload();

    await expectCompletedCourseHome(page);
    await signOutForCleanup(page);
  } finally {
    await closeGlideLingoElectron(runtime);
    await deleteClerkTestAccount(account.email);
    await observer.attach(testInfo);
  }

  expect(observer.errors(), observer.format(observer.errors())).toEqual([]);
});
