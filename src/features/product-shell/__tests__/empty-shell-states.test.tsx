import { beforeEach, expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';

import HomeScreen from '@/app/(app)/index';
import CourseScreen from '@/app/(app)/course';
import ProgressScreen from '@/app/(app)/progress';

const mockPush = jest.fn();
let mockLearningState: Record<string, unknown>;

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/components/screen-frame', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ScreenFrame: ({ children }: import('react').PropsWithChildren) => React.createElement(View, null, children),
  };
});
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));
jest.mock('@/providers/learning-provider', () => ({ useLearning: () => mockLearningState }));
jest.mock('@/features/learning-session/lesson-lecture-view', () => ({ LessonLectureView: () => null }));

beforeEach(() => {
  mockPush.mockClear();
  mockLearningState = {
    activeLessonId: null,
    activeLessonMode: 'learn',
    completedLessonIds: [],
    courses: [
      {
        id: 'course',
        levelLabel: 'A1',
        modules: [
          {
            id: 'authored-unit',
            lessons: [{ id: 'authored-lesson', title: 'Ready', durationMin: 8, contentStatus: 'authored' }],
          },
          {
            id: 'planned-unit',
            lessons: [{ id: 'planned-lesson', title: 'Planned', durationMin: 8, contentStatus: 'placeholder' }],
          },
        ],
        summary: 'Course summary',
        title: 'Greek Foundations',
      },
    ],
    currentModule: null,
    enrolledCourse: null,
    language: { available: true, name: 'Greek' },
    lessonEvidence: [],
    nextLesson: null,
    openLesson: jest.fn(),
    persistenceStatus: 'available',
    practiceDaysThisWeek: 0,
    progress: 0,
    reviewItems: [],
    weeklyPracticeGoal: null,
  };
});

test('keeps a corrupt-storage warning visible in the Home enrollment state', async () => {
  mockLearningState.persistenceStatus = 'corrupt';
  const screen = await render(<HomeScreen />);

  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByText('Saved progress could not be read safely.')).toBeTruthy();
});

test('keeps an unavailable-storage warning visible in empty Progress', async () => {
  mockLearningState.persistenceStatus = 'unavailable';
  const screen = await render(<ProgressScreen />);

  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByText('Progress is available for this session only.')).toBeTruthy();
});

test('Home and Course enrollment cards count only authored lessons', async () => {
  const home = await render(<HomeScreen />);
  expect(home.getByText('A1 · 1 AUTHORED LESSON')).toBeTruthy();

  const course = await render(<CourseScreen />);
  expect(course.getByText('A1 · 1 AUTHORED LESSON')).toBeTruthy();
  expect(course.queryByText(/2 UNITS/)).toBeNull();
});

test('Progress ignores stale placeholder completion IDs', async () => {
  mockLearningState.enrolledCourse = (mockLearningState.courses as unknown[])[0];
  mockLearningState.completedLessonIds = ['authored-lesson', 'planned-lesson'];
  mockLearningState.progress = 1;

  const screen = await render(<ProgressScreen />);
  expect(screen.getByText('1 authored lesson complete')).toBeTruthy();
  expect(screen.queryByText('2 lessons complete')).toBeNull();
});
