const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  OFFICIAL_DOWNLOAD_PAGE_URL,
  POLICY_TIMEOUT_MS,
  UPDATE_CHANNELS,
  compareNumericSemVer,
  configureUpdaterPrivacy,
  createMacUpdateCoordinator,
  fetchMinimumSupportedVersion,
  isAllowedUpdateSender,
  parseNumericSemVer,
  registerDesktopUpdateIpc,
  removeLegacyUpdaterId,
  shouldQuitForRequiredUpdate,
  shouldStartMacUpdater,
  SHARED_STAGING_USER_ID,
  startMacUpdater,
  SUPPORTED_ELECTRON_UPDATER_VERSION,
} = require('./updater.cjs');

function createUpdater() {
  const updater = new EventEmitter();
  updater.checks = 0;
  updater.installs = 0;
  updater.checkForUpdates = async () => { updater.checks += 1; };
  updater.quitAndInstall = (silent, forceRunAfter) => {
    updater.installs += 1;
    updater.installArguments = [silent, forceRunAfter];
  };
  return updater;
}

function flushEvents() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('numeric SemVer parsing and comparison reject every non-numeric form', () => {
  assert.deepEqual(parseNumericSemVer('1.20.3'), [1n, 20n, 3n]);
  assert.equal(compareNumericSemVer('1.9.9', '1.10.0'), -1);
  assert.equal(compareNumericSemVer('2.0.0', '1.999.999'), 1);
  assert.equal(compareNumericSemVer('1.0.0', '1.0.0'), 0);

  for (const value of ['', '1.2', 'v1.2.3', '01.2.3', '1.2.3-beta', '1.2.3+build', ' 1.2.3']) {
    assert.equal(parseNumericSemVer(value), null);
  }
});

test('updater eligibility is packaged macOS only and performs no runtime signature subprocess', () => {
  const eligible = { isPackaged: true, platform: 'darwin', developmentUrl: null };
  assert.equal(shouldStartMacUpdater(eligible), true);
  assert.equal(shouldStartMacUpdater({ ...eligible, isPackaged: false }), false);
  assert.equal(shouldStartMacUpdater({ ...eligible, platform: 'linux' }), false);
  assert.equal(shouldStartMacUpdater({ ...eligible, developmentUrl: 'http://localhost:8081' }), false);
});

test('updater privacy prevents per-install ID access and uses one non-identifying shared value', async () => {
  let defaultIdAccesses = 0;
  const createPrivacyTestUpdater = () => ({
    logger: console,
    stagingUserIdPromise: {
      get value() {
        defaultIdAccesses += 1;
        return Promise.resolve('unique-persistent-id');
      },
    },
  });
  const first = createPrivacyTestUpdater();
  const second = createPrivacyTestUpdater();

  configureUpdaterPrivacy(first, SUPPORTED_ELECTRON_UPDATER_VERSION);
  configureUpdaterPrivacy(second, SUPPORTED_ELECTRON_UPDATER_VERSION);

  assert.equal(defaultIdAccesses, 0);
  assert.equal(await first.stagingUserIdPromise.value, SHARED_STAGING_USER_ID);
  assert.equal(await second.stagingUserIdPromise.value, SHARED_STAGING_USER_ID);
  assert.equal(first.stagingUserIdPromise, first.stagingUserIdPromise);
  assert.notEqual(first.stagingUserIdPromise, second.stagingUserIdPromise);
  assert.equal(typeof first.logger.error, 'function');
  assert.throws(
    () => configureUpdaterPrivacy(createPrivacyTestUpdater(), '6.9.0'),
    /Unsupported electron-updater version/,
  );
});

test('legacy updater ID cleanup targets only the exact known file and contains failures', async () => {
  const removed = [];
  assert.equal(await removeLegacyUpdaterId({
    userDataPath: '/Users/example/Library/Application Support/GlideLingo',
    unlinkImpl: async (target) => { removed.push(target); },
  }), true);
  assert.deepEqual(removed, [
    '/Users/example/Library/Application Support/GlideLingo/.updaterId',
  ]);
  assert.equal(await removeLegacyUpdaterId({
    userDataPath: 'relative/path',
    unlinkImpl: async () => { throw new Error('must not run'); },
  }), false);
  assert.equal(await removeLegacyUpdaterId({
    userDataPath: '/Users/example/Library/Application Support/GlideLingo',
    unlinkImpl: async () => { throw new Error('missing or protected'); },
  }), false);
});

test('closing a required-update window requests a real app quit', () => {
  assert.equal(shouldQuitForRequiredUpdate({ getSnapshot: () => ({ required: true }) }), true);
  assert.equal(shouldQuitForRequiredUpdate({ getSnapshot: () => ({ required: false }) }), false);
  assert.equal(shouldQuitForRequiredUpdate(null), false);
});

