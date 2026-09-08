import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { MarketplaceOperatorCapability } from '@/features/tutor-marketplace/api';
import { MarketplaceOperationsHubScreen } from '@/features/tutor-marketplace/marketplace-operations-hub-screen';

const mockCapabilities = jest.fn<() => Promise<MarketplaceOperatorCapability[]>>();
const mockPush = jest.fn();
jest.mock('@/features/tutor-marketplace/api', () => ({
  getMarketplaceOperatorCapabilities: () => mockCapabilities(),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/components/screen-frame', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ScreenFrame: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () => jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

beforeEach(() => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = 'true';
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MESSAGING_ENABLED = 'true';
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED = 'true';
  mockCapabilities.mockReset();
  mockPush.mockReset();
});

afterEach(() => {
  cleanup();
  delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
  delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MESSAGING_ENABLED;
  delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED;
});

test('distinguishes capability failure from an empty account and retries safely', async () => {
  mockCapabilities
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(['manage_bookings', 'review_message_reports']);
  const screen = await render(
    <SafeAreaProvider initialMetrics={metrics}><MarketplaceOperationsHubScreen /></SafeAreaProvider>,
  );

  await waitFor(() => expect(screen.getByText('Operator tools are unavailable.')).toBeTruthy());
  expect(screen.queryByText('This account has no marketplace operator tools.')).toBeNull();
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.getByText('Booking operations')).toBeTruthy());
  expect(screen.getByText('Message safety reports')).toBeTruthy();
  expect(screen.queryByText('Review moderation')).toBeNull();
});

test('shows the true capability-empty state without privileged links', async () => {
  mockCapabilities.mockResolvedValue([]);
  const screen = await render(
    <SafeAreaProvider initialMetrics={metrics}><MarketplaceOperationsHubScreen /></SafeAreaProvider>,
  );

  await waitFor(() => expect(screen.getByText('This account has no marketplace operator tools.')).toBeTruthy());
  expect(screen.queryByText('Booking operations')).toBeNull();
});
