const { contextBridge, ipcRenderer } = require('electron');

const TOKEN_CACHE_CHANNELS = {
  getToken: 'clerk:token-cache:get',
  saveToken: 'clerk:token-cache:save',
  clearToken: 'clerk:token-cache:clear',
};

const OAUTH_TRANSPORT_CHANNELS = {
  getRedirectUrl: 'clerk:oauth-transport:get-redirect-url',
  open: 'clerk:oauth-transport:open',
};

const UPDATE_CHANNELS = {
  getSnapshot: 'desktop-update:get-snapshot',
  openOfficialDownloadPage: 'desktop-update:open-official-download-page',
  restartAndInstall: 'desktop-update:restart-and-install',
  retry: 'desktop-update:retry',
  snapshot: 'desktop-update:snapshot',
};

contextBridge.exposeInMainWorld('__clerk_internal_electron', {
  tokenCache: {
    getToken: (key) => ipcRenderer.invoke(TOKEN_CACHE_CHANNELS.getToken, key),
    saveToken: (key, value) => ipcRenderer.invoke(TOKEN_CACHE_CHANNELS.saveToken, key, value),
    clearToken: (key) => ipcRenderer.invoke(TOKEN_CACHE_CHANNELS.clearToken, key),
  },
  oauthTransport: {
    getRedirectUrl: () => ipcRenderer.invoke(OAUTH_TRANSPORT_CHANNELS.getRedirectUrl),
    open: (url) => ipcRenderer.invoke(OAUTH_TRANSPORT_CHANNELS.open, url),
  },
});

contextBridge.exposeInMainWorld('__glidelingoDesktopUpdates', {
  getSnapshot: () => ipcRenderer.invoke(UPDATE_CHANNELS.getSnapshot),
  subscribe: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const receiveSnapshot = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on(UPDATE_CHANNELS.snapshot, receiveSnapshot);
    return () => ipcRenderer.removeListener(UPDATE_CHANNELS.snapshot, receiveSnapshot);
  },
  retry: () => ipcRenderer.invoke(UPDATE_CHANNELS.retry),
  restartAndInstall: () => ipcRenderer.invoke(UPDATE_CHANNELS.restartAndInstall),
  openOfficialDownloadPage: () => ipcRenderer.invoke(UPDATE_CHANNELS.openOfficialDownloadPage),
});
