import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeConcurrentLearning } from '../learning-migration.ts';

function stored(overrides = {}) {
  return {
    version: 2,
    languageId: 'el',
    enrolledByLanguage: {},
    completedLessonIds: [],
    lessonEvidence: [],
    practiceDayKeys: [],
    weeklyGoalChanges: [],
    fieldWrites: {},
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    lessonId: 'lesson-1',
    capability: { id: 'capability-1', canDo: 'I can read it.', mode: 'reading' },
    state: 'demonstrated',
    evidenceAt: 1_000,
    lastPracticedAt: 1_000,
    lastMode: 'learn',
    lastCheckpoint: 'first-try',
    introducedModes: ['reading'],
    checkCount: 1,
    firstTryCorrectCount: 1,
    recoveredCheckCount: 0,
    completionCount: 1,
    ...overrides,
  };
}

function stamp(at, writerId, sequence = 1) {
  return { at, sequence, writerId };
}

test('concurrent merge retains monotonic progress while a later scalar write wins', () => {
  const completed = stored({
    completedLessonIds: ['lesson-1'],
    lessonEvidence: [evidence()],
    practiceDayKeys: ['2026-08-31'],
  });
  const laterScalar = stored({
    languageId: 'es',
    fieldWrites: { languageId: stamp(2_000, 'tab-b') },
  });

  const merged = mergeConcurrentLearning(completed, laterScalar);

  assert.equal(merged.languageId, 'es');
  assert.deepEqual(merged.completedLessonIds, ['lesson-1']);
  assert.deepEqual(merged.practiceDayKeys, ['2026-08-31']);
  assert.equal(merged.lessonEvidence[0].state, 'demonstrated');
  assert.deepEqual(mergeConcurrentLearning(merged, completed), merged);
});

test('course and same-week goal conflicts use deterministic field-level last-writer semantics', () => {
  const first = stored({
    enrolledByLanguage: { el: 'greek-first' },
    weeklyGoalChanges: [{ effectiveWeekKey: '2026-08-31', goal: 5 }],
    fieldWrites: {
      enrolledByLanguage: { el: stamp(3_000, 'tab-a') },
      weeklyGoalChanges: { '2026-08-31': stamp(3_000, 'tab-a') },
    },
  });
  const last = stored({
    enrolledByLanguage: { el: 'greek-last' },
    weeklyGoalChanges: [{ effectiveWeekKey: '2026-08-31', goal: null }],
    fieldWrites: {
      enrolledByLanguage: { el: stamp(3_001, 'tab-b') },
      weeklyGoalChanges: { '2026-08-31': stamp(3_001, 'tab-b') },
    },
  });

  const merged = mergeConcurrentLearning(first, last);
  assert.equal(merged.enrolledByLanguage.el, 'greek-last');
  assert.deepEqual(merged.weeklyGoalChanges, [{ effectiveWeekKey: '2026-08-31', goal: null }]);

  const sameMillisecond = mergeConcurrentLearning(
    stored({ languageId: 'es', fieldWrites: { languageId: stamp(4_000, 'tab-a') } }),
    stored({ languageId: 'fr', fieldWrites: { languageId: stamp(4_000, 'tab-b') } }),
  );
  assert.equal(sameMillisecond.languageId, 'fr');
});
