import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { PublicTutor, TutorSearchResult } from '@/features/tutor-marketplace/api';
import { TutorDiscoveryScreen } from '@/features/tutor-marketplace/tutor-discovery-screen';

const mockList = jest.fn<(...args: unknown[]) => Promise<TutorSearchResult>>();
const mockPush = jest.fn();
jest.mock('@/features/tutor-marketplace/api', () => ({
  ...jest.requireActual<typeof import('@/features/tutor-marketplace/api')>('@/features/tutor-marketplace/api'),
  listPublicTutors: (...args: unknown[]) => mockList(...args),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () => jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));
jest.mock('@/components/screen-header', () => ({ ScreenHeader: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const previous = process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
const tutor: PublicTutor = {
  tutorId: '2382f687-0ca0-4340-8e78-21ba32912869', headline: 'Calm Greek conversation',
  biography: 'Practice useful conversations with an approved human tutor.', timeZone: 'America/Chicago',
  languages: ['el'], dialects: ['el-cy'], specialties: ['Conversation'], verifiedCredentials: [],
  offeringId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9', offeringTitle: 'Greek conversation',
  durationMinutes: 25, amountMinor: 2500, currency: 'USD', rating: null, ratingCount: 0, isFavorite: false,
};

beforeEach(() => { process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = 'true'; mockList.mockReset(); mockPush.mockReset(); });
afterEach(() => { cleanup(); if (previous === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED; else process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = previous; });

test('discovery covers empty, keyboard-filtered, and deterministic result navigation states', async () => {
  mockList.mockResolvedValueOnce({ items: [], nextCursor: null }).mockResolvedValueOnce({ items: [tutor], nextCursor: null });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorDiscoveryScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText('No tutors match these filters yet.')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('Filter by language code'), 'EL');
  await fireEvent(screen.getByLabelText('Filter by language code'), 'submitEditing');
  await waitFor(() => expect(screen.getByText(tutor.headline)).toBeTruthy());
  expect(mockList).toHaveBeenLastCalledWith({ language: 'el' }, expect.any(AbortSignal));
  await fireEvent.press(screen.getByText(tutor.headline));
  expect(mockPush).toHaveBeenCalledWith(`/tutors/${tutor.tutorId}`);
});

test('discovery exposes an accessible retry after a bounded failure', async () => {
  mockList.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], nextCursor: null });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorDiscoveryScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.getByText('No tutors match these filters yet.')).toBeTruthy());
});

test('a failed next page preserves the current deterministic results', async () => {
  mockList.mockResolvedValueOnce({ items: [tutor], nextCursor: 'next-page' })
    .mockRejectedValueOnce(new Error('offline'));
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorDiscoveryScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText('Load more tutors')).toBeTruthy());
  await fireEvent.press(screen.getByText('Load more tutors'));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByText(tutor.headline)).toBeTruthy();
});
