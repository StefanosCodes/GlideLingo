import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import SubscriptionScreen from '@/app/subscription';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockRefresh = jest.fn(async () => undefined);

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => false, replace: mockReplace }),
}));
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));
jest.mock('@/providers/billing-provider', () => ({
  useBilling: () => ({
    mode: 'revenuecat',
    status: 'error',
    isPro: false,
    packages: [],
    purchaseState: { packageIdentifier: null, status: 'idle', message: null },
    managementState: { status: 'idle', message: null },
    manage: jest.fn(async () => undefined),
    purchase: jest.fn(async () => false),
    refresh: mockRefresh,
    restore: jest.fn(async () => undefined),
    resetMockAccess: jest.fn(),
  }),
}));

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

beforeEach(() => {
  mockBack.mockClear();
  mockReplace.mockClear();
  mockRefresh.mockClear();
});

test('subscription failure is concise, actionable, and vendor neutral', async () => {
  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <SubscriptionScreen />
    </SafeAreaProvider>,
  );

  expect(screen.getByText('We couldn’t check your plan')).toBeTruthy();
  expect(screen.getByText('Your plan has not changed. Check your connection and try again.')).toBeTruthy();
  expect(screen.queryByText(/RevenueCat/i)).toBeNull();
  expect(screen.queryByText(/entitlement/i)).toBeNull();
  expect(screen.queryByText('Purchase status unavailable')).toBeNull();
  expect(screen.queryByText('Refresh access')).toBeNull();
  expect(screen.getAllByText('Try again')).toHaveLength(1);

  await fireEvent.press(screen.getByText('Try again'));
  expect(mockRefresh).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByText('Back'));
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith('/profile');
});
