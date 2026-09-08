import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { MarketplaceLearningContext } from '@/features/tutor-marketplace/api';
import { MarketplaceLearningContextScreen } from '@/features/tutor-marketplace/marketplace-learning-context-screen';

const mockGet = jest.fn<() => Promise<MarketplaceLearningContext>>();
const mockSave = jest.fn<() => Promise<MarketplaceLearningContext>>();
const mockRevoke = jest.fn<() => Promise<MarketplaceLearningContext>>();
const mockFollowUp = jest.fn<() => Promise<MarketplaceLearningContext>>();

jest.mock('@/features/tutor-marketplace/api', () => ({
  getMarketplaceLearningContext: () => mockGet(),
  saveMarketplaceLearningContext: () => mockSave(),
  revokeMarketplaceLearningContext: () => mockRevoke(),
  saveMarketplaceTutorFollowUp: () => mockFollowUp(),
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
const base: MarketplaceLearningContext = {
  bookingId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9', role: 'learner',
  consentState: 'not_shared', accessExpiresAt: null, brief: null, followUp: null,
};
const shared: MarketplaceLearningContext = {
  ...base, consentState: 'granted', accessExpiresAt: '2026-09-12T12:25:00Z',
  brief: {
    selectedGoal: 'Practice confidently with my tutor', languageCode: 'el',
    courseId: null, courseTitle: null, capabilities: [], reviewFocus: [],
  },
};

beforeEach(() => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_LEARNING_BRIDGE_ENABLED = 'true';
  mockGet.mockReset(); mockSave.mockReset(); mockRevoke.mockReset(); mockFollowUp.mockReset();
});
afterEach(() => {
  cleanup();
  delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_LEARNING_BRIDGE_ENABLED;
});

test('learner explicitly shares a no-course brief and can revoke access', async () => {
  mockGet.mockResolvedValue(base);
  mockSave.mockResolvedValue(shared);
  mockRevoke.mockResolvedValue({ ...base, consentState: 'revoked' });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><MarketplaceLearningContextScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByText('Consent: not shared')).toBeTruthy());
  await fireEvent.press(screen.getByText('Share with assigned tutor'));
  await waitFor(() => expect(screen.getByText('Course: No GlideLingo course selected')).toBeTruthy());
  await waitFor(() => expect(screen.getByText(/booking-only learning brief is now shared/i)).toBeTruthy());
  await fireEvent.press(screen.getByText('Revoke future tutor access'));
  await waitFor(() => expect(screen.getByText('Consent: revoked')).toBeTruthy());
  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(mockRevoke).toHaveBeenCalledTimes(1);
});

test('assigned tutor can write free-text follow-up without a course', async () => {
  const tutor = { ...shared, role: 'tutor' as const };
  mockGet.mockResolvedValue(tutor);
  mockFollowUp.mockResolvedValue({
    ...tutor,
    followUp: {
      followUpId: '335516e3-6ab7-4de4-83ae-1ac7d6b76cdb', version: 1,
      summary: 'The learner practiced a clear introduction.',
      recommendations: [{ kind: 'free_text', contentReference: null, recommendation: 'Practice aloud twice.' }],
      createdAt: '2026-09-05T12:30:00Z', updatedAt: '2026-09-05T12:30:00Z',
    },
  });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><MarketplaceLearningContextScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByText('Private learner follow-up')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('Lesson summary'), 'The learner practiced a clear introduction.');
  await fireEvent.changeText(screen.getByLabelText('Recommendation'), 'Practice aloud twice.');
  await fireEvent.press(screen.getByText('Save learner follow-up'));
  await waitFor(() => expect(mockFollowUp).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText('Practice aloud twice.')).toBeTruthy());
});
