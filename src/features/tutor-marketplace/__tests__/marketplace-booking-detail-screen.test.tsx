import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { MarketplaceBooking } from '@/features/tutor-marketplace/api';
import { MarketplaceBookingDetailScreen } from '@/features/tutor-marketplace/marketplace-booking-detail-screen';

const mockGet = jest.fn<() => Promise<MarketplaceBooking>>();
const mockReconcile = jest.fn<() => Promise<MarketplaceBooking>>();

jest.mock('@/features/tutor-marketplace/api', () => ({
  getMarketplaceBooking: () => mockGet(),
  reconcileMarketplaceBooking: () => mockReconcile(),
}));
jest.mock('@/components/screen-frame', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ScreenFrame: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ bookingId: 'booking-1' }) }));
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () => jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const ambiguous: MarketplaceBooking = {
  bookingId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9', role: 'learner',
  tutorId: '7da10dbc-0546-4f74-a751-3cad7b5058b3', state: 'payment_ambiguous',
  startsAt: '2026-09-05T12:00:00Z', endsAt: '2026-09-05T12:25:00Z',
  holdExpiresAt: '2026-09-04T12:10:00Z', amountMinor: 2500, currency: 'USD',
  commissionAmountMinor: 500, tutorAmountMinor: 0, checkoutUrl: null, meetingUrl: null, ics: null,
};

beforeEach(() => { process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED = 'true'; mockGet.mockReset(); mockReconcile.mockReset(); });
afterEach(() => { cleanup(); delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED; });

test('shows ambiguous payment without a second checkout and converges by reconciliation', async () => {
  mockGet.mockResolvedValue(ambiguous);
  mockReconcile.mockResolvedValue({
    ...ambiguous, state: 'confirmed',
    meetingUrl: 'https://meet.example.com/reviewed-room',
    ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
  });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><MarketplaceBookingDetailScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByText(/Do not start a second checkout/)).toBeTruthy());
  expect(screen.queryByText('Continue secure checkout')).toBeNull();
  await fireEvent.press(screen.getByText('Check payment status'));
  await waitFor(() => expect(screen.getByText('Status: confirmed')).toBeTruthy());
  expect(mockReconcile).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Open approved meeting')).toBeTruthy();
});
