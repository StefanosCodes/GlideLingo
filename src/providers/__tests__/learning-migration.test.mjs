import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeLegacyLearning, persistLegacyLearningImport } from '../learning-migration.ts';

function stored(overrides = {}) {
  return {
    version: 2,
    languageId: 'el',
    enrolledByLanguage: {},
    completedLessonIds: [],
    lessonEvidence: [],
    practiceDayKeys: [],
    weeklyGoalChanges: [],
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

test('legacy import preserves all V2 history while newer account choices win', () => {
  const merged = mergeLegacyLearning(
    stored({
      languageId: 'es',
      enrolledByLanguage: { es: 'current-spanish' },
      completedLessonIds: ['shared-lesson', 'new-lesson'],
      lessonEvidence: [evidence({ state: 'demonstrated', lastPracticedAt: 2_000 })],
      practiceDayKeys: ['2026-08-31'],
      weeklyGoalChanges: [{ effectiveWeekKey: '2026-08-31', goal: 3 }],
    }),
    stored({
      languageId: 'el',
      enrolledByLanguage: { el: 'legacy-greek', es: 'legacy-spanish' },
      completedLessonIds: ['old-lesson', 'shared-lesson'],
      lessonEvidence: [evidence({ state: 'practiced', introducedModes: ['listening'], completionCount: 3 })],
      practiceDayKeys: ['2026-08-24'],
      weeklyGoalChanges: [{ effectiveWeekKey: '2026-08-24', goal: 2 }],
    }),
  );

  assert.equal(merged.languageId, 'es');
  assert.deepEqual(merged.enrolledByLanguage, { el: 'legacy-greek', es: 'current-spanish' });
  assert.deepEqual(merged.completedLessonIds, ['old-lesson', 'shared-lesson', 'new-lesson']);
  assert.deepEqual(merged.practiceDayKeys, ['2026-08-24', '2026-08-31']);
  assert.deepEqual(merged.weeklyGoalChanges, [
    { effectiveWeekKey: '2026-08-24', goal: 2 },
    { effectiveWeekKey: '2026-08-31', goal: 3 },
  ]);
  assert.equal(merged.lessonEvidence[0].state, 'demonstrated');
  assert.deepEqual(merged.lessonEvidence[0].introducedModes, ['listening', 'reading']);
  assert.equal(merged.lessonEvidence[0].completionCount, 3);
});

test('legacy evidence merging is idempotent during cleanup retries', () => {
  const current = stored({ lessonEvidence: [evidence({ completionCount: 4 })] });
  const legacy = stored({ lessonEvidence: [evidence({ completionCount: 2, introducedModes: ['listening'] })] });
  const once = mergeLegacyLearning(current, legacy);
  const twice = mergeLegacyLearning(once, legacy);

  assert.deepEqual(twice, once);
});

test('legacy import persists the scoped V2 destination before removing shared progress', () => {
  const operations = [];
  const values = new Map([['glidelingo-learning', 'legacy']]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      operations.push(['set', key]);
      values.set(key, value);
    },
    removeItem(key) {
      operations.push(['remove', key]);
      values.delete(key);
    },
  };

  persistLegacyLearningImport(storage, {
    destinationKey: 'glidelingo-learning:v2:user_123',
    decisionKey: 'glidelingo-learning:legacy-decision:user_123',
    legacyKey: 'glidelingo-learning',
    merged: stored({ completedLessonIds: ['lesson-1'] }),
  });

  assert.deepEqual(operations, [
    ['set', 'glidelingo-learning:v2:user_123'],
    ['set', 'glidelingo-learning:legacy-decision:user_123'],
    ['remove', 'glidelingo-learning'],
  ]);
  assert.equal(values.has('glidelingo-learning'), false);
  assert.match(values.get('glidelingo-learning:v2:user_123'), /lesson-1/);
});

test('cleanup failure keeps the source and makes an exact retry possible', () => {
  const operations = [];
  const values = new Map([['legacy', JSON.stringify(stored({ completedLessonIds: ['lesson-1'] }))]]);
  let failCleanup = true;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      operations.push(['set', key]);
      values.set(key, value);
    },
    removeItem(key) {
      operations.push(['remove', key]);
      if (key === 'legacy' && failCleanup) throw new Error('cleanup failed');
      values.delete(key);
    },
  };
  const merged = stored({ completedLessonIds: ['lesson-1'] });

  assert.throws(
    () =>
      persistLegacyLearningImport(storage, {
        destinationKey: 'scoped',
        decisionKey: 'decision',
        legacyKey: 'legacy',
        merged,
      }),
    /cleanup failed/,
  );
  assert.equal(values.has('legacy'), true);
  assert.equal(values.has('decision'), false);
  assert.deepEqual(JSON.parse(values.get('scoped')), merged);

  failCleanup = false;
  persistLegacyLearningImport(storage, {
    destinationKey: 'scoped',
    decisionKey: 'decision',
    legacyKey: 'legacy',
    merged,
  });
  assert.equal(values.has('legacy'), false);
  assert.equal(values.get('decision'), 'imported');
  assert.deepEqual(JSON.parse(values.get('scoped')), merged);
});
