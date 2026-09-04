import PostHog, { type PostHogOptions } from 'posthog-react-native';

import type { AnalyticsAdapter, AnalyticsAdapterProperties } from './analytics-adapter';
import type { AnalyticsConfiguration } from './analytics-config';

export function createPostHogAdapter(
  configuration: Extract<AnalyticsConfiguration, { enabled: true }>,
  createClient: (publicToken: string, options: PostHogOptions) => Pick<PostHog, 'capture' | 'identify' | 'reset'> =
    (publicToken, options) => new PostHog(publicToken, options),
): AnalyticsAdapter {
  const posthog = createClient(configuration.publicToken, {
    captureAppLifecycleEvents: false,
    capturePushNotificationOpened: false,
    capturePushNotificationSubscriptions: false,
    disableRemoteFeatureFlags: true,
    disableSurveys: true,
    enableSessionReplay: false,
    errorTracking: { autocapture: false, exceptionSteps: { enabled: false } },
    flushAt: 20,
    flushInterval: 10_000,
    host: configuration.host,
    maxQueueSize: 1_000,
    persistence: 'memory',
    preloadFeatureFlags: false,
    setDefaultPersonProperties: false,
  });

  return {
    capture(name: string, properties: AnalyticsAdapterProperties) {
      return posthog.capture(name, { ...properties, $geoip_disable: true });
    },
    identify(opaqueUserId: string) {
      return posthog.identify(opaqueUserId);
    },
    reset() {
      return posthog.reset();
    },
  };
}
