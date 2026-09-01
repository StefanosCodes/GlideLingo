const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  hasValidMacSignature,
  installMacUpdater,
  resolveMacAppBundle,
  shouldStartMacUpdater,
  startMacUpdater,
} = require('./updater.cjs');

function createUpdater() {
  const updater = new EventEmitter();
  updater.checks = 0;
  updater.downloads = 0;
  updater.installs = 0;
  updater.checkForUpdates = async () => { updater.checks += 1; };
  updater.downloadUpdate = async () => { updater.downloads += 1; };
  updater.quitAndInstall = (silent, forceRunAfter) => {
    updater.installs += 1;
    updater.installArguments = [silent, forceRunAfter];
  };
  return updater;
}

function flushEvents() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('update checks are restricted to packaged, signed macOS app bundles', () => {
  const executablePath = '/Applications/GlideLingo.app/Contents/MacOS/GlideLingo';
  const eligible = {
    isPackaged: true,
    platform: 'darwin',
    developmentUrl: null,
    executablePath,
    verifySignature: () => true,
  };

  assert.equal(shouldStartMacUpdater(eligible), true);
  assert.equal(shouldStartMacUpdater({ ...eligible, isPackaged: false }), false);
  assert.equal(shouldStartMacUpdater({ ...eligible, platform: 'win32' }), false);
  assert.equal(
    shouldStartMacUpdater({ ...eligible, developmentUrl: 'http://127.0.0.1:8081/' }),
    false,
  );
  assert.equal(shouldStartMacUpdater({ ...eligible, verifySignature: () => false }), false);
  assert.equal(resolveMacAppBundle(executablePath), '/Applications/GlideLingo.app');
  assert.equal(resolveMacAppBundle('/tmp/GlideLingo'), null);
});

test('macOS signature verification uses the fixed codesign binary and exact app bundle', () => {
  const calls = [];
  const valid = hasValidMacSignature(
    '/Applications/GlideLingo.app/Contents/MacOS/GlideLingo',
    (command, args, options) => {
      calls.push([command, args, options]);
      if (args[0] === '--display') {
        return {
          status: 0,
          stderr: 'Authority=Developer ID Application: Stefanos Sophocleous (TEAM123456)\nTeamIdentifier=TEAM123456\n',
        };
      }
      return { status: 0 };
    },
  );

  assert.equal(valid, true);
  assert.deepEqual(calls, [
    [
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', '/Applications/GlideLingo.app'],
      { stdio: 'ignore' },
    ],
    [
      '/usr/bin/codesign',
      ['--display', '--verbose=4', '/Applications/GlideLingo.app'],
      { encoding: 'utf8' },
    ],
  ]);
  assert.equal(
    hasValidMacSignature(
      '/Applications/GlideLingo.app/Contents/MacOS/GlideLingo',
      (_command, args) =>
        args[0] === '--display'
          ? { status: 0, stderr: 'Signature=adhoc\nTeamIdentifier=not set\n' }
          : { status: 0 },
    ),
    false,
  );
});

test('the updater never loads or checks in development, unsigned packages, or non-macOS builds', () => {
  let loads = 0;
  const common = {
    app: { isPackaged: true },
    dialog: {},
    parentWindow: null,
    executablePath: '/Applications/GlideLingo.app/Contents/MacOS/GlideLingo',
    loadUpdater: () => { loads += 1; return createUpdater(); },
    logger: { error() {} },
  };

  assert.equal(startMacUpdater({ ...common, platform: 'linux', verifySignature: () => true }), false);
  assert.equal(startMacUpdater({ ...common, platform: 'darwin', verifySignature: () => false }), false);
  assert.equal(
    startMacUpdater({
      ...common,
      platform: 'darwin',
      verifySignature: () => { throw new Error('codesign unavailable'); },
    }),
    false,
  );
  assert.equal(
    startMacUpdater({
      ...common,
      platform: 'darwin',
      developmentUrl: 'http://127.0.0.1:8081/',
      verifySignature: () => true,
    }),
    false,
  );
  assert.equal(loads, 0);
});

test('available updates require explicit download and install confirmation', async () => {
  const updater = createUpdater();
  const responses = [1, 0, 1, 0];
  const prompts = [];
  const dialog = {
    async showMessageBox(...args) {
      const options = args.at(-1);
      prompts.push(options);
      return { response: responses.shift() };
    },
  };

  installMacUpdater({
    updater,
    dialog,
    parentWindow: { isDestroyed: () => false },
    logger: { error() {} },
  });
  await flushEvents();

  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.logger, null);
  assert.equal(updater.checks, 1);

  updater.emit('update-available');
  await flushEvents();
  assert.equal(updater.downloads, 0);

  updater.emit('update-available');
  await flushEvents();
  assert.equal(updater.downloads, 1);

  updater.emit('update-downloaded');
  await flushEvents();
  assert.equal(updater.installs, 0);

  updater.emit('update-downloaded');
  await flushEvents();
  assert.equal(updater.installs, 1);
  assert.deepEqual(updater.installArguments, [false, true]);
  assert.deepEqual(prompts.map((prompt) => prompt.cancelId), [1, 1, 1, 1]);
});

test('updater failures are contained and logged without remote error details', async () => {
  const updater = createUpdater();
  updater.checkForUpdates = async () => { throw new Error('https://token@example.test/secret'); };
  const messages = [];

  installMacUpdater({
    updater,
    dialog: {},
    parentWindow: null,
    logger: { error(message) { messages.push(message); } },
  });
  await flushEvents();
  updater.emit('error', new Error('private updater response'));

  assert.equal(messages.length, 2);
  assert.ok(messages.every((message) => !/token|secret|private updater response/.test(message)));
});

test('user-confirmed download and install failures show a safe recovery message', async () => {
  const updater = createUpdater();
  updater.downloadUpdate = async () => { throw new Error('private download details'); };
  updater.quitAndInstall = () => { throw new Error('private install details'); };
  const prompts = [];
  const messages = [];
  const dialog = {
    async showMessageBox(...args) {
      const options = args.at(-1);
      prompts.push(options);
      return { response: 0 };
    },
  };

  installMacUpdater({
    updater,
    dialog,
    parentWindow: { isDestroyed: () => false },
    logger: { error(message) { messages.push(message); } },
  });
  await flushEvents();

  updater.emit('update-available');
  await flushEvents();
  await flushEvents();
  updater.emit('update-downloaded');
  await flushEvents();
  await flushEvents();

  const failurePrompts = prompts.filter(
    (prompt) => prompt.title === 'GlideLingo update unavailable',
  );
  assert.equal(failurePrompts.length, 2);
  assert.ok(failurePrompts.every((prompt) => /current version is unchanged/i.test(prompt.detail)));
  assert.ok(messages.every((message) => !/private|details/.test(message)));
});
