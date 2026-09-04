import { describe, expect, it } from '@jest/globals';

import { AnalyticsIdentityController } from '../analytics-identity';

describe('analytics identity transitions', () => {
  it('clears any persisted vendor identity when Clerk first resolves signed out', () => {
    const calls: string[] = [];
    const controller = new AnalyticsIdentityController({
      identify: (id) => { calls.push(`identify:${id}`); return true; },
      reset: () => { calls.push('reset'); },
    }, () => { calls.push('boundary'); });

    controller.synchronize(false, null);
    controller.synchronize(true, null);
    controller.synchronize(true, null);
    controller.synchronize(true, 'user_123');
    controller.synchronize(true, 'user_123');

    expect(calls).toEqual(['boundary', 'reset', 'identify:user_123']);
  });

  it('clears persisted identity before a cold signed-in start', () => {
    const calls: string[] = [];
    const controller = new AnalyticsIdentityController({
      identify: (id) => { calls.push(`identify:${id}`); return true; },
      reset: () => { calls.push('reset'); },
    }, () => { calls.push('boundary'); });

    controller.synchronize(true, 'user_456');

    expect(calls).toEqual(['boundary', 'reset', 'identify:user_456']);
  });

  it('resets exactly once on logout and separates an immediate account switch', () => {
    const calls: string[] = [];
    const controller = new AnalyticsIdentityController({
      identify: (id) => { calls.push(`identify:${id}`); return true; },
      reset: () => { calls.push('reset'); },
    }, () => { calls.push('boundary'); });

    controller.synchronize(true, 'user_123');
    controller.synchronize(true, null);
    controller.synchronize(true, null);
    controller.synchronize(true, 'user_456');
    controller.synchronize(true, 'user_789');

    expect(calls).toEqual([
      'boundary',
      'reset',
      'identify:user_123',
      'boundary',
      'reset',
      'identify:user_456',
      'boundary',
      'reset',
      'identify:user_789',
    ]);
  });
});
