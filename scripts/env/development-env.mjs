import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const DEVELOPMENT_PROJECT = 'glidelingo-development';
export const DEVELOPMENT_CLERK_ISSUER = 'https://vast-gator-9531.clerk.accounts.dev';
export const MANAGED_START = '# BEGIN GLIDELINGO MANAGED DEVELOPMENT ENV';
export const MANAGED_END = '# END GLIDELINGO MANAGED DEVELOPMENT ENV';

const localSecretSpecs = {
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: {
    id: 'glidelingo-desktop-clerk-publishable-key',
    contract: 'local_env_secret_versions.clerk_publishable_key',
  },
  EXPO_PUBLIC_REVENUECAT_WEB_API_KEY: {
    id: 'glidelingo-revenuecat-sandbox-web-public-key',
    contract: 'local_env_secret_versions.revenuecat_web_api_key',
  },
};

const revenueCatSecretSpecs = {
  GLIDELINGO_REVENUECAT_API_KEY: {
    id: 'glidelingo-revenuecat-api-key',
    contract: 'revenuecat_secret_versions.api_key',
  },
  GLIDELINGO_REVENUECAT_PSEUDONYM_KEY: {
    id: 'glidelingo-revenuecat-pseudonym-key',
    contract: 'revenuecat_secret_versions.pseudonym_key',
  },
  GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION: {
    id: 'glidelingo-revenuecat-webhook-authorization',
    contract: 'revenuecat_secret_versions.webhook_authorization',
  },
  GLIDELINGO_REVENUECAT_WEBHOOK_SIGNING_SECRET: {
    id: 'glidelingo-revenuecat-webhook-signing-secret',
    contract: 'revenuecat_secret_versions.webhook_signing_secret',
  },
};

export const secretSpecs = { ...localSecretSpecs, ...revenueCatSecretSpecs };

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function atPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], value);
}

export function loadDevelopmentContract(projectRoot) {
  const environmentDir = path.join(projectRoot, 'infra/gcp/environments/development');
  const local = readJson(path.join(environmentDir, 'local-env.auto.tfvars.json'));
  const revenueCat = readJson(path.join(environmentDir, 'revenuecat.auto.tfvars.json'));
  const combined = { ...local, ...revenueCat };
  const resolved = {};

  for (const [envName, spec] of Object.entries(secretSpecs)) {
    const version = atPath(combined, spec.contract);
    if (typeof version !== 'string' || !/^[1-9][0-9]*$/.test(version)) {
      throw new Error(`${spec.contract} must be an exact positive Secret Manager version.`);
    }
    resolved[envName] = { ...spec, version };
  }

  return resolved;
}

export function parseEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1);
  }
  return values;
}

