import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIVE_CONFIRMATION = 'I_ACCEPT_BOUNDED_OPENAI_TEST_SPEND';
export const LIVE_MODEL = 'gpt-realtime-2.1';
export const LIVE_VOICE = 'marin';
export const GRADER_MODEL = 'gpt-5.6-terra';
export const MAX_REALTIME_SESSIONS = 16;
export const ACTOR_REF = `vusr_v1_${'A'.repeat(43)}`;

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..');
const SCENARIO_RELATIVE = 'courses/en-el-GR/voice/scenarios/el-letters-1-voice-v1.json';
const LESSON_RELATIVE = 'courses/en-el-GR/missions/el-letters-1.json';
const PUBLICATION_RELATIVE = 'courses/en-el-GR/voice/publication.json';

export function readLiveConfiguration(env = process.env) {
  if (env.GLIDELINGO_VOICE_LIVE_TEST !== 'true') {
    throw new Error('Set GLIDELINGO_VOICE_LIVE_TEST=true to opt into the paid live Voice test.');
  }
  if (env.GLIDELINGO_VOICE_TEST_CONFIRM_SPEND !== LIVE_CONFIRMATION) {
    throw new Error(`Set GLIDELINGO_VOICE_TEST_CONFIRM_SPEND=${LIVE_CONFIRMATION}.`);
  }
  const apiKey = env.GLIDELINGO_VOICE_TEST_OPENAI_API_KEY?.trim();
  const projectId = env.GLIDELINGO_VOICE_TEST_OPENAI_PROJECT_ID?.trim();
  if (!apiKey) throw new Error('Set the dedicated GLIDELINGO_VOICE_TEST_OPENAI_API_KEY.');
  if (!projectId && !apiKey.startsWith('sk-proj-')) {
    throw new Error('Set GLIDELINGO_VOICE_TEST_OPENAI_PROJECT_ID for a non-project-scoped key.');
  }
  return {
    apiKey,
    projectId: projectId || null,
    credentialScope: projectId ? 'explicit-project' : 'project-scoped-key',
    chromePath: env.GLIDELINGO_VOICE_TEST_CHROME_PATH?.trim() || defaultChromePath(),
  };
}

export function sanitizedChildEnvironment(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) =>
      !name.startsWith('OPENAI_') &&
      !name.startsWith('GLIDELINGO_VOICE_TEST_')),
  );
}

export function createBoundedSessionCounter(maximum = MAX_REALTIME_SESSIONS) {
  let used = 0;
  return () => {
    if (used >= maximum) throw new Error(`Live Voice session limit of ${maximum} was reached.`);
    used += 1;
    return used;
  };
}

export function createHarnessAdmissionGuard({ token = randomUUID(), consumeSessionSlot }) {
  let sessionCreated = false;
  return {
    token,
    authenticate(providedToken) {
      return providedToken === token;
    },
    claimSession() {
      if (sessionCreated) return false;
      consumeSessionSlot();
      sessionCreated = true;
      return true;
    },
  };
}

export function createAdmissionLifecycle() {
  let closing = false;
  let pendingAdmission = null;
  return {
    async run(operation) {
      if (closing) throw new Error('Harness admission is closing.');
      if (pendingAdmission) throw new Error('Harness admission is already in flight.');
      pendingAdmission = Promise.resolve().then(operation);
      try {
        return await pendingAdmission;
      } finally {
        pendingAdmission = null;
      }
    },
    async beginClose() {
      closing = true;
      if (pendingAdmission) {
        try {
          await pendingAdmission;
        } catch {
          // A failed admission has no provider reference to clean up.
        }
      }
    },
  };
}

