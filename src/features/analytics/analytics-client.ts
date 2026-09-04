import type { AnalyticsAdapter } from './analytics-adapter';
import type {
  AnalyticsContextProperties,
  AnalyticsEventName,
  AnalyticsEventProperties,
} from './analytics-events';
import { validateAnalyticsEvent } from './analytics-validation';

function safelyRun(operation: () => Promise<void> | void) {
  try {
    const result = operation();
    if (result && typeof result.catch === 'function') void result.catch(() => undefined);
  } catch {
    // Behavioral analytics is best effort and must never affect product behavior.
  }
}

export class AnalyticsClient {
  constructor(
    private readonly adapter: AnalyticsAdapter,
    private readonly context: AnalyticsContextProperties,
  ) {}

  capture<Name extends AnalyticsEventName>(
    name: Name,
    properties: AnalyticsEventProperties[Name],
  ): boolean {
    let event;
    try {
      event = validateAnalyticsEvent(name, properties);
    } catch {
      return false;
    }
    if (!event) return false;

    safelyRun(() => this.adapter.capture(event.name, { ...this.context, ...event.properties }));
    return true;
  }

  identify(opaqueUserId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(opaqueUserId)) return false;
    safelyRun(() => this.adapter.identify(opaqueUserId));
    return true;
  }

  reset() {
    safelyRun(() => this.adapter.reset());
  }
}
