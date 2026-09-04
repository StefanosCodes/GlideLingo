import type { AnalyticsClient } from './analytics-client';
import type { AnalyticsSurface } from './analytics-events';

type ScreenAnalytics = Pick<AnalyticsClient, 'capture'>;

export class AnalyticsScreenSession {
  private activeSince: number | null = null;
  private foreground: boolean;
  private hasViewed = false;
  private surface: AnalyticsSurface | null = null;

  constructor(
    private readonly analytics: ScreenAnalytics,
    initiallyForeground: boolean,
  ) {
    this.foreground = initiallyForeground;
  }

  setSurface(surface: AnalyticsSurface, now: number) {
    if (surface === this.surface) return;
    const entryReason = this.surface === null ? 'initial' : 'navigation';
    if (this.surface && this.activeSince !== null) this.exit('navigation', now);

    this.surface = surface;
    if (this.foreground) this.view(entryReason, now);
  }

  setForeground(foreground: boolean, now: number) {
    if (foreground === this.foreground) return;
    this.foreground = foreground;

    if (!foreground) {
      if (this.surface && this.activeSince !== null) this.exit('background', now);
      return;
    }

    if (this.surface) this.view('foreground', now);
  }

  endIdentitySession(now: number) {
    if (this.surface && this.activeSince !== null) this.exit('identity_change', now);
    this.surface = null;
  }

  private view(reason: 'foreground' | 'initial' | 'navigation', now: number) {
    if (!this.surface || this.activeSince !== null) return;
    this.analytics.capture('screen_viewed', {
      surface: this.surface,
      entry_reason: this.hasViewed ? reason : 'initial',
    });
    this.hasViewed = true;
    this.activeSince = now;
  }

  private exit(reason: 'background' | 'identity_change' | 'navigation', now: number) {
    if (!this.surface || this.activeSince === null) return;
    this.analytics.capture('screen_exited', {
      surface: this.surface,
      exit_reason: reason,
      active_duration_ms: Math.min(86_400_000, Math.max(0, Math.round(now - this.activeSince))),
    });
    this.activeSince = null;
  }
}

export function analyticsSurfaceForPath(pathname: string, lessonActive = false): AnalyticsSurface {
  if (lessonActive && pathname === '/') return 'lesson';
  if (pathname === '/') return 'home';
  if (pathname === '/quests') return 'quests';
  if (pathname === '/letters') return 'letters';
  if (pathname === '/phrases') return 'phrases';
  if (pathname === '/profile') return 'profile';
  if (pathname === '/progress') return 'progress';
  if (pathname === '/review') return 'review';
  if (pathname === '/rhythm') return 'rhythm';
  if (pathname === '/kit') return 'kit';
  if (pathname === '/diagnostics') return 'diagnostics';
  if (pathname === '/subscription') return 'subscription';
  if (pathname === '/sso-callback') return 'sso_callback';
  if (pathname === '/sign-in') return 'auth_sign_in';
  if (pathname === '/sign-up') return 'auth_sign_up';
  if (pathname === '/forgot-password') return 'auth_forgot_password';
  if (pathname.startsWith('/course/')) return 'course_preview';
  if (pathname.startsWith('/lesson/')) return 'lesson';
  return 'unknown';
}
