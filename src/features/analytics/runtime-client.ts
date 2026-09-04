import { NoopAnalyticsAdapter, type AnalyticsAdapter } from './analytics-adapter';
import { AnalyticsClient } from './analytics-client';
import {
  resolveRuntimeAnalyticsConfiguration,
  type AnalyticsConfiguration,
} from './analytics-config';
import { createPostHogAdapter } from './posthog-adapter';
import { getAnalyticsRuntimeMetadata } from './runtime-metadata';

type AdapterFactory = (
  configuration: Extract<AnalyticsConfiguration, { enabled: true }>,
) => AnalyticsAdapter;

export function createAnalyticsClient(
  configuration: AnalyticsConfiguration,
  metadata: ReturnType<typeof getAnalyticsRuntimeMetadata>,
  adapterFactory: AdapterFactory = createPostHogAdapter,
): AnalyticsClient {
  if (!configuration.enabled) {
    return new AnalyticsClient(new NoopAnalyticsAdapter(), {
      analytics_environment: 'preview',
      app_version: metadata.appVersion,
      runtime_surface: metadata.runtimeSurface,
      schema_version: 1,
    });
  }

  let adapter: AnalyticsAdapter;
  try {
    adapter = adapterFactory(configuration);
  } catch {
    adapter = new NoopAnalyticsAdapter();
  }

  return new AnalyticsClient(adapter, {
    analytics_environment: configuration.environment,
    app_version: metadata.appVersion,
    runtime_surface: metadata.runtimeSurface,
    schema_version: 1,
  });
}

export function createRuntimeAnalyticsClient() {
  try {
    return createAnalyticsClient(
      resolveRuntimeAnalyticsConfiguration(),
      getAnalyticsRuntimeMetadata(),
    );
  } catch {
    return new AnalyticsClient(new NoopAnalyticsAdapter(), {
      analytics_environment: 'preview',
      app_version: 'unknown',
      runtime_surface: 'web',
      schema_version: 1,
    });
  }
}
