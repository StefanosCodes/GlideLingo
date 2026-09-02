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
  dispatchSupportedAppUrl,
  findSupportedAppUrl,
  isAllowedAuthWindowUrl,
  isAllowedNavigation,
  isExactPackagedRendererUrl,
  isSafeExternalUrl,
  installAuthPopupNavigationSecurity,
  parseSupportedAppUrl,
  redactUrlForLogging,
  resolveAffiliateReferralsEnabled,
  resolveRendererPath,
  validateDevelopmentUrl,
  validateProductionApiOrigin,
  validateProductionClerkOrigin,
} = require('./runtime.cjs');
const { startMacUpdater } = require('./updater.cjs');
const {
  glidelingoAffiliateReferralsEnabled,
  glidelingoApiOrigin,
  glidelingoClerkOrigin,
} = require('./package.json');

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
const AFFILIATE_REFERRALS_ENABLED = resolveAffiliateReferralsEnabled({
  developmentUrl: DEVELOPMENT_URL,
  environmentValue: process.env.EXPO_PUBLIC_AFFILIATE_REFERRALS_ENABLED,
  packagedValue: glidelingoAffiliateReferralsEnabled,
});
let mainWindow = null;
let pendingAppUrl = findSupportedAppUrl(process.argv, {
  referralsEnabled: AFFILIATE_REFERRALS_ENABLED,
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  if (process.env.ELECTRON_AUTH_FLOW_TEST === '1' || process.env.ELECTRON_SMOKE_TEST === '1') {
    console.error('[desktop-auth-flow] another GlideLingo desktop instance is already running');
    app.exit(1);
  }
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

function handleAppUrl(targetUrl) {
  return dispatchSupportedAppUrl(targetUrl, {
    activateWindow() {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    },
    hasWindow: () => Boolean(mainWindow && !mainWindow.isDestroyed()),
    loadRendererUrl: (rendererUrl) => { void mainWindow.loadURL(rendererUrl); },
    referralsEnabled: AFFILIATE_REFERRALS_ENABLED,
    rendererOrigin: RENDERER_URL,
    storePendingUrl: (appUrl) => { pendingAppUrl = appUrl; },
  });
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
    if (parseSupportedAppUrl(url, { referralsEnabled: AFFILIATE_REFERRALS_ENABLED })) {
      event.preventDefault();
      handleAppUrl(url);
      return;
    }

    if (isAllowedNavigation(url, RENDERER_URL)) {
      return;
    }

    event.preventDefault();
    openExternalUrl(url);
  });

  if (process.env.ELECTRON_AUTH_FLOW_TEST === '1') {
    window.webContents.once('did-finish-load', () => {
      const inspectRenderer = async () => window.webContents.executeJavaScript(`(() => {
        const alert = document.querySelector('[role="alert"]');
        return {
          accountSummary: Boolean(document.querySelector('[data-testid="account-summary"]')),
          authenticated: Boolean(document.querySelector('[data-testid="start-lesson"]')),
          authLoading: Boolean(document.querySelector('[data-testid="auth-session-loading"]')),
          completingProfile: Boolean(document.querySelector('[data-testid="first-name-completion"]')),
          electronBridge: Boolean(window.__clerk_internal_electron),
          hasCreateAccountLink: Boolean(document.querySelector('[data-testid="auth-create-account-link"]')),
          hasSignOutButton: Boolean(document.querySelector('[data-testid="sign-out"], [data-testid="profile-completion-sign-out"]')),
          hasWindowClerkSignOut: typeof window.Clerk?.signOut === 'function',
          href: window.location.href,
          origin: window.location.origin,
          signedOut: Boolean(document.querySelector('[data-testid="auth-sign-in"]')),
          signUpScreen: Boolean(document.querySelector('[data-testid="auth-sign-up"]')),
          userVisibleError: alert?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 180) ?? null,
        };
      })()`);

      const waitForRenderer = (description, accept, timeoutMs = 15000) => new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const poll = async () => {
          try {
            const state = await inspectRenderer();
            if (accept(state)) {
              resolve(state);
              return;
            }
            if (Date.now() - startedAt > timeoutMs) {
              reject(new Error(
                `${description} timed out with state ${JSON.stringify({
                  accountSummary: state.accountSummary,
                  authenticated: state.authenticated,
                  authLoading: state.authLoading,
                  completingProfile: state.completingProfile,
                  hasCreateAccountLink: state.hasCreateAccountLink,
                  hasSignOutButton: state.hasSignOutButton,
                  hasWindowClerkSignOut: state.hasWindowClerkSignOut,
                  href: state.href,
                  signedOut: state.signedOut,
                  signUpScreen: state.signUpScreen,
                  userVisibleError: state.userVisibleError,
                })}`,
              ));
              return;
            }
            setTimeout(poll, 500);
          } catch (error) {
            reject(error);
          }
        };
        void poll();
      });

      setTimeout(async () => {
        try {
          const initial = await waitForRenderer(
            'initial auth state',
            (state) =>
              state.electronBridge &&
              !state.authLoading &&
              (state.authenticated || state.accountSummary || state.completingProfile || state.signedOut),
          );

          if (initial.authenticated || initial.accountSummary || initial.completingProfile) {
            const signOutAction = await window.webContents.executeJavaScript(`(async () => {
              if (typeof window.Clerk?.signOut === 'function') {
                await window.Clerk.signOut();
                return 'window.Clerk.signOut';
              }
              const button = document.querySelector('[data-testid="sign-out"], [data-testid="profile-completion-sign-out"]');
              if (!button) return 'missing-sign-out-control';
              button.click();
              return 'dom-click';
            })()`);

            if (signOutAction === 'missing-sign-out-control') {
              throw new Error('signed-in state did not expose a sign-out control');
            }

            await waitForRenderer('signed-out screen after sign-out', (state) => state.signedOut && state.hasCreateAccountLink);
          }

          await waitForRenderer('signed-out screen before signup navigation', (state) => state.signedOut && state.hasCreateAccountLink);

          await window.webContents.executeJavaScript(`(() => {
            const link = document.querySelector('[data-testid="auth-create-account-link"]');
            if (link) {
              link.click();
              return;
            }
            window.location.href = '/sign-up';
          })()`);
          await waitForRenderer('sign-up screen after create-account navigation', (state) => state.signUpScreen);

          await window.webContents.executeJavaScript(`(() => {
            const link = Array.from(document.querySelectorAll('a'))
              .find((anchor) => anchor.textContent?.trim() === 'Sign in');
            if (link) {
              link.click();
              return;
            }
            window.location.href = '/sign-in';
          })()`);
          await waitForRenderer('signed-out screen after returning from sign-up', (state) => state.signedOut && state.hasCreateAccountLink);

          console.log('[desktop-auth-flow] verified sign-out, sign-in screen, sign-up navigation, and return-to-sign-in');
          app.quit();
        } catch (error) {
          console.error('[desktop-auth-flow] verification failed:', error);
          app.exit(1);
        }
      }, 500);
    });
  } else if (process.env.ELECTRON_SMOKE_TEST === '1') {
    window.webContents.once('did-finish-load', () => {
      const smokeStartedAt = Date.now();
      const inspectRenderer = async () => window.webContents.executeJavaScript(`(() => {
        const alert = document.querySelector('[role="alert"]');
        return {
          authenticated: Boolean(document.querySelector('[data-testid="start-lesson"]')),
          authLoading: Boolean(document.querySelector('[data-testid="auth-session-loading"]')),
          completingProfile: Boolean(document.querySelector('[data-testid="first-name-completion"]')),
          electronBridge: Boolean(window.__clerk_internal_electron),
          origin: window.location.origin,
          signedOut: Boolean(document.querySelector('[data-testid="auth-sign-in"]')),
          userVisibleError: alert?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 180) ?? null,
        };
      })()`);

      const verifyRenderer = async () => {
        try {
          const rendered = await inspectRenderer();

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

          if (rendered.authLoading && Date.now() - smokeStartedAt < 10000) {
            setTimeout(verifyRenderer, 500);
            return;
          }

          if (!rendered.authenticated && !rendered.completingProfile && !rendered.signedOut) {
            console.error(
              '[desktop-smoke] renderer loaded without a valid signed-in, signed-out, or profile-completion screen',
              JSON.stringify({
                authLoading: rendered.authLoading,
                userVisibleError: rendered.userVisibleError,
                url: window.webContents.getURL(),
              }),
            );
            app.exit(1);
            return;
          }

          console.log(
            `[desktop-smoke] loaded ${rendered.signedOut ? 'signed-out' : 'authenticated'} state at ` +
              redactUrlForLogging(window.webContents.getURL()),
          );
          app.quit();
        } catch (error) {
          console.error('[desktop-smoke] renderer verification failed:', error);
          app.exit(1);
        }
      };

      setTimeout(verifyRenderer, 500);
    });

    window.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(`[desktop-smoke] load failed (${code}): ${description}`);
      app.exit(1);
    });
  }

  void window.loadURL(RENDERER_URL);

  if (pendingAppUrl) {
    const appUrl = pendingAppUrl;
    pendingAppUrl = null;
    window.webContents.once('did-finish-load', () => handleAppUrl(appUrl));
  }

  return window;
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAppUrl(url);
});

app.on('second-instance', (_event, argv) => {
  const appUrl = findSupportedAppUrl(argv, { referralsEnabled: AFFILIATE_REFERRALS_ENABLED });
  if (appUrl) {
    handleAppUrl(appUrl);
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
