import assert from 'node:assert/strict';
import test from 'node:test';

import { selectRevenueCatApiKey } from '../billing-config.ts';

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
