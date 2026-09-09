import { expect, it } from '@jest/globals';

import { isVisibleLessonActive, sidebarTransitionDuration } from '../app-tabs.web';

it('defers a required desktop update only while the active lesson is visible', () => {
  expect(isVisibleLessonActive('lesson-1', '/')).toBe(true);
  expect(isVisibleLessonActive('lesson-1', '/profile')).toBe(false);
  expect(isVisibleLessonActive('lesson-1', '/quests')).toBe(false);
  expect(isVisibleLessonActive(null, '/')).toBe(false);
});

it('animates the sidebar unless the user requests reduced motion', () => {
  expect(sidebarTransitionDuration(false)).toBe('220ms');
  expect(sidebarTransitionDuration(true)).toBe('0ms');
});
