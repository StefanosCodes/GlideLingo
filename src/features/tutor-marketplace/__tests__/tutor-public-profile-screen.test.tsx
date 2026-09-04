import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { PublicTutor, TutorSlots } from '@/features/tutor-marketplace/api';
import { TutorPublicProfileScreen } from '@/features/tutor-marketplace/tutor-public-profile-screen';

const mockGetTutor = jest.fn<() => Promise<PublicTutor>>();
const mockGetSlots = jest.fn<(...args: unknown[]) => Promise<TutorSlots>>();
const mockFavorite = jest.fn<() => Promise<PublicTutor>>();
const mockConversation = jest.fn<() => Promise<{ conversationId: string }>>();
const mockCheckout = jest.fn<(tutorId: string, startsAt: string, key: string, offeringId?: string) => Promise<{ bookingId: string; checkoutUrl: string | null }>>();
const mockPush = jest.fn();

jest.mock('@/features/tutor-marketplace/api', () => ({
  createBookingCheckout: (tutorId: string, startsAt: string, key: string, offeringId?: string) => mockCheckout(tutorId, startsAt, key, offeringId),
  createMarketplaceConversation: () => mockConversation(),
  getPublicTutor: () => mockGetTutor(),
  listPublicTutorSlots: (...args: unknown[]) => mockGetSlots(...args),
  setPublicTutorFavorite: () => mockFavorite(),
}));
jest.mock('@/features/tutor-marketplace/client-operation-id', () => ({
  createMarketplaceClientId: () => '11111111-1111-4111-8111-111111111111',
}));
jest.mock('@/components/screen-frame', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ScreenFrame: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ tutorId: 'tutor-1' }),
  useRouter: () => ({ push: mockPush }),
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
  mockGetTutor.mockReset(); mockGetSlots.mockReset(); mockFavorite.mockReset(); mockConversation.mockReset(); mockCheckout.mockReset(); mockPush.mockReset();
});
afterEach(() => { cleanup(); delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MESSAGING_ENABLED; delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED; jest.restoreAllMocks(); });

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

test('stale Google availability is never presented as silently bookable', async () => {
  mockGetTutor.mockResolvedValue(tutor);
  mockGetSlots.mockResolvedValue({
    tutorId: tutor.tutorId,
    timeZone: tutor.timeZone,
    source: 'manual+google',
    freshness: 'stale',
    slots: [],
  });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorPublicProfileScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByText(/temporarily stale/)).toBeTruthy());
  expect(screen.queryByText('No manual slots are available in the next two weeks.')).toBeNull();
});

