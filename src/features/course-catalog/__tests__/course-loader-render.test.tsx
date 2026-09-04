import { expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LessonSittingView } from '@/features/learning-session/lesson-sitting-view';

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const mockCompleteLesson = jest.fn();

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));

jest.mock('@/providers/learning-provider', () => ({
  useLearning: () => ({
    enrolledCourse: jest.requireActual<typeof import('@/constants/catalog')>('@/constants/catalog').courses[0],
    completedLessonIds: [],
    lessonEvidence: [],
    completeLesson: mockCompleteLesson,
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
  mockCompleteLesson.mockClear();
  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <LessonSittingView lessonId="el-letters-1" onClose={jest.fn()} />
    </SafeAreaProvider>,
  );

  expect(screen.getByText('α · Α')).toBeTruthy();
  expect(screen.getByText('like the a in father')).toBeTruthy();
  expect(screen.getByLabelText('Play pronunciation: α · Α')).toBeTruthy();
});

test('the authored lesson completes end to end without advancing into placeholder content', async () => {
  mockCompleteLesson.mockClear();
  const onClose = jest.fn();
  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <LessonSittingView lessonId="el-letters-1" onClose={onClose} />
    </SafeAreaProvider>,
  );

  for (let step = 0; step < 5; step += 1) {
    await fireEvent.press(screen.getByText('Continue'));
  }
  expect(screen.getByText('Which letter is the a in father?')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('1. α'));
  await fireEvent.press(screen.getByText('Continue'));
  expect(screen.getByText('What sound does this make?')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('2. na'));
  await fireEvent.press(screen.getByText('Continue'));

  expect(mockCompleteLesson).toHaveBeenCalledWith(expect.objectContaining({
    lessonId: 'el-letters-1',
    checks: [
      expect.objectContaining({ correct: true, correctOnFirstTry: true }),
      expect.objectContaining({ correct: true, correctOnFirstTry: true }),
    ],
  }));
  expect(screen.getByText('CHECKPOINT PASSED')).toBeTruthy();
  expect(screen.getByText('Back to Home')).toBeTruthy();
  expect(screen.queryByText(/Next: The alphabet/)).toBeNull();
  await fireEvent.press(screen.getByText('Back to Home'));
  expect(onClose).toHaveBeenCalledTimes(1);
});
