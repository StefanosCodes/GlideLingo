import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { LearningProvider, useLearning } from '@/providers/learning-provider';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: jest.fn((key: string) => storage.get(key) ?? null),
      setItem: jest.fn((key: string, value: string) => storage.set(key, value)),
    },
  });
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 31, 12));
});

afterEach(() => {
  jest.useRealTimers();
});

function Probe() {
  const { completeLesson, rhythmSummary, setWeeklyPracticeGoal } = useLearning();
  return (
    <>
      <Text testID="days">{rhythmSummary.practiceDaysThisWeek}</Text>
      <Pressable accessibilityLabel="Set two-day rhythm" onPress={() => setWeeklyPracticeGoal(2)} />
      <Pressable
        accessibilityLabel="Complete lesson"
        onPress={() =>
          completeLesson({
            lessonId: 'el-letters-1',
            mode: 'learn',
            introducedModes: ['reading'],
            checks: [],
          })
        }
      />
    </>
  );
}

test('provider records at most one meaningful day per local date and persists it', async () => {
  const screen = await render(
    <LearningProvider>
      <Probe />
    </LearningProvider>,
  );
  await act(async () => {
    jest.runAllTicks();
  });

  await fireEvent.press(screen.getByLabelText('Set two-day rhythm'));
  await fireEvent.press(screen.getByLabelText('Complete lesson'));
  await fireEvent.press(screen.getByLabelText('Complete lesson'));

  expect(screen.getByTestId('days').props.children).toBe(1);
  expect([...storage.values()].some((value) => value.includes('2026-08-31'))).toBe(true);
});
