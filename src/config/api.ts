import * as Device from 'expo-device';
import { Platform, type PlatformOSType } from 'react-native';

export type ApiConfigurationErrorReason =
  | 'missing-production-url'
  | 'missing-physical-device-url'
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'insecure-production-url'
  | 'credentials-not-allowed'
  | 'query-or-fragment-not-allowed';

export type ApiRuntimeConfiguration = {
  origin: string;
  platform: PlatformOSType;
  source: 'environment' | 'development-default';
};

export class ApiConfigurationError extends Error {
  readonly platform: PlatformOSType;
  readonly reason: ApiConfigurationErrorReason;

  constructor(reason: ApiConfigurationErrorReason, platform: PlatformOSType) {
    super('The API base URL is not configured correctly.');
    this.name = 'ApiConfigurationError';
    this.platform = platform;
    this.reason = reason;
  }
}

/**
 * Resolve the one public, non-secret value the client needs to reach the API.
 * EXPO_PUBLIC values are embedded in the shipped bundle and must never contain secrets.
 */
export function resolveApiRuntimeConfiguration(): ApiRuntimeConfiguration {
  const platform = Platform.OS;
  const configuredValue = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  if (!configuredValue) {
    if (!__DEV__) {
      throw new ApiConfigurationError('missing-production-url', platform);
    }
    if ((platform === 'android' || platform === 'ios') && Device.isDevice) {
      throw new ApiConfigurationError('missing-physical-device-url', platform);
    }

    return {
      origin: platform === 'android' ? 'http://10.0.2.2:8123' : 'http://localhost:8123',
      platform,
      source: 'development-default',
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(configuredValue);
  } catch {
    throw new ApiConfigurationError('invalid-url', platform);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ApiConfigurationError('unsupported-protocol', platform);
  }
  if (!__DEV__ && parsedUrl.protocol !== 'https:') {
    throw new ApiConfigurationError('insecure-production-url', platform);
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new ApiConfigurationError('credentials-not-allowed', platform);
  }
  if (parsedUrl.search || parsedUrl.hash) {
    throw new ApiConfigurationError('query-or-fragment-not-allowed', platform);
  }

  const normalizedPath = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname.replace(/\/+$/, '');

  return {
    origin: `${parsedUrl.origin}${normalizedPath}`,
    platform,
    source: 'environment',
  };
}
