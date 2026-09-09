#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  accessSecret,
  assertDevelopmentProject,
  loadAuthenticatedE2EContract,
} from '../env/development-env.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
assertDevelopmentProject();
const secretKey = accessSecret(loadAuthenticatedE2EContract(projectRoot)).trim();

if (!publishableKey?.startsWith('pk_test_')) {
  console.error('Authenticated E2E requires the pinned Clerk development publishable key.');
  process.exit(2);
}
if (!secretKey?.startsWith('sk_test_')) {
  console.error('Authenticated E2E requires the server-only Clerk development secret key.');
  process.exit(2);
}
process.env.CLERK_SECRET_KEY = secretKey;

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(
  npmCommand,
  [
    'exec',
    '--',
    'playwright',
    'test',
    '--config=playwright.auth.config.ts',
    ...process.argv.slice(2),
  ],
  { env: process.env, stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
