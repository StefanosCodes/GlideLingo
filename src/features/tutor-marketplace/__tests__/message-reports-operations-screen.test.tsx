import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { MarketplaceMessageReport } from '@/features/tutor-marketplace/api';
import { MessageReportsOperationsScreen } from '@/features/tutor-marketplace/message-reports-operations-screen';

const mockList = jest.fn<() => Promise<MarketplaceMessageReport[]>>();
const mockGet = jest.fn<() => Promise<MarketplaceMessageReport>>();
const mockResolve = jest.fn<() => Promise<MarketplaceMessageReport>>();
jest.mock('@/features/tutor-marketplace/api', () => ({
  getMarketplaceMessageReport: () => mockGet(),
  listMarketplaceMessageReports: () => mockList(),
  resolveMarketplaceMessageReport: () => mockResolve(),
}));
jest.mock('@/components/screen-frame', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ScreenFrame: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const report: MarketplaceMessageReport = {
  reportId: '335516e3-6ab7-4de4-83ae-1ac7d6b76cdb', conversationId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9',
  messageId: '2382f687-0ca0-4340-8e78-21ba32912869', reason: 'unsafe', details: 'Review this bounded context.',
  status: 'open', createdAt: '2026-09-04T12:10:00Z', messages: [{
    messageId: '2382f687-0ca0-4340-8e78-21ba32912869', kind: 'user', senderRole: 'tutor', body: 'Reported text',
    isOwn: false, createdAt: '2026-09-04T12:10:00Z',
  }],
};

beforeEach(() => { mockList.mockReset(); mockGet.mockReset(); mockResolve.mockReset(); });
afterEach(cleanup);

test('renders an empty capability-scoped queue', async () => {
  mockList.mockResolvedValue([]);
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><MessageReportsOperationsScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText('No message reports need review.')).toBeTruthy());
});

test('loads only the selected report context before allowing resolution', async () => {
  mockList.mockResolvedValue([{ ...report, messages: [] }]); mockGet.mockResolvedValue(report); mockResolve.mockResolvedValue({ ...report, status: 'resolved' });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><MessageReportsOperationsScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText('Review report')).toBeTruthy());
  expect(screen.queryByText('Reported text')).toBeNull();
  await fireEvent.press(screen.getByText('Review report'));
  await waitFor(() => expect(screen.getByText('Reported text')).toBeTruthy());
  expect(screen.queryByText(/actor_ref/i)).toBeNull();
  await fireEvent.press(screen.getByText('Resolve after review'));
  await waitFor(() => expect(screen.getByText(/RESOLVED/)).toBeTruthy());
  expect(mockResolve).toHaveBeenCalledTimes(1);
});
