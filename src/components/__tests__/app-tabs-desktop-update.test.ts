import { expect, it } from '@jest/globals';

import { isVisibleLessonActive } from '../app-tabs.web';

it('defers a required desktop update only while the active lesson is visible', () => {
  expect(isVisibleLessonActive('lesson-1', '/')).toBe(true);
  expect(isVisibleLessonActive('lesson-1', '/profile')).toBe(false);
  expect(isVisibleLessonActive('lesson-1', '/quests')).toBe(false);
  expect(isVisibleLessonActive(null, '/')).toBe(false);
});
