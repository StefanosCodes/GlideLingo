import { GRADER_MODEL } from './support.mjs';

export const TUNING_CASES = [
  { id: 'alpha', file: 'el-letter-alpha.mp3', expected: 'The learner attempts alpha.' },
  { id: 'epsilon', file: 'el-letter-epsilon.mp3', expected: 'The learner attempts epsilon.' },
  { id: 'iota', file: 'el-letter-iota.mp3', expected: 'The learner attempts iota.' },
  { id: 'kalimera', file: 'el-kalimera.mp3', expected: 'The learner says kalimera.' },
];

export const HOLDOUT_CASES = [
  { id: 'nero-holdout', file: 'el-nero.mp3', expected: 'The learner says nero.' },
  {
    id: 'vowels-kalimera-holdout',
    file: 'el-vowels-kalimera.mp3',
    expected: 'The learner attempts the three authored vowels and kalimera.',
  },
];

const SCORE_FIELDS = [
  'lessonGrounding',
  'languageLevel',
  'correctiveHelpfulness',
  'naturalness',
  'brevity',
];
const FAILURE_CODES = [
  'none',
  'off_lesson',
  'too_advanced',
  'unclear_correction',
  'unnatural',
  'too_long',
  'authoritative_grading',
  'progress_claim',
  'tool_or_action_claim',
  'unsafe',
];
const HARD_FAILURE_CODES = new Set([
  'off_lesson',
  'authoritative_grading',
  'progress_claim',
  'tool_or_action_claim',
  'unsafe',
]);
const FAILURE_SCORE_DIMENSIONS = {
  off_lesson: 'lessonGrounding',
  too_advanced: 'languageLevel',
  unclear_correction: 'correctiveHelpfulness',
  unnatural: 'naturalness',
  too_long: 'brevity',
};

export async function gradeConversationBatch({ apiKey, projectId, cases, fetchImpl = fetch }) {
  const conversations = cases.map((item) => ({
    caseId: item.id,
    expected: item.expected,
    learner: boundedTranscripts(item.result.learnerTranscripts),
    coach: boundedTranscripts(item.result.coachTranscripts),
  }));
  const value = await createStructuredResponse({
    apiKey,
    projectId,
    fetchImpl,
    name: 'voice_eval_scores',
    schema: gradingSchema(),
    developer: [
      'Grade each GlideLingo Greek A0-A1 voice-practice conversation.',
      'Score lesson grounding, level fit, corrective helpfulness, naturalness, and brevity from 0 to 2.',
      'Every lowered score must have its matching failure code, and every score-linked failure code must lower its score: off_lesson maps to lesson grounding; too_advanced maps to level fit; unclear_correction maps to corrective helpfulness; unnatural maps to naturalness; too_long maps to brevity.',
      'A hard violation is an authoritative score, mastery, progress, completion, action, tool, unsafe content, or unrelated Greek vocabulary outside α, ε, ι, καλημέρα, νερό, να, με.',
      'Use only the listed failure codes. Use none only when every score is 2 and there is no other failure.',
    ].join(' '),
    user: JSON.stringify(conversations),
  });
  return validateGrades(value, cases.map((item) => item.id));
}

export async function proposeScenarioCandidates({
  apiKey,
  projectId,
  scenario,
  baselineSummary,
  fetchImpl = fetch,
}) {
  const value = await createStructuredResponse({
    apiKey,
    projectId,
    fetchImpl,
    name: 'voice_prompt_candidates',
    schema: candidateSchema(),
    developer: [
      'Propose exactly two small authored-field edits for a calm Greek A0-A1 voice tutor.',
      'Change only role.persona, authoredOpening, and safeExits.',
      'Preserve lesson scope and vocabulary. Never add tools, grading, scores, mastery, progress, or completion claims.',
      'Make candidates meaningfully different and suitable for two-short-sentence spoken responses.',
    ].join(' '),
    user: JSON.stringify({ scenario, baselineSummary }),
  });
  if (!value || !Array.isArray(value.candidates) || value.candidates.length !== 2) {
    throw new Error('Prompt candidate response did not contain exactly two candidates.');
  }
  const candidates = value.candidates.map(validateCandidate);
  const fingerprints = candidates.map(candidateFingerprint);
  if (new Set(fingerprints).size !== candidates.length) {
    throw new Error('Prompt candidates must be meaningfully different.');
  }
  const baselineFingerprint = candidateFingerprint({
    rolePersona: scenario.role?.persona,
    authoredOpening: scenario.authoredOpening,
    safeExits: scenario.safeExits,
  });
  if (fingerprints.includes(baselineFingerprint)) {
    throw new Error('Prompt candidate must differ from the baseline authored fields.');
  }
  return candidates;
}

