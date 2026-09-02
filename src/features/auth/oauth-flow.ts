export const DESKTOP_AUTH_CALLBACK_URL = 'glidelingo://app/sso-callback';
export const ALLOWED_AUTH_REDIRECT_ORIGINS = [/^null$/];
export const ALLOWED_AUTH_REDIRECT_PROTOCOLS = ['glidelingo:'];

export function selectWebOauthFlow({
  protocol,
  userAgent,
}: {
  protocol: string;
  userAgent: string;
}): 'popup' | 'redirect' {
  const isPackagedElectron =
    userAgent.toLowerCase().includes('electron') && protocol === 'https:';

  return isPackagedElectron ? 'redirect' : 'popup';
}
