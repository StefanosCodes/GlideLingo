const fs = require('node:fs');
const path = require('node:path');

const PRODUCTION_IDENTITY_PATH = path.resolve(
  __dirname,
  '../infra/gcp/environments/production/identity.json',
);

const SECRET_VERSION_VARIABLES = [
  'GLIDELINGO_MACOS_CERTIFICATE_SECRET_VERSION',
  'GLIDELINGO_MACOS_CERTIFICATE_PASSWORD_SECRET_VERSION',
  'GLIDELINGO_APPLE_ID_SECRET_VERSION',
  'GLIDELINGO_APPLE_APP_SPECIFIC_PASSWORD_SECRET_VERSION',
  'GLIDELINGO_APPLE_TEAM_ID_SECRET_VERSION',
  'GLIDELINGO_CLERK_PUBLISHABLE_KEY_SECRET_VERSION',
  'GLIDELINGO_REVENUECAT_WEB_API_KEY_SECRET_VERSION',
];

const FIXED_SECRET_IDS = {
  GLIDELINGO_MACOS_CERTIFICATE_SECRET_VERSION:
    'glidelingo-desktop-macos-certificate-base64',
  GLIDELINGO_MACOS_CERTIFICATE_PASSWORD_SECRET_VERSION:
    'glidelingo-desktop-macos-certificate-password',
  GLIDELINGO_APPLE_ID_SECRET_VERSION: 'glidelingo-desktop-apple-id',
  GLIDELINGO_APPLE_APP_SPECIFIC_PASSWORD_SECRET_VERSION:
    'glidelingo-desktop-apple-app-specific-password',
  GLIDELINGO_APPLE_TEAM_ID_SECRET_VERSION: 'glidelingo-desktop-apple-team-id',
  GLIDELINGO_CLERK_PUBLISHABLE_KEY_SECRET_VERSION:
    'glidelingo-desktop-clerk-publishable-key',
};

function resolveBillingMode(value) {
  if (value !== 'sandbox' && value !== 'production') {
    throw new Error('GLIDELINGO_BILLING_MODE must be exactly sandbox or production.');
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadProductionIdentity(identityPath = PRODUCTION_IDENTITY_PATH) {
  let identity;
  try {
    identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  } catch {
    throw new Error(
      'The committed production identity manifest is missing or invalid; release authentication is disabled.',
    );
  }

  return identity;
}

function validateProductionIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error('The committed production identity manifest must be a JSON object.');
  }

  const idPattern = /^[a-z][a-z0-9-]*[a-z0-9]$/;
  const projectNumber = String(identity.project_number ?? '');
  if (!/^[1-9][0-9]*$/.test(projectNumber)) {
    throw new Error(
      'The committed production identity manifest must pin the numeric project_number before releases are enabled.',
    );
  }

  for (const name of [
    'project_id',
    'workload_identity_pool_id',
    'release_provider_id',
    'release_service_account_id',
  ]) {
    if (!idPattern.test(identity[name] || '')) {
      throw new Error(`The committed production identity manifest has an invalid ${name}.`);
    }
  }

  return {
    projectId: identity.project_id,
    projectNumber,
    releaseProviderId: identity.release_provider_id,
    releaseServiceAccountId: identity.release_service_account_id,
    workloadIdentityPoolId: identity.workload_identity_pool_id,
  };
}

function validateSecretVersionSelector(name, value, projectId) {
  const pattern = new RegExp(
    `^projects/${escapeRegExp(projectId)}/secrets/([A-Za-z0-9_-]+)/versions/([1-9][0-9]*)$`,
  );
  const match = pattern.exec(value || '');

  if (!match) {
    throw new Error(
      `${name} must be a full Secret Manager resource in ${projectId} pinned to a positive numeric version.`,
    );
  }

  return { name: match[1], version: match[2] };
}

function validateGcpReleaseConfiguration(
  environment = process.env,
  identity = loadProductionIdentity(),
) {
  const expected = validateProductionIdentity(identity);
  const projectId = environment.GLIDELINGO_GCP_PROJECT_ID;
  if (projectId !== expected.projectId) {
    throw new Error(
      `GLIDELINGO_GCP_PROJECT_ID must exactly match the committed production project ${expected.projectId}.`,
    );
  }

  const workloadIdentityProvider = environment.GLIDELINGO_GCP_WORKLOAD_IDENTITY_PROVIDER;
  const expectedProvider =
    `projects/${expected.projectNumber}/locations/global/workloadIdentityPools/` +
    `${expected.workloadIdentityPoolId}/providers/${expected.releaseProviderId}`;
  if (workloadIdentityProvider !== expectedProvider) {
    throw new Error(
      'GLIDELINGO_GCP_WORKLOAD_IDENTITY_PROVIDER must exactly match the committed production release provider.',
    );
  }

  const serviceAccount = environment.GLIDELINGO_GCP_DESKTOP_RELEASE_SERVICE_ACCOUNT;
  const expectedServiceAccount =
    `${expected.releaseServiceAccountId}@${expected.projectId}.iam.gserviceaccount.com`;
  if (serviceAccount !== expectedServiceAccount) {
    throw new Error(
      'GLIDELINGO_GCP_DESKTOP_RELEASE_SERVICE_ACCOUNT must exactly match the committed production release account.',
    );
  }

  const billingMode = resolveBillingMode(environment.GLIDELINGO_BILLING_MODE);
  const selectors = Object.fromEntries(
    SECRET_VERSION_VARIABLES.map((name) => [
      name,
      validateSecretVersionSelector(name, environment[name], projectId),
    ]),
  );
  for (const [variable, secretId] of Object.entries(FIXED_SECRET_IDS)) {
    if (selectors[variable].name !== secretId) {
      throw new Error(`${variable} must select the dedicated ${secretId} container.`);
    }
  }
  const revenueCatSecret = selectors.GLIDELINGO_REVENUECAT_WEB_API_KEY_SECRET_VERSION.name;
  const expectedRevenueCatSecret = `glidelingo-revenuecat-${billingMode}-web-public-key`;

  if (revenueCatSecret !== expectedRevenueCatSecret) {
    throw new Error(
      `GLIDELINGO_REVENUECAT_WEB_API_KEY_SECRET_VERSION must select a ${billingMode}-scoped secret.`,
    );
  }

  return {
    billingMode,
    projectId,
    serviceAccount,
    workloadIdentityProvider,
    selectors,
  };
}

if (require.main === module) {
  try {
    const configuration = validateGcpReleaseConfiguration();
    console.log(
      `[desktop-release] Validated ${configuration.billingMode} GCP release selectors without reading secret values.`,
    );
  } catch (error) {
    console.error(`[desktop-release] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  FIXED_SECRET_IDS,
  PRODUCTION_IDENTITY_PATH,
  SECRET_VERSION_VARIABLES,
  loadProductionIdentity,
  resolveBillingMode,
  validateGcpReleaseConfiguration,
  validateProductionIdentity,
  validateSecretVersionSelector,
};