export function defaultChromePath(platform = process.platform) {
  if (platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (platform === 'linux') return 'google-chrome';
  throw new Error('Set GLIDELINGO_VOICE_TEST_CHROME_PATH for this platform.');
}

export function publicationHash(files) {
  const digest = createHash('sha256');
  for (const [relativePath, bytes] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    digest.update(relativePath);
    digest.update(Buffer.from([0]));
    digest.update(bytes);
    digest.update(Buffer.from([0]));
  }
  return `sha256:${digest.digest('hex')}`;
}

export async function createPublishedFixture() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'glidelingo-voice-live-'));
  const contentRoot = join(temporaryRoot, 'content');
  const sourceRoot = join(ROOT, 'content');
  for (const relativePath of [SCENARIO_RELATIVE, LESSON_RELATIVE]) {
    const target = join(contentRoot, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(sourceRoot, relativePath), target);
  }
  const sourcePublication = JSON.parse(
    await readFile(join(sourceRoot, PUBLICATION_RELATIVE), 'utf8'),
  );
  const publication = await refreshPublication(contentRoot, sourcePublication);
  return {
    temporaryRoot,
    contentRoot,
    contentHash: publication.contentHash,
    scenarioPath: join(contentRoot, SCENARIO_RELATIVE),
    publicationTemplate: sourcePublication,
  };
}

