#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  accessSecret,
  assertDevelopmentProject,
  buildManagedValues,
  loadAuthenticatedE2EContract,
  loadDevelopmentContract,
  renderManagedBlock,
  replaceManagedBlock,
  validateLocalValues,
  writeEnvironmentAtomic,
} from './development-env.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const environmentPath = path.join(projectRoot, '.env');
const authenticatedE2EEnvironmentPath = path.join(projectRoot, '.e2e-auth.env');

try {
  assertDevelopmentProject();
  const contract = loadDevelopmentContract(projectRoot);
  const secretValues = Object.fromEntries(
    Object.entries(contract).map(([envName, spec]) => [envName, accessSecret(spec)]),
  );
  const clerkSecretKey = accessSecret(loadAuthenticatedE2EContract(projectRoot));
  const managedValues = buildManagedValues(secretValues);
  const validationErrors = validateLocalValues({ ...managedValues, CLERK_SECRET_KEY: clerkSecretKey });
  if (validationErrors.length > 0) {
    throw new Error(`Refusing to write an invalid development environment: ${validationErrors.join(' ')}`);
  }
  const existing = existsSync(environmentPath) ? readFileSync(environmentPath, 'utf8') : '';
  const next = replaceManagedBlock(existing, renderManagedBlock(managedValues));
  writeEnvironmentAtomic(environmentPath, next);
  writeEnvironmentAtomic(
    authenticatedE2EEnvironmentPath,
    `${renderManagedBlock({ CLERK_SECRET_KEY: clerkSecretKey })}\n`,
  );
  console.log('Development .env and .e2e-auth.env synchronized from pinned glidelingo-development Secret Manager versions.');
  console.log('Secret values were not printed. Run npm run env:check locally or env:check:provenance for GCP comparison.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Development environment synchronization failed.');
  process.exitCode = 1;
}
