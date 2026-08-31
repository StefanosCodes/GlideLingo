import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const LOCK_FILENAME = 'audio-lock.json';
const TRANSIENT_CODES = new Set([4, 8, 10, 13, 14, 429, 500, 502, 503, 504]);
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

export function hashClip(clip, profile) {
  return createHash('sha256')
    .update(JSON.stringify({
      text: clip.text,
      locale: profile.locale,
      voice: profile.voice,
      encoding: profile.encoding,
    }))
    .digest('hex');
}

export function estimateClips(clips, profiles) {
  return clips.reduce(
    (estimate, clip) => {
      const profile = profiles[clip.profile];
      const characters = Array.from(clip.text).length;
      return {
        characters: estimate.characters + characters,
        costUsd:
          estimate.costUsd +
          (characters / 1_000_000) * profile.priceUsdPerMillionCharacters,
      };
    },
    { characters: 0, costUsd: 0 },
  );
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

async function readJson(filename) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read valid JSON from ${filename}: ${error.message}`);
  }
}

async function readLock(lockPath) {
  try {
    return await readJson(lockPath);
  } catch (error) {
    if (error.cause?.code === 'ENOENT' || error.message.includes('ENOENT')) {
      return { schemaVersion: 1, generatedAt: null, clips: {} };
    }
    throw error;
  }
}

function applyEnvironmentOverrides(profile, env, courseLocale) {
  if (!env.GOOGLE_TTS_DEFAULT_LOCALE || env.GOOGLE_TTS_DEFAULT_LOCALE !== courseLocale) {
    return profile;
  }
  return {
    ...profile,
    voice: env.GOOGLE_TTS_DEFAULT_VOICE || profile.voice,
    encoding: env.GOOGLE_TTS_AUDIO_ENCODING || profile.encoding,
  };
}

function targetLocaleFromCourseDirectory(courseDirectory) {
  const parts = courseDirectory.split('-');
  if (parts.length < 3) throw new Error(`Course directory ${courseDirectory} must look like en-el-GR.`);
  return parts.slice(1).join('-');
}

export async function loadProject(root, env = process.env, courseDirectory = 'en-el-GR') {
  const courseDir = path.join(root, 'content', 'courses', courseDirectory);
  const courseLocale = targetLocaleFromCourseDirectory(courseDirectory);
  const profilesDocument = await readJson(path.join(courseDir, 'audio-profiles.json'));
  const manifest = await readJson(path.join(courseDir, 'audio-manifest.json'));
  assertObject(profilesDocument.profiles, 'audio-profiles.json profiles');
  if (!Array.isArray(manifest.clips)) throw new Error('audio-manifest.json clips must be an array.');

  const profiles = Object.fromEntries(
    Object.entries(profilesDocument.profiles).map(([id, profile]) => [
      id,
      applyEnvironmentOverrides(profile, env, courseLocale),
    ]),
  );
  const missionDir = path.join(courseDir, 'missions');
  const missionNames = (await readdir(missionDir)).filter((name) => name.endsWith('.json')).sort();
  const missions = await Promise.all(missionNames.map((name) => readJson(path.join(missionDir, name))));

  return {
    root,
    courseDirectory,
    courseDir,
    locale: courseLocale,
    profiles,
    clips: manifest.clips,
    missions,
    lockPath: path.join(courseDir, LOCK_FILENAME),
    assetDir: path.join(root, 'assets', 'audio', courseLocale),
    registryPath: path.join(
      root,
      'src',
      'features',
      'learning-session',
      'audio',
      'audio-sources.generated.ts',
    ),
  };
}

export async function loadProjects(root, env = process.env) {
  const coursesRoot = path.join(root, 'content', 'courses');
  const entries = await readdir(coursesRoot, { withFileTypes: true });
  const courseDirectories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await stat(path.join(coursesRoot, entry.name, 'audio-manifest.json'));
      courseDirectories.push(entry.name);
    } catch {
      // A course without an audio manifest has no generated-audio work.
    }
  }
  return Promise.all(courseDirectories.sort().map((name) => loadProject(root, env, name)));
}

export function validateDefinitions(project) {
  const errors = [];
  const clipIds = new Set();
  const lessonIds = new Set();

  for (const [profileId, profile] of Object.entries(project.profiles)) {
    try {
      assertObject(profile, `profile ${profileId}`);
      assertNonEmptyString(profile.locale, `profile ${profileId} locale`);
      assertNonEmptyString(profile.voice, `profile ${profileId} voice`);
      if (profile.locale !== project.locale) {
        errors.push(`Profile ${profileId} uses unsupported locale ${profile.locale}; expected ${project.locale}.`);
      }
      if (profile.encoding !== 'MP3') errors.push(`Profile ${profileId} uses unsupported encoding ${profile.encoding}.`);
      if (!(profile.priceUsdPerMillionCharacters >= 0)) {
        errors.push(`Profile ${profileId} has an invalid character price.`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  for (const clip of project.clips) {
    try {
      assertObject(clip, 'clip');
      assertNonEmptyString(clip.id, 'clip id');
      assertNonEmptyString(clip.lessonId, `clip ${clip.id} lessonId`);
      assertNonEmptyString(clip.profile, `clip ${clip.id} profile`);
      assertNonEmptyString(clip.text, `clip ${clip.id} text`);
      if (!SAFE_ID.test(clip.id)) errors.push(`Clip id ${clip.id} is not a safe kebab-case identifier.`);
      if (!SAFE_ID.test(clip.lessonId)) errors.push(`Lesson id ${clip.lessonId} is not a safe kebab-case identifier.`);
      if (clipIds.has(clip.id)) errors.push(`Duplicate audio clip id: ${clip.id}.`);
      clipIds.add(clip.id);
      if (!project.profiles[clip.profile]) errors.push(`Clip ${clip.id} uses missing profile ${clip.profile}.`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  for (const mission of project.missions) {
    if (lessonIds.has(mission.lessonId)) errors.push(`Duplicate mission lesson id: ${mission.lessonId}.`);
    lessonIds.add(mission.lessonId);
    if (!Array.isArray(mission.blocks)) {
      errors.push(`Mission ${mission.lessonId ?? '(unknown)'} blocks must be an array.`);
      continue;
    }
    for (const block of mission.blocks) {
      if ('audioId' in block && !clipIds.has(block.audioId)) {
        errors.push(`Mission ${mission.lessonId} references missing audio clip ${block.audioId}.`);
      }
      if (block.type === 'listen' && !block.audioId) {
        errors.push(`Listen block in mission ${mission.lessonId} requires an audioId.`);
      }
    }
  }

  for (const clip of project.clips) {
    if (!lessonIds.has(clip.lessonId)) errors.push(`Clip ${clip.id} references missing lesson ${clip.lessonId}.`);
  }
  return errors;
}

export function selectClips(clips, selection = {}) {
  const selectors = [selection.clip, selection.lesson, selection.all].filter(Boolean).length;
  if (selectors > 1) throw new Error('Use only one of --clip, --lesson, or --all.');
  const selected = selection.clip
    ? clips.filter((clip) => clip.id === selection.clip)
    : selection.lesson
      ? clips.filter((clip) => clip.lessonId === selection.lesson)
      : clips;
  if (selected.length === 0) throw new Error('The selection did not match any audio clips.');
  return selected;
}

export async function withRetry(operation, { attempts = 3, delay = async () => {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const code = Number(error.code ?? error.status ?? error.statusCode);
      if (!TRANSIENT_CODES.has(code) || attempt === attempts) throw error;
      await delay(attempt);
    }
  }
  throw lastError;
}

async function writeAtomically(filename, data) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, filename);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeAtomicallyIfChanged(filename, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  try {
    if ((await readFile(filename)).equals(bytes)) return false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeAtomically(filename, bytes);
  return true;
}

function lockEntry(clip, profile, sourceHash) {
  return {
    lessonId: clip.lessonId,
    locale: profile.locale,
    voice: profile.voice,
    sourceTextHash: sourceHash,
    outputFilename: `${clip.id}.mp3`,
    encoding: profile.encoding,
  };
}

function lockDocument(clips, generatedAt) {
  return {
    schemaVersion: 1,
    generatedAt,
    clips: Object.fromEntries(Object.entries(clips).sort(([a], [b]) => a.localeCompare(b))),
  };
}

async function writeLock(lockPath, clips, generatedAt) {
  const document = lockDocument(clips, generatedAt);
  await writeAtomicallyIfChanged(lockPath, `${JSON.stringify(document, null, 2)}\n`);
  return document;
}

function renderRegistry(entriesById) {
  const entries = Object.entries(entriesById).sort(([left], [right]) => left.localeCompare(right));
  const lines = entries.map(
    ([id, entry]) => `  ${JSON.stringify(id)}: require(${JSON.stringify(`../../../../assets/audio/${entry.locale}/${entry.outputFilename}`)}),`,
  );
  return [
    '// This file is generated by npm run audio:generate. Do not edit by hand.',
    "import type { AudioSource } from 'expo-audio';",
    '',
    'export const audioSources: Readonly<Record<string, AudioSource>> = {',
    ...lines,
    '};',
    '',
  ].join('\n');
}

export async function generateAudio({
  project,
  clips,
  synthesize,
  maxUsd,
  now = () => new Date(),
  writeRegistry = true,
}) {
  const definitionErrors = validateDefinitions(project);
  if (definitionErrors.length) throw new Error(definitionErrors.join('\n'));
  const estimate = estimateClips(clips, project.profiles);
  if (!Number.isFinite(maxUsd) || maxUsd < 0) throw new Error('GOOGLE_TTS_MAX_GENERATION_USD must be a non-negative number.');
  if (estimate.costUsd > maxUsd) {
    throw new Error(`Estimated cost $${estimate.costUsd.toFixed(6)} exceeds the $${maxUsd.toFixed(2)} generation limit.`);
  }

  const lock = await readLock(project.lockPath);
  const nextClips = { ...(lock.clips ?? {}) };
  const generated = [];
  const skipped = [];
  let batchGeneratedAt = null;

  for (const clip of clips) {
    const profile = project.profiles[clip.profile];
    const sourceHash = hashClip(clip, profile);
    const entry = lockEntry(clip, profile, sourceHash);
    const destination = path.join(project.assetDir, entry.outputFilename);
    let unchanged = false;
    try {
      unchanged = lock.clips?.[clip.id]?.sourceTextHash === sourceHash && (await stat(destination)).size > 0;
    } catch {
      unchanged = false;
    }
    if (unchanged) {
      nextClips[clip.id] = entry;
      skipped.push(clip.id);
      continue;
    }

    const audio = await withRetry(
      () => synthesize({ clip, profile }),
      { attempts: 3, delay: (attempt) => new Promise((resolve) => setTimeout(resolve, attempt * 250)) },
    );
    const bytes = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
    if (bytes.length === 0) throw new Error(`Google returned empty audio for ${clip.id}.`);
    await writeAtomically(destination, bytes);
    nextClips[clip.id] = entry;
    generated.push(clip.id);
    batchGeneratedAt ??= now().toISOString();
    await writeLock(project.lockPath, nextClips, batchGeneratedAt);
  }

  const nextLock = await writeLock(project.lockPath, nextClips, batchGeneratedAt ?? lock.generatedAt);
  if (writeRegistry) await writeAtomicallyIfChanged(project.registryPath, renderRegistry(nextLock.clips));
  return { estimate, generated, skipped, lock: nextLock };
}

export async function writeAudioRegistry(projects) {
  const entries = {};
  for (const project of projects) {
    const lock = await readLock(project.lockPath);
    for (const [id, entry] of Object.entries(lock.clips ?? {})) {
      if (entries[id]) throw new Error(`Duplicate generated audio clip id across courses: ${id}.`);
      entries[id] = entry;
    }
  }
  const registryPath = projects[0]?.registryPath;
  if (!registryPath) throw new Error('No audio-enabled course manifests were found.');
  await writeAtomicallyIfChanged(registryPath, renderRegistry(entries));
}

async function listMp3Files(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.mp3'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function validateGenerated(project) {
  const errors = validateDefinitions(project);
  const lock = await readLock(project.lockPath);
  const expectedFiles = new Set();
  for (const clip of project.clips) {
    const profile = project.profiles[clip.profile];
    if (!profile) continue;
    const entry = lock.clips?.[clip.id];
    if (!entry) {
      errors.push(`Clip ${clip.id} is missing from ${LOCK_FILENAME}.`);
      continue;
    }
    if (entry.sourceTextHash !== hashClip(clip, profile)) errors.push(`Clip ${clip.id} has a stale source hash.`);
    if (entry.locale !== profile.locale || entry.voice !== profile.voice || entry.encoding !== profile.encoding) {
      errors.push(`Clip ${clip.id} has stale voice metadata.`);
    }
    const expectedFilename = `${clip.id}.mp3`;
    if (entry.outputFilename !== expectedFilename) {
      errors.push(`Clip ${clip.id} has unexpected output filename ${entry.outputFilename}.`);
      continue;
    }
    expectedFiles.add(expectedFilename);
    try {
      if ((await stat(path.join(project.assetDir, expectedFilename))).size === 0) {
        errors.push(`Audio file ${expectedFilename} is empty.`);
      }
    } catch {
      errors.push(`Audio file ${expectedFilename} is missing.`);
    }
  }
  for (const id of Object.keys(lock.clips ?? {})) {
    if (!project.clips.some((clip) => clip.id === id)) errors.push(`Lock contains orphaned clip ${id}.`);
  }
  for (const filename of await listMp3Files(project.assetDir)) {
    if (!expectedFiles.has(filename)) errors.push(`Audio directory contains orphaned file ${filename}.`);
  }
  return errors;
}
