import { execFile, spawn } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import {
  HOLDOUT_CASES,
  TUNING_CASES,
  gradeConversationBatch,
  privacySafeEvaluationReport,
  passesHoldout,
  proposeScenarioCandidates,
  selectCandidate,
  summarizeGrades,
} from './evaluator.mjs';
import {
  LIVE_MODEL,
  LIVE_VOICE,
  MAX_REALTIME_SESSIONS,
  ROOT,
  applyScenarioCandidate,
  assertSuccessfulReport,
  createBoundedSessionCounter,
  createPublishedFixture,
  readLiveConfiguration,
  safeReport,
  sanitizedChildEnvironment,
  startHarnessServer,
} from './support.mjs';

const execFileAsync = promisify(execFile);
const children = new Set();
let fixture = null;
let compileRoot = null;
let evidenceHeadSha = null;

try {
  const config = readLiveConfiguration();
  const childEnvironment = sanitizedChildEnvironment(process.env);
  const consumeSessionSlot = createBoundedSessionCounter(MAX_REALTIME_SESSIONS);
  await access(config.chromePath);
  const { stdout: initialStatus } = await execFileAsync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: ROOT, encoding: 'utf8', env: childEnvironment },
  );
  if (initialStatus.trim()) {
    throw new Error('Commit or stash tracked work before binding paid Voice evidence to Git HEAD.');
  }
  const { stdout: initialHeadShaOutput } = await execFileAsync(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: ROOT, encoding: 'utf8', env: childEnvironment },
  );
  evidenceHeadSha = initialHeadShaOutput.trim();
  fixture = await createPublishedFixture();
  const baselineScenario = JSON.parse(await readFile(fixture.scenarioPath, 'utf8'));
  const baselineCandidate = {
    id: 'baseline',
    rolePersona: baselineScenario.role.persona,
    authoredOpening: baselineScenario.authoredOpening,
    safeExits: baselineScenario.safeExits,
    rationale: 'Checked-in authored scenario.',
  };

  compileRoot = await mkdtemp(join(tmpdir(), 'glidelingo-voice-live-ts-'));
  await compileBrowserAdapter(compileRoot, childEnvironment);
  const tutorPort = 18131;
  const tutorEnvironment = {
    ...childEnvironment,
    UV_CACHE_DIR: join(fixture.temporaryRoot, 'uv-cache'),
    OPENAI_API_KEY: config.apiKey,
    GLIDELINGO_TUTOR_VOICE_ENABLED: 'true',
    GLIDELINGO_TUTOR_OPENAI_REALTIME_MODEL: LIVE_MODEL,
    GLIDELINGO_TUTOR_OPENAI_REALTIME_VOICE_ID: LIVE_VOICE,
    GLIDELINGO_TUTOR_CONTENT_ROOT: fixture.contentRoot,
  };
  if (config.projectId) tutorEnvironment.OPENAI_PROJECT_ID = config.projectId;
  const tutor = trackedSpawn(
    'uv',
    [
      'run',
      '--directory',
      join(ROOT, 'services/lesson-tutor'),
      '--locked',
      'fastapi',
      'run',
      'app/main.py',
      '--host',
      '127.0.0.1',
      '--port',
      String(tutorPort),
    ],
    {
      cwd: ROOT,
      env: tutorEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const tutorOutput = captureOutput(tutor);
  const tutorBaseUrl = 'http://127.0.0.1:' + tutorPort;
  await waitForHealth(tutorBaseUrl + '/health/live', tutor, tutorOutput);

  const context = {
    chromePath: config.chromePath,
    compiledAdapterPath: join(compileRoot, 'providers', 'openai-realtime.web.js'),
    tutorBaseUrl,
    fixture,
    projectId: config.projectId,
    credentialScope: config.credentialScope,
    childEnvironment,
    consumeSessionSlot,
  };
  const transportReports = [];

  await applyScenarioCandidate(fixture, baselineCandidate);
  const baselineTuning = await runBatch(
    TUNING_CASES,
    'baseline-tuning',
    context,
    transportReports,
  );
  const baselineGrades = await gradeConversationBatch({
    apiKey: config.apiKey,
    projectId: config.projectId,
    cases: baselineTuning,
  });
  discardTranscripts(baselineTuning);
  const baselineSummary = summarizeGrades(baselineGrades);

  const candidateDefinitions = await proposeScenarioCandidates({
    apiKey: config.apiKey,
    projectId: config.projectId,
    scenario: baselineScenario,
    baselineSummary,
  });
  const evaluatedCandidates = [];
  for (const candidate of candidateDefinitions) {
    await applyScenarioCandidate(fixture, candidate);
    const conversations = await runBatch(
      TUNING_CASES,
      candidate.id + '-tuning',
      context,
      transportReports,
    );
    const grades = await gradeConversationBatch({
      apiKey: config.apiKey,
      projectId: config.projectId,
      cases: conversations,
    });
    discardTranscripts(conversations);
    evaluatedCandidates.push({ candidate, summary: summarizeGrades(grades) });
  }

  const selected = selectCandidate(baselineSummary, evaluatedCandidates);
  await applyScenarioCandidate(fixture, baselineCandidate);
  const baselineHoldoutConversations = await runBatch(
    HOLDOUT_CASES,
    'baseline-holdout',
    context,
    transportReports,
  );
  const baselineHoldoutGrades = await gradeConversationBatch({
    apiKey: config.apiKey,
    projectId: config.projectId,
    cases: baselineHoldoutConversations,
  });
  discardTranscripts(baselineHoldoutConversations);
  const baselineHoldout = summarizeGrades(baselineHoldoutGrades);

  let candidateHoldout = null;
  let recommendation = {
    selected: 'baseline',
    reason: selected
      ? 'Candidate did not pass the independent holdout.'
      : 'No candidate cleared the tuning improvement threshold.',
    candidate: null,
  };
  if (selected) {
    await applyScenarioCandidate(fixture, selected.candidate);
    const candidateHoldoutConversations = await runBatch(
      HOLDOUT_CASES,
      selected.candidate.id + '-holdout',
      context,
      transportReports,
    );
    const candidateHoldoutGrades = await gradeConversationBatch({
      apiKey: config.apiKey,
      projectId: config.projectId,
      cases: candidateHoldoutConversations,
    });
    discardTranscripts(candidateHoldoutConversations);
    candidateHoldout = summarizeGrades(candidateHoldoutGrades);
    const passedHoldout = passesHoldout(baselineHoldout, candidateHoldout);
    if (passedHoldout) {
      recommendation = {
        selected: selected.candidate.id,
        reason: 'Candidate improved tuning performance and passed the independent holdout.',
        candidate: selected.candidate,
      };
    }
  }

  await applyScenarioCandidate(fixture, baselineCandidate);
  const { stdout: finalHeadShaOutput } = await execFileAsync(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: ROOT, encoding: 'utf8', env: childEnvironment },
  );
  const { stdout: finalStatus } = await execFileAsync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: ROOT, encoding: 'utf8', env: childEnvironment },
  );
  if (finalHeadShaOutput.trim() !== evidenceHeadSha || finalStatus.trim()) {
    throw new Error('Git HEAD or the worktree changed during the paid Voice evaluation.');
  }
  const report = privacySafeEvaluationReport({
    headSha: evidenceHeadSha,
    projectId: config.projectId,
    credentialScope: config.credentialScope,
    contentHash: fixture.contentHash,
    baselineSummary,
    candidates: evaluatedCandidates,
    recommendation,
    holdout: { baseline: baselineHoldout, candidate: candidateHoldout },
    transportReports,
  });
  const reportPath = join(ROOT, '.voice-live', 'latest.json');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await chmod(reportPath, 0o600);
  process.stdout.write(JSON.stringify({
    status: 'passed',
    reportPath,
    recommendation: report.recommendation,
    sessionsRun: transportReports.length,
  }, null, 2) + '\n');
} finally {
  await Promise.all([...children].map(stop));
  if (compileRoot) await rm(compileRoot, { recursive: true, force: true });
  if (fixture?.temporaryRoot) await rm(fixture.temporaryRoot, { recursive: true, force: true });
}

