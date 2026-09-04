import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { PublicTutor, TutorSlots } from '@/features/tutor-marketplace/api';
import { TutorPublicProfileScreen } from '@/features/tutor-marketplace/tutor-public-profile-screen';

const mockGetTutor = jest.fn<() => Promise<PublicTutor>>();
const mockGetSlots = jest.fn<() => Promise<TutorSlots>>();
const mockFavorite = jest.fn<() => Promise<PublicTutor>>();

jest.mock('@/features/tutor-marketplace/api', () => ({
  getPublicTutor: () => mockGetTutor(),
  listPublicTutorSlots: () => mockGetSlots(),
  setPublicTutorFavorite: () => mockFavorite(),
}));
jest.mock('@/components/screen-frame', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ScreenFrame: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ tutorId: 'tutor-1' }),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () => jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const tutor: PublicTutor = {
  tutorId: 'tutor-1', headline: 'Calm Greek conversation',
  biography: 'Practice useful conversations with an approved human tutor.', timeZone: 'America/Chicago',
  languages: ['el'], dialects: ['el-cy'], specialties: ['Conversation'],
  verifiedCredentials: ['Adult language teaching certificate'], offeringId: 'offering-1',
  offeringTitle: 'Greek conversation', durationMinutes: 25, amountMinor: 2500,
  currency: 'USD', rating: null, ratingCount: 0, isFavorite: false,
};

beforeEach(() => {
  mockGetTutor.mockReset(); mockGetSlots.mockReset(); mockFavorite.mockReset();
});
afterEach(cleanup);

test('public profile renders only safe fields, empty slots, and a race-safe favorite action', async () => {
  mockGetTutor.mockResolvedValue(tutor);
  mockGetSlots.mockResolvedValue({
    tutorId: tutor.tutorId, timeZone: tutor.timeZone, source: 'manual', freshness: 'current', slots: [],
  });
  mockFavorite.mockResolvedValue({ ...tutor, isFavorite: true });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorPublicProfileScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByText(tutor.headline)).toBeTruthy());
  expect(screen.getByText('Verified credential: Adult language teaching certificate')).toBeTruthy();
  expect(screen.getByText('No manual slots are available in the next two weeks.')).toBeTruthy();
  expect(screen.queryByText(/actor_ref|application_id|payout_ready/i)).toBeNull();

  await fireEvent.press(screen.getByText('Save tutor'));
  await waitFor(() => expect(screen.getByText('Remove from favorites')).toBeTruthy());
  expect(mockFavorite).toHaveBeenCalledTimes(1);
});

test('public profile exposes a retry after either request fails', async () => {
  mockGetTutor.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(tutor);
  mockGetSlots.mockResolvedValue({
    tutorId: tutor.tutorId, timeZone: tutor.timeZone, source: 'manual', freshness: 'current', slots: [],
  });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorPublicProfileScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.getByText(tutor.headline)).toBeTruthy());
});
