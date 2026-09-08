import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { TutorProfile } from '@/features/tutor-marketplace/api';
import { TutorMarketplaceClientError } from '@/features/tutor-marketplace/api';
import { TutorProfileScreen } from '@/features/tutor-marketplace/tutor-profile-screen';

const mockGetProfile = jest.fn<(...args: unknown[]) => Promise<TutorProfile>>();
const mockUpdateProfile = jest.fn<(...args: unknown[]) => Promise<TutorProfile>>();
const mockSaveCredential = jest.fn<(...args: unknown[]) => Promise<TutorProfile>>();
const mockSaveOffering = jest.fn<(...args: unknown[]) => Promise<TutorProfile>>();
const mockSetPublication = jest.fn<(...args: unknown[]) => Promise<TutorProfile>>();

jest.mock('@/features/tutor-marketplace/api', () => ({
  ...jest.requireActual<typeof import('@/features/tutor-marketplace/api')>('@/features/tutor-marketplace/api'),
  getOwnTutorProfile: (...args: unknown[]) => mockGetProfile(...args),
  updateTutorProfileDraft: (...args: unknown[]) => mockUpdateProfile(...args),
  saveTutorCredential: (...args: unknown[]) => mockSaveCredential(...args),
  saveTutorOffering: (...args: unknown[]) => mockSaveOffering(...args),
  setTutorPublication: (...args: unknown[]) => mockSetPublication(...args),
}));
jest.mock('@/features/tutor-marketplace/client-operation-id', () => ({
  createMarketplaceClientId: () => '535516e3-6ab7-4de4-83ae-1ac7d6b76cdb',
}));
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () => jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));
jest.mock('@/components/screen-header', () => ({ ScreenHeader: () => null }));

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const previousValue = process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
const profile: TutorProfile = {
  tutorId: '2382f687-0ca0-4340-8e78-21ba32912869',
  applicationId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9',
  applicationStatus: 'approved',
  version: 2,
  headline: 'Patient conversation tutor',
  biography: 'I help adults build confidence through practical conversation.',
  timeZone: 'America/Chicago',
  isPublished: false,
  payoutReady: false,
  publicationBlockers: ['payout_not_ready', 'offering_missing'],
  credential: null,
  offering: null,
};

beforeEach(() => {
  mockGetProfile.mockReset();
  mockUpdateProfile.mockReset();
  mockSaveCredential.mockReset();
  mockSaveOffering.mockReset();
  mockSetPublication.mockReset();
});

afterEach(() => {
  cleanup();
  if (previousValue === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = previousValue;
});

test('feature-off profile is inert', async () => {
  delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
  const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><TutorProfileScreen /></SafeAreaProvider>);
  expect(screen.getByTestId('tutor-profile-disabled')).toBeTruthy();
  expect(mockGetProfile).not.toHaveBeenCalled();
});

test('approved tutor can prepare drafts while publication remains disabled by payout readiness', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = 'true';
  mockGetProfile.mockResolvedValue(profile);
  mockUpdateProfile.mockResolvedValue({ ...profile, version: 3, headline: 'Updated tutor headline' });

  const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><TutorProfileScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText('Private profile draft')).toBeTruthy());
  expect(screen.getByText(/Payout onboarding is not complete/)).toBeTruthy();
  expect(screen.getByTestId('set-tutor-publication').props.accessibilityState.disabled).toBe(true);

  await fireEvent.changeText(screen.getByLabelText('Tutor headline'), 'Updated tutor headline');
  await fireEvent.press(screen.getByTestId('save-tutor-profile'));
  await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
  expect(mockUpdateProfile).toHaveBeenCalledWith(
    expect.objectContaining({ headline: 'Updated tutor headline' }),
    2,
  );
  expect(mockSetPublication).not.toHaveBeenCalled();
});

test('stale profile save exposes a recoverable reload action', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = 'true';
  mockGetProfile.mockResolvedValue(profile);
  mockUpdateProfile.mockRejectedValue(new TutorMarketplaceClientError('conflict'));

  const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><TutorProfileScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByTestId('save-tutor-profile')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('save-tutor-profile'));
  await waitFor(() => expect(screen.getByText('Reload workspace')).toBeTruthy());
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByText(/changed in another session/)).toBeTruthy();
});

test('suspended tutor sees a private read-only workspace', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = 'true';
  mockGetProfile.mockResolvedValue({
    ...profile,
    applicationStatus: 'suspended',
    publicationBlockers: ['application_not_approved', 'payout_not_ready', 'offering_missing'],
  });

  const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><TutorProfileScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByText(/workspace is suspended/)).toBeTruthy());

  expect(screen.getByLabelText('Tutor headline').props.editable).toBe(false);
  expect(screen.getByTestId('save-tutor-profile').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('save-tutor-credential').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('add-tutor-offering').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('set-tutor-publication').props.accessibilityState.disabled).toBe(true);
});

test('creates a second offering with a stable id and edits the selected offering', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = 'true';
  const first = {
    offeringId: '335516e3-6ab7-4de4-83ae-1ac7d6b76cdb', version: 3,
    title: 'Conversation practice', durationMinutes: 25 as const, amountMinor: 2500,
    currency: 'USD' as const, state: 'draft' as const,
    commissionPolicy: { policyId: 'commission-v1', policyType: 'commission' as const, version: 1, commissionBasisPoints: 2000, cancellationCutoffHours: null, disputeWindowHours: null, effectiveAt: '2026-09-04T00:00:00Z' },
    cancellationPolicy: { policyId: 'cancellation-v1', policyType: 'cancellation' as const, version: 1, commissionBasisPoints: null, cancellationCutoffHours: 12, disputeWindowHours: 24, effectiveAt: '2026-09-04T00:00:00Z' },
  };
  const second = { ...first, offeringId: '435516e3-6ab7-4de4-83ae-1ac7d6b76cdb', version: 5, title: 'Exam speaking' };
  const multiple: TutorProfile = {
    ...profile, offering: first, offerings: [first, second],
    publicationBlockers: ['payout_not_ready'],
  };
  mockGetProfile.mockResolvedValue(multiple);
  mockSaveOffering.mockResolvedValue(multiple);

  const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><TutorProfileScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByTestId(`save-tutor-offering-${second.offeringId}`)).toBeTruthy());
  await fireEvent.press(screen.getByTestId(`save-tutor-offering-${second.offeringId}`));
  await waitFor(() => expect(mockSaveOffering).toHaveBeenCalledWith(
    expect.objectContaining({ title: second.title }), 5, second.offeringId,
  ));
  await waitFor(() => expect(
    screen.getByTestId('add-tutor-offering').props.accessibilityState.disabled,
  ).toBe(false));
  await fireEvent.press(screen.getByTestId('add-tutor-offering'));
  await waitFor(() => expect(screen.getByTestId('save-tutor-offering-new')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('save-tutor-offering-new'));
  await waitFor(() => expect(mockSaveOffering).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: '25-minute conversation lesson' }),
    0,
    '535516e3-6ab7-4de4-83ae-1ac7d6b76cdb',
  ));
});
