const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { app, BrowserWindow, net, protocol, session, shell } = require('electron');

const {
  APP_HOST,
  APP_SCHEME,
  isAllowedNavigation,
  isSafeExternalUrl,
  resolveRendererPath,
  validateDevelopmentUrl,
} = require('./runtime.cjs');

const DEVELOPMENT_URL = validateDevelopmentUrl(process.env.ELECTRON_RENDERER_URL);
const AUDIO_SMOKE_TEST = process.env.ELECTRON_AUDIO_SMOKE_TEST === '1';
const PRODUCTION_URL = `${APP_SCHEME}://${APP_HOST}/`;
const RENDERER_URL = DEVELOPMENT_URL ?? PRODUCTION_URL;
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

app.enableSandbox();

if (AUDIO_SMOKE_TEST) {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
}

async function registerProductionProtocol() {
  const distDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'dist')
    : path.join(app.getAppPath(), '..', 'dist');
  const notFoundPage = path.join(distDirectory, '+not-found.html');

  await protocol.handle(APP_SCHEME, async (request) => {
    const requestedFile = resolveRendererPath(distDirectory, request.url);

    if (!requestedFile) {
      return new Response('Not found', { status: 404 });
    }

    let fileToServe = requestedFile;

    try {
      await fs.access(fileToServe);
    } catch {
      try {
        await fs.access(notFoundPage);
        fileToServe = notFoundPage;
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }

    return net.fetch(pathToFileURL(fileToServe).toString());
  });
}

function installSessionSecurity() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  if (!DEVELOPMENT_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (!details.url.startsWith(PRODUCTION_URL)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
        },
      });
    });
  }
}

function openExternalUrl(targetUrl) {
  if (isSafeExternalUrl(targetUrl)) {
    void shell.openExternal(targetUrl);
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: 'GlideLingo',
    backgroundColor: '#0d0d0d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, RENDERER_URL)) {
      return;
    }

    event.preventDefault();
    openExternalUrl(url);
  });

  if (process.env.ELECTRON_SMOKE_TEST === '1') {
    window.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const rendered = await window.webContents.executeJavaScript(
            "Boolean(document.querySelector('[data-testid=\"start-lesson\"]'))",
          );

          if (!rendered) {
            console.error('[desktop-smoke] renderer loaded without the home screen');
            app.exit(1);
            return;
          }

          console.log(`[desktop-smoke] loaded ${window.webContents.getURL()}`);
          app.quit();
        } catch (error) {
          console.error('[desktop-smoke] renderer verification failed:', error);
          app.exit(1);
        }
      }, 1500);
    });

    window.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(`[desktop-smoke] load failed (${code}): ${description}`);
      app.exit(1);
    });
  } else if (AUDIO_SMOKE_TEST) {
    let learningStatePrepared = false;

    window.webContents.on('did-finish-load', () => {
      if (!learningStatePrepared) {
        learningStatePrepared = true;
        void window.webContents
          .executeJavaScript(
            `localStorage.setItem('glidelingo-learning', JSON.stringify({
              languageId: 'el',
              enrolledByLanguage: { el: 'el-from-zero' },
              completedLessonIds: []
            }))`,
          )
          .then(() => window.reload());
        return;
      }

      setTimeout(async () => {
        try {
          const playbackResult = await window.webContents.executeJavaScript(`(async () => {
            const lessonButton = document.querySelector('[data-testid="start-lesson"]');
            const initialLabel = lessonButton?.getAttribute('aria-label') ?? lessonButton?.textContent ?? null;
            lessonButton?.click();
            let button;
            for (let attempt = 0; attempt < 30; attempt += 1) {
              button = Array.from(document.querySelectorAll('[aria-label]')).find(
                (element) => (element.getAttribute('aria-label') ?? '').startsWith('Play pronunciation:'),
              );
              if (button) break;
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            button?.click();
            const pronunciationStates = [];
            for (const delay of [10, 50, 100, 250, 750]) {
              await new Promise((resolve) => setTimeout(resolve, delay));
              pronunciationStates.push(button?.textContent ?? null);
            }
            return {
              initialLabel,
              pronunciationFound: Boolean(button),
              pronunciationText: button?.textContent ?? null,
              pronunciationStates,
              playing: pronunciationStates.some((state) => state?.includes('Playing')),
            };
          })()`);

          if (!playbackResult.playing) {
            console.error('[desktop-audio-smoke] pronunciation did not enter the playing state', playbackResult);
            app.exit(1);
            return;
          }

          console.log(`[desktop-audio-smoke] bundled Greek audio played from ${window.webContents.getURL()}`);
          app.quit();
        } catch (error) {
          console.error('[desktop-audio-smoke] playback verification failed:', error);
          app.exit(1);
        }
      }, 1000);
    });
  }

  void window.loadURL(RENDERER_URL);
}

app.whenReady().then(async () => {
  if (!DEVELOPMENT_URL) {
    await registerProductionProtocol();
  }

  installSessionSecurity();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  console.error('GlideLingo desktop failed to start:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
