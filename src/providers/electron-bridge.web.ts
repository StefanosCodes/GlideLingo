export function hasElectronClerkBridge() {
  return typeof window !== 'undefined' && '__clerk_internal_electron' in window;
}
