#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  accessSecret,
  assertDevelopmentProject,
  fingerprint,
  loadDevelopmentContract,
  parseEnv,
  validateLocalValues,
} from './development-env.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const environmentPath = path.join(projectRoot, '.env');

try {
  assertDevelopmentProject();
  if (!existsSync(environmentPath)) throw new Error('Root .env is missing. Run npm run env:sync:development.');
  execFileSync('git', ['check-ignore', '--quiet', '.env'], { cwd: projectRoot, stdio: 'ignore' });
  const mode = statSync(environmentPath).mode & 0o777;
  if (mode !== 0o600) throw new Error(`Root .env must have mode 0600; found ${mode.toString(8)}.`);

  const values = parseEnv(readFileSync(environmentPath, 'utf8'));
  const errors = validateLocalValues(values);
  const contract = loadDevelopmentContract(projectRoot);
  const provenance = [];
  for (const [envName, spec] of Object.entries(contract)) {
    const authoritative = accessSecret(spec);
    const matches = fingerprint(values[envName] ?? '') === fingerprint(authoritative);
    if (!matches) errors.push(`${envName} does not match ${spec.id} version ${spec.version}.`);
    provenance.push(`${envName}: ${spec.id}@${spec.version} fingerprint=${fingerprint(authoritative)} ${matches ? 'match' : 'mismatch'}`);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    throw new Error('Development environment verification failed.');
  }
  console.log('Project: glidelingo-development');
  console.log('Mode: local / Clerk development / RevenueCat sandbox');
  for (const line of provenance) console.log(line);
  console.log('PASS: root .env is ignored, mode 0600, development-only, and matches every pinned version.');
} catch (error) {
  if (error && typeof error === 'object' && 'status' in error && error.status === 1) {
    console.error('Root .env must be ignored by Git.');
  } else if (error instanceof Error && error.message !== 'Development environment verification failed.') {
    console.error(error.message);
  }
  process.exitCode = 1;
}