export async function applyScenarioCandidate(fixture, candidate) {
  const scenario = JSON.parse(await readFile(fixture.scenarioPath, 'utf8'));
  scenario.role.persona = boundedText(candidate.rolePersona, 'rolePersona');
  scenario.authoredOpening = boundedText(candidate.authoredOpening, 'authoredOpening');
  if (!Array.isArray(candidate.safeExits) || candidate.safeExits.length < 1 || candidate.safeExits.length > 8) {
    throw new Error('Candidate safeExits must contain 1 to 8 items.');
  }
  scenario.safeExits = candidate.safeExits.map((value) => boundedText(value, 'safeExit'));
  await writeFile(fixture.scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`);
  const publication = await refreshPublication(fixture.contentRoot, fixture.publicationTemplate);
  fixture.contentHash = publication.contentHash;
}

async function refreshPublication(contentRoot, sourcePublication) {
  const files = await Promise.all(
    [SCENARIO_RELATIVE, LESSON_RELATIVE].map(async (relativePath) => [
      relativePath,
      await readFile(join(contentRoot, relativePath)),
    ]),
  );
  const publication = {
    ...sourcePublication,
    status: 'published',
    contentHash: publicationHash(files),
    validatorStatus: 'passed',
    publishedAt: '2026-09-04T00:00:00Z',
    reviews: {
      curriculum: 'approved',
      instructionalDesign: 'approved',
      languagePragmatics: 'approved',
      accessibility: 'approved',
    },
    knownLimitations: ['Synthetic, local-only live provider evaluation fixture.'],
  };
  const targetPublication = join(contentRoot, PUBLICATION_RELATIVE);
  await mkdir(dirname(targetPublication), { recursive: true });
  await writeFile(targetPublication, `${JSON.stringify(publication, null, 2)}\n`);
  return publication;
}

export function safeReport(result, { projectId, credentialScope, contentHash }) {
  return {
    schemaVersion: 1,
    provider: 'openai',
    declaredProjectId: projectId,
    credentialScope,
    model: LIVE_MODEL,
    voice: LIVE_VOICE,
    contentHash,
    connected: result.connected === true,
    providerConfigurationObserved: result.providerConfigurationObserved === true,
    remoteAudioTrackReceived: result.remoteAudioTrackReceived === true,
    remoteAudioObserved: result.remoteAudioObserved === true,
    learnerTranscriptFinalCount: boundedCount(result.learnerTranscriptFinalCount),
    coachTranscriptFinalCount: boundedCount(result.coachTranscriptFinalCount),
    responseCompletedCount: boundedCount(result.responseCompletedCount),
    interruptionSent: result.interruptionSent === true,
    providerHangupConfirmed: result.providerHangupConfirmed === true,
    recapTranscriptCount: boundedCountOrInvalid(result.recapTranscriptCount),
    elapsedMs: boundedCount(result.elapsedMs, 120_000),
  };
}

export function assertSuccessfulReport(report) {
  const failures = [];
  if (!report.connected) failures.push('WebRTC data channel did not connect');
  if (!report.providerConfigurationObserved) failures.push('effective provider configuration was not observed');
  if (!report.remoteAudioTrackReceived) failures.push('no remote audio track was received');
  if (!report.remoteAudioObserved) failures.push('remote audio energy was not observed');
  if (report.learnerTranscriptFinalCount < 1) failures.push('learner audio was not transcribed');
  if (report.coachTranscriptFinalCount < 1) failures.push('coach transcript did not complete');
  if (report.responseCompletedCount < 1) failures.push('Realtime response did not complete');
  if (!report.providerHangupConfirmed) failures.push('provider hangup was not confirmed');
  if (report.recapTranscriptCount !== 0) failures.push('recap transcript contract was not empty');
  if (failures.length) throw new Error(`Live Voice acceptance failed: ${failures.join('; ')}.`);
}

export async function startHarnessServer({
  compiledAdapterPath,
  tutorBaseUrl,
  fixturePath,
  consumeSessionSlot,
}) {
  const html = await readFile(join(HERE, 'harness.html'));
  const browser = await readFile(join(HERE, 'browser.mjs'));
  const evidence = await readFile(join(HERE, 'evidence.mjs'));
  const adapter = await readFile(compiledAdapterPath);
  const fixture = await readFile(fixturePath);
  const sessions = new Map();
  const guard = createHarnessAdmissionGuard({ consumeSessionSlot });
  const admissionLifecycle = createAdmissionLifecycle();
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolvePromise, rejectPromise) => {
    resolveCompletion = resolvePromise;
    rejectCompletion = rejectPromise;
  });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/') return send(response, 200, html, 'text/html');
      if (request.method === 'GET' && url.pathname === '/browser.mjs') return send(response, 200, browser, 'text/javascript');
      if (request.method === 'GET' && url.pathname === '/evidence.mjs') return send(response, 200, evidence, 'text/javascript');
      if (request.method === 'GET' && url.pathname === '/openai-realtime.web.js') return send(response, 200, adapter, 'text/javascript');
      if (request.method === 'GET' && url.pathname === '/fixture.mp3') return send(response, 200, fixture, 'audio/mpeg');
      if (request.method === 'POST' && !guard.authenticate(request.headers['x-voice-harness-token'])) {
        return sendJson(response, 403, { error: 'invalid harness token' });
      }
      if (request.method === 'POST' && url.pathname === '/session') {
        const admission = await admissionLifecycle.run(async () => {
          if (!guard.claimSession()) return null;
          const body = await readJson(request);
          const applicationSessionId = randomUUID();
          const payload = {
            actor_ref: ACTOR_REF,
            application_session_id: applicationSessionId,
            course_id: 'el-from-zero',
            scenario_id: 'el-letters-1-voice-v1',
            source_locale: 'en',
            target_locale: 'el-GR',
            conversation_mode: 'guided',
            captions_enabled: true,
            offer_sdp: body.offer_sdp,
          };
          const provider = await providerJson(`${tutorBaseUrl}/internal/v1/voice-sessions`, payload);
          sessions.set(applicationSessionId, provider.provider_call_id);
          return { applicationSessionId, provider };
        });
        if (!admission) return sendJson(response, 409, { error: 'session already created' });
        const { applicationSessionId, provider } = admission;
        return sendJson(response, 200, {
          session_id: applicationSessionId,
          lifecycle: 'connecting',
          expires_at: new Date(Date.now() + provider.spec.maximum_duration_seconds * 1000).toISOString(),
          spec: provider.spec,
          connection: { type: 'openai-webrtc-sdp', answer_sdp: provider.answer_sdp },
        });
      }
      if (request.method === 'POST' && url.pathname === '/end') {
        const body = await readJson(request);
        const providerCallId = sessions.get(body.session_id);
        if (!providerCallId) return sendJson(response, 404, { error: 'unknown session' });
        await providerJson(`${tutorBaseUrl}/internal/v1/voice-sessions/end`, {
          actor_ref: ACTOR_REF,
          application_session_id: body.session_id,
          provider_call_id: providerCallId,
        });
        sessions.delete(body.session_id);
        return sendJson(response, 200, { transcript: [], provider_hangup_confirmed: true });
      }
      if (request.method === 'POST' && url.pathname === '/complete') {
        const body = await readJson(request);
        body.providerHangupConfirmed = sessions.size === 0;
        resolveCompletion(body);
        return sendJson(response, 200, { accepted: true });
      }
      if (request.method === 'POST' && url.pathname === '/failed') {
        const body = await readJson(request);
        const evidence = safeFailureEvidence(body.evidence);
        rejectCompletion(new Error(
          `Browser harness failed: ${String(body.message).slice(0, 200)}; evidence=${JSON.stringify(evidence)}`,
        ));
        return sendJson(response, 200, { accepted: true });
      }
      sendJson(response, 404, { error: 'not found' });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : 'unknown error' });
    }
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Harness server did not bind TCP.');
  return {
    url: `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(guard.token)}`,
    completion,
    async close() {
      await admissionLifecycle.beginClose();
      let cleanupError;
      try {
        await cleanupTrackedSessions(sessions, (applicationSessionId, providerCallId) =>
          providerJson(`${tutorBaseUrl}/internal/v1/voice-sessions/end`, {
            actor_ref: ACTOR_REF,
            application_session_id: applicationSessionId,
            provider_call_id: providerCallId,
          }),
        );
      } catch (error) {
        cleanupError = error;
      }
      await new Promise((resolvePromise) => server.close(resolvePromise));
      if (cleanupError) throw cleanupError;
    },
  };
}

export async function cleanupTrackedSessions(
  sessions,
  endCall,
  { delays = [0, 100, 300], sleep = defaultSleep } = {},
) {
  for (const [applicationSessionId, providerCallId] of [...sessions.entries()]) {
    let lastError;
    for (const delay of delays) {
      if (delay > 0) await sleep(delay);
      try {
        await endCall(applicationSessionId, providerCallId);
        sessions.delete(applicationSessionId);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) {
      throw new Error(`Provider hangup remained unconfirmed for ${applicationSessionId}.`, {
        cause: lastError,
      });
    }
  }
}

function defaultSleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function boundedCount(value, maximum = 10_000) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, maximum) : 0;
}

function boundedCountOrInvalid(value, maximum = 10_000) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, maximum) : -1;
}

export function safeFailureEvidence(value) {
  const evidence = value && typeof value === 'object' ? value : {};
  return {
    connected: evidence.connected === true,
    providerConfigurationObserved: evidence.providerConfigurationObserved === true,
    remoteAudioTrackReceived: evidence.remoteAudioTrackReceived === true,
    remoteAudioObserved: evidence.remoteAudioObserved === true,
    inputFinished: evidence.inputFinished === true,
    postInputLearnerTranscript: evidence.postInputLearnerTranscript === true,
    postInputCoachTranscript: evidence.postInputCoachTranscript === true,
    postInputResponseCompleted: evidence.postInputResponseCompleted === true,
    learnerTranscriptFinalCount: boundedCount(evidence.learnerTranscriptFinalCount),
    coachTranscriptFinalCount: boundedCount(evidence.coachTranscriptFinalCount),
    responseCompletedCount: boundedCount(evidence.responseCompletedCount),
    receivedEventCount: boundedCount(evidence.receivedEventCount),
    sessionCreatedObserved: evidence.sessionCreatedObserved === true,
    sessionModelMatches: evidence.sessionModelMatches === true,
    sessionVoiceMatches: evidence.sessionVoiceMatches === true,
    transcriptionConfigured: evidence.transcriptionConfigured === true,
    transcriptionModelMatches: evidence.transcriptionModelMatches === true,
    toolsDisabled: evidence.toolsDisabled === true,
    toolChoiceNone: evidence.toolChoiceNone === true,
    turnDetectionDisabled: evidence.turnDetectionDisabled === true,
    responseDoneCompleted: evidence.responseDoneCompleted === true,
    responseDoneCancelled: evidence.responseDoneCancelled === true,
    responseDoneFailed: evidence.responseDoneFailed === true,
    responseDoneIncomplete: evidence.responseDoneIncomplete === true,
    responseLimitReached: evidence.responseLimitReached === true,
    outboundAudioBytes: boundedCount(evidence.outboundAudioBytes, 100_000_000),
    outboundAudioEnergyObserved: evidence.outboundAudioEnergyObserved === true,
  };
}

function boundedText(value, label) {
  if (typeof value !== 'string') throw new Error(`Candidate ${label} must be text.`);
  const text = value.trim();
  if (!text || text.length > 1000) throw new Error(`Candidate ${label} must contain 1 to 1000 characters.`);
  return text;
}

async function providerJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Tutor service returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 70_000) throw new Error('Request body exceeded 70000 bytes.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(response, status, body, contentType) {
  response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  response.end(body);
}

function sendJson(response, status, body) {
  send(response, status, JSON.stringify(body), 'application/json');
}
