import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import { RhythmStatusButton } from '@/components/rhythm-status-button';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));
jest.mock('@/providers/learning-provider', () => ({
  useLearning: () => ({
    rhythmSummary: {
      activeGoal: 3,
      currentStreakWeeks: 4,
      practiceDaysThisWeek: 2,
    },
  }),
}));

beforeEach(() => {
  mockPush.mockClear();
});

test('announces both rhythm streak and weekly progress and opens the rhythm route', async () => {
  const screen = await render(<RhythmStatusButton />);
  const button = screen.getByLabelText('4-week rhythm streak. 2 of 3 practice days this week.');

  expect(screen.getByText('4 wk')).toBeTruthy();
  fireEvent.press(button);
  expect(mockPush).toHaveBeenCalledWith('/rhythm');
});
