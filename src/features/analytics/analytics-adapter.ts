export type AnalyticsAdapterProperties = Record<string, boolean | number | string>;

export interface AnalyticsAdapter {
  capture(name: string, properties: AnalyticsAdapterProperties): Promise<void> | void;
  identify(opaqueUserId: string): Promise<void> | void;
  reset(): Promise<void> | void;
}

export class NoopAnalyticsAdapter implements AnalyticsAdapter {
  capture() {}
  identify() {}
  reset() {}
}

export type InMemoryAnalyticsRecord =
  | { kind: 'capture'; name: string; properties: AnalyticsAdapterProperties }
  | { kind: 'identify'; opaqueUserId: string }
  | { kind: 'reset' };

export class InMemoryAnalyticsAdapter implements AnalyticsAdapter {
  readonly records: InMemoryAnalyticsRecord[] = [];

  capture(name: string, properties: AnalyticsAdapterProperties) {
    this.records.push({ kind: 'capture', name, properties: { ...properties } });
  }

  identify(opaqueUserId: string) {
    this.records.push({ kind: 'identify', opaqueUserId });
  }

  reset() {
    this.records.push({ kind: 'reset' });
  }
}
