const CANCELLATION_CODES = new Set([
  'access_denied',
  'canceled',
  'cancelled',
  'user_canceled',
  'user_cancelled',
]);

export function wasSsoCallbackCancelled(callbackUrl: string): boolean {
  let url: URL;

  try {
    url = new URL(callbackUrl);
  } catch {
    return false;
  }

  const parameters = new URLSearchParams(url.search);
  const hashQueryStart = url.hash.indexOf('?');
  if (hashQueryStart >= 0) {
    const hashParameters = new URLSearchParams(url.hash.slice(hashQueryStart + 1));
    hashParameters.forEach((value, name) => parameters.append(name, value));
  }

  const errorCode = parameters.get('error')?.trim().toLowerCase();
  if (errorCode && CANCELLATION_CODES.has(errorCode)) return true;

  const description = parameters.get('error_description')?.trim().toLowerCase();
  return description?.includes('cancel') ?? false;
}

export function rotatingTokenNonceFromSsoCallback(callbackUrl: string): string | null {
  let url: URL;

  try {
    url = new URL(callbackUrl);
  } catch {
    return null;
  }

  const nonce = url.searchParams.get('rotating_token_nonce');
  return nonce && nonce.length <= 2048 ? nonce : null;
}
