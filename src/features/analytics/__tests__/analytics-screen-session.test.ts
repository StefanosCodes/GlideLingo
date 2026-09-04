import { describe, expect, it } from '@jest/globals';

import type { AnalyticsEventName, AnalyticsEventProperties } from '../analytics-events';
import { analyticsSurfaceForPath, AnalyticsScreenSession } from '../analytics-screen-session';

type Capture = {
  [Name in AnalyticsEventName]: { name: Name; properties: AnalyticsEventProperties[Name] };
}[AnalyticsEventName];

function recorder() {
  const events: Capture[] = [];
  return {
    events,
    analytics: {
      capture<Name extends AnalyticsEventName>(name: Name, properties: AnalyticsEventProperties[Name]) {
        events.push({ name, properties } as Capture);
        return true;
      },
    },
  };
}

describe('semantic screen and foreground sessions', () => {
  it('maps paths to stable surfaces without retaining dynamic routes or query values', () => {
    expect(analyticsSurfaceForPath('/course/el-a1?ref=private')).toBe('course_preview');
    expect(analyticsSurfaceForPath('/lesson/el-letters-1')).toBe('lesson');
    expect(analyticsSurfaceForPath('/not-a-product-surface?token=private')).toBe('unknown');
    expect(analyticsSurfaceForPath('/', true)).toBe('lesson');
    expect(analyticsSurfaceForPath('/subscription', true)).toBe('subscription');
  });

  it('emits each semantic navigation transition exactly once', () => {
    const { analytics, events } = recorder();
    const session = new AnalyticsScreenSession(analytics, true);

    session.setSurface('home', 1_000);
    session.setSurface('home', 1_500);
    session.setSurface('quests', 2_000);
    session.setSurface('quests', 2_500);

    expect(events).toEqual([
      { name: 'screen_viewed', properties: { surface: 'home', entry_reason: 'initial' } },
      {
        name: 'screen_exited',
        properties: { surface: 'home', exit_reason: 'navigation', active_duration_ms: 1_000 },
      },
      { name: 'screen_viewed', properties: { surface: 'quests', entry_reason: 'navigation' } },
    ]);
  });

  it('counts only foreground time and ignores duplicate AppState signals', () => {
    const { analytics, events } = recorder();
    const session = new AnalyticsScreenSession(analytics, true);

    session.setSurface('home', 1_000);
    session.setForeground(false, 3_000);
    session.setForeground(false, 4_000);
    session.setForeground(true, 13_000);
    session.setForeground(true, 14_000);
    session.setSurface('profile', 16_000);

    expect(events).toEqual([
      { name: 'screen_viewed', properties: { surface: 'home', entry_reason: 'initial' } },
      {
        name: 'screen_exited',
        properties: { surface: 'home', exit_reason: 'background', active_duration_ms: 2_000 },
      },
      { name: 'screen_viewed', properties: { surface: 'home', entry_reason: 'foreground' } },
      {
        name: 'screen_exited',
        properties: { surface: 'home', exit_reason: 'navigation', active_duration_ms: 3_000 },
      },
      { name: 'screen_viewed', properties: { surface: 'profile', entry_reason: 'navigation' } },
    ]);
  });

  it('emits an initial view when AppState becomes known after startup', () => {
    const { analytics, events } = recorder();
    const session = new AnalyticsScreenSession(analytics, false);

    session.setSurface('auth_sign_in', 1_000);
    session.setForeground(true, 2_000);

    expect(events).toEqual([
      { name: 'screen_viewed', properties: { surface: 'auth_sign_in', entry_reason: 'initial' } },
    ]);
  });

  it('closes a screen segment before an authenticated identity is replaced', () => {
    const { analytics, events } = recorder();
    const session = new AnalyticsScreenSession(analytics, true);

    session.setSurface('home', 1_000);
    session.endIdentitySession(2_500);
    session.setSurface('home', 3_000);

    expect(events).toEqual([
      { name: 'screen_viewed', properties: { surface: 'home', entry_reason: 'initial' } },
      {
        name: 'screen_exited',
        properties: { surface: 'home', exit_reason: 'identity_change', active_duration_ms: 1_500 },
      },
      { name: 'screen_viewed', properties: { surface: 'home', entry_reason: 'initial' } },
    ]);
  });
});
