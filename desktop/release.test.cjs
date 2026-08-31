const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveProductionApiOrigin,
  resolveProductionClerkOrigin,
  validateNotarizationCredentials,
  validatePublicBuildConfiguration,
  validateReleaseEnvironment,
  validateReleaseTag,
} = require('./release.cjs');

const apiKeyEnvironment = {
  APPLE_API_ISSUER: 'issuer-id',
  APPLE_API_KEY: '/tmp/AuthKey_TEST.p8',
  APPLE_API_KEY_ID: 'TESTKEY123',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.glidelingo.com/v1',
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_publicclientkey',
  EXPO_PUBLIC_REVENUECAT_WEB_API_KEY: 'rcb_publicwebkey',
  GLIDELINGO_CLERK_ORIGIN: 'https://clerk.glidelingo.com',
};

test('release API configuration returns the exact HTTPS origin used by Electron CSP', () => {
  assert.equal(
    resolveProductionApiOrigin('https://api.glidelingo.com/v1/'),
    'https://api.glidelingo.com',
  );
  assert.throws(() => resolveProductionApiOrigin('http://api.glidelingo.com'));
  assert.throws(() => resolveProductionApiOrigin('https://api.glidelingo.com?debug=true'));
  assert.throws(() => resolveProductionApiOrigin(''));
});

test('release Clerk configuration returns one exact HTTPS origin', () => {
  assert.equal(
    resolveProductionClerkOrigin('https://clerk.glidelingo.com'),
    'https://clerk.glidelingo.com',
  );
  assert.throws(() => resolveProductionClerkOrigin('http://clerk.glidelingo.com'));
  assert.throws(() => resolveProductionClerkOrigin('https://clerk.glidelingo.com/path'));
  assert.throws(() => resolveProductionClerkOrigin(''));
});

test('release validation requires public Clerk and RevenueCat web keys and rejects mock billing', () => {
  assert.deepEqual(validatePublicBuildConfiguration(apiKeyEnvironment), {
    clerkPublishableKey: 'pk_live_publicclientkey',
    revenueCatWebApiKey: 'rcb_publicwebkey',
  });
  assert.throws(
    () => validatePublicBuildConfiguration({ ...apiKeyEnvironment, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: '' }),
    /CLERK_PUBLISHABLE_KEY/,
  );
  assert.throws(
    () => validatePublicBuildConfiguration({ ...apiKeyEnvironment, EXPO_PUBLIC_REVENUECAT_WEB_API_KEY: 'sk_secret' }),
    /REVENUECAT_WEB_API_KEY/,
  );
  assert.throws(
    () => validatePublicBuildConfiguration({ ...apiKeyEnvironment, EXPO_PUBLIC_ENABLE_MOCK_BILLING: 'true' }),
    /Mock billing must remain disabled/,
  );
});

test('release validation requires one complete notarization credential set', () => {
  assert.doesNotThrow(() => validateNotarizationCredentials(apiKeyEnvironment));
  assert.doesNotThrow(() =>
    validateNotarizationCredentials({
      APPLE_APP_SPECIFIC_PASSWORD: 'not-a-real-password',
      APPLE_ID: 'developer@example.com',
      APPLE_TEAM_ID: 'TEAM123456',
    }),
  );
  assert.throws(
    () => validateNotarizationCredentials({ APPLE_API_KEY_ID: 'TESTKEY123' }),
    /Incomplete notarization credentials/,
  );
  assert.throws(() => validateNotarizationCredentials({}), /credentials are required/);
});

test('release tag must match the packaged desktop version', () => {
  assert.doesNotThrow(() => validateReleaseTag(undefined, '1.2.3'));
  assert.doesNotThrow(() => validateReleaseTag('desktop-v1.2.3', '1.2.3'));
  assert.throws(() => validateReleaseTag('desktop-v1.2.4', '1.2.3'), /must match/);
});

test('release environment accepts macOS and rejects unsigned or non-macOS builds', () => {
  assert.deepEqual(validateReleaseEnvironment(apiKeyEnvironment, 'darwin'), {
    apiOrigin: 'https://api.glidelingo.com',
    clerkOrigin: 'https://clerk.glidelingo.com',
  });
  assert.throws(() => validateReleaseEnvironment(apiKeyEnvironment, 'linux'), /built on macOS/);
  assert.throws(
    () =>
      validateReleaseEnvironment(
        { ...apiKeyEnvironment, EXPO_PUBLIC_API_BASE_URL: '' },
        'darwin',
      ),
    /must be set/,
  );
});
