const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MAC_SIGNATURE_TOOL = '/usr/bin/codesign';

function resolveMacAppBundle(executablePath) {
  if (!path.isAbsolute(executablePath || '')) return null;

  const bundlePath = path.resolve(executablePath, '../../..');
  return bundlePath.endsWith('.app') ? bundlePath : null;
}

function hasValidMacSignature(executablePath, spawn = spawnSync) {
  const bundlePath = resolveMacAppBundle(executablePath);
  if (!bundlePath) return false;

  try {
    const verification = spawn(
      MAC_SIGNATURE_TOOL,
      ['--verify', '--deep', '--strict', bundlePath],
      { stdio: 'ignore' },
    );
    if (verification.error || verification.status !== 0) return false;

    const identity = spawn(
      MAC_SIGNATURE_TOOL,
      ['--display', '--verbose=4', bundlePath],
      { encoding: 'utf8' },
    );
    const details = `${identity.stdout || ''}\n${identity.stderr || ''}`;
    return (
      !identity.error &&
      identity.status === 0 &&
      /^Authority=Developer ID Application:/m.test(details) &&
      /^TeamIdentifier=[A-Z0-9]+$/m.test(details)
    );
  } catch {
    return false;
  }
}

function shouldStartMacUpdater({
  isPackaged,
  platform,
  developmentUrl,
  executablePath,
  verifySignature = hasValidMacSignature,
}) {
  return (
    isPackaged === true &&
    platform === 'darwin' &&
    !developmentUrl &&
    verifySignature(executablePath)
  );
}

function showMessage(dialog, parentWindow, options) {
  if (parentWindow && !parentWindow.isDestroyed()) {
    return dialog.showMessageBox(parentWindow, options);
  }
  return dialog.showMessageBox(options);
}

async function showUpdateFailure(dialog, parentWindow, logger, logMessage) {
  logger.error(logMessage);
  try {
    await showMessage(dialog, parentWindow, {
      type: 'error',
      title: 'GlideLingo update unavailable',
      message: 'The update could not be completed.',
      detail: 'Your current version is unchanged. Please try again the next time you open GlideLingo.',
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
  } catch {
    logger.error('[desktop-update] The update failure message could not be shown.');
  }
}

function installMacUpdater({ updater, dialog, parentWindow, logger = console }) {
  let downloadPromptOpen = false;
  let installPromptOpen = false;

  updater.logger = null;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;

  updater.on('error', () => {
    logger.error('[desktop-update] Update operation failed. The current app remains installed.');
  });

  updater.on('update-available', async () => {
    if (downloadPromptOpen) return;
    downloadPromptOpen = true;

    try {
      const { response } = await showMessage(dialog, parentWindow, {
        type: 'info',
        title: 'GlideLingo update available',
        message: 'A new GlideLingo version is available.',
        detail: 'Download it now? You can keep using this version if you choose Later.',
        buttons: ['Download update', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (response === 0) {
        try {
          await updater.downloadUpdate();
        } catch {
          await showUpdateFailure(
            dialog,
            parentWindow,
            logger,
            '[desktop-update] The update could not be downloaded.',
          );
        }
      }
    } catch {
      logger.error('[desktop-update] The download prompt could not be shown.');
    } finally {
      downloadPromptOpen = false;
    }
  });

  updater.on('update-downloaded', async () => {
    if (installPromptOpen) return;
    installPromptOpen = true;

    try {
      const { response } = await showMessage(dialog, parentWindow, {
        type: 'info',
        title: 'GlideLingo update ready',
        message: 'The update is ready to install.',
        detail: 'Restart GlideLingo now to finish installing, or choose Later.',
        buttons: ['Restart and install', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (response === 0) {
        try {
          updater.quitAndInstall(false, true);
        } catch {
          await showUpdateFailure(
            dialog,
            parentWindow,
            logger,
            '[desktop-update] The update could not be installed.',
          );
        }
      }
    } catch {
      logger.error('[desktop-update] The install prompt could not be shown.');
    } finally {
      installPromptOpen = false;
    }
  });

  void updater.checkForUpdates().catch(() => {
    logger.error('[desktop-update] The update check could not be completed.');
  });
}

function startMacUpdater({
  app,
  dialog,
  parentWindow,
  developmentUrl,
  platform = process.platform,
  executablePath = process.execPath,
  verifySignature = hasValidMacSignature,
  loadUpdater = () => require('electron-updater').autoUpdater,
  logger = console,
}) {
  let eligible;
  try {
    eligible = shouldStartMacUpdater({
      isPackaged: app.isPackaged,
      platform,
      developmentUrl,
      executablePath,
      verifySignature,
    });
  } catch {
    eligible = false;
  }

  if (!eligible) {
    return false;
  }

  try {
    installMacUpdater({ updater: loadUpdater(), dialog, parentWindow, logger });
    return true;
  } catch {
    logger.error('[desktop-update] Automatic updates could not be initialized.');
    return false;
  }
}

module.exports = {
  hasValidMacSignature,
  installMacUpdater,
  resolveMacAppBundle,
  shouldStartMacUpdater,
  startMacUpdater,
};
