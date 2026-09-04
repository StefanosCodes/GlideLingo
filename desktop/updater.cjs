const STRICT_SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const path = require('node:path');
const OFFICIAL_DOWNLOAD_PAGE_URL = 'https://glidelingo.com/';
const POLICY_TIMEOUT_MS = 2_000;
const SUPPORTED_ELECTRON_UPDATER_VERSION = '6.8.9';
// electron-updater requires a valid UUID for rollout selection and request headers. A shared,
// non-identifying value prevents its default per-install .updaterId from being read or created.
const SHARED_STAGING_USER_ID = '00000000-0000-5000-8000-000000000000';
const SILENT_UPDATER_LOGGER = Object.freeze({
  debug() {},
  error() {},
  info() {},
  warn() {},
});

const UPDATE_CHANNELS = Object.freeze({
  getSnapshot: 'desktop-update:get-snapshot',
  openOfficialDownloadPage: 'desktop-update:open-official-download-page',
  restartAndInstall: 'desktop-update:restart-and-install',
  retry: 'desktop-update:retry',
  snapshot: 'desktop-update:snapshot',
});

function parseNumericSemVer(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const match = STRICT_SEMVER_PATTERN.exec(value);
  if (!match) return null;
  return match.slice(1).map((part) => BigInt(part));
}

function compareNumericSemVer(left, right) {
  const leftParts = parseNumericSemVer(left);
  const rightParts = parseNumericSemVer(right);
  if (!leftParts || !rightParts) return null;

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

function shouldStartMacUpdater({ isPackaged, platform, developmentUrl }) {
  return isPackaged === true && platform === 'darwin' && !developmentUrl;
}

function shouldQuitForRequiredUpdate(coordinator) {
  return coordinator?.getSnapshot()?.required === true;
}

function configureUpdaterPrivacy(updater, updaterVersion) {
  if (updaterVersion !== SUPPORTED_ELECTRON_UPDATER_VERSION) {
    throw new Error('Unsupported electron-updater version.');
  }

  Object.defineProperty(updater, 'stagingUserIdPromise', {
    configurable: true,
    enumerable: true,
    value: Object.freeze({ value: Promise.resolve(SHARED_STAGING_USER_ID) }),
    writable: false,
  });
  updater.logger = SILENT_UPDATER_LOGGER;
}

async function removeLegacyUpdaterId({
  userDataPath,
  unlinkImpl = require('node:fs/promises').unlink,
}) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) return false;
  const legacyIdPath = path.join(userDataPath, '.updaterId');
  try {
    await unlinkImpl(legacyIdPath);
    return true;
  } catch {
    return false;
  }
}

function sanitizePercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

