import { DESKTOP_AUTH_CALLBACK_URL } from './oauth-flow.ts';

const PACKAGED_DESKTOP_ORIGIN = 'https://desktop.glidelingo.com';

type DesktopOAuthBridge = {
  open: (targetUrl: string) => Promise<{ callbackUrl: string }>;
};

type DesktopOAuthTransport = {
  getRedirectUrl: () => string;
  open: (url: URL) => Promise<{ callbackUrl: string }>;
};

declare global {
  interface Window {
    glideLingoDesktopAuth?: DesktopOAuthBridge;
  }
}

let desktopOAuthTransport: DesktopOAuthTransport | undefined;

// Clerk's Electron/Tauri transport contract is intentionally internal. Keep
// @clerk/expo pinned to 4.6.1 and re-run packaged OAuth tests before upgrading.
export function getDesktopOAuthTransport(): DesktopOAuthTransport | undefined {
  if (
    typeof window === 'undefined' ||
    window.location.origin !== PACKAGED_DESKTOP_ORIGIN ||
    !window.glideLingoDesktopAuth
  ) {
    return undefined;
  }

  desktopOAuthTransport ??= {
    getRedirectUrl: () => DESKTOP_AUTH_CALLBACK_URL,
    open: async (url) => {
      const result = await window.glideLingoDesktopAuth!.open(url.toString());
      if (!isExactDesktopOAuthCallback(result.callbackUrl)) {
        throw new Error('The desktop OAuth callback did not match GlideLingo.');
      }
      return result;
    },
  };

  return desktopOAuthTransport;
}

export function isExactDesktopOAuthCallback(value: string): boolean {
  if (typeof value !== 'string' || value.length > 4096) return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === 'glidelingo:' &&
      url.hostname === 'app' &&
      url.pathname === '/sso-callback' &&
      !url.port &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
