import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TutorApplicationScreen } from '@/features/tutor-marketplace/tutor-application-screen';
import {
  type TutorApplication,
  TutorMarketplaceClientError,
} from '@/features/tutor-marketplace/api';

const mockGetOwnTutorApplication = jest.fn<(...args: unknown[]) => Promise<TutorApplication>>();
const mockCreateTutorApplication = jest.fn<(...args: unknown[]) => Promise<TutorApplication>>();
const mockSubmitTutorApplication = jest.fn<(...args: unknown[]) => Promise<TutorApplication>>();

jest.mock('@/features/tutor-marketplace/api', () => ({
  ...jest.requireActual<typeof import('@/features/tutor-marketplace/api')>(
    '@/features/tutor-marketplace/api',
  ),
  getOwnTutorApplication: (...args: unknown[]) => mockGetOwnTutorApplication(...args),
  createTutorApplication: (...args: unknown[]) => mockCreateTutorApplication(...args),
  submitTutorApplication: (...args: unknown[]) => mockSubmitTutorApplication(...args),
}));

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));
jest.mock('@/components/screen-header', () => ({ ScreenHeader: () => null }));

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const previousValue = process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;

beforeEach(() => {
  mockGetOwnTutorApplication.mockReset();
  mockCreateTutorApplication.mockReset();
  mockSubmitTutorApplication.mockReset();
});

afterEach(() => {
  cleanup();
  if (previousValue === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = previousValue;
});

test('disabled marketplace renders a safe holding state without calling the API', async () => {
  delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED;

  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <TutorApplicationScreen />
    </SafeAreaProvider>,
  );

  expect(screen.getByTestId('tutor-marketplace-disabled')).toBeTruthy();
  expect(screen.getByText('Tutor applications are not open yet.')).toBeTruthy();
  expect(mockGetOwnTutorApplication).not.toHaveBeenCalled();
});

test('invited tutor can create and submit a complete application', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = 'true';
  const draft: TutorApplication = {
    applicationId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9',
    status: 'draft',
    version: 1,
    headline: 'Patient conversation tutor',
    biography: 'I help adults build confidence through practical conversation.',
    timeZone: 'America/Chicago',
    languages: ['el', 'en'],
    specialties: ['Conversation'],
    submittedAt: null,
    reviewedAt: null,
    decisionReason: null,
  };
  mockGetOwnTutorApplication.mockRejectedValue(new TutorMarketplaceClientError('not-found'));
  mockCreateTutorApplication.mockResolvedValue(draft);
  mockSubmitTutorApplication.mockResolvedValue({
    ...draft,
    status: 'submitted',
    version: 2,
    submittedAt: '2026-09-04T12:00:00Z',
  });

  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <TutorApplicationScreen />
    </SafeAreaProvider>,
  );

  await waitFor(() => expect(screen.getByText('Tutor application')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('Profile headline'), draft.headline);
  await fireEvent.changeText(screen.getByLabelText('About your teaching'), draft.biography);
  await fireEvent.changeText(screen.getByLabelText('Time zone'), draft.timeZone);
  await fireEvent.changeText(screen.getByLabelText('Languages you teach'), 'el, en');
  await fireEvent.changeText(screen.getByLabelText('Specialties'), 'Conversation');
  await waitFor(() =>
    expect(screen.getByTestId('save-tutor-application').props.accessibilityState.disabled).toBe(
      false,
    ),
  );
  await fireEvent.press(screen.getByTestId('save-tutor-application'));

  await waitFor(() => expect(mockCreateTutorApplication).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText('DRAFT SAVED')).toBeTruthy());
  expect(screen.getByText(draft.biography)).toBeTruthy();
  expect(screen.getByText(draft.timeZone)).toBeTruthy();
  expect(mockCreateTutorApplication).toHaveBeenCalledWith(
    {
      headline: draft.headline,
      biography: draft.biography,
      timeZone: draft.timeZone,
      languages: ['el', 'en'],
      specialties: ['Conversation'],
    },
  );

  await fireEvent.press(screen.getByTestId('submit-tutor-application'));
  await waitFor(() => expect(screen.getByText('SUBMITTED')).toBeTruthy());
  expect(mockSubmitTutorApplication).toHaveBeenCalledWith(1);
});

test('a stale submit offers a reload path and converges on server state', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_MARKETPLACE_ENABLED = 'true';
  const draft: TutorApplication = {
    applicationId: 'f8d97d12-3e8a-49c6-bb22-55c49956c8b9',
    status: 'draft',
    version: 1,
    headline: 'Patient conversation tutor',
    biography: 'I help adults build confidence through practical conversation.',
    timeZone: 'America/Chicago',
    languages: ['el'],
    specialties: ['Conversation'],
    submittedAt: null,
    reviewedAt: null,
    decisionReason: null,
  };
  const submitted = {
    ...draft,
    status: 'submitted' as const,
    version: 2,
    submittedAt: '2026-09-04T12:00:00Z',
  };
  mockGetOwnTutorApplication.mockResolvedValueOnce(draft).mockResolvedValueOnce(submitted);
  mockSubmitTutorApplication.mockRejectedValue(new TutorMarketplaceClientError('conflict'));

  const screen = await render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <TutorApplicationScreen />
    </SafeAreaProvider>,
  );

  await waitFor(() => expect(screen.getByText('DRAFT SAVED')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('submit-tutor-application'));
  await waitFor(() => expect(screen.getByText('Reload application')).toBeTruthy());
  await fireEvent.press(screen.getByText('Reload application'));
  await waitFor(() => expect(screen.getByText('SUBMITTED')).toBeTruthy());
  expect(mockGetOwnTutorApplication).toHaveBeenCalledTimes(2);
});
