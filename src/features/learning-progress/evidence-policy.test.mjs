import assert from 'node:assert/strict';
import test from 'node:test';

import {
  capabilityStateForMode,
  isLessonEvidenceRecord,
  mergeLessonEvidence,
  practiceDaysInCurrentWeek,
  reviewItemsFor,
  summarizeLessonCompletion,
} from './evidence-policy.ts';

const capability = {
  id: 'el-script-vowels-a-e-i',
  canDo: 'I can recognize α, ε, and ι in a new Greek syllable.',
  mode: 'reading',
};

function completion(checks, mode = 'learn') {
  return {
    lessonId: 'el-letters-1',
    mode,
    capability,
    introducedModes: ['listening', 'reading'],
    checks,
  };
}

test('a fresh first-try checkpoint demonstrates a narrow capability', () => {
  const record = summarizeLessonCompletion(
    completion([
      {
        beatIndex: 6,
        capabilityId: capability.id,
        level: 'checkpoint',
        attempts: 1,
        correct: true,
        correctOnFirstTry: true,
      },
    ]),
    1_000,
  );

  assert.equal(record.state, 'demonstrated');
  assert.equal(record.lastCheckpoint, 'first-try');
});

test('recovery after a wrong checkpoint remains practice evidence', () => {
  const record = summarizeLessonCompletion(
    completion([
      {
        beatIndex: 6,
        capabilityId: capability.id,
        level: 'checkpoint',
        attempts: 2,
        correct: true,
        correctOnFirstTry: false,
      },
    ]),
    1_000,
  );

  assert.equal(record.state, 'practiced');
  assert.equal(record.lastCheckpoint, 'recovered');
});

test('replaying with more support never erases stronger prior evidence', () => {
  const demonstrated = summarizeLessonCompletion(
    completion([
      {
        beatIndex: 6,
        capabilityId: capability.id,
        level: 'checkpoint',
        attempts: 1,
        correct: true,
        correctOnFirstTry: true,
      },
    ]),
    1_000,
  );
  const recovered = summarizeLessonCompletion(
    completion([
      {
        beatIndex: 6,
        capabilityId: capability.id,
        level: 'checkpoint',
        attempts: 2,
        correct: true,
        correctOnFirstTry: false,
      },
    ]),
    2_000,
    demonstrated,
  );
  const merged = mergeLessonEvidence(demonstrated, recovered);

  assert.equal(merged.state, 'demonstrated');
  assert.equal(merged.lastCheckpoint, 'recovered');
  assert.equal(merged.completionCount, 2);
});

test('mode progress distinguishes introduced exposure from demonstrated evidence', () => {
  const record = summarizeLessonCompletion(
    completion([
      {
        beatIndex: 6,
        capabilityId: capability.id,
        level: 'checkpoint',
        attempts: 1,
        correct: true,
        correctOnFirstTry: true,
      },
    ]),
    1_000,
  );

  assert.equal(capabilityStateForMode([record], 'reading'), 'demonstrated');
  assert.equal(capabilityStateForMode([record], 'listening'), 'introduced');
  assert.equal(capabilityStateForMode([record], 'speaking'), 'unseen');
});

test('review timing is immediate after recovery and delayed after demonstration', () => {
  const recovered = summarizeLessonCompletion(
    completion([
      {
        beatIndex: 6,
        capabilityId: capability.id,
        level: 'checkpoint',
        attempts: 2,
        correct: true,
        correctOnFirstTry: false,
      },
    ]),
    1_000,
  );
  const demonstrated = summarizeLessonCompletion(
    completion([
      {
        beatIndex: 6,
        capabilityId: capability.id,
        level: 'checkpoint',
        attempts: 1,
        correct: true,
        correctOnFirstTry: true,
      },
    ]),
    1_000,
  );

  assert.equal(reviewItemsFor([recovered], 1_000)[0]?.due, true);
  assert.equal(reviewItemsFor([demonstrated], 1_000)[0]?.due, false);
});

test('a recovered review preserves prior demonstration but returns to the due queue', () => {
  const demonstrated = summarizeLessonCompletion(
    completion([
      {
        beatIndex: 6,
        capabilityId: capability.id,
        level: 'checkpoint',
        attempts: 1,
        correct: true,
        correctOnFirstTry: true,
      },
    ]),
    1_000,
  );
  const recoveredReview = summarizeLessonCompletion(
    completion(
      [
        {
          beatIndex: 1,
          capabilityId: capability.id,
          level: 'checkpoint',
          attempts: 2,
          correct: true,
          correctOnFirstTry: false,
        },
      ],
      'review',
    ),
    2_000,
    demonstrated,
  );
  const merged = mergeLessonEvidence(demonstrated, recoveredReview);

  assert.equal(merged.state, 'demonstrated');
  assert.equal(reviewItemsFor([merged], 2_000)[0]?.due, true);
});

test('stored evidence validation rejects malformed nested capability data', () => {
  const valid = summarizeLessonCompletion(completion([]), 1_000);

  assert.equal(isLessonEvidenceRecord(valid), true);
  assert.equal(isLessonEvidenceRecord({ ...valid, capability: true }), false);
  assert.equal(isLessonEvidenceRecord({ ...valid, introducedModes: ['telepathy'] }), false);
});

test('weekly consistency counts distinct local practice days without a streak reset', () => {
  const now = new Date(2026, 7, 31, 12);
  assert.equal(practiceDaysInCurrentWeek(['2026-08-31', '2026-08-31', '2026-09-02'], now), 2);
  assert.equal(practiceDaysInCurrentWeek(['2026-08-30'], now), 0);
});
