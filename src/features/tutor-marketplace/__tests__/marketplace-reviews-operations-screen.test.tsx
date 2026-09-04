import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { MarketplaceReview } from '@/features/tutor-marketplace/api';
import { MarketplaceReviewsOperationsScreen } from '@/features/tutor-marketplace/marketplace-reviews-operations-screen';

const mockList = jest.fn<() => Promise<MarketplaceReview[]>>();
const mockModerate = jest.fn<() => Promise<MarketplaceReview>>();
jest.mock('@/features/tutor-marketplace/api', () => ({
  listMarketplaceReviews: () => mockList(),
  moderateMarketplaceReview: () => mockModerate(),
}));
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
const review: MarketplaceReview = {
  reviewId: '335516e3-6ab7-4de4-83ae-1ac7d6b76cdb',
  bookingId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9',
  tutorId: '2382f687-0ca0-4340-8e78-21ba32912869',
  rating: 5,
  body: 'A calm and useful lesson.',
  moderationState: 'published',
  moderationReason: null,
  moderatedAt: null,
  createdAt: '2026-09-04T12:10:00Z',
};

beforeEach(() => { mockList.mockReset(); mockModerate.mockReset(); });
afterEach(cleanup);

test('requires a recorded reason and applies the returned moderation state', async () => {
  mockList.mockResolvedValue([review]);
  mockModerate.mockResolvedValue({
    ...review,
    moderationState: 'hidden',
    moderationReason: 'Contains prohibited contact details.',
    moderatedAt: '2026-09-04T12:20:00Z',
  });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}>
    <MarketplaceReviewsOperationsScreen />
  </SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText('Hide review')).toBeTruthy());
  await fireEvent.press(screen.getByText('Hide review'));
  expect(mockModerate).not.toHaveBeenCalled();
  await fireEvent.changeText(
    screen.getByLabelText(`Moderation reason for ${review.reviewId}`),
    'Contains prohibited contact details.',
  );
  await fireEvent.press(screen.getByText('Hide review'));
  await waitFor(() => expect(screen.getByText(/5 \/ 5 · hidden/)).toBeTruthy());
  expect(mockModerate).toHaveBeenCalledTimes(1);
});

test('keeps the prior state visible when a moderation request fails', async () => {
  mockList.mockResolvedValue([review]);
  mockModerate.mockRejectedValue(new Error('offline'));
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}>
    <MarketplaceReviewsOperationsScreen />
  </SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText('Hide review')).toBeTruthy());
  await fireEvent.changeText(
    screen.getByLabelText(`Moderation reason for ${review.reviewId}`),
    'Requires a documented safety review.',
  );
  await fireEvent.press(screen.getByText('Hide review'));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByText(/5 \/ 5 · published/)).toBeTruthy();
});