test('policy fetch uses the strict public contract and a two-second timeout', async () => {
  let requestedUrl;
  let requestedOptions;
  let timeoutDelay;
  let cleared;
  const minimum = await fetchMinimumSupportedVersion({
    apiOrigin: 'https://api.example.test',
    currentVersion: '1.2.3',
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return { ok: true, json: async () => ({ minimum_supported_version: '1.1.0' }) };
    },
    setTimeoutImpl: (_callback, delay) => { timeoutDelay = delay; return 42; },
    clearTimeoutImpl: (timer) => { cleared = timer; },
  });

  assert.equal(minimum, '1.1.0');
  assert.equal(requestedUrl, 'https://api.example.test/v1/desktop/update-policy?current_version=1.2.3');
  assert.deepEqual(requestedOptions.headers, { Accept: 'application/json' });
  assert.equal(requestedOptions.method, 'GET');
  assert.equal(requestedOptions.redirect, 'error');
  assert.equal(timeoutDelay, POLICY_TIMEOUT_MS);
  assert.equal(cleared, 42);
});

test('policy outage, timeout, and malformed responses fail open', async () => {
  const outage = await fetchMinimumSupportedVersion({
    apiOrigin: 'https://api.example.test',
    currentVersion: '1.0.0',
    fetchImpl: async () => { throw new Error('token=private'); },
  });
  assert.equal(outage, null);

  const malformed = await fetchMinimumSupportedVersion({
    apiOrigin: 'https://api.example.test',
    currentVersion: '1.0.0',
    fetchImpl: async () => ({ ok: true, json: async () => ({ minimum_supported_version: 'v2' }) }),
  });
  assert.equal(malformed, null);

  let abort;
  class FakeAbortController {
    constructor() {
      this.signal = {};
      abort = () => this.reject?.(new Error('aborted private URL'));
    }
    abort() { abort(); }
  }
  let fireTimeout;
  const timedOut = fetchMinimumSupportedVersion({
    apiOrigin: 'https://api.example.test',
    currentVersion: '1.0.0',
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      assert.ok(options.signal);
      abort = () => reject(new Error('aborted private URL'));
    }),
    AbortControllerImpl: FakeAbortController,
    setTimeoutImpl: (callback, delay) => { assert.equal(delay, 2_000); fireTimeout = callback; return 1; },
    clearTimeoutImpl() {},
  });
  fireTimeout();
  assert.equal(await timedOut, null);
});

test('coordinator publishes checking, download progress, ready, and sanitized snapshots', async () => {
  const updater = createUpdater();
  const logs = [];
  const coordinator = createMacUpdateCoordinator({
    updater,
    currentVersion: '1.0.0',
    getMinimumSupportedVersion: async () => '0.9.0',
    logger: { info: (message) => logs.push(message) },
  });
  const snapshots = [];
  coordinator.subscribe((snapshot) => snapshots.push(snapshot));

  await coordinator.start();
  updater.emit('update-available', { version: '1.1.0', releaseNotes: 'private' });
  updater.emit('download-progress', { percent: 37.777, transferred: 123, bytesPerSecond: 456 });
  updater.emit('update-downloaded', { version: '1.1.0', downloadedFile: '/private/path' });

  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(typeof updater.logger.error, 'function');
  assert.equal(updater.checks, 1);
  assert.deepEqual(coordinator.getSnapshot(), {
    phase: 'ready', required: false, currentVersion: '1.0.0', targetVersion: '1.1.0', percent: 100,
  });
  assert.ok(snapshots.some((snapshot) => snapshot.phase === 'checking'));
  assert.ok(snapshots.some((snapshot) => snapshot.phase === 'downloading' && snapshot.percent === 37.8));
  assert.deepEqual(logs, ['[desktop-update] currentVersion=1.0.0 required=false']);
  assert.doesNotMatch(JSON.stringify(snapshots), /private|releaseNotes|downloadedFile|transferred/);
});

test('required policy blocks no-update and rejects a target below the minimum', async () => {
  const updater = createUpdater();
  let policyAvailable = true;
  const coordinator = createMacUpdateCoordinator({
    updater,
    currentVersion: '1.0.0',
    getMinimumSupportedVersion: async () => policyAvailable ? '2.0.0' : null,
    logger: { info() {} },
  });

  await coordinator.start();
  assert.equal(coordinator.getSnapshot().required, true);
  updater.emit('update-not-available', { version: '1.0.0' });
  assert.equal(coordinator.getSnapshot().phase, 'error');

  policyAvailable = false;
  const retrying = coordinator.retry();
  assert.deepEqual(coordinator.getSnapshot(), {
    phase: 'checking', required: true, currentVersion: '1.0.0', targetVersion: null, percent: 0,
  });
  await retrying;
  updater.emit('update-available', { version: '1.5.0' });
  assert.deepEqual(coordinator.getSnapshot(), {
    phase: 'error', required: true, currentVersion: '1.0.0', targetVersion: null, percent: 0,
  });
  assert.equal(updater.checks, 2);
});

