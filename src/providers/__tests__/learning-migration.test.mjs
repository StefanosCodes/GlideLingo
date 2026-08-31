import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeLegacyLearning, persistLegacyLearningImport } from '../learning-migration.ts';

test('legacy import preserves newer account progress while adding earlier lessons', () => {
  assert.deepEqual(
    mergeLegacyLearning(
      {
        languageId: 'es',
        enrolledByLanguage: { es: 'current-spanish' },
        completedLessonIds: ['shared-lesson', 'new-lesson'],
      },
      {
        languageId: 'el',
        enrolledByLanguage: { el: 'legacy-greek', es: 'legacy-spanish' },
        completedLessonIds: ['old-lesson', 'shared-lesson'],
      },
    ),
    {
      languageId: 'es',
      enrolledByLanguage: { el: 'legacy-greek', es: 'current-spanish' },
      completedLessonIds: ['old-lesson', 'shared-lesson', 'new-lesson'],
    },
  );
});

test('legacy import restores the earlier language when the account has no progress', () => {
  const merged = mergeLegacyLearning(
    { languageId: 'el', enrolledByLanguage: {}, completedLessonIds: [] },
    { languageId: 'fr', enrolledByLanguage: { fr: 'legacy-french' }, completedLessonIds: ['lesson-1'] },
  );

  assert.equal(merged.languageId, 'fr');
});

test('legacy import persists the scoped destination before removing shared progress', () => {
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
    destinationKey: 'glidelingo-learning:user_123',
    decisionKey: 'glidelingo-learning:legacy-decision:user_123',
    legacyKey: 'glidelingo-learning',
    merged: { languageId: 'el', enrolledByLanguage: {}, completedLessonIds: ['lesson-1'] },
  });

  assert.deepEqual(operations, [
    ['set', 'glidelingo-learning:user_123'],
    ['set', 'glidelingo-learning:legacy-decision:user_123'],
    ['remove', 'glidelingo-learning'],
  ]);
  assert.equal(values.has('glidelingo-learning'), false);
  assert.match(values.get('glidelingo-learning:user_123'), /lesson-1/);
});

test('legacy import never removes the shared source when destination persistence fails', () => {
  const operations = [];
  const storage = {
    getItem: () => 'legacy',
    setItem(key) {
      operations.push(['set', key]);
      if (key === 'scoped') throw new Error('quota exceeded');
    },
    removeItem(key) {
      operations.push(['remove', key]);
    },
  };

  assert.throws(
    () =>
      persistLegacyLearningImport(storage, {
        destinationKey: 'scoped',
        decisionKey: 'decision',
        legacyKey: 'legacy',
        merged: { languageId: 'el', enrolledByLanguage: {}, completedLessonIds: [] },
      }),
    /quota exceeded/,
  );
  assert.deepEqual(operations, [['set', 'scoped']]);
});
