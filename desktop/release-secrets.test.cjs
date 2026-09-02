const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  FIXED_SECRET_IDS,
  SECRET_VERSION_VARIABLES,
  loadProductionIdentity,
  resolveBillingMode,
  validateGcpReleaseConfiguration,
  validateProductionIdentity,
  validateSecretVersionSelector,
} = require('./release-secrets.cjs');

const projectId = 'glidelingo-prod-50843312405';
const productionIdentity = {
  project_id: projectId,
  project_number: '123456789012',
  workload_identity_pool_id: 'github-actions',
  release_provider_id: 'desktop-release',
  release_service_account_id: 'glidelingo-desktop-releaser',
};

function releaseConfiguration(overrides = {}) {
  const environment = {
    GLIDELINGO_BILLING_MODE: 'sandbox',
    GLIDELINGO_GCP_DESKTOP_RELEASE_SERVICE_ACCOUNT:
      `glidelingo-desktop-releaser@${projectId}.iam.gserviceaccount.com`,
    GLIDELINGO_GCP_PROJECT_ID: projectId,
    GLIDELINGO_GCP_WORKLOAD_IDENTITY_PROVIDER:
      'projects/123456789012/locations/global/workloadIdentityPools/github-actions/providers/desktop-release',
  };

  for (const [index, name] of SECRET_VERSION_VARIABLES.entries()) {
    const secretId = name === 'GLIDELINGO_REVENUECAT_WEB_API_KEY_SECRET_VERSION'
      ? 'glidelingo-revenuecat-sandbox-web-public-key'
      : FIXED_SECRET_IDS[name];
    environment[name] = `projects/${projectId}/secrets/${secretId}/versions/${index + 1}`;
  }

  return { ...environment, ...overrides };
}

function validate(environment = releaseConfiguration(), identity = productionIdentity) {
  return validateGcpReleaseConfiguration(environment, identity);
}

test('billing mode is explicit and fail closed', () => {
  assert.equal(resolveBillingMode('sandbox'), 'sandbox');
  assert.equal(resolveBillingMode('production'), 'production');
  assert.throws(() => resolveBillingMode('SANDBOX'), /exactly sandbox or production/);
  assert.throws(() => resolveBillingMode(''), /exactly sandbox or production/);
});

test('GCP release configuration accepts only same-project pinned secret versions', () => {
  const validated = validate();
  assert.equal(validated.projectId, projectId);
  assert.equal(validated.billingMode, 'sandbox');
  assert.equal(
    validated.selectors.GLIDELINGO_MACOS_CERTIFICATE_SECRET_VERSION.version,
    '1',
  );

  assert.throws(
    () => validateSecretVersionSelector('TEST_SECRET', `${projectId}/secret`, projectId),
    /full Secret Manager resource/,
  );
  assert.throws(
    () =>
      validate(
        releaseConfiguration({
          GLIDELINGO_APPLE_ID_SECRET_VERSION:
            `projects/${projectId}/secrets/apple-id/versions/latest`,
        }),
      ),
    /positive numeric version/,
  );
  assert.throws(
    () =>
      validate(
        releaseConfiguration({
          GLIDELINGO_APPLE_ID_SECRET_VERSION:
            'projects/glidelingo-development/secrets/apple-id/versions/1',
        }),
      ),
    /pinned to a positive numeric version/,
  );
  assert.throws(
    () =>
      validate(
        releaseConfiguration({
          GLIDELINGO_APPLE_ID_SECRET_VERSION:
            `projects/${projectId}/secrets/shared-apple-id/versions/1`,
        }),
      ),
    /dedicated glidelingo-desktop-apple-id container/,
  );
});

test('billing mode must match the RevenueCat secret container', () => {
  assert.throws(
    () =>
      validate(
        releaseConfiguration({
          GLIDELINGO_REVENUECAT_WEB_API_KEY_SECRET_VERSION:
            `projects/${projectId}/secrets/glidelingo-revenuecat-production-web-public-key/versions/1`,
        }),
      ),
    /sandbox-scoped secret/,
  );

  assert.doesNotThrow(() =>
    validate(
      releaseConfiguration({
        GLIDELINGO_BILLING_MODE: 'production',
        GLIDELINGO_REVENUECAT_WEB_API_KEY_SECRET_VERSION:
          `projects/${projectId}/secrets/glidelingo-revenuecat-production-web-public-key/versions/7`,
      }),
    ),
  );
});

test('release identity must exactly match the committed project and service account', () => {
  assert.throws(
    () =>
      validate(
        releaseConfiguration({ GLIDELINGO_GCP_PROJECT_ID: 'glidelingo-development' }),
      ),
    /exactly match the committed production project/,
  );
  assert.throws(
    () =>
      validate(
        releaseConfiguration({
          GLIDELINGO_GCP_PROJECT_ID: 'glidelingo-prod-50843312405-1',
        }),
      ),
    /exactly match the committed production project/,
  );
  assert.throws(
    () =>
      validate(
        releaseConfiguration({
          GLIDELINGO_GCP_DESKTOP_RELEASE_SERVICE_ACCOUNT:
            'desktop-release@glidelingo-development.iam.gserviceaccount.com',
        }),
      ),
    /exactly match the committed production release account/,
  );
  assert.throws(
    () =>
      validate(
        releaseConfiguration({
          GLIDELINGO_GCP_DESKTOP_RELEASE_SERVICE_ACCOUNT:
            `project-owner@${projectId}.iam.gserviceaccount.com`,
        }),
      ),
    /exactly match the committed production release account/,
  );
});

test('release provider must match the exact project number, pool, and provider', () => {
  const provider = (projectNumber, pool, name) =>
    `projects/${projectNumber}/locations/global/workloadIdentityPools/${pool}/providers/${name}`;

  assert.throws(
    () =>
      validate(
        releaseConfiguration({
          GLIDELINGO_GCP_WORKLOAD_IDENTITY_PROVIDER:
            provider('999999999999', 'github-actions', 'desktop-release'),
        }),
      ),
    /exactly match the committed production release provider/,
  );
  assert.throws(
    () =>
      validate(
        releaseConfiguration({
          GLIDELINGO_GCP_WORKLOAD_IDENTITY_PROVIDER:
            provider('123456789012', 'other-pool', 'desktop-release'),
        }),
      ),
    /exactly match the committed production release provider/,
  );
  assert.throws(
    () =>
      validate(
        releaseConfiguration({
          GLIDELINGO_GCP_WORKLOAD_IDENTITY_PROVIDER:
            provider('123456789012', 'github-actions', 'other-provider'),
        }),
      ),
    /exactly match the committed production release provider/,
  );
});

test('the committed manifest loader fails closed and requires a pinned project number', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'glidelingo-production-identity-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const identityPath = path.join(directory, 'identity.json');

  fs.writeFileSync(identityPath, JSON.stringify(productionIdentity));
  assert.deepEqual(loadProductionIdentity(identityPath), productionIdentity);
  assert.deepEqual(validateProductionIdentity(productionIdentity), {
    projectId,
    projectNumber: '123456789012',
    releaseProviderId: 'desktop-release',
    releaseServiceAccountId: 'glidelingo-desktop-releaser',
    workloadIdentityPoolId: 'github-actions',
  });

  assert.throws(
    () => validateProductionIdentity({ ...productionIdentity, project_number: null }),
    /must pin the numeric project_number/,
  );
  assert.throws(
    () => loadProductionIdentity(path.join(directory, 'missing.json')),
    /missing or invalid/,
  );
});