test('policy failures still run the optional updater check and raw errors are redacted', async () => {
  const updater = createUpdater();
  const logs = [];
  const coordinator = createMacUpdateCoordinator({
    updater,
    currentVersion: '1.0.0',
    getMinimumSupportedVersion: async () => { throw new Error('https://token@example.test/private'); },
    logger: { info: (message) => logs.push(message) },
  });

  await coordinator.start();
  updater.emit('error', new Error('feed=https://secret.example.test'));
  assert.equal(updater.checks, 1);
  assert.deepEqual(coordinator.getSnapshot(), {
    phase: 'error', required: false, currentVersion: '1.0.0', targetVersion: null, percent: 0,
  });
  assert.deepEqual(logs, ['[desktop-update] currentVersion=1.0.0 required=false']);
});

test('retry is error-only and install is ready-only and idempotent', async () => {
  const updater = createUpdater();
  const coordinator = createMacUpdateCoordinator({
    updater,
    currentVersion: '1.0.0',
    getMinimumSupportedVersion: async () => '0.0.0',
    logger: { info() {} },
  });

  await coordinator.start();
  assert.equal(await coordinator.retry(), false);
  assert.equal(coordinator.restartAndInstall(), false);
  updater.emit('error', new Error('private'));
  assert.equal(await coordinator.retry(), true);
  updater.emit('update-available', { version: '1.1.0' });
  updater.emit('update-downloaded', { version: '1.1.0' });
  assert.equal(coordinator.restartAndInstall(), true);
  assert.equal(coordinator.restartAndInstall(), false);
  assert.equal(updater.installs, 1);
  assert.deepEqual(updater.installArguments, [false, true]);
});

test('start performs one automatic check and never loads updater outside packaged macOS', async () => {
  const updater = createUpdater();
  let loads = 0;
  const common = {
    app: { isPackaged: true, getPath: () => '/tmp/GlideLingo', getVersion: () => '1.0.0' },
    apiOrigin: 'https://api.example.test',
    fetchImpl: async () => ({ ok: true, json: async () => ({ minimum_supported_version: '0.0.0' }) }),
    loadUpdater: () => { loads += 1; return updater; },
    logger: { info() {}, error() {} },
    removeLegacyUpdaterIdImpl: async ({ userDataPath }) => {
      assert.equal(userDataPath, '/tmp/GlideLingo');
      return true;
    },
  };

  assert.equal(startMacUpdater({ ...common, platform: 'linux' }), null);
  assert.equal(startMacUpdater({ ...common, developmentUrl: 'http://localhost:8081', platform: 'darwin' }), null);
  const coordinator = startMacUpdater({ ...common, platform: 'darwin' });
  assert.ok(coordinator);
  await flushEvents();
  assert.equal(loads, 1);
  assert.equal(updater.checks, 1);
});

test('IPC rejects every non-exact sender and opens only the fixed official URL', async () => {
  const handlers = new Map();
  const sent = [];
  const opened = [];
  let openFails = false;
  const webContents = { send: (...args) => sent.push(args) };
  const window = { isDestroyed: () => false, webContents };
  let subscriber;
  const coordinator = {
    getSnapshot: () => ({ phase: 'idle' }),
    retry: () => 'retried',
    restartAndInstall: () => 'installed',
    subscribe: (listener) => { subscriber = listener; return () => { subscriber = null; }; },
  };
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel),
  };
  const exact = (url) => {
    try { return new URL(url).origin === 'https://desktop.glidelingo.com' && new URL(url).username === ''; }
    catch { return false; }
  };
  const cleanup = registerDesktopUpdateIpc({
    coordinator,
    getWindow: () => window,
    ipcMain,
    isExactPackagedRendererUrl: exact,
    shell: { openExternal: (url) => {
      if (openFails) throw new Error('private OS path and token');
      opened.push(url);
    } },
  });
  const validEvent = { sender: webContents, senderFrame: { url: 'https://desktop.glidelingo.com/quests' } };

  assert.deepEqual(await handlers.get(UPDATE_CHANNELS.getSnapshot)(validEvent), { phase: 'idle' });
  await handlers.get(UPDATE_CHANNELS.openOfficialDownloadPage)(validEvent);
  assert.deepEqual(opened, [OFFICIAL_DOWNLOAD_PAGE_URL]);
  openFails = true;
  assert.equal(await handlers.get(UPDATE_CHANNELS.openOfficialDownloadPage)(validEvent), false);
  await assert.rejects(() => handlers.get(UPDATE_CHANNELS.retry)(
    { sender: webContents, senderFrame: { url: 'https://desktop.glidelingo.com.attacker.test/' } },
  ), /denied/);
  await assert.rejects(() => handlers.get(UPDATE_CHANNELS.retry)(validEvent, 'unexpected'), /denied/);
  await assert.rejects(() => handlers.get(UPDATE_CHANNELS.retry)(
    { sender: {}, senderFrame: { url: 'https://desktop.glidelingo.com/' } },
  ), /denied/);
  assert.equal(isAllowedUpdateSender(validEvent, () => window, exact), true);

  subscriber({ phase: 'ready', required: false });
  assert.deepEqual(sent, [[UPDATE_CHANNELS.snapshot, { phase: 'ready', required: false }]]);
  cleanup();
  assert.equal(handlers.size, 0);
  assert.equal(subscriber, null);
});