test('opens a participant-scoped conversation when messaging is enabled', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MESSAGING_ENABLED = 'true';
  mockGetTutor.mockResolvedValue(tutor);
  mockGetSlots.mockResolvedValue({ tutorId: tutor.tutorId, timeZone: tutor.timeZone, source: 'manual', freshness: 'current', slots: [] });
  mockConversation.mockResolvedValue({ conversationId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9' });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorPublicProfileScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByText('Message tutor')).toBeTruthy());
  await fireEvent.press(screen.getByText('Message tutor'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/messages/f8d97d12-3e8a-49c6-bb22-55c49956c8b9'));
});

test('creates one server-authoritative hold and opens only the parsed Stripe checkout', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED = 'true';
  const slot = { startsAt: '2026-09-05T15:00:00Z', endsAt: '2026-09-05T15:25:00Z' };
  const checkout = { bookingId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9', checkoutUrl: 'https://checkout.stripe.com/c/pay/reviewed123' };
  let resolveCheckout: (value: typeof checkout) => void = () => undefined;
  let resolveOpen: (value: boolean) => void = () => undefined;
  const checkoutPromise = new Promise<typeof checkout>((resolve) => { resolveCheckout = resolve; });
  const openPromise = new Promise<boolean>((resolve) => { resolveOpen = resolve; });
  mockGetTutor.mockResolvedValue(tutor);
  mockGetSlots.mockResolvedValue({ tutorId: tutor.tutorId, timeZone: tutor.timeZone, source: 'manual', freshness: 'current', slots: [slot] });
  mockCheckout.mockReturnValue(checkoutPromise);
  const open = jest.spyOn(Linking, 'openURL').mockReturnValue(openPromise);
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorPublicProfileScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
  const bookButton = screen.getByRole('button', { name: 'Book' });
  const pressBook = bookButton.props.onClick ?? bookButton.props.onResponderRelease;
  expect(typeof pressBook).toBe('function');
  await act(() => {
    pressBook({ nativeEvent: {} });
    pressBook({ nativeEvent: {} });
  });
  expect(mockCheckout).toHaveBeenCalledTimes(1);
  expect(mockCheckout.mock.calls[0]?.[0]).toBe(tutor.tutorId);
  expect(mockCheckout.mock.calls[0]?.[1]).toBe(slot.startsAt);
  expect(mockCheckout.mock.calls[0]?.[2]).toMatch(/^[0-9a-f-]{36}$/i);
  expect(mockCheckout.mock.calls[0]?.[3]).toBe(tutor.offeringId);
  await act(async () => {
    resolveCheckout(checkout);
    await checkoutPromise;
    await Promise.resolve();
    resolveOpen(true);
    await openPromise;
  });
  expect(mockPush).toHaveBeenCalledWith('/bookings/f8d97d12-3e8a-49c6-bb22-55c49956c8b9');
  expect(open).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/reviewed123');
});

test('preserves favorite state across an overlapping offering request and checks out that offering', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_COMMERCE_ENABLED = 'true';
  const secondOffering = {
    offeringId: 'offering-2', title: 'Extended Greek conversation', durationMinutes: 50 as const,
    amountMinor: 4500, currency: 'USD' as const,
  };
  const multiTutor: PublicTutor = {
    ...tutor,
    offerings: [{
      offeringId: tutor.offeringId, title: tutor.offeringTitle,
      durationMinutes: tutor.durationMinutes, amountMinor: tutor.amountMinor, currency: tutor.currency,
    }, secondOffering],
  };
  const secondSlot = { startsAt: '2026-09-06T15:00:00Z', endsAt: '2026-09-06T15:50:00Z' };
  let resolveFavorite: (value: PublicTutor) => void = () => undefined;
  let resolveSecondSlots: (value: TutorSlots) => void = () => undefined;
  const favoritePromise = new Promise<PublicTutor>((resolve) => { resolveFavorite = resolve; });
  const secondSlotsPromise = new Promise<TutorSlots>((resolve) => { resolveSecondSlots = resolve; });
  mockGetTutor.mockResolvedValue(multiTutor);
  mockGetSlots
    .mockResolvedValueOnce({ tutorId: tutor.tutorId, timeZone: tutor.timeZone, source: 'manual', freshness: 'current', slots: [] })
    .mockReturnValueOnce(secondSlotsPromise);
  mockFavorite.mockReturnValue(favoritePromise);
  mockCheckout.mockResolvedValue({ bookingId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9', checkoutUrl: null });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorPublicProfileScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByText(/Extended Greek conversation/)).toBeTruthy());
  const favoriteButton = screen.getByRole('button', { name: 'Save tutor' });
  const offeringButton = screen.getByRole('button', { name: /Extended Greek conversation/ });
  const pressFavorite = favoriteButton.props.onClick ?? favoriteButton.props.onResponderRelease;
  const pressOffering = offeringButton.props.onClick ?? offeringButton.props.onResponderRelease;
  expect(typeof pressFavorite).toBe('function');
  expect(typeof pressOffering).toBe('function');
  await act(() => {
    pressFavorite({ nativeEvent: {} });
    pressOffering({ nativeEvent: {} });
  });
  await act(async () => {
    resolveFavorite({ ...multiTutor, isFavorite: true });
    resolveSecondSlots({ tutorId: tutor.tutorId, timeZone: tutor.timeZone, source: 'manual', freshness: 'current', slots: [secondSlot] });
    await Promise.all([favoritePromise, secondSlotsPromise]);
  });
  await waitFor(() => expect(screen.getByText('Remove from favorites')).toBeTruthy());
  await waitFor(() => expect(screen.getByText(`Times below are for ${secondOffering.title} · ${tutor.timeZone}`)).toBeTruthy());
  await act(async () => {
    fireEvent.press(screen.getByText('Book'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
  expect(mockCheckout.mock.calls[0]?.[3]).toBe(secondOffering.offeringId);
  await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
});
