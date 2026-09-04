import type { AnalyticsEnvironment } from './analytics-events';

export const POSTHOG_INGESTION_ORIGINS = [
  'https://eu.i.posthog.com',
  'https://us.i.posthog.com',
] as const;

type AnalyticsDisabledReason =
  | 'invalid-environment'
  | 'invalid-host'
  | 'invalid-public-token'
  | 'local'
  | 'test'
  | 'unconfigured';

export type AnalyticsConfiguration =
  | { enabled: false; reason: AnalyticsDisabledReason }
  | {
      enabled: true;
      environment: AnalyticsEnvironment;
      host: (typeof POSTHOG_INGESTION_ORIGINS)[number];
      publicToken: string;
    };

type AnalyticsConfigurationInput = {
  apiKey?: string;
  environment?: string;
  host?: string;
  isDevelopment: boolean;
  nodeEnvironment?: string;
};

export function resolveAnalyticsConfiguration({
  apiKey,
  environment,
  host,
  isDevelopment,
  nodeEnvironment,
}: AnalyticsConfigurationInput): AnalyticsConfiguration {
  if (nodeEnvironment === 'test') return { enabled: false, reason: 'test' };
  if (isDevelopment || environment === 'local') return { enabled: false, reason: 'local' };
  if (!environment && !apiKey && !host) return { enabled: false, reason: 'unconfigured' };
  if (environment !== 'preview' && environment !== 'staging' && environment !== 'production') {
    return { enabled: false, reason: 'invalid-environment' };
  }

  const publicToken = apiKey?.trim() ?? '';
  if (!/^phc_[A-Za-z0-9_-]+$/.test(publicToken)) {
    return { enabled: false, reason: 'invalid-public-token' };
  }

  const configuredHost = host?.trim() ?? '';
  if (!POSTHOG_INGESTION_ORIGINS.includes(configuredHost as (typeof POSTHOG_INGESTION_ORIGINS)[number])) {
    return { enabled: false, reason: 'invalid-host' };
  }

  return {
    enabled: true,
    environment,
    host: configuredHost as (typeof POSTHOG_INGESTION_ORIGINS)[number],
    publicToken,
  };
}

export function resolveRuntimeAnalyticsConfiguration(): AnalyticsConfiguration {
  return resolveAnalyticsConfiguration({
    apiKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
    environment: process.env.EXPO_PUBLIC_ANALYTICS_ENVIRONMENT,
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
    isDevelopment: __DEV__,
    nodeEnvironment: process.env.NODE_ENV,
  });
}
