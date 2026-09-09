import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const migrationFiles = [
  'backend/migrations/001_lesson_tutor_guard.sql',
  'backend/migrations/002_revenuecat_entitlements.sql',
  'backend/migrations/003_revenuecat_webhook_maintenance.sql',
];

function runPsql(sql, extraArgs = []) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'infra/compose.yaml',
      'exec',
      '-T',
      'db',
      'psql',
      '-X',
      '--quiet',
      '--username=glidelingo',
      '--dbname=glidelingo',
      '--set=ON_ERROR_STOP=1',
      ...extraArgs,
    ],
    { cwd: root, encoding: 'utf8', input: sql },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

runPsql(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudsqlsuperuser') THEN
    CREATE ROLE cloudsqlsuperuser NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glidelingo_app') THEN
    CREATE ROLE glidelingo_app NOLOGIN;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.glidelingo_schema_migration (
  version integer PRIMARY KEY CHECK (version > 0),
  name text NOT NULL UNIQUE,
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.glidelingo_schema_migration OWNER TO cloudsqlsuperuser;
REVOKE ALL ON public.glidelingo_schema_migration FROM PUBLIC, glidelingo_app;
`);

for (const [index, relativePath] of migrationFiles.entries()) {
  const version = index + 1;
  const sourcePath = join(root, relativePath);
  const source = readFileSync(sourcePath, 'utf8');
  const name = relativePath.split('/').at(-1);
  const checksum = createHash('sha256').update(source).digest('hex');
  const state = runPsql(
    `SELECT CASE
       WHEN NOT EXISTS (SELECT 1 FROM public.glidelingo_schema_migration WHERE version = ${version})
         THEN 'missing'
       WHEN (SELECT name = '${name}' AND checksum = '${checksum}'
             FROM public.glidelingo_schema_migration WHERE version = ${version})
         THEN 'applied'
       ELSE 'mismatch'
     END;`,
    ['--tuples-only', '--no-align'],
  );

  if (state === 'applied') continue;
  if (state !== 'missing') {
    throw new Error(`Local migration ${version} does not match the recorded schema.`);
  }

  const body = source.replace(/^\s*BEGIN;\s*/, '').replace(/\s*COMMIT;\s*$/, '');
  runPsql(`
BEGIN;
${body}
INSERT INTO public.glidelingo_schema_migration (version, name, checksum)
VALUES (${version}, '${name}', '${checksum}');
COMMIT;
`);
  console.log(`Applied local migration ${relative(root, sourcePath)}.`);
}

console.log('Local database schema is current.');
