import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEVELOPMENT_CLERK_ISSUER,
  DEVELOPMENT_DATABASE_PASSWORD,
  DEVELOPMENT_DATABASE_PORT,
  DEVELOPMENT_DATABASE_URL,
  DEVELOPMENT_PROJECT,
  accessSecret,
  assertDevelopmentProject,
  fingerprint,
  loadDevelopmentContract,
  parseEnv,
  renderManagedBlock,
  replaceManagedBlock,
  validateLocalValues,
  writeEnvironmentAtomic,
} from './development-env.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const clerkPublishableKeyFor = (frontend) =>
  `pk_test_${Buffer.from(`${frontend}$`, 'utf8').toString('base64url')}`;

const validValues = {
  EXPO_PUBLIC_API_BASE_URL: 'http://localhost:8123',
  EXPO_PUBLIC_ENABLE_MOCK_BILLING: 'false',
  GLIDELINGO_REVENUECAT_ENABLED: 'true',
  GLIDELINGO_REVENUECAT_ENVIRONMENT: 'SANDBOX',
  GLIDELINGO_CLERK_ISSUER: DEVELOPMENT_CLERK_ISSUER,
  GLIDELINGO_CLERK_JWKS_URL: `${DEVELOPMENT_CLERK_ISSUER}/.well-known/jwks.json`,
  GLIDELINGO_CLERK_AUTHORIZED_PARTIES:
    '["http://localhost:8081","http://127.0.0.1:8081"]',
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishableKeyFor(
    'vast-gator-9531.clerk.accounts.dev',
  ),
  GLIDELINGO_DATABASE_URL: DEVELOPMENT_DATABASE_URL,
  GLIDELINGO_DB_PORT: DEVELOPMENT_DATABASE_PORT,
  GLIDELINGO_DB_PASSWORD: DEVELOPMENT_DATABASE_PASSWORD,
  EXPO_PUBLIC_REVENUECAT_WEB_API_KEY: 'rcb_sb_fixture_key',
  GLIDELINGO_REVENUECAT_API_KEY: 'rcb_sb_fixture_key',
  GLIDELINGO_REVENUECAT_PSEUDONYM_KEY: 'pseudonym-fixture-at-least-32-bytes',
  GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION: 'Bearer fixture authorization # = "safe"',
  GLIDELINGO_REVENUECAT_WEBHOOK_SIGNING_SECRET: 'signing-fixture-at-least-32-bytes',
};

test('project guard accepts only the exact development project', () => {
  assert.doesNotThrow(() => assertDevelopmentProject(() => `${DEVELOPMENT_PROJECT}\n`));
  assert.throws(() => assertDevelopmentProject(() => 'glidelingo-production\n'), /Refusing/);
  assert.throws(() => assertDevelopmentProject(() => '(unset)\n'), /Refusing/);
});

test('secret access pins project, container, and numeric version without exposing failures', () => {
  let invocation;
  const value = accessSecret(
    { id: 'fixture-secret', version: '7' },
    (command, args) => {
      invocation = { command, args };
      return 'fixture-value\n';
    },
  );
  assert.equal(value, 'fixture-value');
  assert.deepEqual(invocation, {
    command: 'gcloud',
    args: [
      'secrets',
      'versions',
      'access',
      '7',
      '--secret=fixture-secret',
      '--project=glidelingo-development',
    ],
  });
  assert.throws(
    () => accessSecret({ id: 'fixture-secret', version: '7' }, () => { throw new Error('secret-byte'); }),
    (error) => error instanceof Error && !error.message.includes('secret-byte'),
  );
});

test('development contract uses the canonical desktop release public-key containers', () => {
  const contract = loadDevelopmentContract(projectRoot);
  assert.equal(
    contract.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY.id,
    'glidelingo-desktop-clerk-publishable-key',
  );
  assert.equal(
    contract.EXPO_PUBLIC_REVENUECAT_WEB_API_KEY.id,
    'glidelingo-revenuecat-sandbox-web-public-key',
  );
});

test('human tutor marketplace remains disabled in both client and server defaults', () => {
  const example = parseEnv(readFileSync(path.join(projectRoot, '.env.example'), 'utf8'));
  assert.equal(example.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED, 'false');
  assert.equal(example.GLIDELINGO_HUMAN_TUTOR_MARKETPLACE_ENABLED, 'false');
  assert.equal(example.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED, 'false');
  assert.equal(example.GLIDELINGO_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED, 'false');
  assert.equal(example.EXPO_PUBLIC_HUMAN_TUTOR_MESSAGING_ENABLED, 'false');
  assert.equal(example.GLIDELINGO_HUMAN_TUTOR_MESSAGING_ENABLED, 'false');
});

