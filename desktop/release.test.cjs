const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDesktopRelease,
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
  GLIDELINGO_BILLING_MODE: 'sandbox',
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
    billingMode: 'sandbox',
    clerkPublishableKey: 'pk_live_publicclientkey',
    revenueCatWebApiKey: 'rcb_publicwebkey',
  });
  assert.throws(
    () => validatePublicBuildConfiguration({ ...apiKeyEnvironment, GLIDELINGO_BILLING_MODE: '' }),
    /BILLING_MODE/,
  );
  assert.throws(
    () => validatePublicBuildConfiguration({ ...apiKeyEnvironment, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: '' }),
    /CLERK_PUBLISHABLE_KEY/,
  );
  assert.throws(
    () => validatePublicBuildConfiguration({ ...apiKeyEnvironment, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_developmentkey' }),
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
  assert.throws(
    () => validateReleaseTag('desktop-v1.2.3-beta.1', '1.2.3-beta.1'),
    /strict numeric SemVer/,
  );
  assert.throws(
    () => validateReleaseTag('desktop-v1.2.3;echo-pwned', '1.2.3;echo-pwned'),
    /strict numeric SemVer/,
  );
});

test('release environment accepts macOS and rejects unsigned or non-macOS builds', () => {
  assert.deepEqual(validateReleaseEnvironment(apiKeyEnvironment, 'darwin'), {
    affiliateReferralsEnabled: false,
    apiOrigin: 'https://api.glidelingo.com',
    billingMode: 'sandbox',
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

test('release packaging embeds one default-off referral flag with the validated configuration', () => {
  const calls = [];
  buildDesktopRelease(
    apiKeyEnvironment,
    (command, args, environment) => {
      calls.push({ command, args, environment });
    },
    'darwin',
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ['run', 'desktop:export']);
  assert.ok(
    calls[1].args.includes('--config.extraMetadata.glidelingoAffiliateReferralsEnabled=false'),
  );
  assert.ok(
    calls[1].args.includes('--config.extraMetadata.glidelingoBillingMode=sandbox'),
  );
  assert.ok(
    calls[1].args.includes('--config.extraMetadata.glidelingoApiOrigin=https://api.glidelingo.com'),
  );
  assert.ok(
    calls[1].args.includes('--config.extraMetadata.glidelingoClerkOrigin=https://clerk.glidelingo.com'),
  );

  const enabledCalls = [];
  buildDesktopRelease(
    { ...apiKeyEnvironment, EXPO_PUBLIC_AFFILIATE_REFERRALS_ENABLED: 'true' },
    (command, args, environment) => enabledCalls.push({ command, args, environment }),
    'darwin',
  );
  assert.ok(
    enabledCalls[1].args.includes('--config.extraMetadata.glidelingoAffiliateReferralsEnabled=true'),
  );
});
