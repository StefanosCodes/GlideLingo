export type RevenueCatPlatform = 'ios' | 'android' | 'web';

export type RevenueCatKeyEnvironment = {
  development: boolean;
  platform: RevenueCatPlatform;
  testKey?: string;
  iosKey?: string;
  androidKey?: string;
  webKey?: string;
};

function normalized(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function selectRevenueCatApiKey(environment: RevenueCatKeyEnvironment) {
  const testKey = normalized(environment.testKey);
  if (environment.development && testKey) return testKey;

  if (environment.platform === 'ios') return normalized(environment.iosKey);
  if (environment.platform === 'android') return normalized(environment.androidKey);
  return normalized(environment.webKey);
}
