export type RevenueCatPlatform = 'ios' | 'android' | 'web';

export type RevenueCatKeyEnvironment = {
  development: boolean;
  platform: RevenueCatPlatform;
  testKey?: string;
  iosKey?: string;
  androidKey?: string;
  webKey?: string;
};

export type BillingModeEnvironment = {
  development: boolean;
  hasApiKey: boolean;
  mockBillingEnabled: boolean;
};

function normalized(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function selectRevenueCatApiKey(environment: RevenueCatKeyEnvironment) {
  const testKey = normalized(environment.testKey);
  const webKey = normalized(environment.webKey);

  // Electron resolves the web bundle. Prefer its explicit RevenueCat Billing
  // config even during local development so the real hosted checkout can be
  // exercised. The Test Store remains a local fallback when no web app exists.
  if (environment.platform === 'web') {
    if (webKey) return webKey;
    return environment.development ? testKey : undefined;
  }

  if (environment.development && testKey) return testKey;

  if (environment.platform === 'ios') return normalized(environment.iosKey);
  if (environment.platform === 'android') return normalized(environment.androidKey);
  return undefined;
}

export function selectBillingMode(environment: BillingModeEnvironment) {
  if (environment.hasApiKey) return 'revenuecat' as const;
  if (environment.development && environment.mockBillingEnabled) return 'mock' as const;
  return 'unavailable' as const;
}
