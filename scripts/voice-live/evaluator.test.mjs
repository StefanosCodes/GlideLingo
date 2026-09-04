import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractOutputText,
  gradeConversationBatch,
  privacySafeEvaluationReport,
  proposeScenarioCandidates,
  selectCandidate,
  summarizeGrades,
} from './evaluator.mjs';

const passingGrade = (caseId, score = 2) => ({
  caseId,
  lessonGrounding: score,
  languageLevel: score,
  correctiveHelpfulness: score,
  naturalness: score,
  brevity: score,
  hardViolation: false,
  failureCodes: ['none'],
});

function responseWith(value) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
      };
    },
  };
}

test('extractOutputText reads structured response content', () => {
  assert.equal(
    extractOutputText({ output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }),
    '{"ok":true}',
  );
  assert.throws(() => extractOutputText({ output: [] }), /no output text/);
});

test('grader keeps transcripts in the ephemeral request and returns bounded grades', async () => {
  let requestBody;
  const grades = await gradeConversationBatch({
    apiKey: 'secret',
    projectId: 'proj_test',
    cases: [{
      id: 'alpha',
      expected: 'alpha',
      result: { learnerTranscripts: ['άλφα'], coachTranscripts: ['Good attempt.'] },
    }],
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      assert.equal(options.headers['OpenAI-Project'], 'proj_test');
      return responseWith({ results: [passingGrade('alpha')] });
    },
  });
  assert.equal(grades.length, 1);
  assert.equal(requestBody.store, false);
  assert.match(JSON.stringify(requestBody), /άλφα/);
  assert.equal(JSON.stringify(grades).includes('Good attempt'), false);
});

test('candidate generation permits only the reviewable authored fields', async () => {
  const candidates = await proposeScenarioCandidates({
    apiKey: 'secret',
    projectId: 'proj_test',
    scenario: {
      role: { persona: 'Baseline.' },
      authoredOpening: 'Baseline opening.',
      safeExits: ['Baseline exit.'],
      allowedResources: ['α'],
    },
    baselineSummary: { averageScore: 7 },
    fetchImpl: async () => responseWith({
      candidates: [
        {
          rolePersona: 'Calm and precise.',
          authoredOpening: 'Invite one sound.',
          safeExits: ['Offer one retry.'],
          rationale: 'Reduce ambiguity.',
          ignoredField: 'not retained',
        },
        {
          rolePersona: 'Warm and brief.',
          authoredOpening: 'Ask for alpha.',
          safeExits: ['End warmly.'],
          rationale: 'Improve focus.',
        },
      ],
    }),
  });
  assert.deepEqual(Object.keys(candidates[0]), [
    'id',
    'rolePersona',
    'authoredOpening',
    'safeExits',
    'rationale',
  ]);
});

test('candidate generation rejects duplicate and baseline-equivalent candidates', async () => {
  const scenario = {
    role: { persona: 'Baseline.' },
    authoredOpening: 'Baseline opening.',
    safeExits: ['Baseline exit.'],
  };
  const duplicate = {
    rolePersona: 'Different.',
    authoredOpening: 'Different opening.',
    safeExits: ['Different exit.'],
    rationale: 'Test.',
  };
  await assert.rejects(
    proposeScenarioCandidates({
      apiKey: 'secret',
      projectId: 'proj_test',
      scenario,
      baselineSummary: { averageScore: 7 },
      fetchImpl: async () => responseWith({ candidates: [duplicate, duplicate] }),
    }),
    /meaningfully different/,
  );
  await assert.rejects(
    proposeScenarioCandidates({
      apiKey: 'secret',
      projectId: 'proj_test',
      scenario,
      baselineSummary: { averageScore: 7 },
      fetchImpl: async () => responseWith({ candidates: [
        {
          rolePersona: 'Baseline.',
          authoredOpening: 'Baseline opening.',
          safeExits: ['Baseline exit.'],
          rationale: 'No-op.',
        },
        duplicate,
      ] }),
    }),
    /differ from the baseline/,
  );
});

test('grader rejects empty, duplicate, and contradictory failure results', async () => {
  const run = (grade) => gradeConversationBatch({
    apiKey: 'secret',
    projectId: 'proj_test',
    cases: [{ id: 'alpha', expected: 'alpha', result: {} }],
    fetchImpl: async () => responseWith({ results: [grade] }),
  });
  await assert.rejects(run({ ...passingGrade('alpha'), failureCodes: [] }), /invalid failure code/);
  await assert.rejects(
    run({ ...passingGrade('alpha'), failureCodes: ['too_long', 'too_long'] }),
    /duplicate failure codes/,
  );
  await assert.rejects(
    run({ ...passingGrade('alpha'), failureCodes: ['progress_claim'] }),
    /inconsistent hard violation/,
  );
  await assert.rejects(
    run({ ...passingGrade('alpha'), hardViolation: true, failureCodes: ['too_long'] }),
    /inconsistent hard violation/,
  );
});

test('selection requires a measurable gain and no hard violations', () => {
  const baseline = { averageScore: 7.5, minimumScore: 7, hardViolationCount: 0 };
  const selected = selectCandidate(baseline, [
    { candidate: { id: 'unsafe' }, summary: { averageScore: 9, minimumScore: 8, hardViolationCount: 1 } },
    { candidate: { id: 'flat' }, summary: { averageScore: 7.9, minimumScore: 7, hardViolationCount: 0 } },
    { candidate: { id: 'winner' }, summary: { averageScore: 8.4, minimumScore: 8, hardViolationCount: 0 } },
  ]);
  assert.equal(selected.candidate.id, 'winner');
});

test('privacy-safe report never contains source transcripts or audio', () => {
  const baselineSummary = summarizeGrades([passingGrade('alpha')]);
  const report = privacySafeEvaluationReport({
    headSha: 'abc123',
    projectId: 'proj_test',
    contentHash: 'sha256:test',
    baselineSummary,
    candidates: [],
    recommendation: { id: 'baseline' },
    holdout: null,
    transportReports: [],
    transcripts: ['private'],
    audio: 'private bytes',
  });
  assert.equal(report.baselineSummary.averageScore, 10);
  assert.equal(JSON.stringify(report).includes('private'), false);
  assert.equal(report.transcriptRetained, false);
  assert.equal(report.audioRetained, false);
});
