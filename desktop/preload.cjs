const { contextBridge, ipcRenderer } = require('electron');

const OAUTH_OPEN_CHANNEL = 'glidelingo:oauth:open';

contextBridge.exposeInMainWorld(
  'glideLingoDesktopAuth',
  Object.freeze({
    open: async (targetUrl) => {
      if (typeof targetUrl !== 'string' || targetUrl.length > 8192) {
        throw new Error('The desktop OAuth URL was invalid.');
      }

      const result = await ipcRenderer.invoke(OAUTH_OPEN_CHANNEL, targetUrl);
      if (
        !result ||
        typeof result !== 'object' ||
        typeof result.callbackUrl !== 'string' ||
        result.callbackUrl.length > 4096
      ) {
        throw new Error('The desktop OAuth callback was invalid.');
      }

      return { callbackUrl: result.callbackUrl };
    },
  }),
);
