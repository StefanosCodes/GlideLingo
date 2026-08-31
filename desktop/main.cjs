const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { app, BrowserWindow, net, protocol, session, shell } = require('electron');

const {
  APP_HOST,
  APP_SCHEME,
  isAllowedAuthWindowUrl,
  isAllowedNavigation,
  isSafeExternalUrl,
  resolveRendererPath,
  validateDevelopmentUrl,
} = require('./runtime.cjs');

const DEVELOPMENT_URL = validateDevelopmentUrl(process.env.ELECTRON_RENDERER_URL);
const PRODUCTION_URL = `${APP_SCHEME}://${APP_HOST}/`;
const RENDERER_URL = DEVELOPMENT_URL ?? PRODUCTION_URL;
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.clerk.com https://*.clerk.accounts.dev https://img.clerk.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.clerk.accounts.dev https://api.clerk.com https://*.revenuecat.com wss://*.clerk.accounts.dev",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "frame-src https://*.clerk.accounts.dev https://accounts.google.com https://appleid.apple.com",
  "base-uri 'self'",
  "form-action 'self' https://*.clerk.accounts.dev https://accounts.google.com https://appleid.apple.com",
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
    if (isAllowedAuthWindowUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          parent: window,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          },
        },
      };
    }

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
          const rendered = await window.webContents.executeJavaScript(`({
            authenticated: Boolean(document.querySelector('[data-testid="start-lesson"]')),
            completingProfile: Boolean(document.querySelector('[data-testid="first-name-completion"]')),
            signedOut: Boolean(document.querySelector('[data-testid="auth-sign-in"]')),
          })`);

          if (!rendered.authenticated && !rendered.completingProfile && !rendered.signedOut) {
            console.error('[desktop-smoke] renderer loaded without a valid signed-in or signed-out screen');
            app.exit(1);
            return;
          }

          console.log(
            `[desktop-smoke] loaded ${rendered.signedOut ? 'signed-out' : 'authenticated'} state at ` +
              window.webContents.getURL(),
          );
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
