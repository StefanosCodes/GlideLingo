import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  estimateClips,
  generateAudio,
  hashClip,
  selectClips,
  validateDefinitions,
  validateGenerated,
  withRetry,
} from './audio-tool.mjs';

function fixture(root) {
  const profile = {
    locale: 'el-GR',
    voice: 'el-GR-Chirp3-HD-Aoede',
    encoding: 'MP3',
    priceUsdPerMillionCharacters: 30,
  };
  return {
    project: {
      root,
      courseDir: path.join(root, 'content'),
      locale: 'el-GR',
      profiles: { primary: profile },
      clips: [{ id: 'hello', lessonId: 'lesson-1', profile: 'primary', text: 'Καλημέρα.' }],
      missions: [{ lessonId: 'lesson-1', blocks: [{ type: 'listen', label: 'Hello', audioId: 'hello' }] }],
      lockPath: path.join(root, 'content', 'audio-lock.json'),
      assetDir: path.join(root, 'assets'),
      registryPath: path.join(root, 'registry.ts'),
    },
    profile,
  };
}

async function temporaryFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'glidelingo-audio-'));
  t.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { force: true, recursive: true });
  });
  await mkdir(path.join(root, 'content'), { recursive: true });
  return fixture(root);
}

test('estimate and selection are deterministic and write nothing', async (t) => {
  const { project } = await temporaryFixture(t);
  const clips = selectClips(project.clips, { lesson: 'lesson-1' });
  assert.deepEqual(estimateClips(clips, project.profiles), { characters: 9, costUsd: 0.00027 });
  assert.equal((await readdir(project.root)).includes('registry.ts'), false);
});

test('definitions reject duplicates, missing references, and unsupported locales', async (t) => {
  const { project } = await temporaryFixture(t);
  project.clips.push({ ...project.clips[0] });
  project.clips[0].id = '../unsafe';
  project.clips.push({ ...project.clips[1] });
  project.missions[0].blocks.push({ type: 'listen', label: 'Missing', audioId: 'not-there' });
  project.profiles.primary.locale = 'xx-ZZ';
  const errors = validateDefinitions(project).join('\n');
  assert.match(errors, /Duplicate audio clip id/);
  assert.match(errors, /not a safe kebab-case identifier/);
  assert.match(errors, /missing audio clip/);
  assert.match(errors, /unsupported locale/);
});

test('generation enforces the cost ceiling before synthesis', async (t) => {
  const { project } = await temporaryFixture(t);
  let calls = 0;
  await assert.rejects(
    generateAudio({ project, clips: project.clips, maxUsd: 0, synthesize: async () => { calls += 1; } }),
    /exceeds/,
  );
  assert.equal(calls, 0);
});

test('generation writes atomically and skips an unchanged clip', async (t) => {
  const { project } = await temporaryFixture(t);
  let calls = 0;
  const synthesize = async () => {
    calls += 1;
    return Buffer.from('fake mp3');
  };
  const first = await generateAudio({ project, clips: project.clips, synthesize, maxUsd: 1 });
  const firstLockContents = await readFile(project.lockPath, 'utf8');
  const second = await generateAudio({ project, clips: project.clips, synthesize, maxUsd: 1 });
  assert.deepEqual(first.generated, ['hello']);
  assert.deepEqual(second.skipped, ['hello']);
  assert.equal(calls, 1);
  assert.equal(await readFile(project.lockPath, 'utf8'), firstLockContents);
  assert.equal(await readFile(path.join(project.assetDir, 'hello.mp3'), 'utf8'), 'fake mp3');
  assert.deepEqual((await readdir(project.assetDir)).filter((name) => name.endsWith('.tmp')), []);
  assert.match(await readFile(project.registryPath, 'utf8'), /require\("\.\.\/\.\.\/\.\.\/\.\.\/assets\/audio\/el-GR\/hello\.mp3"\)/);
});

test('a permanent synthesis failure leaves no partial output', async (t) => {
  const { project } = await temporaryFixture(t);
  await assert.rejects(
    generateAudio({
      project,
      clips: project.clips,
      maxUsd: 1,
      synthesize: async () => {
        throw Object.assign(new Error('invalid voice'), { code: 3 });
      },
    }),
    /invalid voice/,
  );
  assert.deepEqual((await readdir(project.root)).sort(), ['content']);
  assert.deepEqual(await readdir(project.courseDir), []);
});

test('retry handles transient errors but preserves permanent failures', async () => {
  let attempts = 0;
  const value = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error('quota'), { code: 8 });
      return 'ok';
    },
    { attempts: 3 },
  );
  assert.equal(value, 'ok');
  assert.equal(attempts, 3);
  await assert.rejects(withRetry(async () => { throw Object.assign(new Error('bad request'), { code: 3 }); }), /bad request/);
});

test('validation catches stale hashes, missing files, and orphaned files', async (t) => {
  const { project, profile } = await temporaryFixture(t);
  await mkdir(project.assetDir, { recursive: true });
  await writeFile(path.join(project.assetDir, 'orphan.mp3'), 'orphan');
  await writeFile(
    project.lockPath,
    JSON.stringify({
      schemaVersion: 1,
      clips: {
        hello: {
          locale: profile.locale,
          voice: profile.voice,
          encoding: profile.encoding,
          sourceTextHash: `${hashClip(project.clips[0], profile)}-stale`,
          outputFilename: 'hello.mp3',
        },
      },
    }),
  );
  const errors = (await validateGenerated(project)).join('\n');
  assert.match(errors, /stale source hash/);
  assert.match(errors, /hello\.mp3 is missing/);
  assert.match(errors, /orphaned file orphan\.mp3/);
});
