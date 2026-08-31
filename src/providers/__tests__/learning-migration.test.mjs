import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeLegacyLearning } from '../learning-migration.ts';

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
