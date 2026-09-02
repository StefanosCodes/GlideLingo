const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPreload(invoke) {
  let exposed;
  const source = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  vm.runInNewContext(source, {
    Object,
    require: (moduleName) => {
      assert.equal(moduleName, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld: (name, value) => {
            exposed = { name, value };
          },
        },
        ipcRenderer: { invoke },
      };
    },
  });
  return exposed;
}

test('preload exposes one frozen, narrow OAuth bridge', async () => {
  const calls = [];
  const exposed = loadPreload(async (...args) => {
    calls.push(args);
    return { callbackUrl: 'glidelingo://app/sso-callback?rotating_token_nonce=nonce' };
  });

  assert.equal(exposed.name, 'glideLingoDesktopAuth');
  assert.deepEqual(Object.keys(exposed.value), ['open']);
  assert.equal(Object.isFrozen(exposed.value), true);
  const result = await exposed.value.open('https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(
    result.callbackUrl,
    'glidelingo://app/sso-callback?rotating_token_nonce=nonce',
  );
  assert.deepEqual(calls, [[
    'glidelingo:oauth:open',
    'https://accounts.google.com/o/oauth2/v2/auth',
  ]]);
});

test('preload rejects malformed request and response payloads', async () => {
  const invalidResponse = loadPreload(async () => ({ callbackUrl: 42 }));
  await assert.rejects(invalidResponse.value.open('https://accounts.google.com'), /callback was invalid/);
  await assert.rejects(invalidResponse.value.open(42), /URL was invalid/);
});
