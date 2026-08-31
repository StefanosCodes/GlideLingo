#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  estimateClips,
  generateAudio,
  loadProjects,
  validateDefinitions,
  validateGenerated,
  writeAudioRegistry,
} from './audio-tool.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '..', '..');

function parseArguments(argv) {
  const result = { command: 'estimate', selection: {} };
  const argumentsToRead = [...argv];
  if (['estimate', 'generate', 'validate'].includes(argumentsToRead[0])) {
    result.command = argumentsToRead.shift();
  }
  while (argumentsToRead.length) {
    const argument = argumentsToRead.shift();
    if (argument === '--estimate') result.command = 'estimate';
    else if (argument === '--all') result.selection.all = true;
    else if (argument === '--clip' || argument === '--lesson') {
      const value = argumentsToRead.shift();
      if (!value) throw new Error(`${argument} requires a value.`);
      result.selection[argument.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function selectAcrossProjects(projects, selection) {
  const selectors = [selection.clip, selection.lesson, selection.all].filter(Boolean).length;
  if (selectors > 1) throw new Error('Use only one of --clip, --lesson, or --all.');
  const selections = projects
    .map((project) => ({
      project,
      clips: project.clips.filter((clip) =>
        selection.clip ? clip.id === selection.clip : selection.lesson ? clip.lessonId === selection.lesson : true,
      ),
    }))
    .filter(({ clips }) => clips.length);
  if (!selections.length) throw new Error('The selection did not match any audio clips.');
  return selections;
}

function printEstimate(selections) {
  const estimate = selections.reduce(
    (total, { clips, project }) => {
      const current = estimateClips(clips, project.profiles);
      return { characters: total.characters + current.characters, costUsd: total.costUsd + current.costUsd };
    },
    { characters: 0, costUsd: 0 },
  );
  console.log(`Clips: ${selections.reduce((count, item) => count + item.clips.length, 0)}`);
  console.log(`Characters: ${estimate.characters.toLocaleString('en-US')}`);
  console.log(`Estimated Google TTS cost: $${estimate.costUsd.toFixed(6)}`);
  return estimate;
}

async function createGoogleSynthesizer(projectId) {
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT is required for generation.');
  const { TextToSpeechClient } = await import('@google-cloud/text-to-speech');
  const client = new TextToSpeechClient({ projectId });
  return async ({ clip, profile }) => {
    const [response] = await client.synthesizeSpeech({
      input: { text: clip.text },
      voice: { languageCode: profile.locale, name: profile.voice },
      audioConfig: { audioEncoding: profile.encoding },
    });
    if (!response.audioContent) throw new Error(`Google returned no audio for ${clip.id}.`);
    return response.audioContent;
  };
}

async function main() {
  const { command, selection } = parseArguments(process.argv.slice(2));
  const projects = await loadProjects(root);
  if (!projects.length) throw new Error('No audio-enabled course manifests were found.');
  const definitionErrors = projects.flatMap((project) => validateDefinitions(project));
  const allIds = new Set();
  for (const project of projects) {
    for (const clip of project.clips) {
      if (allIds.has(clip.id)) definitionErrors.push(`Duplicate audio clip id across courses: ${clip.id}.`);
      allIds.add(clip.id);
    }
  }
  if (definitionErrors.length) throw new Error(definitionErrors.join('\n'));

  if (command === 'validate') {
    const errors = (await Promise.all(projects.map(validateGenerated))).flat();
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Validated ${allIds.size} clips and their bundled MP3 assets.`);
    return;
  }

  const selections = selectAcrossProjects(projects, selection);
  const estimate = printEstimate(selections);
  if (command === 'estimate') {
    console.log('Estimate only; no files were written and no Google API call was made.');
    return;
  }

  const maxUsd = Number(process.env.GOOGLE_TTS_MAX_GENERATION_USD ?? '5');
  if (estimate.costUsd > maxUsd) {
    throw new Error(`Estimated cost exceeds GOOGLE_TTS_MAX_GENERATION_USD=${maxUsd}.`);
  }
  const synthesize = await createGoogleSynthesizer(process.env.GOOGLE_CLOUD_PROJECT);
  const results = [];
  for (const { project, clips } of selections) {
    results.push(await generateAudio({ project, clips, synthesize, maxUsd, writeRegistry: false }));
  }
  await writeAudioRegistry(projects);
  console.log(
    `Generated: ${results.reduce((count, result) => count + result.generated.length, 0)}; unchanged: ${results.reduce((count, result) => count + result.skipped.length, 0)}.`,
  );
}

main().catch((error) => {
  console.error(`Audio command failed: ${error.message}`);
  process.exitCode = 1;
});
