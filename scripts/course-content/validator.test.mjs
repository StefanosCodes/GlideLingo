import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  computeContentHash,
  formatDiagnostic,
  schemaDirectory,
  validateCoursePackage,
  workspaceRoot,
} from './validator.mjs';

const validFixture = path.join(workspaceRoot, 'content', 'fixtures', 'course-content', 'valid', 'portability');
const invalidFixtures = path.join(workspaceRoot, 'content', 'fixtures', 'course-content', 'invalid');

function decodePointerPart(value) {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolvePointer(document, pointer) {
  if (pointer === '') return { parent: null, key: null, value: document };
  const parts = pointer.slice(1).split('/').map(decodePointerPart);
  let value = document;
  for (const part of parts) value = value[part];
  return { value };
}

function mutateAtPointer(document, operation) {
  const parts = operation.path.slice(1).split('/').map(decodePointerPart);
  const key = parts.pop();
  let parent = document;
  for (const part of parts) parent = parent[part];
  const value = operation.op === 'copy'
    ? structuredClone(resolvePointer(document, operation.from).value)
    : structuredClone(operation.value);
  if (operation.op === 'copy' && key === '-') parent.push(value);
  else parent[key] = value;
}

async function buildInvalidPackage(t, caseDirectory) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'glidelingo-course-content-'));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const packageDirectory = path.join(temporaryRoot, 'portability');
  await cp(validFixture, packageDirectory, { recursive: true });
  const fixture = JSON.parse(await readFile(path.join(invalidFixtures, caseDirectory, 'case.json'), 'utf8'));
  const operationsByFile = new Map();
  for (const operation of fixture.operations) {
    const operations = operationsByFile.get(operation.file) ?? [];
    operations.push(operation);
    operationsByFile.set(operation.file, operations);
  }
  for (const [relativeFile, operations] of operationsByFile) {
    const filename = path.join(packageDirectory, relativeFile);
    const document = JSON.parse(await readFile(filename, 'utf8'));
    for (const operation of operations) mutateAtPointer(document, operation);
    await writeFile(filename, `${JSON.stringify(document, null, 2)}\n`);
  }
  return { fixture, packageDirectory };
}

async function hashTree(directory, current = '') {
  const result = {};
  const entries = (await readdir(path.join(directory, current), { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = path.join(current, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashTree(directory, relative));
    else if (entry.isFile()) {
      result[relative.split(path.sep).join('/')] = createHash('sha256')
        .update(await readFile(path.join(directory, relative)))
        .digest('hex');
    }
  }
  return result;
}

test('the portability package validates deterministically with an exact content hash', async () => {
  const first = await validateCoursePackage(validFixture);
  const second = await validateCoursePackage(validFixture);
  assert.deepEqual(first, second);
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(first.stats, {
    capabilities: 1,
    modules: 1,
    missions: 1,
    lessons: 1,
    activities: 7,
    scenarios: 1,
    pronunciationTargets: 1,
  });
  const publication = JSON.parse(await readFile(path.join(validFixture, 'publication.json'), 'utf8'));
  assert.equal(publication.contentHash, await computeContentHash(validFixture));
});

test('the universal schema set covers every logical record in section 6', async () => {
  const requiredSchemas = [
    'activity.schema.json',
    'capabilities.schema.json',
    'course.schema.json',
    'language-profile.schema.json',
    'lesson.schema.json',
    'mission.schema.json',
    'modules.schema.json',
    'pronunciation-targets.schema.json',
    'publication.schema.json',
    'scenario.schema.json',
  ];
  const available = new Set(await readdir(schemaDirectory));
  for (const name of requiredSchemas) assert.equal(available.has(name), true, `missing ${name}`);
});

test('the authored scenario is provider-neutral and delegates only by conversationProfileId', async () => {
  const scenario = JSON.parse(await readFile(path.join(validFixture, 'scenarios', 'portable-service-scenario.json'), 'utf8'));
  assert.equal(scenario.conversationProfileId, 'fixture-bounded-turns');
  assert.equal('provider' in scenario, false);
  assert.equal('model' in scenario, false);
  assert.equal('voiceId' in scenario, false);
});

for (const caseDirectory of [
  'duplicate-ids',
  'missing-references',
  'prerequisite-cycles',
  'leaked-assessment-content',
  'bad-assets',
  'unsupported-renderer-types',
]) {
  test(`invalid fixture ${caseDirectory} reports its exact file, path, and field`, async (t) => {
    const { fixture, packageDirectory } = await buildInvalidPackage(t, caseDirectory);
    const result = await validateCoursePackage(packageDirectory, { root: path.dirname(packageDirectory) });
    const match = result.diagnostics.find((item) => item.code === fixture.expectedCode);
    assert.ok(match, result.diagnostics.map(formatDiagnostic).join('\n'));
    assert.equal(match.file, `portability/${fixture.expectedFile}`);
    assert.equal(match.pointer, fixture.expectedPointer);
  });
}

test('the CLI validates read-only with no provider credentials in its environment', async () => {
  const before = await hashTree(path.join(workspaceRoot, 'content'));
  const result = spawnSync(process.execPath, [path.join(workspaceRoot, 'scripts', 'course-content', 'cli.mjs')], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /no network or provider credentials were required/);
  assert.deepEqual(await hashTree(path.join(workspaceRoot, 'content')), before);
});
