import { describe, expect, it, jest } from '@jest/globals';

import { InMemoryAnalyticsAdapter } from '../analytics-adapter';
import { createAnalyticsClient } from '../runtime-client';

describe('runtime analytics client', () => {
  it('never constructs a vendor adapter when analytics is disabled', () => {
    const factory = jest.fn(() => new InMemoryAnalyticsAdapter());
    const analytics = createAnalyticsClient(
      { enabled: false, reason: 'local' },
      { appVersion: '1.0.0', runtimeSurface: 'web' },
      factory,
    );

    expect(() => analytics.capture('screen_viewed', { surface: 'home', entry_reason: 'initial' })).not.toThrow();
    expect(factory).not.toHaveBeenCalled();
  });

  it('falls back to disabled behavior when vendor initialization fails', () => {
    const analytics = createAnalyticsClient(
      {
        enabled: true,
        environment: 'preview',
        host: 'https://eu.i.posthog.com',
        publicToken: 'phc_public_project_token',
      },
      { appVersion: '1.0.0', runtimeSurface: 'electron' },
      () => { throw new Error('vendor unavailable'); },
    );

    expect(() => analytics.capture('screen_viewed', { surface: 'home', entry_reason: 'initial' })).not.toThrow();
  });
});
