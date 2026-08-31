import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RhythmScreen } from '@/features/learning-progress/rhythm-screen';

const mockSetWeeklyPracticeGoal = jest.fn();
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
    persistenceStatus: 'available',
    practiceDayKeys: ['2026-08-31'],
    weeklyPracticeGoal: 3,
    weeklyGoalChanges: [{ effectiveWeekKey: '2026-08-31', goal: 3 }],
    rhythmSummary: {
      currentWeekKey: '2026-08-31',
      activeGoal: 3,
      practiceDaysThisWeek: 1,
      daysRemaining: 2,
      currentWeekMet: false,
      currentStreakWeeks: 2,
      bestStreakWeeks: 4,
      totalPracticeDays: 9,
      hasLapsed: false,
    },
    setWeeklyPracticeGoal: mockSetWeeklyPracticeGoal,
  }),
}));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 31, 12));
  mockSetWeeklyPracticeGoal.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

test('renders streak truth, a Monday-first calendar, and goal controls', async () => {
  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <RhythmScreen onBack={jest.fn()} />
    </SafeAreaProvider>,
  );

  expect(screen.getByText('2-week rhythm streak')).toBeTruthy();
  expect(screen.getByText('1 of 3 practice days')).toBeTruthy();
  expect(screen.getByText('August 2026')).toBeTruthy();
  expect(screen.getByLabelText(/Monday, August 31, 2026, today, practiced/)).toBeTruthy();

  fireEvent.press(screen.getByLabelText('5 practice days per week'));
  expect(mockSetWeeklyPracticeGoal).toHaveBeenCalledWith(5);
});

test('does not navigate beyond the current calendar month', async () => {
  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <RhythmScreen onBack={jest.fn()} />
    </SafeAreaProvider>,
  );
  expect(screen.getByLabelText('Next month').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByLabelText('Previous month'));
  expect(screen.getByText('July 2026')).toBeTruthy();
});
