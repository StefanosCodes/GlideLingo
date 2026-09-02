const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { createClerkBridge } = require('@clerk/electron');
const { storage: createClerkStorage } = require('@clerk/electron/storage');
const { app, BrowserWindow, dialog, net, protocol, session, shell } = require('electron');

const {
  APP_SCHEME,
  DEVELOPMENT_CLERK_ORIGIN,
  PACKAGED_RENDERER_ORIGIN,
  PRODUCTION_API_ORIGIN,
  PRODUCTION_CLERK_ORIGIN,
  buildContentSecurityPolicy,
  findAuthCallbackUrl,
  isAllowedAuthWindowUrl,
  isAllowedNavigation,
  isExactPackagedRendererUrl,
  isSafeExternalUrl,
  installAuthPopupNavigationSecurity,
  mapAuthCallbackToRendererUrl,
  parseAuthCallbackUrl,
  resolveRendererPath,
  validateDevelopmentUrl,
  validateProductionApiOrigin,
  validateProductionClerkOrigin,
} = require('./runtime.cjs');
const { startMacUpdater } = require('./updater.cjs');
const { glidelingoApiOrigin, glidelingoClerkOrigin } = require('./package.json');

const DEVELOPMENT_URL = validateDevelopmentUrl(process.env.ELECTRON_RENDERER_URL);
const PRODUCTION_URL = `${PACKAGED_RENDERER_ORIGIN}/`;
const RENDERER_URL = DEVELOPMENT_URL ?? PRODUCTION_URL;
const PACKAGED_API_ORIGIN = validateProductionApiOrigin(
  glidelingoApiOrigin ?? PRODUCTION_API_ORIGIN,
);
const PACKAGED_CLERK_ORIGIN = validateProductionClerkOrigin(
  glidelingoClerkOrigin ?? PRODUCTION_CLERK_ORIGIN,
);
const AUTH_CLERK_ORIGIN = DEVELOPMENT_URL
  ? DEVELOPMENT_CLERK_ORIGIN
  : PACKAGED_CLERK_ORIGIN;
const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy({
  apiOrigin: PACKAGED_API_ORIGIN,
  clerkOrigin: PACKAGED_CLERK_ORIGIN,
});
let mainWindow = null;
let pendingAuthCallbackUrl = findAuthCallbackUrl(process.argv);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

const clerkBridge = hasSingleInstanceLock
  ? createClerkBridge({
      manageSingleInstanceLock: false,
      renderer: { scheme: APP_SCHEME, host: 'app' },
      storage: createClerkStorage({ name: 'clerk-tokens' }),
      userAgent: `GlideLingo/${app.getVersion()}`,
    })
  : null;

app.enableSandbox();

async function registerProductionProtocol() {
  const distDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'dist')
    : path.join(app.getAppPath(), '..', 'dist');
  const notFoundPage = path.join(distDirectory, '+not-found.html');

  await protocol.handle('https', async (request) => {
    if (!isExactPackagedRendererUrl(request.url)) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }

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
      if (!isExactPackagedRendererUrl(details.url)) {
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

function handleAuthCallback(targetUrl) {
  const acceptedCallbackUrl = parseAuthCallbackUrl(targetUrl);
  const callbackUrl = mapAuthCallbackToRendererUrl(targetUrl, RENDERER_URL);
  if (!acceptedCallbackUrl || !callbackUrl) return false;

  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingAuthCallbackUrl = acceptedCallbackUrl;
    return true;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  void mainWindow.loadURL(callbackUrl);
  return true;
}

function authPopupWindowOptions(parent) {
  return {
    autoHideMenuBar: true,
    parent,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}

function installAuthPopupSecurity(authWindow, parent) {
  installAuthPopupNavigationSecurity(authWindow.webContents, {
    rendererUrl: RENDERER_URL,
    clerkOrigin: AUTH_CLERK_ORIGIN,
    openExternalUrl,
  });

  authWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedAuthWindowUrl(url, AUTH_CLERK_ORIGIN)) {
      openExternalUrl(url);
      return { action: 'deny' };
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: authPopupWindowOptions(parent),
    };
  });

  authWindow.webContents.on('did-create-window', (childWindow) => {
    installAuthPopupSecurity(childWindow, parent);
  });
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
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  mainWindow = window;
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAuthWindowUrl(url, AUTH_CLERK_ORIGIN)) {
      if (!DEVELOPMENT_URL) {
        openExternalUrl(url);
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: authPopupWindowOptions(window),
      };
    }

    openExternalUrl(url);
    return { action: 'deny' };
  });

  window.webContents.on('did-create-window', (childWindow) => {
    installAuthPopupSecurity(childWindow, window);
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (parseAuthCallbackUrl(url)) {
      event.preventDefault();
      handleAuthCallback(url);
      return;
    }

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
            electronBridge: Boolean(window.__clerk_internal_electron),
            origin: window.location.origin,
            signedOut: Boolean(document.querySelector('[data-testid="auth-sign-in"]')),
          })`);

          if (!rendered.electronBridge) {
            console.error('[desktop-smoke] Clerk Electron preload bridge was not exposed');
            app.exit(1);
            return;
          }

          if (!DEVELOPMENT_URL && rendered.origin !== PACKAGED_RENDERER_ORIGIN) {
            console.error(`[desktop-smoke] unexpected renderer origin: ${rendered.origin}`);
            app.exit(1);
            return;
          }

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

  if (pendingAuthCallbackUrl) {
    const callbackUrl = pendingAuthCallbackUrl;
    pendingAuthCallbackUrl = null;
    window.webContents.once('did-finish-load', () => handleAuthCallback(callbackUrl));
  }

  return window;
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

app.on('second-instance', (_event, argv) => {
  const callbackUrl = findAuthCallbackUrl(argv);
  if (callbackUrl) {
    handleAuthCallback(callbackUrl);
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(APP_SCHEME);
  }
  if (!DEVELOPMENT_URL) {
    await registerProductionProtocol();
  }

  installSessionSecurity();
  const initialWindow = createWindow();
  initialWindow.once('ready-to-show', () => {
    startMacUpdater({
      app,
      dialog,
      parentWindow: initialWindow,
      developmentUrl: DEVELOPMENT_URL,
    });
  });

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

app.on('before-quit', () => {
  clerkBridge?.cleanup();
});
