import Constants from 'expo-constants';

import { hasElectronClerkBridge } from '@/providers/electron-bridge';

import type { AnalyticsRuntimeSurface } from './analytics-events';

export function getAnalyticsRuntimeMetadata(): {
  appVersion: string;
  runtimeSurface: AnalyticsRuntimeSurface;
} {
  return {
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    runtimeSurface: hasElectronClerkBridge() ? 'electron' : 'web',
  };
}
