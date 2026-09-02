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
