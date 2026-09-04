import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { MarketplaceConversation } from '@/features/tutor-marketplace/api';
import { MarketplaceMessagesScreen } from '@/features/tutor-marketplace/marketplace-messages-screen';

const mockList = jest.fn<() => Promise<MarketplaceConversation[]>>();
const mockGetPreference = jest.fn<() => Promise<boolean>>();
const mockSetPreference = jest.fn<() => Promise<boolean>>();
const mockPush = jest.fn();
jest.mock('@/features/tutor-marketplace/api', () => ({
  getMarketplaceMessageEmailPreference: () => mockGetPreference(),
  listMarketplaceConversations: () => mockList(),
  setMarketplaceMessageEmailPreference: () => mockSetPreference(),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/components/screen-frame', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ScreenFrame: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const conversation: MarketplaceConversation = {
  conversationId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9', tutorId: '7da10dbc-0546-4f74-a751-3cad7b5058b3',
  participantRole: 'learner', state: 'open', updatedAt: '2026-09-04T12:10:00Z',
};

beforeEach(() => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MESSAGING_ENABLED = 'true';
  mockList.mockReset(); mockGetPreference.mockReset(); mockSetPreference.mockReset(); mockPush.mockReset();
  mockGetPreference.mockResolvedValue(true); mockSetPreference.mockResolvedValue(false);
});
afterEach(() => { cleanup(); delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MESSAGING_ENABLED; });

test('renders the empty journey and links back to discovery', async () => {
  mockList.mockResolvedValue([]);
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><MarketplaceMessagesScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText('No conversations yet.')).toBeTruthy());
  await fireEvent.press(screen.getByText('Find a tutor'));
  expect(mockPush).toHaveBeenCalledWith('/tutors');
});

test('opens a participant conversation and recovers after an error', async () => {
  mockList.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([conversation]);
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><MarketplaceMessagesScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText('Conversations could not be loaded.')).toBeTruthy());
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.getByText('Tutor conversation')).toBeTruthy());
  await fireEvent.press(screen.getByText('Tutor conversation'));
  expect(mockPush).toHaveBeenCalledWith(`/messages/${conversation.conversationId}`);
});

test('updates the message email preference through a race-safe switch', async () => {
  mockList.mockResolvedValue([]);
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><MarketplaceMessagesScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByTestId('message-email-preference')).toBeTruthy());
  await fireEvent(screen.getByTestId('message-email-preference'), 'valueChange', false);
  await waitFor(() => expect(mockSetPreference).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/includes no message text/)).toBeTruthy();
});
