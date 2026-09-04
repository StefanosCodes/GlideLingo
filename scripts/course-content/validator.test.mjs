import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
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
const greekMigrationPackage = path.join(workspaceRoot, 'content', 'courses', 'en-el-GR');
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
    activities: 8,
    scenarios: 1,
    pronunciationTargets: 1,
  });
  const publication = JSON.parse(await readFile(path.join(validFixture, 'publication.json'), 'utf8'));
  assert.equal(publication.contentHash, await computeContentHash(validFixture));
});

test('a stale content hash reports the exact publication location', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'glidelingo-course-content-hash-'));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const packageDirectory = path.join(temporaryRoot, 'portability');
  await cp(validFixture, packageDirectory, { recursive: true });
  const publicationPath = path.join(packageDirectory, 'publication.json');
  const publication = JSON.parse(await readFile(publicationPath, 'utf8'));
  publication.contentHash = `sha256:${'0'.repeat(64)}`;
  await writeFile(publicationPath, `${JSON.stringify(publication, null, 2)}\n`);

  const result = await validateCoursePackage(packageDirectory, { root: temporaryRoot });
  const match = result.diagnostics.find((item) => item.code === 'content-hash');
  assert.ok(match, result.diagnostics.map(formatDiagnostic).join('\n'));
  assert.equal(match.file, 'portability/publication.json');
  assert.equal(match.pointer, '/contentHash');
  assert.match(match.message, /^must equal deterministic package hash sha256:[a-f0-9]{64}$/);
});

test('the draft Greek migration package validates without inventing a guided scenario', async () => {
  const result = await validateCoursePackage(greekMigrationPackage);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.stats, {
    capabilities: 1,
    modules: 1,
    missions: 1,
    lessons: 1,
    activities: 13,
    scenarios: 0,
    pronunciationTargets: 1,
  });
  const publication = JSON.parse(await readFile(path.join(greekMigrationPackage, 'publication.json'), 'utf8'));
  assert.equal(publication.status, 'draft');
  assert.equal(publication.contentHash, await computeContentHash(greekMigrationPackage));
});

test('duplicate audio clip IDs report the exact second manifest location', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'glidelingo-course-audio-duplicate-'));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const packageDirectory = path.join(temporaryRoot, 'en-el-GR');
  await cp(greekMigrationPackage, packageDirectory, { recursive: true });
  const manifestPath = path.join(packageDirectory, 'audio-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const duplicateIndex = manifest.clips.length;
  manifest.clips.push(structuredClone(manifest.clips[0]));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = await validateCoursePackage(packageDirectory, { root: temporaryRoot });
  const match = result.diagnostics.find((item) => item.code === 'duplicate-id');
  assert.ok(match, result.diagnostics.map(formatDiagnostic).join('\n'));
  assert.equal(match.file, 'en-el-GR/audio-manifest.json');
  assert.equal(match.pointer, `/clips/${duplicateIndex}/id`);
});

