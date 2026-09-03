export function hasElectronClerkBridge() {
  return typeof window !== 'undefined' && '__clerk_internal_electron' in window;
}

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

export function shouldUseElectronClerkNativeAuth() {
  if (!hasElectronClerkBridge()) return false;
  if (typeof window === 'undefined') return false;

  const { hostname, protocol } = window.location;
  if ((protocol === 'http:' || protocol === 'https:') && isLoopbackHost(hostname)) {
    return false;
  }

  return true;
}
