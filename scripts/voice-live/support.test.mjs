import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import test from 'node:test';

import {
  LIVE_CONFIRMATION,
  applyScenarioCandidate,
  assertSuccessfulReport,
  cleanupTrackedSessions,
  createAdmissionLifecycle,
  createBoundedSessionCounter,
  createHarnessAdmissionGuard,
  createPublishedFixture,
  publicationHash,
  readLiveConfiguration,
  safeReport,
  safeFailureEvidence,
  sanitizedChildEnvironment,
} from './support.mjs';

test('live configuration fails closed without every explicit opt-in', () => {
  assert.throws(() => readLiveConfiguration({}), /opt into/);
  assert.throws(
    () => readLiveConfiguration({ GLIDELINGO_VOICE_LIVE_TEST: 'true' }),
    /CONFIRM_SPEND/,
  );
  assert.throws(
    () => readLiveConfiguration({
      GLIDELINGO_VOICE_LIVE_TEST: 'true',
      GLIDELINGO_VOICE_TEST_CONFIRM_SPEND: LIVE_CONFIRMATION,
    }),
    /dedicated.*API_KEY/,
  );
});

test('live configuration accepts only the dedicated credential boundary', () => {
  const config = readLiveConfiguration({
    GLIDELINGO_VOICE_LIVE_TEST: 'true',
    GLIDELINGO_VOICE_TEST_CONFIRM_SPEND: LIVE_CONFIRMATION,
    GLIDELINGO_VOICE_TEST_OPENAI_API_KEY: 'test-secret',
    GLIDELINGO_VOICE_TEST_OPENAI_PROJECT_ID: 'proj_test',
    GLIDELINGO_VOICE_TEST_CHROME_PATH: '/test/chrome',
  });
  assert.deepEqual(config, {
    apiKey: 'test-secret',
    projectId: 'proj_test',
    credentialScope: 'explicit-project',
    chromePath: '/test/chrome',
  });
});

test('project-scoped test keys do not require a duplicated project ID', () => {
  const config = readLiveConfiguration({
    GLIDELINGO_VOICE_LIVE_TEST: 'true',
    GLIDELINGO_VOICE_TEST_CONFIRM_SPEND: LIVE_CONFIRMATION,
    GLIDELINGO_VOICE_TEST_OPENAI_API_KEY: 'sk-proj-test-secret',
    GLIDELINGO_VOICE_TEST_CHROME_PATH: '/test/chrome',
  });
  assert.equal(config.projectId, null);
  assert.equal(config.credentialScope, 'project-scoped-key');
  assert.throws(
    () => readLiveConfiguration({
      GLIDELINGO_VOICE_LIVE_TEST: 'true',
      GLIDELINGO_VOICE_TEST_CONFIRM_SPEND: LIVE_CONFIRMATION,
      GLIDELINGO_VOICE_TEST_OPENAI_API_KEY: 'sk-legacy-test-secret',
    }),
    /non-project-scoped key/,
  );
});

test('child environment excludes the paid credential boundary', () => {
  assert.deepEqual(sanitizedChildEnvironment({
    PATH: '/bin',
    OPENAI_API_KEY: 'generic-secret',
    OPENAI_PROJECT_ID: 'proj_generic',
    GLIDELINGO_VOICE_TEST_OPENAI_API_KEY: 'test-secret',
    GLIDELINGO_VOICE_TEST_OPENAI_PROJECT_ID: 'proj_test',
    GLIDELINGO_VOICE_TEST_CONFIRM_SPEND: LIVE_CONFIRMATION,
  }), { PATH: '/bin' });
});

test('session counter enforces its hard provider-call limit', () => {
  const consume = createBoundedSessionCounter(2);
  assert.equal(consume(), 1);
  assert.equal(consume(), 2);
  assert.throws(() => consume(), /limit of 2/);
});

test('cleanup retries transient hangup failures and preserves permanent failures', async () => {
  const sessions = new Map([['session-1', 'call-1']]);
  let attempts = 0;
  await cleanupTrackedSessions(sessions, async () => {
    attempts += 1;
    if (attempts < 2) throw new Error('temporary');
  }, { delays: [0, 0], sleep: async () => {} });
  assert.equal(attempts, 2);
  assert.equal(sessions.size, 0);

  const unresolved = new Map([['session-2', 'call-2']]);
  await assert.rejects(
    cleanupTrackedSessions(unresolved, async () => { throw new Error('persistent'); }, {
      delays: [0, 0],
      sleep: async () => {},
    }),
    /hangup remained unconfirmed/,
  );
  assert.deepEqual([...unresolved.entries()], [['session-2', 'call-2']]);
});