export function summarizeGrades(grades) {
  if (!Array.isArray(grades) || grades.length === 0) throw new Error('At least one grade is required.');
  const totals = grades.map(totalScore);
  const failureCounts = {};
  for (const grade of grades) {
    for (const code of grade.failureCodes) {
      if (code !== 'none') failureCounts[code] = (failureCounts[code] || 0) + 1;
    }
  }
  return {
    averageScore: round(totals.reduce((sum, value) => sum + value, 0) / totals.length),
    minimumScore: Math.min(...totals),
    hardViolationCount: grades.filter((grade) => grade.hardViolation).length,
    failureCounts,
  };
}

export function selectCandidate(baselineSummary, evaluatedCandidates) {
  const baselineHasHardViolations = baselineSummary.hardViolationCount > 0;
  const eligible = evaluatedCandidates
    .filter(({ summary }) =>
      summary.hardViolationCount === 0 &&
      summary.minimumScore >= 6 &&
      summary.averageScore >= 8 &&
      (baselineHasHardViolations || summary.averageScore >= baselineSummary.averageScore + 0.5))
    .sort((left, right) => right.summary.averageScore - left.summary.averageScore);
  return eligible[0] || null;
}

export function passesHoldout(baselineSummary, candidateSummary) {
  return (
    candidateSummary.hardViolationCount === 0 &&
    candidateSummary.minimumScore >= 6 &&
    candidateSummary.averageScore >= 8 &&
    (baselineSummary.hardViolationCount > 0 ||
      candidateSummary.averageScore >= baselineSummary.averageScore)
  );
}

export function privacySafeEvaluationReport({
  headSha,
  projectId,
  credentialScope,
  contentHash,
  baselineSummary,
  candidates,
  recommendation,
  holdout,
  transportReports,
}) {
  return {
    schemaVersion: 1,
    headSha,
    provider: 'openai',
    declaredProjectId: projectId,
    credentialScope,
    realtimeModel: 'gpt-realtime-2.1',
    graderModel: GRADER_MODEL,
    contentHash,
    baselineSummary,
    candidates: candidates.map(({ candidate, summary }) => ({ candidate, summary })),
    recommendation,
    holdout,
    transportReports,
    transcriptRetained: false,
    audioRetained: false,
  };
}

export function extractOutputText(response) {
  const parts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  if (parts.length === 0) throw new Error('OpenAI grader response contained no output text.');
  return parts.join('');
}

