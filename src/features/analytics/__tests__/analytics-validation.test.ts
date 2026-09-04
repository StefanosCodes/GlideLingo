import { describe, expect, it } from '@jest/globals';

import { InMemoryAnalyticsAdapter } from '../analytics-adapter';
import { AnalyticsClient } from '../analytics-client';
import { validateAnalyticsEvent } from '../analytics-validation';

const context = {
  analytics_environment: 'staging' as const,
  app_version: '1.2.3',
  runtime_surface: 'ios' as const,
  schema_version: 1 as const,
};

describe('analytics event validation and privacy', () => {
  it('accepts only an exact event-specific property allowlist', () => {
    expect(validateAnalyticsEvent('screen_viewed', { surface: 'home', entry_reason: 'initial' })).not.toBeNull();
    expect(validateAnalyticsEvent('screen_viewed', {
      surface: 'home',
      entry_reason: 'initial',
      route: '/?token=secret',
    })).toBeNull();
    expect(validateAnalyticsEvent('screen_viewed', {
      surface: 'home',
      entry_reason: 'initial',
      constructor: 'not-allowlisted',
    })).toBeNull();
    expect(validateAnalyticsEvent('screen_viewed', {
      surface: 'home',
      entry_reason: 'initial',
      toString: 'not-allowlisted',
    })).toBeNull();
    expect(validateAnalyticsEvent('answer_submitted', {
      lesson_id: 'lesson-1',
      lesson_mode: 'learn',
      beat_index: 2,
      attempt_number: 1,
      result: 'correct',
      raw_answer: 'learner text',
    })).toBeNull();
  });

  it('rejects unknown events, malformed IDs, missing fields, and unbounded values', () => {
    expect(validateAnalyticsEvent('button_clicked', {})).toBeNull();
    expect(validateAnalyticsEvent('course_started', { course_id: 'contains spaces', language_id: 'el' })).toBeNull();
    expect(validateAnalyticsEvent('screen_exited', { surface: 'home', exit_reason: 'navigation' })).toBeNull();
    expect(validateAnalyticsEvent('screen_exited', {
      surface: 'home',
      exit_reason: 'navigation',
      active_duration_ms: 86_400_001,
    })).toBeNull();
  });

  it('passes validated typed properties and controlled context to the adapter', () => {
    const adapter = new InMemoryAnalyticsAdapter();
    const analytics = new AnalyticsClient(adapter, context);

    expect(analytics.capture('screen_viewed', { surface: 'home', entry_reason: 'initial' })).toBe(true);
    expect(adapter.records).toEqual([{
      kind: 'capture',
      name: 'screen_viewed',
      properties: {
        analytics_environment: 'staging',
        app_version: '1.2.3',
        runtime_surface: 'ios',
        schema_version: 1,
        surface: 'home',
        entry_reason: 'initial',
      },
    }]);
  });

  it('contains synchronous and asynchronous adapter failures', async () => {
    const syncFailure = new AnalyticsClient({
      capture() { throw new Error('sync'); },
      identify() { throw new Error('sync'); },
      reset() { throw new Error('sync'); },
    }, context);
    const asyncFailure = new AnalyticsClient({
      async capture() { throw new Error('async'); },
      async identify() { throw new Error('async'); },
      async reset() { throw new Error('async'); },
    }, context);

    expect(() => syncFailure.capture('screen_viewed', { surface: 'home', entry_reason: 'initial' })).not.toThrow();
    expect(() => syncFailure.identify('user_123')).not.toThrow();
    expect(() => syncFailure.reset()).not.toThrow();
    expect(() => asyncFailure.capture('screen_viewed', { surface: 'home', entry_reason: 'initial' })).not.toThrow();
    expect(() => asyncFailure.identify('user_123')).not.toThrow();
    expect(() => asyncFailure.reset()).not.toThrow();
    await Promise.resolve();
  });
});