test('harness token and one-create rule prevent duplicate provider sessions', () => {
  let consumed = 0;
  const guard = createHarnessAdmissionGuard({
    token: 'single-run-token',
    consumeSessionSlot: () => { consumed += 1; },
  });
  assert.equal(guard.authenticate('wrong'), false);
  assert.equal(guard.authenticate('single-run-token'), true);
  assert.equal(guard.claimSession(), true);
  assert.equal(guard.claimSession(), false);
  assert.equal(consumed, 1);
});

test('shutdown waits for an in-flight admission before cleanup begins', async () => {
  const lifecycle = createAdmissionLifecycle();
  let releaseAdmission;
  const gate = new Promise((resolvePromise) => { releaseAdmission = resolvePromise; });
  let providerReferenceTracked = false;
  const admission = lifecycle.run(async () => {
    await gate;
    providerReferenceTracked = true;
  });
  let closeFinished = false;
  const closing = lifecycle.beginClose().then(() => { closeFinished = true; });
  await Promise.resolve();
  assert.equal(closeFinished, false);
  releaseAdmission();
  await Promise.all([admission, closing]);
  assert.equal(providerReferenceTracked, true);
  assert.equal(closeFinished, true);
  await assert.rejects(lifecycle.run(async () => {}), /closing/);
});

test('publication hash is stable and path bound', () => {
  const first = publicationHash([['b.json', Buffer.from('two')], ['a.json', Buffer.from('one')]]);
  const second = publicationHash([['a.json', Buffer.from('one')], ['b.json', Buffer.from('two')]]);
  const changedPath = publicationHash([['c.json', Buffer.from('one')], ['b.json', Buffer.from('two')]]);
  assert.equal(first, second);
  assert.match(first, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(first, changedPath);
});

test('candidate changes only temporary authored fields and refreshes the publication hash', async () => {
  const fixture = await createPublishedFixture();
  try {
    const before = fixture.contentHash;
    await applyScenarioCandidate(fixture, {
      rolePersona: 'Calm and exact.',
      authoredOpening: 'Invite the learner to try alpha.',
      safeExits: ['Offer one retry, then end warmly.'],
    });
    const scenario = JSON.parse(await readFile(fixture.scenarioPath, 'utf8'));
    const publication = JSON.parse(
      await readFile(fixture.contentRoot + '/courses/en-el-GR/voice/publication.json', 'utf8'),
    );
    assert.equal(scenario.role.persona, 'Calm and exact.');
    assert.notEqual(fixture.contentHash, before);
    assert.equal(publication.contentHash, fixture.contentHash);
    assert.equal(publication.status, 'published');
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test('safe report retains metrics but never transcript or audio content', () => {
  const report = safeReport({
    connected: true,
    providerConfigurationObserved: true,
    remoteAudioTrackReceived: true,
    remoteAudioObserved: true,
    learnerTranscriptFinalCount: 1,
    coachTranscriptFinalCount: 1,
    responseCompletedCount: 1,
    providerHangupConfirmed: true,
    recapTranscriptCount: 0,
    elapsedMs: 500,
    transcript: 'private words',
    audio: 'private bytes',
  }, { projectId: 'proj_test', contentHash: 'sha256:test' });
  assert.equal(JSON.stringify(report).includes('private'), false);
  assert.doesNotThrow(() => assertSuccessfulReport(report));
});

test('failure evidence retains only bounded booleans and counts', () => {
  const evidence = safeFailureEvidence({
    connected: true,
    inputFinished: true,
    learnerTranscriptFinalCount: 1,
    transcript: 'private words',
    extra: 'private data',
  });
  assert.equal(evidence.connected, true);
  assert.equal(evidence.learnerTranscriptFinalCount, 1);
  assert.equal(JSON.stringify(evidence).includes('private'), false);
});

test('acceptance rejects missing provider evidence or retained transcript', () => {
  assert.throws(
    () => assertSuccessfulReport({
      connected: true,
      providerConfigurationObserved: false,
      remoteAudioTrackReceived: false,
      remoteAudioObserved: false,
      learnerTranscriptFinalCount: 0,
      coachTranscriptFinalCount: 0,
      responseCompletedCount: 0,
      providerHangupConfirmed: false,
      recapTranscriptCount: 1,
    }),
    /no remote audio track.*recap transcript contract was not empty/,
  );
});

test('invalid recap shape cannot be normalized into a privacy pass', () => {
  const report = safeReport({
    connected: true,
    providerConfigurationObserved: true,
    remoteAudioTrackReceived: true,
    remoteAudioObserved: true,
    learnerTranscriptFinalCount: 1,
    coachTranscriptFinalCount: 1,
    responseCompletedCount: 1,
    providerHangupConfirmed: true,
    recapTranscriptCount: -1,
  }, { projectId: 'proj_test', contentHash: 'sha256:test' });
  assert.equal(report.recapTranscriptCount, -1);
  assert.throws(() => assertSuccessfulReport(report), /recap transcript contract was not empty/);
});