test('nested choice and scenario observation IDs reject their exact second locations', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'glidelingo-course-nested-duplicates-'));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const packageDirectory = path.join(temporaryRoot, 'portability');
  await cp(validFixture, packageDirectory, { recursive: true });
  const missionPath = path.join(packageDirectory, 'missions', 'portable-request-mission.json');
  const mission = JSON.parse(await readFile(missionPath, 'utf8'));
  const choices = mission.lessons[0].activities.find(
    (item) => item.id === 'portable-symbol-choice',
  ).choices;
  choices[1].id = choices[0].id;
  choices[1].text = choices[0].text;
  await writeFile(missionPath, `${JSON.stringify(mission, null, 2)}\n`);
  const scenarioPath = path.join(packageDirectory, 'scenarios', 'portable-service-scenario.json');
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  scenario.successObservations.push({
    ...structuredClone(scenario.successObservations[0]),
    description: 'A distinct description cannot make a duplicate observation ID deterministic.',
  });
  await writeFile(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`);

  const result = await validateCoursePackage(packageDirectory, { root: temporaryRoot });
  const duplicateLocations = result.diagnostics
    .filter((item) => item.code === 'duplicate-id')
    .map((item) => `${item.file}${item.pointer}`);
  assert.ok(duplicateLocations.includes(
    'portability/missions/portable-request-mission.json/lessons/0/activities/1/choices/1/id',
  ));
  assert.ok(duplicateLocations.includes(
    'portability/scenarios/portable-service-scenario.json/successObservations/1/id',
  ));
  const duplicateChoiceText = result.diagnostics.find((item) =>
    item.code === 'duplicate-choice'
    && item.pointer === '/lessons/0/activities/1/choices/1/text');
  assert.ok(duplicateChoiceText, result.diagnostics.map(formatDiagnostic).join('\n'));
});

test('an asset path cannot escape the package through an intermediate symlink', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'glidelingo-course-symlink-'));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const packageDirectory = path.join(temporaryRoot, 'portability');
  await cp(validFixture, packageDirectory, { recursive: true });
  const outsideDirectory = path.join(temporaryRoot, 'outside');
  await cp(path.join(packageDirectory, 'assets'), outsideDirectory, { recursive: true });
  await writeFile(path.join(outsideDirectory, 'secret.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  await symlink(outsideDirectory, path.join(packageDirectory, 'linked-assets'));
  const missionPath = path.join(packageDirectory, 'missions', 'portable-request-mission.json');
  const mission = JSON.parse(await readFile(missionPath, 'utf8'));
  mission.assets[0].path = 'linked-assets/secret.svg';
  await writeFile(missionPath, `${JSON.stringify(mission, null, 2)}\n`);

  const result = await validateCoursePackage(packageDirectory, { root: temporaryRoot });
  const match = result.diagnostics.find((item) => item.code === 'missing-asset');
  assert.ok(match, result.diagnostics.map(formatDiagnostic).join('\n'));
  assert.equal(match.file, 'portability/missions/portable-request-mission.json');
  assert.equal(match.pointer, '/assets/0/path');
});

test('opportunity minimums use exact practice, demonstration, and retention eligibility', async (t) => {
  const cases = [
    { eligibility: 'practice', rule: 'practiceEvidence', activityId: 'portable-recall' },
    { eligibility: 'demonstration', rule: 'demonstrationCriteria', activityId: 'portable-roleplay' },
    { eligibility: 'retention', rule: 'retentionCriteria', activityId: 'portable-review' },
  ];
  for (const testCase of cases) {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `glidelingo-course-${testCase.eligibility}-`));
    t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
    const packageDirectory = path.join(temporaryRoot, 'portability');
    await cp(validFixture, packageDirectory, { recursive: true });
    const missionPath = path.join(packageDirectory, 'missions', 'portable-request-mission.json');
    const mission = JSON.parse(await readFile(missionPath, 'utf8'));
    const activity = mission.lessons[0].activities.find((item) => item.id === testCase.activityId);
    assert.ok(activity);
    activity.evidenceEligibility = 'none';
    await writeFile(missionPath, `${JSON.stringify(mission, null, 2)}\n`);

    const result = await validateCoursePackage(packageDirectory, { root: temporaryRoot });
    const match = result.diagnostics.find((item) =>
      item.code === 'insufficient-opportunities'
      && item.pointer === `/capabilities/0/${testCase.rule}/minimumOpportunities`);
    assert.ok(match, `${testCase.eligibility}: ${result.diagnostics.map(formatDiagnostic).join('\n')}`);
    assert.match(match.message, new RegExp(`2 ${testCase.eligibility} opportunities but only 1`));
  }
});

test('assessment leakage resolves learner-visible answers instead of opaque choice IDs', async (t) => {
  async function packageWithClonedCheckpoint(suffix, promptSuffix = '') {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), `glidelingo-course-leak-${suffix}-`));
    t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
    const packageDirectory = path.join(temporaryRoot, 'portability');
    await cp(validFixture, packageDirectory, { recursive: true });
    const missionPath = path.join(packageDirectory, 'missions', 'portable-request-mission.json');
    const mission = JSON.parse(await readFile(missionPath, 'utf8'));
    const activities = mission.lessons[0].activities;
    const practice = structuredClone(activities.find((item) => item.id === 'portable-symbol-choice'));
    const checkpointIndex = activities.findIndex((item) => item.id === 'portable-checkpoint');
    practice.id = 'portable-checkpoint';
    practice.phase = 'perform';
    practice.usage = 'assessment';
    practice.assessmentEligible = true;
    practice.evidenceEligibility = 'demonstration';
    practice.prompt += promptSuffix;
    practice.choices = practice.choices.map((choice) => ({ ...choice, id: `renamed-${choice.id}` }));
    practice.acceptedChoiceIds = practice.acceptedChoiceIds.map((id) => `renamed-${id}`);
    practice.choices.reverse();
    activities[checkpointIndex] = practice;
    await writeFile(missionPath, `${JSON.stringify(mission, null, 2)}\n`);
    return { packageDirectory, temporaryRoot };
  }

  const cloned = await packageWithClonedCheckpoint('exact');
  const clonedResult = await validateCoursePackage(cloned.packageDirectory, { root: cloned.temporaryRoot });
  const leak = clonedResult.diagnostics.find((item) => item.code === 'assessment-leak');
  assert.ok(leak, clonedResult.diagnostics.map(formatDiagnostic).join('\n'));
  assert.equal(leak.file, 'portability/missions/portable-request-mission.json');
  assert.equal(leak.pointer, '/checkpointActivityIds/1');

  const reviewRoot = await mkdtemp(path.join(os.tmpdir(), 'glidelingo-course-review-leak-'));
  t.after(() => rm(reviewRoot, { force: true, recursive: true }));
  const reviewPackage = path.join(reviewRoot, 'portability');
  await cp(validFixture, reviewPackage, { recursive: true });
  const reviewMissionPath = path.join(reviewPackage, 'missions', 'portable-request-mission.json');
  const reviewMission = JSON.parse(await readFile(reviewMissionPath, 'utf8'));
  const reviewActivities = reviewMission.lessons[0].activities;
  const exposedCheckpoint = structuredClone(
    reviewActivities.find((item) => item.id === 'portable-checkpoint'),
  );
  const reviewIndex = reviewActivities.findIndex((item) => item.id === 'portable-review');
  exposedCheckpoint.id = 'portable-review';
  exposedCheckpoint.phase = 'revisit';
  exposedCheckpoint.usage = 'review';
  exposedCheckpoint.evidenceEligibility = 'retention';
  reviewActivities[reviewIndex] = exposedCheckpoint;
  await writeFile(reviewMissionPath, `${JSON.stringify(reviewMission, null, 2)}\n`);
  const reviewResult = await validateCoursePackage(reviewPackage, { root: reviewRoot });
  const reviewLeak = reviewResult.diagnostics.find((item) =>
    item.code === 'assessment-leak' && item.pointer === '/reviewActivityIds/0');
  assert.ok(reviewLeak, reviewResult.diagnostics.map(formatDiagnostic).join('\n'));

  const distinct = await packageWithClonedCheckpoint('distinct', ' in a changed context');
  const distinctResult = await validateCoursePackage(distinct.packageDirectory, { root: distinct.temporaryRoot });
  assert.equal(distinctResult.diagnostics.some((item) => item.code === 'assessment-leak'), false);
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

test('precompiled runtime validators are current and contain no runtime code generation', async () => {
  const generator = path.join(workspaceRoot, 'scripts', 'course-content', 'generate-runtime-validators.mjs');
  const result = spawnSync(process.execPath, [generator, '--check'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const generated = await readFile(path.join(
    workspaceRoot,
    'src/features/course-catalog/loader/course-schema-validators.generated.js',
  ), 'utf8');
  const runtimeBoundary = await readFile(path.join(
    workspaceRoot,
    'src/features/course-catalog/loader/course-schema-validator.ts',
  ), 'utf8');
  const runtimeCompiler = /new Function|ajv\/dist\/(?:2020|core|compile|standalone)/;
  assert.doesNotMatch(generated, runtimeCompiler);
  assert.doesNotMatch(runtimeBoundary, runtimeCompiler);
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
