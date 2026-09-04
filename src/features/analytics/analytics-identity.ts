import type { AnalyticsClient } from './analytics-client';

export class AnalyticsIdentityController {
  private authResolved = false;
  private identity: string | null = null;

  constructor(
    private readonly analytics: Pick<AnalyticsClient, 'identify' | 'reset'>,
    private readonly onIdentityBoundary: () => void = () => undefined,
  ) {}

  synchronize(isLoaded: boolean, opaqueUserId: string | null) {
    if (!isLoaded) return;

    if (!this.authResolved) {
      this.authResolved = true;
      this.onIdentityBoundary();
      this.analytics.reset();
      this.identity = opaqueUserId;
      if (opaqueUserId !== null) this.analytics.identify(opaqueUserId);
      return;
    }

    if (opaqueUserId === this.identity) return;

    if (this.identity === null && opaqueUserId !== null) {
      this.identity = opaqueUserId;
      this.analytics.identify(opaqueUserId);
      return;
    }

    this.onIdentityBoundary();
    this.analytics.reset();
    this.identity = opaqueUserId;
    if (opaqueUserId !== null) this.analytics.identify(opaqueUserId);
  }
}
