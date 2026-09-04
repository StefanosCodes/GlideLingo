import { beforeEach, expect, jest, test } from '@jest/globals';

import { createPostHogAdapter } from '../posthog-adapter';

const mockCapture = jest.fn();
const mockIdentify = jest.fn();
const mockReset = jest.fn();
const mockCreateClient = jest.fn(() => ({
  capture: mockCapture,
  identify: mockIdentify,
  reset: mockReset,
}));

beforeEach(() => {
  mockCapture.mockClear();
  mockCreateClient.mockClear();
});

test('native adapter disables automatic collection and uses a bounded batch queue', () => {
  const adapter = createPostHogAdapter(
    {
      enabled: true,
      environment: 'staging',
      host: 'https://us.i.posthog.com',
      publicToken: 'phc_public_project_token',
    },
    mockCreateClient,
  );

  expect(mockCreateClient).toHaveBeenCalledWith('phc_public_project_token', expect.objectContaining({
    captureAppLifecycleEvents: false,
    capturePushNotificationOpened: false,
    capturePushNotificationSubscriptions: false,
    disableRemoteFeatureFlags: true,
    disableSurveys: true,
    enableSessionReplay: false,
    errorTracking: { autocapture: false, exceptionSteps: { enabled: false } },
    flushAt: 20,
    flushInterval: 10_000,
    host: 'https://us.i.posthog.com',
    maxQueueSize: 1_000,
    persistence: 'memory',
    preloadFeatureFlags: false,
    setDefaultPersonProperties: false,
  }));
  adapter.capture('screen_viewed', { surface: 'home' });
  expect(mockCapture).toHaveBeenCalledWith('screen_viewed', {
    surface: 'home',
    $geoip_disable: true,
  });
});
