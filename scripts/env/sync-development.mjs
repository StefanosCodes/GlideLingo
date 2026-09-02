#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  accessSecret,
  assertDevelopmentProject,
  buildManagedValues,
  loadDevelopmentContract,
  renderManagedBlock,
  replaceManagedBlock,
  writeEnvironmentAtomic,
} from './development-env.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const environmentPath = path.join(projectRoot, '.env');

try {
  assertDevelopmentProject();
  const contract = loadDevelopmentContract(projectRoot);
  const secretValues = Object.fromEntries(
    Object.entries(contract).map(([envName, spec]) => [envName, accessSecret(spec)]),
  );
  const existing = existsSync(environmentPath) ? readFileSync(environmentPath, 'utf8') : '';
  const next = replaceManagedBlock(existing, renderManagedBlock(buildManagedValues(secretValues)));
  writeEnvironmentAtomic(environmentPath, next);
  console.log('Development .env synchronized from pinned glidelingo-development Secret Manager versions.');
  console.log('Secret values were not printed. Run npm run env:check for provenance verification.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Development environment synchronization failed.');
  process.exitCode = 1;
}
