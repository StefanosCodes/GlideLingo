import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ProfileScreen from '@/app/profile';

const mockDismissLegacyProgress = jest.fn();
const mockImportLegacyProgress = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => false);
const mockReplace = jest.fn();

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
    legacyProgressAvailable: true,
    legacyProgressError: null,
    persistenceStatus: 'available',
    setWeeklyPracticeGoal: jest.fn(),
    dismissLegacyProgress: mockDismissLegacyProgress,
    importLegacyProgress: mockImportLegacyProgress,
    switchCourse: jest.fn(),
  }),
}));

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

beforeEach(() => {
  mockDismissLegacyProgress.mockClear();
  mockImportLegacyProgress.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
  mockCanGoBack.mockClear();
  mockCanGoBack.mockReturnValue(false);
  mockReplace.mockClear();
});

test('profile preserves legacy decisions, billing, and account controls', async () => {
  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <ProfileScreen />
    </SafeAreaProvider>,
  );

  expect(screen.getByLabelText('Account controls')).toBeTruthy();
  await fireEvent.press(screen.getByText('Import progress'));
  await fireEvent.press(screen.getByText('Not mine'));
  await fireEvent.press(screen.getByText('Manage Pro'));
  await fireEvent.press(screen.getByLabelText('Back to learning'));

  expect(mockImportLegacyProgress).toHaveBeenCalledTimes(1);
  expect(mockDismissLegacyProgress).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/subscription');
  expect(mockReplace).toHaveBeenCalledWith('/');
});
