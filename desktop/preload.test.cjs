const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPreload() {
  const source = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  const calls = [];
  const listeners = new Map();
  const removed = [];
  const context = {
    require: (moduleName) => {
      assert.equal(moduleName, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld: (name, bridge) => calls.push({ name, bridge }),
        },
        ipcRenderer: {
          invoke: (...args) => args,
          on: (channel, listener) => listeners.set(channel, listener),
          removeListener: (channel, listener) => removed.push([channel, listener]),
        },
      };
    },
  };
  vm.runInNewContext(source, context);
  return { calls, listeners, removed };
}

test('preload exposes Clerk token and OAuth IPC channels in Electron sandbox', async () => {
  const { calls } = loadPreload();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, '__clerk_internal_electron');

  const { tokenCache, oauthTransport } = calls[0].bridge;
  assert.deepEqual(await tokenCache.getToken('__clerk_client_jwt'), [
    'clerk:token-cache:get',
    '__clerk_client_jwt',
  ]);
  assert.deepEqual(await tokenCache.saveToken('__clerk_client_jwt', 'token'), [
    'clerk:token-cache:save',
    '__clerk_client_jwt',
    'token',
  ]);
  assert.deepEqual(await tokenCache.clearToken('__clerk_client_jwt'), [
    'clerk:token-cache:clear',
    '__clerk_client_jwt',
  ]);
  assert.deepEqual(await oauthTransport.getRedirectUrl(), [
    'clerk:oauth-transport:get-redirect-url',
  ]);
  assert.deepEqual(await oauthTransport.open('https://clerk.example.test'), [
    'clerk:oauth-transport:open',
    'https://clerk.example.test',
  ]);
});

test('preload exposes only narrow update operations and hides Electron event objects', async () => {
  const { calls, listeners, removed } = loadPreload();
  const exposed = calls.find((call) => call.name === '__glidelingoDesktopUpdates');
  assert.ok(exposed);
  assert.deepEqual(Object.keys(exposed.bridge).sort(), [
    'getSnapshot',
    'openOfficialDownloadPage',
    'restartAndInstall',
    'retry',
    'subscribe',
  ]);
  assert.deepEqual(await exposed.bridge.getSnapshot(), ['desktop-update:get-snapshot']);
  assert.deepEqual(await exposed.bridge.retry(), ['desktop-update:retry']);
  assert.deepEqual(await exposed.bridge.restartAndInstall(), ['desktop-update:restart-and-install']);
  assert.deepEqual(await exposed.bridge.openOfficialDownloadPage(), [
    'desktop-update:open-official-download-page',
  ]);

  const received = [];
  const unsubscribe = exposed.bridge.subscribe((snapshot) => received.push(snapshot));
  const nativeEvent = { sender: 'must not escape preload' };
  const snapshot = { phase: 'downloading', required: false, percent: 42 };
  listeners.get('desktop-update:snapshot')(nativeEvent, snapshot);
  assert.deepEqual(received, [snapshot]);
  assert.notEqual(received[0], nativeEvent);
  unsubscribe();
  assert.equal(removed.length, 1);
  assert.equal(removed[0][0], 'desktop-update:snapshot');
  assert.equal(removed[0][1], listeners.get('desktop-update:snapshot'));
});
