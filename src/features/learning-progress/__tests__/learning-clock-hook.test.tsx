import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { localWeekKey } from '@/features/learning-progress/rhythm-policy';
import { useLearningClock } from '@/features/learning-progress/learning-clock';

let foreground: ((state: string) => void) | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 30, 23, 59, 59));
  foreground = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    foreground = listener as (state: string) => void;
    return { remove: jest.fn() };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function ClockProbe() {
  const now = useLearningClock([]);
  return <Text testID="week">{localWeekKey(now)}</Text>;
}

test('the scheduled local-midnight tick moves Sunday into the new Monday week', async () => {
  const screen = await render(<ClockProbe />);
  expect(screen.getByTestId('week').props.children).toBe('2026-08-24');

  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });

  expect(screen.getByTestId('week').props.children).toBe('2026-08-31');
});

test('returning to the foreground recomputes time-derived learning state', async () => {
  const screen = await render(<ClockProbe />);
  jest.setSystemTime(new Date(2026, 7, 31, 12));

  await act(async () => {
    foreground?.('active');
  });

  expect(screen.getByTestId('week').props.children).toBe('2026-08-31');
});
