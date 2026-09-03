export const DESKTOP_AUTH_CALLBACK_URL = 'glidelingo://app/';
// Clerk represents every opaque custom-protocol URL with the string origin
// "null". This is only the SDK's coarse prefilter; Electron's main process is
// authoritative and accepts only the exact glidelingo://app callback routes.
export const CLERK_ALLOWED_OPAQUE_REDIRECT_ORIGINS = [/^null$/];
export const ALLOWED_AUTH_REDIRECT_PROTOCOLS = ['glidelingo:'];

export function selectWebOauthFlow({
  usesElectronNativeAuth,
}: {
  usesElectronNativeAuth: boolean;
}): 'popup' | 'redirect' {
  return usesElectronNativeAuth ? 'redirect' : 'popup';
}
