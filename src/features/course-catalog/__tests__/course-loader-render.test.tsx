import { expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LessonSittingView } from '@/features/learning-session/lesson-sitting-view';

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));

jest.mock('@/providers/learning-provider', () => ({
  useLearning: () => ({
    enrolledCourse: jest.requireActual<typeof import('@/constants/catalog')>('@/constants/catalog').courses[0],
    completedLessonIds: [],
    lessonEvidence: [],
    completeLesson: jest.fn(),
    openLesson: jest.fn(),
  }),
}));

jest.mock('@/features/learning-session/audio/use-pronunciation-player', () => ({
  usePronunciationPlayer: () => ({
    play: jest.fn(),
    stateFor: () => ({ status: 'idle', error: null }),
  }),
}));

jest.mock('@/features/learning-session/lesson-tutor/use-lesson-tutor', () => ({
  isLessonTutorEnabled: () => false,
  useLessonTutor: () => ({ cancel: jest.fn(), retry: jest.fn(), send: jest.fn(), state: null }),
}));

test('the current lesson renders its first saved-audio beat through the package bridge', async () => {
  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <LessonSittingView lessonId="el-letters-1" onClose={jest.fn()} />
    </SafeAreaProvider>,
  );

  expect(screen.getByText('α · Α')).toBeTruthy();
  expect(screen.getByText('like the a in father')).toBeTruthy();
  expect(screen.getByLabelText('Play pronunciation: α · Α')).toBeTruthy();
});
