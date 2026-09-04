import { expect, test } from '@jest/globals';

import { voiceScenarioForLesson } from '../voice-scenarios';

test('maps only the checked-in sound-map lesson to the authored voice scenario', () => {
  expect(voiceScenarioForLesson('el-from-zero', 'el-letters-1')).toEqual({
    courseId: 'el-from-zero',
    lessonId: 'el-letters-1',
    scenarioId: 'el-letters-1-voice-v1',
  });
  expect(voiceScenarioForLesson('el-from-zero', 'el-introduce-1')).toBeNull();
  expect(voiceScenarioForLesson('another-course', 'el-letters-1')).toBeNull();
});