async function fetchMinimumSupportedVersion({
  apiOrigin,
  currentVersion,
  fetchImpl,
  timeoutMs = POLICY_TIMEOUT_MS,
  AbortControllerImpl = AbortController,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  const controller = new AbortControllerImpl();
  const timeout = setTimeoutImpl(() => controller.abort(), timeoutMs);

  try {
    const policyUrl = new URL('/v1/desktop/update-policy', apiOrigin);
    policyUrl.searchParams.set('current_version', currentVersion);
    const response = await fetchImpl(policyUrl.toString(), {
      headers: { Accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const body = await response.json();
    const minimumVersion = body?.minimum_supported_version;
    return parseNumericSemVer(minimumVersion) ? minimumVersion : null;
  } catch {
    return null;
  } finally {
    clearTimeoutImpl(timeout);
  }
}

function createMacUpdateCoordinator({
  updater,
  currentVersion,
  getMinimumSupportedVersion,
  logger = console,
}) {
  if (!parseNumericSemVer(currentVersion)) {
    throw new Error('The packaged desktop version must use numeric SemVer.');
  }

  let minimumSupportedVersion = '0.0.0';
  let checkRunning = false;
  let adoptionLogged = false;
  let installRequested = false;
  let snapshot = Object.freeze({
    phase: 'idle',
    required: false,
    currentVersion,
    targetVersion: null,
    percent: 0,
  });
  const listeners = new Set();

  const publish = (next) => {
    snapshot = Object.freeze({
      phase: next.phase,
      required: next.required === true,
      currentVersion,
      targetVersion: parseNumericSemVer(next.targetVersion) ? next.targetVersion : null,
      percent: sanitizePercent(next.percent),
    });
    for (const listener of listeners) {
      try {
        listener({ ...snapshot });
      } catch {
        // A closing renderer must not break the updater state machine.
      }
    }
  };

  const patchSnapshot = (changes) => publish({ ...snapshot, ...changes });
  const fail = () => patchSnapshot({ phase: 'error', percent: 0 });

  updater.logger = SILENT_UPDATER_LOGGER;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;

  updater.on('checking-for-update', () => {
    patchSnapshot({ phase: 'checking', percent: 0, targetVersion: null });
  });
  updater.on('update-available', (info) => {
    const targetVersion = info?.version;
    if (
      !parseNumericSemVer(targetVersion) ||
      (snapshot.required && compareNumericSemVer(targetVersion, minimumSupportedVersion) < 0)
    ) {
      fail();
      return;
    }
    patchSnapshot({ phase: 'downloading', percent: 0, targetVersion });
  });
  updater.on('download-progress', (progress) => {
    if (snapshot.phase !== 'downloading') return;
    patchSnapshot({ percent: progress?.percent });
  });
  updater.on('update-downloaded', (info) => {
    const targetVersion = parseNumericSemVer(info?.version)
      ? info.version
      : snapshot.targetVersion;
    if (
      !targetVersion ||
      (snapshot.required && compareNumericSemVer(targetVersion, minimumSupportedVersion) < 0)
    ) {
      fail();
      return;
    }
    patchSnapshot({ phase: 'ready', percent: 100, targetVersion });
  });
  updater.on('update-not-available', () => {
    if (snapshot.required) {
      fail();
      return;
    }
    patchSnapshot({ phase: 'idle', percent: 0, targetVersion: null });
  });
  updater.on('error', () => fail());

  async function checkForUpdates() {
    if (checkRunning) return false;
    checkRunning = true;
    const wasRequired = snapshot.required;
    publish({
      phase: 'checking',
      required: wasRequired,
      currentVersion,
      targetVersion: null,
      percent: 0,
    });

    try {
      let configuredMinimum = null;
      try {
        configuredMinimum = await getMinimumSupportedVersion();
      } catch {
        configuredMinimum = null;
      }
      if (parseNumericSemVer(configuredMinimum)) {
        minimumSupportedVersion = configuredMinimum;
      } else if (!wasRequired) {
        minimumSupportedVersion = '0.0.0';
      }
      const required = wasRequired || compareNumericSemVer(currentVersion, minimumSupportedVersion) < 0;
      patchSnapshot({ required });

      if (!adoptionLogged) {
        adoptionLogged = true;
        logger.info(`[desktop-update] currentVersion=${currentVersion} required=${required}`);
      }

      await updater.checkForUpdates();
      return true;
    } catch {
      fail();
      return false;
    } finally {
      checkRunning = false;
    }
  }

  function retry() {
    if (snapshot.phase !== 'error') return Promise.resolve(false);
    return checkForUpdates();
  }

  function restartAndInstall() {
    if (snapshot.phase !== 'ready' || installRequested) return false;
    installRequested = true;
    try {
      updater.quitAndInstall(false, true);
      return true;
    } catch {
      installRequested = false;
      fail();
      return false;
    }
  }

  return {
    getSnapshot: () => ({ ...snapshot }),
    restartAndInstall,
    retry,
    start: checkForUpdates,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function isAllowedUpdateSender(event, getWindow, isExactPackagedRendererUrl) {
  const window = getWindow();
  return Boolean(
    window &&
    !window.isDestroyed() &&
    event?.sender === window.webContents &&
    isExactPackagedRendererUrl(event?.senderFrame?.url),
  );
}

function registerDesktopUpdateIpc({
  coordinator,
  getWindow,
  ipcMain,
  isExactPackagedRendererUrl,
  shell,
}) {
  const operations = new Map([
    [UPDATE_CHANNELS.getSnapshot, () => coordinator.getSnapshot()],
    [UPDATE_CHANNELS.retry, () => coordinator.retry()],
    [UPDATE_CHANNELS.restartAndInstall, () => coordinator.restartAndInstall()],
    [UPDATE_CHANNELS.openOfficialDownloadPage, async () => {
      try {
        await shell.openExternal(OFFICIAL_DOWNLOAD_PAGE_URL);
        return true;
      } catch {
        return false;
      }
    }],
  ]);

  for (const [channel, operation] of operations) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isAllowedUpdateSender(event, getWindow, isExactPackagedRendererUrl) || args.length > 0) {
        throw new Error('Desktop update request denied.');
      }
      try {
        return await operation();
      } catch {
        return false;
      }
    });
  }

  const unsubscribe = coordinator.subscribe((nextSnapshot) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(UPDATE_CHANNELS.snapshot, nextSnapshot);
    }
  });

  return () => {
    unsubscribe();
    for (const channel of operations.keys()) ipcMain.removeHandler(channel);
  };
}

function startMacUpdater({
  app,
  apiOrigin,
  developmentUrl,
  fetchImpl,
  platform = process.platform,
  loadUpdater = () => require('electron-updater').autoUpdater,
  loadUpdaterVersion = () => require('electron-updater/package.json').version,
  logger = console,
  removeLegacyUpdaterIdImpl = removeLegacyUpdaterId,
}) {
  if (!shouldStartMacUpdater({ isPackaged: app.isPackaged, platform, developmentUrl })) {
    return null;
  }

  try {
    const currentVersion = app.getVersion();
    const updater = loadUpdater();
    configureUpdaterPrivacy(updater, loadUpdaterVersion());
    const coordinator = createMacUpdateCoordinator({
      currentVersion,
      getMinimumSupportedVersion: () => fetchMinimumSupportedVersion({
        apiOrigin,
        currentVersion,
        fetchImpl,
      }),
      logger,
      updater,
    });
    void removeLegacyUpdaterIdImpl({ userDataPath: app.getPath('userData') })
      .then(() => coordinator.start());
    return coordinator;
  } catch {
    logger.error('[desktop-update] Automatic updates could not be initialized.');
    return null;
  }
}

module.exports = {
  OFFICIAL_DOWNLOAD_PAGE_URL,
  POLICY_TIMEOUT_MS,
  STRICT_SEMVER_PATTERN,
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
};
