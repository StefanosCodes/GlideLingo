const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { version } = require('./package.json');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DESKTOP_TAG_PREFIX = 'desktop-v';

function resolveProductionApiOrigin(value) {
  if (!value || value !== value.trim()) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be set to the production HTTPS API URL.');
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be a valid absolute URL.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'EXPO_PUBLIC_API_BASE_URL must use HTTPS and cannot contain credentials, a query, or a fragment.',
    );
  }

  return url.origin;
}

function resolveProductionClerkOrigin(value) {
  if (!value || value !== value.trim()) {
    throw new Error('GLIDELINGO_CLERK_ORIGIN must be set to the production Clerk HTTPS origin.');
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error('GLIDELINGO_CLERK_ORIGIN must be a valid absolute URL.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'GLIDELINGO_CLERK_ORIGIN must be an exact HTTPS origin without credentials or a path.',
    );
  }

  return url.origin;
}

function requirePublicBuildKey(environment, name, pattern) {
  const value = environment[name];
  if (!value || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`${name} must be set to its public production SDK key.`);
  }
  return value;
}

function validatePublicBuildConfiguration(environment) {
  const clerkPublishableKey = requirePublicBuildKey(
    environment,
    'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY',
    /^pk_(?:test|live)_[A-Za-z0-9_-]+$/,
  );
  const revenueCatWebApiKey = requirePublicBuildKey(
    environment,
    'EXPO_PUBLIC_REVENUECAT_WEB_API_KEY',
    /^rcb_[A-Za-z0-9_-]+$/,
  );

  if (environment.EXPO_PUBLIC_ENABLE_MOCK_BILLING === 'true') {
    throw new Error('Mock billing must remain disabled in a desktop release.');
  }

  return { clerkPublishableKey, revenueCatWebApiKey };
}

function hasCompleteGroup(environment, names) {
  const presentNames = names.filter((name) => Boolean(environment[name]));

  if (presentNames.length > 0 && presentNames.length < names.length) {
    const missingNames = names.filter((name) => !environment[name]);
    throw new Error(`Incomplete notarization credentials; missing ${missingNames.join(', ')}.`);
  }

  return presentNames.length === names.length;
}

function validateNotarizationCredentials(environment) {
  const hasApiKey = hasCompleteGroup(environment, [
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ]);
  const hasAppleId = hasCompleteGroup(environment, [
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
  ]);
  const hasKeychainProfile = hasCompleteGroup(environment, ['APPLE_KEYCHAIN_PROFILE']);

  if (!hasApiKey && !hasAppleId && !hasKeychainProfile) {
    throw new Error('Apple notarization credentials are required for a desktop release.');
  }
}

function validateReleaseTag(tag, desktopVersion = version) {
  if (!tag) {
    return;
  }

  const expectedTag = `${DESKTOP_TAG_PREFIX}${desktopVersion}`;
  if (tag !== expectedTag) {
    throw new Error(`Desktop release tag ${tag} must match ${expectedTag}.`);
  }
}

function validateReleaseEnvironment(environment, platform = process.platform) {
  if (platform !== 'darwin') {
    throw new Error('Signed macOS desktop releases must be built on macOS.');
  }

  const apiOrigin = resolveProductionApiOrigin(environment.EXPO_PUBLIC_API_BASE_URL);
  const clerkOrigin = resolveProductionClerkOrigin(environment.GLIDELINGO_CLERK_ORIGIN);
  validatePublicBuildConfiguration(environment);
  validateNotarizationCredentials(environment);
  validateReleaseTag(environment.GLIDELINGO_DESKTOP_RELEASE_TAG);

  return { apiOrigin, clerkOrigin };
}

function runCommand(command, args, environment) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    env: environment,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}

function buildDesktopRelease(environment = process.env) {
  const { apiOrigin, clerkOrigin } = validateReleaseEnvironment(environment);

  runCommand('npm', ['run', 'desktop:export'], environment);
  runCommand(
    'npm',
    [
      'exec',
      '--',
      'electron-builder',
      '--projectDir',
      'desktop',
      '--mac',
      '--universal',
      '--publish',
      'never',
      '--config.forceCodeSigning=true',
      `--config.extraMetadata.glidelingoApiOrigin=${apiOrigin}`,
      `--config.extraMetadata.glidelingoClerkOrigin=${clerkOrigin}`,
    ],
    environment,
  );
}

if (require.main === module) {
  try {
    buildDesktopRelease();
  } catch (error) {
    console.error(`[desktop-release] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DESKTOP_TAG_PREFIX,
  resolveProductionApiOrigin,
  resolveProductionClerkOrigin,
  validateNotarizationCredentials,
  validatePublicBuildConfiguration,
  validateReleaseEnvironment,
  validateReleaseTag,
};
