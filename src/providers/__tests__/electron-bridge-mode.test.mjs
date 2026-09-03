import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasElectronClerkBridge,
  shouldUseElectronClerkNativeAuth,
} from '../electron-bridge.web.ts';

function withWindow(windowValue, run) {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowValue,
  });

  try {
    run();
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  }
}

test('Electron Clerk native auth is disabled for the local Expo loopback renderer', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', '::1']) {
    withWindow(
      {
        __clerk_internal_electron: {},
        location: { hostname, protocol: 'http:' },
      },
      () => {
        assert.equal(hasElectronClerkBridge(), true);
        assert.equal(shouldUseElectronClerkNativeAuth(), false);
      },
    );
  }
});

test('Electron Clerk native auth remains enabled for packaged desktop renderers', () => {
  withWindow(
    {
      __clerk_internal_electron: {},
      location: { hostname: 'desktop.glidelingo.com', protocol: 'https:' },
    },
    () => {
      assert.equal(hasElectronClerkBridge(), true);
      assert.equal(shouldUseElectronClerkNativeAuth(), true);
    },
  );
});

test('ordinary web renderers never use Electron Clerk native auth', () => {
  withWindow(
    {
      location: { hostname: 'localhost', protocol: 'http:' },
    },
    () => {
      assert.equal(hasElectronClerkBridge(), false);
      assert.equal(shouldUseElectronClerkNativeAuth(), false);
    },
  );
});
