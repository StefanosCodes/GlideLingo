import { expect, jest, test } from '@jest/globals';
import { render } from '@testing-library/react-native';

import { RhythmClosure } from '@/features/learning-progress/rhythm-closure';
import type { PracticeCompletionResult } from '@/features/learning-progress/rhythm-policy';

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));

function result(overrides: Partial<PracticeCompletionResult> = {}): PracticeCompletionResult {
  return {
    dayWasNew: true,
    weeklyGoalReachedNow: false,
    milestone: null,
    summary: {
      currentWeekKey: '2026-08-31',
      activeGoal: 3,
      practiceDaysThisWeek: 2,
      daysRemaining: 1,
      currentWeekMet: false,
      currentStreakWeeks: 3,
      bestStreakWeeks: 3,
      totalPracticeDays: 11,
      hasLapsed: false,
    },
    ...overrides,
  };
}

test('shows quiet weekly progress after a new meaningful day', async () => {
  const screen = await render(<RhythmClosure result={result()} />);
  expect(screen.getByText('2 of 3 practice days this week.')).toBeTruthy();
});

test('shows a milestone only when the completion reaches the goal', async () => {
  const milestone = result({
    weeklyGoalReachedNow: true,
    milestone: 4,
    summary: {
      ...result().summary,
      currentWeekMet: true,
      currentStreakWeeks: 4,
      practiceDaysThisWeek: 3,
      daysRemaining: 0,
    },
  });
  const screen = await render(<RhythmClosure result={milestone} />);

  expect(screen.getByText('4-WEEK MILESTONE')).toBeTruthy();
  expect(screen.getByText('Your 4-week rhythm streak continues.')).toBeTruthy();
});

test('same-day repeats do not render another rhythm closure', async () => {
  const screen = await render(<RhythmClosure result={result({ dayWasNew: false })} />);
  expect(screen.queryByTestId('rhythm-closure')).toBeNull();
});