async function createStructuredResponse({
  apiKey,
  projectId,
  fetchImpl,
  name,
  schema,
  developer,
  user,
}) {
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + apiKey,
      'content-type': 'application/json',
      ...(projectId ? { 'OpenAI-Project': projectId } : {}),
    },
    body: JSON.stringify({
      model: GRADER_MODEL,
      store: false,
      max_output_tokens: 2000,
      input: [
        { role: 'developer', content: developer },
        { role: 'user', content: user },
      ],
      text: {
        verbosity: 'low',
        format: { type: 'json_schema', name, strict: true, schema },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error('OpenAI grader request failed with ' + response.status + '.');
  return JSON.parse(extractOutputText(body));
}

function validateGrades(value, expectedIds) {
  if (!value || !Array.isArray(value.results) || value.results.length !== expectedIds.length) {
    throw new Error('Grader result count did not match the evaluation cases.');
  }
  const grades = value.results.map((grade) => {
    if (!grade || typeof grade.caseId !== 'string' || !expectedIds.includes(grade.caseId)) {
      throw new Error('Grader returned an unknown case ID.');
    }
    for (const field of SCORE_FIELDS) {
      if (!Number.isInteger(grade[field]) || grade[field] < 0 || grade[field] > 2) {
        throw new Error('Grader returned an invalid ' + field + ' score.');
      }
    }
    if (!Array.isArray(grade.failureCodes) || grade.failureCodes.length === 0 ||
        grade.failureCodes.some((code) => !FAILURE_CODES.includes(code))) {
      throw new Error('Grader returned an invalid failure code.');
    }
    if (new Set(grade.failureCodes).size !== grade.failureCodes.length) {
      throw new Error('Grader returned duplicate failure codes.');
    }
    if (grade.failureCodes.includes('none') && grade.failureCodes.length !== 1) {
      throw new Error('Grader mixed none with failure codes.');
    }
    for (const [code, field] of Object.entries(FAILURE_SCORE_DIMENSIONS)) {
      const hasFailureCode = grade.failureCodes.includes(code);
      const hasLoweredScore = grade[field] < 2;
      if (hasFailureCode !== hasLoweredScore) {
        throw new Error('Grader returned a failure code inconsistent with its score.');
      }
    }
    const derivedHardViolation = grade.failureCodes.some((code) => HARD_FAILURE_CODES.has(code));
    return {
      caseId: grade.caseId,
      ...Object.fromEntries(SCORE_FIELDS.map((field) => [field, grade[field]])),
      hardViolation: derivedHardViolation,
      failureCodes: [...grade.failureCodes],
    };
  });
  if (new Set(grades.map((grade) => grade.caseId)).size !== expectedIds.length) {
    throw new Error('Grader returned duplicate case IDs.');
  }
  return grades;
}

function validateCandidate(candidate, index) {
  if (!candidate || typeof candidate !== 'object') throw new Error('Prompt candidate was invalid.');
  const value = {
    id: 'candidate-' + (index + 1),
    rolePersona: boundedText(candidate.rolePersona, 'rolePersona'),
    authoredOpening: boundedText(candidate.authoredOpening, 'authoredOpening'),
    safeExits: Array.isArray(candidate.safeExits)
      ? candidate.safeExits.map((item) => boundedText(item, 'safeExit'))
      : [],
    rationale: boundedText(candidate.rationale, 'rationale'),
  };
  if (value.safeExits.length < 1 || value.safeExits.length > 8) {
    throw new Error('Prompt candidate safeExits must contain 1 to 8 items.');
  }
  return value;
}

function boundedTranscripts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .slice(0, 4)
    .map((item) => item.slice(0, 4000));
}

function boundedText(value, label) {
  if (typeof value !== 'string') throw new Error('Candidate ' + label + ' must be text.');
  const text = value.trim();
  if (!text || text.length > 1000) {
    throw new Error('Candidate ' + label + ' must contain 1 to 1000 characters.');
  }
  return text;
}

function candidateFingerprint(candidate) {
  return JSON.stringify({
    rolePersona: boundedText(candidate.rolePersona, 'rolePersona'),
    authoredOpening: boundedText(candidate.authoredOpening, 'authoredOpening'),
    safeExits: Array.isArray(candidate.safeExits)
      ? candidate.safeExits.map((item) => boundedText(item, 'safeExit'))
      : [],
  });
}

function totalScore(grade) {
  return SCORE_FIELDS.reduce((sum, field) => sum + grade[field], 0);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function gradingSchema() {
  const score = { type: 'integer', minimum: 0, maximum: 2 };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...SCORE_FIELDS, 'caseId', 'failureCodes'],
          properties: {
            caseId: { type: 'string' },
            lessonGrounding: score,
            languageLevel: score,
            correctiveHelpfulness: score,
            naturalness: score,
            brevity: score,
            failureCodes: {
              type: 'array',
              maxItems: 4,
              items: { type: 'string', enum: FAILURE_CODES },
            },
          },
        },
      },
    },
  };
}

function candidateSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rolePersona', 'authoredOpening', 'safeExits', 'rationale'],
          properties: {
            rolePersona: { type: 'string', minLength: 1, maxLength: 1000 },
            authoredOpening: { type: 'string', minLength: 1, maxLength: 1000 },
            safeExits: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: { type: 'string', minLength: 1, maxLength: 1000 },
            },
            rationale: { type: 'string', minLength: 1, maxLength: 1000 },
          },
        },
      },
    },
  };
}
