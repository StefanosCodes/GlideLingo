import posthogClient from 'posthog-js';

import type { AnalyticsAdapter, AnalyticsAdapterProperties } from './analytics-adapter';
import type { AnalyticsConfiguration } from './analytics-config';

type WebPostHogClient = Pick<NonNullable<ReturnType<typeof posthogClient.init>>, 'capture' | 'identify' | 'reset'>;
type WebPostHogInitializer = (
  token: string,
  config?: Parameters<typeof posthogClient.init>[1],
) => WebPostHogClient | undefined;

type SanitizablePostHogEvent = {
  properties: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
  $unset?: string[];
};

const ATTRIBUTION_PROPERTY_NAMES = new Set([
  'dclid',
  'fbclid',
  'gad_source',
  'gbraid',
  'gclid',
  'msclkid',
  'twclid',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
  'wbraid',
]);

function isUnsafeVendorProperty(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === '$host'
    || normalized === '$pathname'
    || normalized === '$raw_user_agent'
    || normalized === '$referrer'
    || normalized === '$referring_domain'
    || normalized.includes('campaign')
    || normalized.includes('query')
    || normalized.includes('url')
    || normalized.includes('pathname')
    || normalized.includes('referrer')
    || normalized.includes('referring_domain')
    || normalized.startsWith('$initial_')
    || normalized.startsWith('$session_entry_')
    || ATTRIBUTION_PROPERTY_NAMES.has(normalized);
}

export function sanitizePostHogCapture<Event extends SanitizablePostHogEvent | null>(event: Event): Event {
  if (!event) return event;
  const { $set: _set, $set_once: _setOnce, $unset: _unset, ...safeEvent } = event;
  const properties = Object.fromEntries(
    Object.entries(event.properties).filter(([name]) => !isUnsafeVendorProperty(name)),
  );
  return { ...safeEvent, properties } as Event;
}

export function createPostHogAdapter(
  configuration: Extract<AnalyticsConfiguration, { enabled: true }>,
  initialize: WebPostHogInitializer = (token, config) => posthogClient.init(token, config),
): AnalyticsAdapter {
  const instance = initialize(configuration.publicToken, {
    advanced_disable_flags: true,
    api_host: configuration.host,
    autocapture: false,
    before_send: sanitizePostHogCapture,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_heatmaps: false,
    capture_pageleave: false,
    capture_pageview: false,
    capture_performance: false,
    cross_subdomain_cookie: false,
    disableDeviceModel: true,
    disable_capture_url_hashes: true,
    disable_external_dependency_loading: true,
    disable_session_recording: true,
    disable_surveys: true,
    ip: false,
    mask_personal_data_properties: true,
    persistence: 'localStorage',
    person_profiles: 'identified_only',
    property_denylist: [
      '$current_url',
      '$host',
      '$initial_current_url',
      '$initial_referrer',
      '$initial_referring_domain',
      '$pathname',
      '$referrer',
      '$referring_domain',
      'gclid',
      'utm_campaign',
      'utm_content',
      'utm_medium',
      'utm_source',
      'utm_term',
    ],
    rageclick: false,
    request_batching: true,
    save_campaign_params: false,
    save_referrer: false,
  });

  if (!instance) throw new Error('PostHog did not initialize.');

  return {
    capture(name: string, properties: AnalyticsAdapterProperties) {
      instance.capture(name, { ...properties, $geoip_disable: true });
    },
    identify(opaqueUserId: string) {
      instance.identify(opaqueUserId);
    },
    reset() {
      instance.reset();
    },
  };
}
