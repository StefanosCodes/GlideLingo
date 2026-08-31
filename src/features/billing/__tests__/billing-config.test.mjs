import assert from 'node:assert/strict';
import test from 'node:test';

import { selectBillingMode, selectRevenueCatApiKey } from '../billing-config.ts';

test('uses the Test Store key only in development', () => {
  assert.equal(
    selectRevenueCatApiKey({
      development: true,
      platform: 'ios',
      testKey: ' test_public ',
      iosKey: 'ios_public',
    }),
    'test_public',
  );
  assert.equal(
    selectRevenueCatApiKey({
      development: false,
      platform: 'ios',
      testKey: 'test_public',
      iosKey: ' ios_public ',
    }),
    'ios_public',
  );
});

test('prefers an explicit RevenueCat Web key for Web and Electron development', () => {
  assert.equal(
    selectRevenueCatApiKey({
      development: true,
      platform: 'web',
      testKey: 'test_public',
      webKey: ' rcb_web_public ',
    }),
    'rcb_web_public',
  );
});

test('uses the Test Store as a Web fallback only during local development', () => {
  assert.equal(
    selectRevenueCatApiKey({ development: true, platform: 'web', testKey: ' test_public ' }),
    'test_public',
  );
  assert.equal(
    selectRevenueCatApiKey({ development: false, platform: 'web', testKey: 'test_public' }),
    undefined,
  );
});

test('selects a separate public key for each release platform', () => {
  const environment = {
    development: false,
    testKey: 'test_public',
    iosKey: 'ios_public',
    androidKey: 'android_public',
    webKey: 'web_public',
  };

  assert.equal(selectRevenueCatApiKey({ ...environment, platform: 'ios' }), 'ios_public');
  assert.equal(selectRevenueCatApiKey({ ...environment, platform: 'android' }), 'android_public');
  assert.equal(selectRevenueCatApiKey({ ...environment, platform: 'web' }), 'web_public');
});

test('treats empty values as unconfigured', () => {
  assert.equal(selectRevenueCatApiKey({ development: true, platform: 'web', testKey: '  ', webKey: '' }), undefined);
});

test('mock billing requires both development and an explicit opt-in', () => {
  assert.equal(
    selectBillingMode({ development: true, hasApiKey: false, mockBillingEnabled: true }),
    'mock',
  );
  assert.equal(
    selectBillingMode({ development: true, hasApiKey: false, mockBillingEnabled: false }),
    'unavailable',
  );
});

test('release billing fails closed when its platform key is missing', () => {
  assert.equal(
    selectBillingMode({ development: false, hasApiKey: false, mockBillingEnabled: true }),
    'unavailable',
  );
  assert.equal(
    selectBillingMode({ development: false, hasApiKey: true, mockBillingEnabled: false }),
    'revenuecat',
  );
});
