#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
const secretKey = process.env.CLERK_SECRET_KEY?.trim();

if (!publishableKey?.startsWith('pk_test_')) {
  console.error('Authenticated E2E requires the pinned Clerk development publishable key.');
  process.exit(2);
}
if (!secretKey?.startsWith('sk_test_')) {
  console.error('Authenticated E2E requires .e2e-auth.env. Run npm run env:sync:development once.');
  process.exit(2);
}

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
