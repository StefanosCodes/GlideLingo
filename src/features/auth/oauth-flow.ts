export function selectWebOauthFlow({
  protocol,
  userAgent,
}: {
  protocol: string;
  userAgent: string;
}): 'popup' | 'redirect' {
  const isPackagedElectron =
    userAgent.toLowerCase().includes('electron') && protocol === 'glidelingo:';

  return isPackagedElectron ? 'redirect' : 'popup';
}
