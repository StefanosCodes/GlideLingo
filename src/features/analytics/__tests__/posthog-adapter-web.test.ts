import { beforeEach, expect, jest, test } from '@jest/globals';

import { createPostHogAdapter, sanitizePostHogCapture } from '../posthog-adapter.web';

jest.mock('posthog-js', () => ({}));

const mockCapture = jest.fn();
const mockIdentify = jest.fn();
const mockReset = jest.fn();
const mockInitialize = jest.fn(() => ({
  capture: mockCapture,
  identify: mockIdentify,
  reset: mockReset,
}));

beforeEach(() => {
  mockCapture.mockClear();
  mockInitialize.mockClear();
});

test('web and Electron adapter disables autocapture, replay, flags, and unbounded enrichment', () => {
  const adapter = createPostHogAdapter(
    {
      enabled: true,
      environment: 'production',
      host: 'https://eu.i.posthog.com',
      publicToken: 'phc_public_project_token',
    },
    mockInitialize as Parameters<typeof createPostHogAdapter>[1],
  );

  expect(mockInitialize).toHaveBeenCalledWith('phc_public_project_token', expect.objectContaining({
    advanced_disable_flags: true,
    api_host: 'https://eu.i.posthog.com',
    autocapture: false,
    before_send: sanitizePostHogCapture,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_heatmaps: false,
    capture_pageleave: false,
    capture_pageview: false,
    capture_performance: false,
    disable_capture_url_hashes: true,
    disable_external_dependency_loading: true,
    disable_session_recording: true,
    disable_surveys: true,
    ip: false,
    mask_personal_data_properties: true,
    person_profiles: 'identified_only',
    property_denylist: expect.arrayContaining([
      '$current_url',
      '$pathname',
      '$referrer',
      'gclid',
      'utm_source',
    ]),
    rageclick: false,
    request_batching: true,
    save_campaign_params: false,
    save_referrer: false,
  }));
  adapter.capture('screen_viewed', { surface: 'home' });
  expect(mockCapture).toHaveBeenCalledWith('screen_viewed', {
    surface: 'home',
    $geoip_disable: true,
  });
});

test('sanitizes URL, route, referrer, campaign, and person enrichment added by the browser SDK', () => {
  const event = sanitizePostHogCapture({
    uuid: 'event-1',
    event: 'screen_viewed',
    properties: {
      analytics_environment: 'staging',
      surface: 'course_preview',
      $current_url: 'https://desktop.glidelingo.com/course/abc?token=private#secret',
      $session_entry_url: 'https://desktop.glidelingo.com/course/abc?token=private',
      $session_entry_pathname: '/course/abc',
      $session_entry_referrer: 'https://private.example/path',
      $raw_user_agent: 'identifying browser string',
      utm_campaign: 'private-campaign',
    },
    $set: { email: 'private@example.com' },
    $set_once: { $initial_current_url: 'https://private.example' },
  });

  expect(event).toEqual({
    uuid: 'event-1',
    event: 'screen_viewed',
    properties: {
      analytics_environment: 'staging',
      surface: 'course_preview',
    },
  });
});
