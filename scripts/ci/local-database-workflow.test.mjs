import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('normal local development prepares every versioned application schema migration', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const script = await readFile(new URL('scripts/db/migrate-local.mjs', root), 'utf8');

  assert.equal(packageJson.scripts['db:prepare'], 'npm run db:up && npm run db:migrate:local');
  assert.match(packageJson.scripts.dev, /^npm run db:prepare /);
  assert.match(packageJson.scripts['dev:desktop'], /^npm run db:prepare /);
  assert.match(packageJson.scripts['e2e:auth:api'], /^npm run db:prepare /);
  assert.match(packageJson.scripts['verify:full-stack'], /npm run db:prepare/);
  assert.match(script, /001_lesson_tutor_guard\.sql/);
  assert.match(script, /002_revenuecat_entitlements\.sql/);
  assert.match(script, /003_revenuecat_webhook_maintenance\.sql/);
  assert.match(script, /glidelingo_schema_migration/);
  assert.match(script, /checksum/);
  assert.doesNotMatch(script, /\bgcloud\b|production/);
});
