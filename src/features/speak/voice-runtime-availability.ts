import { Platform } from 'react-native';

import { hasElectronClerkBridge } from '@/providers/electron-bridge';

export type VoiceRuntimeAvailability = 'available' | 'desktop-unavailable' | 'native-unavailable';

export function resolveVoiceRuntimeAvailability(
  platform: string,
  electronRenderer: boolean,
): VoiceRuntimeAvailability {
  if (platform !== 'web') return 'native-unavailable';
  if (electronRenderer) return 'desktop-unavailable';
  return 'available';
}

export function currentVoiceRuntimeAvailability(): VoiceRuntimeAvailability {
  return resolveVoiceRuntimeAvailability(Platform.OS, hasElectronClerkBridge());
}
