import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { MarketplaceMessage } from '@/features/tutor-marketplace/api';
import { MarketplaceMessageThreadScreen } from '@/features/tutor-marketplace/marketplace-message-thread-screen';

const conversationId = 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9';
const mockList = jest.fn<() => Promise<{ items: MarketplaceMessage[]; nextCursor: null }>>();
const mockSend = jest.fn<() => Promise<MarketplaceMessage>>();
const mockBlock = jest.fn<() => Promise<void>>();
const mockReport = jest.fn<() => Promise<object>>();
jest.mock('@/features/tutor-marketplace/api', () => ({
  TutorMarketplaceClientError: class extends Error {},
  blockMarketplaceParticipant: () => mockBlock(),
  listMarketplaceMessages: () => mockList(),
  reportMarketplaceMessage: () => mockReport(),
  sendMarketplaceMessage: () => mockSend(),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ conversationId }) }));
jest.mock('@/components/screen-frame', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ScreenFrame: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const hostile: MarketplaceMessage = {
  messageId: '2382f687-0ca0-4340-8e78-21ba32912869', kind: 'user', senderRole: 'tutor',
  body: '<script>alert("unsafe")</script>', isOwn: false, createdAt: '2026-09-04T12:10:00Z',
};
const own: MarketplaceMessage = { ...hostile, messageId: '335516e3-6ab7-4de4-83ae-1ac7d6b76cdb', body: 'Thanks', isOwn: true, senderRole: 'learner' };

beforeEach(() => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MESSAGING_ENABLED = 'true';
  mockList.mockReset(); mockSend.mockReset(); mockBlock.mockReset(); mockReport.mockReset();
});
afterEach(() => { cleanup(); delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MESSAGING_ENABLED; });

test('renders malicious markup as literal text and sends once without clearing early', async () => {
  mockList.mockResolvedValue({ items: [hostile], nextCursor: null }); mockSend.mockResolvedValue(own);
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><MarketplaceMessageThreadScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText(hostile.body)).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('Message'), 'Thanks');
  await fireEvent.press(screen.getByText('Send message'));
  await waitFor(() => expect(screen.getByText('YOU')).toBeTruthy());
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Message').props.value).toBe('');
});

test('offers report and block controls with user-visible outcomes', async () => {
  mockList.mockResolvedValue({ items: [hostile], nextCursor: null }); mockReport.mockResolvedValue({}); mockBlock.mockResolvedValue();
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><MarketplaceMessageThreadScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText(hostile.body)).toBeTruthy());
  await fireEvent.press(screen.getByText('Report latest message'));
  await waitFor(() => expect(screen.getByText('Report sent for review.')).toBeTruthy());
  await fireEvent.press(screen.getByText('Block participant'));
  await waitFor(() => expect(screen.getByText(/Participant blocked/)).toBeTruthy());
});