test('managed block preserves unrelated local values and remains parseable', () => {
  const next = replaceManagedBlock(
    'OPENAI_API_KEY=local-only\nEXPO_PUBLIC_API_BASE_URL=https://stale.example\n',
    renderManagedBlock(validValues),
  );
  const parsed = parseEnv(next);
  assert.equal(parsed.OPENAI_API_KEY, 'local-only');
  assert.equal(parsed.EXPO_PUBLIC_API_BASE_URL, 'http://localhost:8123');
  assert.equal(
    parsed.GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION,
    'Bearer fixture authorization # = "safe"',
  );
  assert.equal((next.match(/EXPO_PUBLIC_API_BASE_URL=/g) ?? []).length, 1);
  const replaced = replaceManagedBlock(next, renderManagedBlock({ ...validValues, GLIDELINGO_DB_PORT: '55433' }));
  assert.equal((replaced.match(/BEGIN GLIDELINGO/g) ?? []).length, 1);
});

test('dotenv rendering safely round-trips spaces, hashes, equals, quotes, and backslashes', () => {
  const special = 'Bearer token # equals= quote=" backslash=\\';
  const rendered = renderManagedBlock({ SPECIAL_SECRET: special });
  assert.equal(parseEnv(rendered).SPECIAL_SECRET, special);
  const directory = mkdtempSync(path.join(os.tmpdir(), 'glidelingo-dotenv-runtime-'));
  const environmentPath = path.join(directory, '.env');
  writeFileSync(environmentPath, `${rendered}\n`, { mode: 0o600 });
  const runtime = spawnSync(
    process.execPath,
    ['--env-file', environmentPath, '--eval', 'process.stdout.write(JSON.stringify(process.env.SPECIAL_SECRET))'],
    { encoding: 'utf8' },
  );
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(JSON.parse(runtime.stdout), special);
  rmSync(directory, { recursive: true, force: true });
  assert.throws(
    () => renderManagedBlock({ SPECIAL_SECRET: 'line-one\nline-two' }),
    /forbidden dotenv character/,
  );
  assert.throws(
    () => renderManagedBlock({ SPECIAL_SECRET: "unsafe'single-quote" }),
    /forbidden dotenv character/,
  );
});

test('atomic writer replaces the target with mode 0600', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'glidelingo-env-test-'));
  const target = path.join(directory, '.env');
  writeFileSync(target, 'old\n');
  chmodSync(target, 0o644);
  writeEnvironmentAtomic(target, 'new\n');
  assert.equal(readFileSync(target, 'utf8'), 'new\n');
  assert.equal(statSync(target).mode & 0o777, 0o600);
});

test('validation rejects production values and accepts the local sandbox contract', () => {
  assert.deepEqual(validateLocalValues(validValues), []);
  assert.ok(
    validateLocalValues({
      ...validValues,
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_fixture',
      GLIDELINGO_REVENUECAT_ENVIRONMENT: 'PRODUCTION',
    }).length >= 2,
  );
  for (const key of [
    'GLIDELINGO_REVENUECAT_PSEUDONYM_KEY',
    'GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION',
    'GLIDELINGO_REVENUECAT_WEBHOOK_SIGNING_SECRET',
  ]) {
    assert.ok(
      validateLocalValues({ ...validValues, [key]: 'short' }).some((error) => error.includes(key)),
    );
  }
  assert.ok(
    validateLocalValues({
      ...validValues,
      GLIDELINGO_REVENUECAT_WEBHOOK_AUTHORIZATION: 'valid-length\nbut-newline',
    }).some((error) => error.includes('forbidden dotenv character')),
  );
  assert.ok(
    validateLocalValues({
      ...validValues,
      GLIDELINGO_CLERK_AUTHORIZED_PARTIES:
        '["http://localhost:8081","glidelingo://app"]',
    }).some((error) => error.includes('only local development origins')),
  );
});

test('validation rejects remote databases and other Clerk development instances', () => {
  const errors = validateLocalValues({
    ...validValues,
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishableKeyFor(
      'other-instance.clerk.accounts.dev',
    ),
    GLIDELINGO_DATABASE_URL:
      'postgresql+psycopg://glidelingo:production-password@production-db.example:5432/glidelingo',
    GLIDELINGO_DB_PORT: '5432',
    GLIDELINGO_DB_PASSWORD: 'production-password',
  });

  assert.ok(errors.some((error) => error.includes('pinned development frontend')));
  assert.ok(errors.some((error) => error.includes('GLIDELINGO_DATABASE_URL')));
  assert.ok(errors.some((error) => error.includes('GLIDELINGO_DB_PORT')));
  assert.ok(errors.some((error) => error.includes('GLIDELINGO_DB_PASSWORD')));
  assert.ok(
    validateLocalValues({
      ...validValues,
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_not-valid-base64***',
    }).some((error) => error.includes('pinned development frontend')),
  );
});

test('fingerprints are stable and do not expose the input', () => {
  assert.equal(fingerprint('same-value'), fingerprint('same-value'));
  assert.notEqual(fingerprint('same-value'), fingerprint('different-value'));
  assert.ok(!fingerprint('same-value').includes('same-value'));
});
