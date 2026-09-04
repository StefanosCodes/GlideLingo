import { expect, test } from '@jest/globals';

import { mostRecentEvidence, selectHomeNextAction } from '@/features/product-shell/home-next-action';

test('selects the latest capability evidence independent of strength rank', () => {
  const olderRetained = { evidenceAt: 100, id: 'retained' };
  const newerPracticed = { evidenceAt: 200, id: 'practiced' };

  expect(mostRecentEvidence([olderRetained, newerPracticed])).toBe(newerPracticed);
  expect(mostRecentEvidence([])).toBeNull();
});

const lesson = { durationMin: 8, id: 'lesson-next', title: 'The next lesson' };
const review = {
  capability: { canDo: 'I can greet someone.' },
  lessonId: 'lesson-review',
  reason: 'Retrieve this later to see whether it still comes back.',
};

test('prioritizes a due review over the next unlocked lesson', () => {
  const action = selectHomeNextAction({
    courseProgress: 0.25,
    dueReview: review,
    lesson,
    unitOutcome: 'I can introduce myself.',
    unitProgress: 0.5,
  });

  expect(action).toMatchObject({
    cta: 'Start review',
    kind: 'review',
    lessonId: 'lesson-review',
    title: 'I can greet someone.',
  });
});
test('selects the next authored lesson when nothing is due', () => {
  const action = selectHomeNextAction({
    courseProgress: 0.25,
    dueReview: null,
    lesson,
    unitOutcome: 'I can introduce myself.',
    unitProgress: 0.5,
  });

  expect(action).toMatchObject({
    cta: 'Continue lesson',
    kind: 'lesson',
    lessonId: 'lesson-next',
    outcome: 'I can introduce myself.',
    progress: 0.5,
  });
});

test('routes a completed published course to evidence-backed progress', () => {
  const action = selectHomeNextAction({
    courseProgress: 1,
    dueReview: null,
    lesson: null,
    unitOutcome: null,
    unitProgress: 1,
  });

  expect(action).toMatchObject({
    cta: 'View progress',
    kind: 'complete',
    lessonId: null,
    progress: 1,
  });
});
