import { describe, expect, it } from '@jest/globals';

import { resolveAnalyticsConfiguration } from '../analytics-config';

const configured = {
  apiKey: 'phc_public_project_token',
  environment: 'staging',
  host: 'https://us.i.posthog.com',
  isDevelopment: false,
  nodeEnvironment: 'production',
};

describe('analytics configuration', () => {
  it('always disables local and test environments even when a token is present', () => {
    expect(resolveAnalyticsConfiguration({ ...configured, isDevelopment: true })).toEqual({
      enabled: false,
      reason: 'local',
    });
    expect(resolveAnalyticsConfiguration({ ...configured, nodeEnvironment: 'test' })).toEqual({
      enabled: false,
      reason: 'test',
    });
  });

  it('fails open to disabled when configuration is absent or invalid', () => {
    expect(resolveAnalyticsConfiguration({ isDevelopment: false })).toEqual({
      enabled: false,
      reason: 'unconfigured',
    });
    expect(resolveAnalyticsConfiguration({ ...configured, apiKey: 'secret-server-key' })).toEqual({
      enabled: false,
      reason: 'invalid-public-token',
    });
    expect(resolveAnalyticsConfiguration({ ...configured, host: 'https://posthog.example.com' })).toEqual({
      enabled: false,
      reason: 'invalid-host',
    });
  });

  it('accepts explicit preview, staging, and production project configuration', () => {
    for (const environment of ['preview', 'staging', 'production'] as const) {
      expect(resolveAnalyticsConfiguration({ ...configured, environment })).toEqual({
        enabled: true,
        environment,
        host: 'https://us.i.posthog.com',
        publicToken: 'phc_public_project_token',
      });
    }
  });
});
