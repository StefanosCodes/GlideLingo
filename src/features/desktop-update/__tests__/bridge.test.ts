import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { getDesktopUpdateBridge, parseDesktopUpdateSnapshot } from '../bridge.web';

function replaceWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
}

describe('desktop update bridge boundary', () => {
  const originalWindow = globalThis.window;

  afterEach(() => replaceWindow(originalWindow));

  it('is absent from ordinary web, loopback Electron, and lookalike origins', () => {
    const bridge = {};
    for (const origin of [
      'https://glidelingo.com',
      'http://localhost:8081',
      'https://desktop.glidelingo.com.attacker.test',
    ]) {
      replaceWindow({ location: { origin }, __glidelingoDesktopUpdates: bridge });
      expect(getDesktopUpdateBridge()).toBeNull();
    }
  });

  it('accepts the narrow bridge only at the exact packaged renderer origin', () => {
    const bridge = {
      getSnapshot: jest.fn(),
      subscribe: jest.fn(),
      retry: jest.fn(),
      restartAndInstall: jest.fn(),
      openOfficialDownloadPage: jest.fn(),
    };
    replaceWindow({
      location: { origin: 'https://desktop.glidelingo.com' },
      __glidelingoDesktopUpdates: bridge,
    });

    expect(getDesktopUpdateBridge()).toBe(bridge);
  });

  it('rejects an incomplete bridge even at the packaged origin', () => {
    replaceWindow({
      location: { origin: 'https://desktop.glidelingo.com' },
      __glidelingoDesktopUpdates: { getSnapshot: jest.fn() },
    });

    expect(getDesktopUpdateBridge()).toBeNull();
  });

  it('reconstructs only the sanitized snapshot fields', () => {
    expect(parseDesktopUpdateSnapshot({
      phase: 'downloading',
      required: false,
      currentVersion: '1.0.0',
      targetVersion: '1.1.0',
      percent: 170,
      rawError: 'https://token@example.test/private',
      downloadedFile: '/private/app.zip',
    })).toEqual({
      phase: 'downloading',
      required: false,
      currentVersion: '1.0.0',
      targetVersion: '1.1.0',
      percent: 100,
    });
    expect(parseDesktopUpdateSnapshot({
      phase: 'ready',
      required: false,
      currentVersion: 'v1',
      targetVersion: '1.1.0',
      percent: 100,
    })).toBeNull();
  });
});
