import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { OnboardingScreen } from '@/features/onboarding/onboarding-screen';

const mockReplace = jest.fn();
const mockSetWeeklyPracticeGoal = jest.fn();
const mockStartCourse = jest.fn(() => true);
const mockCompleteOnboarding = jest.fn(async () => undefined);
const mockBilling = {
  errorMessage: null as string | null,
  isPro: false,
  mode: 'revenuecat' as const,
  packages: [],
  purchase: jest.fn(async () => undefined),
  refresh: jest.fn(async () => undefined),
  restore: jest.fn(async () => undefined),
  status: 'loading' as 'loading' | 'free',
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));

jest.mock('@/features/learning-session/audio/use-pronunciation-player', () => ({
  usePronunciationPlayer: () => ({
    play: jest.fn(),
    stateFor: () => ({ error: null, status: 'idle' }),
  }),
}));

jest.mock('@/providers/billing-provider', () => ({
  useBilling: () => mockBilling,
}));

jest.mock('@/providers/learning-provider', () => ({
  useLearning: () => ({
    setWeeklyPracticeGoal: mockSetWeeklyPracticeGoal,
    startCourse: mockStartCourse,
  }),
}));

jest.mock('@/providers/onboarding-provider', () => ({
  useOnboarding: () => ({
    completeOnboarding: mockCompleteOnboarding,
    completeSample: jest.fn(),
    selectGoal: jest.fn(),
    selectRhythm: jest.fn(),
    setStep: jest.fn(),
    state: {
      version: 1,
      completed: false,
      step: 'paywall',
      goal: 'conversation',
      rhythm: 'daily',
      sampleCompleted: true,
      access: null,
    },
    storageError: null,
  }),
}));

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

beforeEach(() => {
  mockBilling.status = 'loading';
  mockCompleteOnboarding.mockClear();
  mockReplace.mockClear();
  mockSetWeeklyPracticeGoal.mockClear();
  mockStartCourse.mockClear().mockReturnValue(true);
});

test('waits for entitlement resolution, then applies the onboarding rhythm before entering Home', async () => {
  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <OnboardingScreen />
    </SafeAreaProvider>,
  );

  expect(screen.getByTestId('onboarding-free-continue').props.accessibilityState.disabled).toBe(true);

  mockBilling.status = 'free';
  await screen.rerender(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <OnboardingScreen />
    </SafeAreaProvider>,
  );
  fireEvent.press(screen.getByTestId('onboarding-free-continue'));

  await waitFor(() => expect(mockCompleteOnboarding).toHaveBeenCalledWith('free'));
  expect(mockStartCourse).toHaveBeenCalledWith('el-from-zero');
  expect(mockSetWeeklyPracticeGoal).toHaveBeenCalledWith(7);
  expect(mockReplace).toHaveBeenCalledWith('/');
});
