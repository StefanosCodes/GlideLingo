const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPreload() {
  const source = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  const calls = [];
  const context = {
    require: (moduleName) => {
      assert.equal(moduleName, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld: (name, bridge) => calls.push({ name, bridge }),
        },
        ipcRenderer: {
          invoke: (...args) => args,
        },
      };
    },
  };
  vm.runInNewContext(source, context);
  return calls;
}

test('preload exposes Clerk token and OAuth IPC channels in Electron sandbox', async () => {
  const calls = loadPreload();
  assert.equal(calls.length, 1);
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
