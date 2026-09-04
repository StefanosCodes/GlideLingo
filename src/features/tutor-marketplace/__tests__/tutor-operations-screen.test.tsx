import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { TutorApplication, TutorApplicationQueue, TutorProfile } from '@/features/tutor-marketplace/api';
import { TutorMarketplaceClientError } from '@/features/tutor-marketplace/api';
import { TutorOperationsScreen } from '@/features/tutor-marketplace/tutor-operations-screen';

const mockList = jest.fn<(...args: unknown[]) => Promise<TutorApplicationQueue>>();
const mockStartReview = jest.fn<(...args: unknown[]) => Promise<TutorApplication>>();
const mockDecide = jest.fn<(...args: unknown[]) => Promise<TutorApplication>>();
const mockChangeStatus = jest.fn<(...args: unknown[]) => Promise<TutorApplication>>();
const mockGetProfile = jest.fn<(...args: unknown[]) => Promise<TutorProfile>>();
const mockDecideCredential = jest.fn<(...args: unknown[]) => Promise<TutorProfile>>();

jest.mock('@/features/tutor-marketplace/api', () => ({
  ...jest.requireActual<typeof import('@/features/tutor-marketplace/api')>('@/features/tutor-marketplace/api'),
  listTutorApplicationsForReview: (...args: unknown[]) => mockList(...args),
  startTutorApplicationReview: (...args: unknown[]) => mockStartReview(...args),
  decideTutorApplication: (...args: unknown[]) => mockDecide(...args),
  changeTutorStatus: (...args: unknown[]) => mockChangeStatus(...args),
  getTutorProfileForOperations: (...args: unknown[]) => mockGetProfile(...args),
  decideTutorCredential: (...args: unknown[]) => mockDecideCredential(...args),
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
const submitted: TutorApplication = {
  applicationId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9',
  status: 'submitted',
  version: 2,
  headline: 'Patient conversation tutor',
  biography: 'I help adults build confidence through practical conversation.',
  timeZone: 'America/Chicago',
  languages: ['el'],
  specialties: ['Conversation'],
  submittedAt: '2026-09-04T12:00:00Z',
  reviewedAt: null,
  decisionReason: null,
};

beforeEach(() => {
  mockList.mockReset();
  mockStartReview.mockReset();
  mockDecide.mockReset();
  mockChangeStatus.mockReset();
  mockGetProfile.mockReset();
  mockDecideCredential.mockReset();
});

afterEach(() => {
  cleanup();
  if (previousValue === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = previousValue;
});

test('feature-off operations route sends no request', async () => {
  delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
  const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><TutorOperationsScreen /></SafeAreaProvider>);
  expect(screen.getByTestId('tutor-operations-disabled')).toBeTruthy();
  expect(mockList).not.toHaveBeenCalled();
});

test('non-operator receives a protected forbidden state', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = 'true';
  mockList.mockRejectedValue(new TutorMarketplaceClientError('forbidden'));
  const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><TutorOperationsScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByText('Operator access required.')).toBeTruthy();
});

test('capable operator can claim and approve an application with a reason', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = 'true';
  const underReview: TutorApplication = { ...submitted, status: 'under_review', version: 3 };
  mockList.mockResolvedValue({ items: [submitted], offset: 0, limit: 20, hasMore: false });
  mockStartReview.mockResolvedValue(underReview);
  mockDecide.mockResolvedValue({
    ...underReview,
    status: 'approved',
    version: 4,
    reviewedAt: '2026-09-04T13:00:00Z',
    decisionReason: 'Identity and application details passed manual review.',
  });
  const credentialProfile: TutorProfile = {
    tutorId: '2382f687-0ca0-4340-8e78-21ba32912869',
    applicationId: submitted.applicationId,
    applicationStatus: 'approved',
    version: 1,
    headline: submitted.headline,
    biography: submitted.biography,
    timeZone: submitted.timeZone,
    isPublished: false,
    payoutReady: false,
    publicationBlockers: ['payout_not_ready', 'offering_missing'],
    credential: {
      credentialId: '7da10dbc-0546-4f74-a751-3cad7b5058b3',
      version: 1,
      credentialType: 'certificate',
      title: 'Adult language teaching certificate',
      issuer: 'Example Institute',
      verificationStatus: 'unverified',
      verificationReason: null,
      reviewedAt: null,
    },
    offering: null,
  };
  mockGetProfile.mockResolvedValue(credentialProfile);
  mockDecideCredential.mockResolvedValue({
    ...credentialProfile,
    credential: credentialProfile.credential && {
      ...credentialProfile.credential,
      version: 2,
      verificationStatus: 'verified',
      verificationReason: 'Identity and application details passed manual review.',
      reviewedAt: '2026-09-04T13:05:00Z',
    },
  });
  const screen = await render(<SafeAreaProvider initialMetrics={safeAreaMetrics}><TutorOperationsScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByTestId(`start-review-${submitted.applicationId}`)).toBeTruthy());
  await fireEvent.press(screen.getByTestId(`start-review-${submitted.applicationId}`));
  await waitFor(() => expect(screen.getByText('UNDER REVIEW')).toBeTruthy());
  await fireEvent.changeText(
    screen.getByLabelText(`Decision reason for ${submitted.headline}`),
    'Identity and application details passed manual review.',
  );
  await waitFor(() => expect(screen.getByText('Approve').parent?.props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(screen.getByText('Approve'));
  await waitFor(() => expect(mockDecide).toHaveBeenCalledTimes(1));
  expect(mockDecide).toHaveBeenCalledWith(
    underReview,
    'approved',
    'Identity and application details passed manual review.',
  );
  await waitFor(() => expect(screen.getByText('APPROVED')).toBeTruthy());
  await fireEvent.press(screen.getByText('Inspect tutor workspace'));
  await waitFor(() => expect(screen.getByText('Adult language teaching certificate')).toBeTruthy());
  await fireEvent.press(screen.getByText('Verify credential'));
  await waitFor(() => expect(mockDecideCredential).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText(/Example Institute · verified/)).toBeTruthy());
});