export function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function assertDevelopmentProject(run = execFileSync) {
  let project;
  try {
    project = run('gcloud', ['config', 'get-value', 'project'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('Unable to read the active gcloud project. Authenticate gcloud first.');
  }
  if (project !== DEVELOPMENT_PROJECT) {
    throw new Error(`Refusing development environment access: active gcloud project must be ${DEVELOPMENT_PROJECT}.`);
  }
}

export function accessSecret(spec, run = execFileSync) {
  try {
    return run(
      'gcloud',
      [
        'secrets',
        'versions',
        'access',
        spec.version,
        `--secret=${spec.id}`,
        `--project=${DEVELOPMENT_PROJECT}`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 },
    ).replace(/\r?\n$/, '');
  } catch {
    throw new Error(`Unable to access ${spec.id} version ${spec.version}.`);
  }
}

export function buildManagedValues(secretValues) {
  return {
    EXPO_PUBLIC_API_BASE_URL: 'http://localhost:8123',
    EXPO_PUBLIC_LESSON_TUTOR_ENABLED: 'false',
    EXPO_PUBLIC_ENABLE_MOCK_BILLING: 'false',
    GLIDELINGO_REVENUECAT_ENABLED: 'true',
    GLIDELINGO_REVENUECAT_ENVIRONMENT: 'SANDBOX',
    GLIDELINGO_DATABASE_URL:
      'postgresql+psycopg://glidelingo:glidelingo_dev_only@localhost:55433/glidelingo',
    GLIDELINGO_CLERK_ISSUER: DEVELOPMENT_CLERK_ISSUER,
    GLIDELINGO_CLERK_JWKS_URL: `${DEVELOPMENT_CLERK_ISSUER}/.well-known/jwks.json`,
    GLIDELINGO_CLERK_AUTHORIZED_PARTIES:
      '["http://localhost:8081","http://127.0.0.1:8081"]',
    GLIDELINGO_DB_PORT: '55433',
    GLIDELINGO_DB_PASSWORD: 'glidelingo_dev_only',
    ...secretValues,
  };
}

export function renderManagedBlock(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  return `${MANAGED_START}\n${lines.join('\n')}\n${MANAGED_END}`;
}

export function replaceManagedBlock(existing, managedBlock) {
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error('The existing .env has a malformed GlideLingo managed block.');
  }
  const withoutBlock = start === -1
    ? existing
    : `${existing.slice(0, start)}${existing.slice(end + MANAGED_END.length)}`;
  const managedKeys = new Set(Object.keys(parseEnv(managedBlock)));
  const preserved = withoutBlock
    .split(/\r?\n/)
    .filter((line) => {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      return !match || !managedKeys.has(match[1]);
    })
    .join('\n')
    .trimEnd();
  return `${preserved ? `${preserved}\n\n` : ''}${managedBlock}\n`;
}

export function writeEnvironmentAtomic(environmentPath, content) {
  const temporaryPath = `${environmentPath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, environmentPath);
    chmodSync(environmentPath, 0o600);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function validateLocalValues(values) {
  const errors = [];
  if (values.EXPO_PUBLIC_API_BASE_URL !== 'http://localhost:8123') {
    errors.push('EXPO_PUBLIC_API_BASE_URL must be http://localhost:8123.');
  }
  if (!values.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')) {
    errors.push('The Clerk publishable key must be a development pk_test_ key.');
  }
  if (values.GLIDELINGO_CLERK_ISSUER !== DEVELOPMENT_CLERK_ISSUER) {
    errors.push('The Clerk issuer must be the pinned development instance.');
  }
  if (values.GLIDELINGO_CLERK_JWKS_URL !== `${DEVELOPMENT_CLERK_ISSUER}/.well-known/jwks.json`) {
    errors.push('The Clerk JWKS URL must match the pinned development issuer.');
  }
  let parties;
  try {
    parties = JSON.parse(values.GLIDELINGO_CLERK_AUTHORIZED_PARTIES);
  } catch {
    errors.push('GLIDELINGO_CLERK_AUTHORIZED_PARTIES must be valid JSON.');
  }
  if (
    parties &&
    (!Array.isArray(parties) ||
      parties.length === 0 ||
      parties.some(
        (party) =>
          party !== 'http://localhost:8081' &&
          party !== 'http://127.0.0.1:8081',
      ))
  ) {
    errors.push('Clerk authorized parties must contain only local development origins.');
  }
  if (values.GLIDELINGO_REVENUECAT_ENVIRONMENT !== 'SANDBOX') {
    errors.push('RevenueCat environment must be SANDBOX.');
  }
  if (values.GLIDELINGO_REVENUECAT_ENABLED !== 'true') {
    errors.push('RevenueCat must be explicitly enabled for the verified local sandbox.');
  }
  for (const key of ['EXPO_PUBLIC_REVENUECAT_WEB_API_KEY', 'GLIDELINGO_REVENUECAT_API_KEY']) {
    if (!values[key]?.startsWith('rcb_sb_')) {
      errors.push(`${key} must be a RevenueCat Billing sandbox key.`);
    }
  }
  if (values.EXPO_PUBLIC_ENABLE_MOCK_BILLING !== 'false') {
    errors.push('Mock billing must be disabled.');
  }
  for (const key of Object.keys(secretSpecs)) {
    if (!values[key]) errors.push(`${key} is required.`);
  }
  const serialized = JSON.stringify(values);
  if (/pk_live_|revenuecat_environment["']?\s*[:=]\s*["']?production|https:\/\/api\.glidelingo\.com/i.test(serialized)) {
    errors.push('Production configuration is not allowed in the local development environment.');
  }
  return errors;
}
