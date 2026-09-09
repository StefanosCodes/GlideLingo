import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ProfileScreen from '@/app/profile';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => false);
const mockReplace = jest.fn();
const mockSetThemePreference = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, canGoBack: mockCanGoBack, push: mockPush, replace: mockReplace }),
}));
jest.mock('@/features/auth/account-summary', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AccountSummary: () => React.createElement(Text, { accessibilityLabel: 'Account controls' }, 'Account controls'),
  };
});
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
  useThemeController: () => ({ scheme: 'light', setPreference: mockSetThemePreference }),
}));
jest.mock('@/providers/learning-provider', () => ({
  useLearning: () => ({
    language: { available: true, flag: '🇬🇷', name: 'Greek' },
    languages: [{ available: true, flag: '🇬🇷', id: 'el', name: 'Greek' }],
    courses: [],
    enrolledCourse: null,
    currentModule: null,
    progress: 0,
    lessonEvidence: [],
    practiceDaysThisWeek: 0,
    weeklyPracticeGoal: null,
    rhythmSummary: { activeGoal: null, currentStreakWeeks: 0, practiceDaysThisWeek: 0 },
    completedModuleIds: [],
    persistenceStatus: 'available',
    setWeeklyPracticeGoal: jest.fn(),
    switchCourse: jest.fn(),
  }),
}));

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockCanGoBack.mockClear();
  mockCanGoBack.mockReturnValue(false);
  mockReplace.mockClear();
  mockSetThemePreference.mockClear();
});

test('profile preserves billing, account, and appearance controls', async () => {
  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <ProfileScreen />
    </SafeAreaProvider>,
  );

  expect(screen.getByLabelText('Account controls')).toBeTruthy();
  expect(screen.queryByText('EXISTING PROGRESS FOUND')).toBeNull();
  await fireEvent.press(screen.getByText('Manage Pro'));
  await fireEvent(screen.getByTestId('dark-appearance-switch'), 'valueChange', true);
  await fireEvent.press(screen.getByLabelText('Back to learning'));

  expect(mockPush).toHaveBeenCalledWith('/subscription');
  expect(mockSetThemePreference).toHaveBeenCalledWith('dark');
  expect(mockReplace).toHaveBeenCalledWith('/');
});
