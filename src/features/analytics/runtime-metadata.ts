import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { AnalyticsRuntimeSurface } from './analytics-events';

export function getAnalyticsRuntimeMetadata(): {
  appVersion: string;
  runtimeSurface: AnalyticsRuntimeSurface;
} {
  const runtimeSurface = Platform.OS === 'ios' ? 'ios' : 'android';
  return {
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'unknown',
    runtimeSurface,
  };
}
