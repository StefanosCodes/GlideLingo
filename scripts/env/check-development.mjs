#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  accessSecret,
  assertDevelopmentProject,
  fingerprint,
  loadAuthenticatedE2EContract,
  loadDevelopmentContract,
  parseEnv,
  validateLocalValues,
} from './development-env.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const environmentPath = path.join(projectRoot, '.env');
const authenticatedE2EEnvironmentPath = path.join(projectRoot, '.e2e-auth.env');
const checkProvenance = process.argv.includes('--provenance');

function assertIgnored(relativePath) {
  execFileSync('git', ['check-ignore', '--quiet', relativePath], {
    cwd: projectRoot,
    stdio: 'ignore',
  });
}

function assertPrivateFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} is missing. Run npm run env:sync:development.`);
  }
  const mode = statSync(filePath).mode & 0o777;
  if (mode !== 0o600) throw new Error(`${label} must have mode 0600; found ${mode.toString(8)}.`);
}

try {
  assertPrivateFile(environmentPath, 'Root .env');
  assertPrivateFile(authenticatedE2EEnvironmentPath, '.e2e-auth.env');
  assertIgnored('.env');
  assertIgnored('.e2e-auth.env');

  const values = parseEnv(readFileSync(environmentPath, 'utf8'));
  const errors = validateLocalValues(values);
  const authenticatedE2EValues = parseEnv(readFileSync(authenticatedE2EEnvironmentPath, 'utf8'));
  if (Object.hasOwn(values, 'CLERK_SECRET_KEY')) {
    errors.push('CLERK_SECRET_KEY must live only in .e2e-auth.env, never the root .env.');
  }
  if (
    Object.keys(authenticatedE2EValues).length !== 1
    || !Object.hasOwn(authenticatedE2EValues, 'CLERK_SECRET_KEY')
  ) {
    errors.push('.e2e-auth.env must contain only CLERK_SECRET_KEY.');
  }
  if (!authenticatedE2EValues.CLERK_SECRET_KEY?.startsWith('sk_test_')) {
    errors.push('.e2e-auth.env must contain a Clerk development secret key.');
  }

  const provenance = [];
  if (checkProvenance) {
    assertDevelopmentProject();
    const contract = loadDevelopmentContract(projectRoot);
    for (const [envName, spec] of Object.entries(contract)) {
      const authoritative = accessSecret(spec);
      const matches = fingerprint(values[envName] ?? '') === fingerprint(authoritative);
      if (!matches) errors.push(`${envName} does not match ${spec.id} version ${spec.version}.`);
      provenance.push(`${envName}: ${spec.id}@${spec.version} fingerprint=${fingerprint(authoritative)} ${matches ? 'match' : 'mismatch'}`);
    }
    const clerkSecretSpec = loadAuthenticatedE2EContract(projectRoot);
    const authoritativeClerkSecret = accessSecret(clerkSecretSpec);
    const clerkSecretMatches = fingerprint(authenticatedE2EValues.CLERK_SECRET_KEY ?? '')
      === fingerprint(authoritativeClerkSecret);
    if (!clerkSecretMatches) {
      errors.push(`CLERK_SECRET_KEY does not match ${clerkSecretSpec.id} version ${clerkSecretSpec.version}.`);
    }
    provenance.push(
      `CLERK_SECRET_KEY: ${clerkSecretSpec.id}@${clerkSecretSpec.version} fingerprint=${fingerprint(authoritativeClerkSecret)} ${clerkSecretMatches ? 'match' : 'mismatch'}`,
    );
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    throw new Error('Development environment verification failed.');
  }
  console.log('Project: glidelingo-development');
  console.log('Mode: local / Clerk development / RevenueCat sandbox');
  for (const line of provenance) console.log(line);
  console.log(
    checkProvenance
      ? 'PASS: local environment files are private, development-only, and match every pinned version.'
      : 'PASS: local environment files are ignored, mode 0600, and development-only (offline check).',
  );
} catch (error) {
  if (error && typeof error === 'object' && 'status' in error && error.status === 1) {
    console.error('Local environment files must be ignored by Git.');
  } else if (error instanceof Error && error.message !== 'Development environment verification failed.') {
    console.error(error.message);
  }
  process.exitCode = 1;
}