async function runBatch(cases, phase, context, transportReports) {
  const results = [];
  for (const testCase of cases) {
    const result = await runConversation(testCase, context);
    const report = safeReport(result, {
      projectId: context.projectId,
      credentialScope: context.credentialScope,
      contentHash: context.fixture.contentHash,
    });
    assertSuccessfulReport(report);
    transportReports.push({ phase, caseId: testCase.id, ...report });
    results.push({ ...testCase, result });
  }
  return results;
}

async function runConversation(testCase, context) {
  let chrome = null;
  let harness = null;
  let profile = null;
  try {
    harness = await startHarnessServer({
      compiledAdapterPath: context.compiledAdapterPath,
      tutorBaseUrl: context.tutorBaseUrl,
      fixturePath: join(ROOT, 'assets/audio/el-GR', testCase.file),
      consumeSessionSlot: context.consumeSessionSlot,
    });
    profile = await mkdtemp(join(tmpdir(), 'glidelingo-voice-live-chrome-'));
    chrome = trackedSpawn(context.chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--user-data-dir=' + profile,
      harness.url,
    ], { env: context.childEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
    return await Promise.race([
      harness.completion,
      timeoutFailure('Live Voice conversation exceeded 45 seconds.', 45_000),
      processExit(chrome, 'Chrome'),
    ]);
  } finally {
    let cleanupError;
    try {
      await harness?.close();
    } catch (error) {
      cleanupError = error;
    }
    await stop(chrome);
    if (profile) await rm(profile, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  }
}

function discardTranscripts(cases) {
  for (const item of cases) {
    item.result.learnerTranscripts = [];
    item.result.coachTranscripts = [];
  }
}

async function compileBrowserAdapter(outputRoot, env) {
  await run(join(ROOT, 'node_modules/.bin/tsc'), [
    join(ROOT, 'src/features/speak/providers/openai-realtime.web.ts'),
    join(ROOT, 'src/features/speak/providers/openai-realtime.types.ts'),
    '--ignoreConfig',
    '--target',
    'ES2022',
    '--module',
    'ES2022',
    '--moduleResolution',
    'Bundler',
    '--lib',
    'ES2022,DOM',
    '--skipLibCheck',
    '--outDir',
    outputRoot,
  ], env);
}

async function run(command, args, env) {
  const childRoot = trackedSpawn(command, args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = captureOutput(childRoot);
  const code = await new Promise((resolvePromise, rejectPromise) => {
    childRoot.once('error', rejectPromise);
    childRoot.once('exit', resolvePromise);
  });
  if (code !== 0) throw new Error('Command failed (' + code + '): ' + output());
}

function trackedSpawn(command, args, options) {
  const child = spawn(command, args, options);
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function captureOutput(child) {
  let output = '';
  child.stdout?.on('data', (chunk) => {
    output = (output + chunk).slice(-8_000);
  });
  child.stderr?.on('data', (chunk) => {
    output = (output + chunk).slice(-8_000);
  });
  return () => output;
}

async function waitForHealth(url, child, output) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Tutor service exited early: ' + output());
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error('Tutor service did not become healthy: ' + output());
}

function processExit(child, label) {
  return new Promise((_, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      reject(new Error(label + ' exited before completing the live test (' + code + ').'));
    });
  });
}

function timeoutFailure(message, milliseconds) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref();
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
