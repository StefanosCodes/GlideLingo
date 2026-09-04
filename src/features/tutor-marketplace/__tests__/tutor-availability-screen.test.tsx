import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { CalendarConnection, CalendarOAuthStart, ManualAvailability, TutorSlots } from '@/features/tutor-marketplace/api';
import { TutorAvailabilityScreen } from '@/features/tutor-marketplace/tutor-availability-screen';

const mockGet = jest.fn<(...args: unknown[]) => Promise<ManualAvailability>>();
const mockPreview = jest.fn<(...args: unknown[]) => Promise<TutorSlots>>();
const mockReplace = jest.fn<(...args: unknown[]) => Promise<ManualAvailability>>();
const mockCalendar = jest.fn<(...args: unknown[]) => Promise<CalendarConnection>>();
const mockCalendarStart = jest.fn<(...args: unknown[]) => Promise<CalendarOAuthStart>>();
const mockCalendarRefresh = jest.fn<(...args: unknown[]) => Promise<CalendarConnection>>();
const mockCalendarRevoke = jest.fn<(...args: unknown[]) => Promise<CalendarConnection>>();
const mockOpenUrl = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock('@/features/tutor-marketplace/api', () => ({
  ...jest.requireActual<typeof import('@/features/tutor-marketplace/api')>('@/features/tutor-marketplace/api'),
  getOwnManualAvailability: (...args: unknown[]) => mockGet(...args),
  previewOwnManualSlots: (...args: unknown[]) => mockPreview(...args),
  replaceOwnManualAvailability: (...args: unknown[]) => mockReplace(...args),
  getTutorCalendarConnection: (...args: unknown[]) => mockCalendar(...args),
  startTutorCalendarOAuth: (...args: unknown[]) => mockCalendarStart(...args),
  refreshTutorCalendar: (...args: unknown[]) => mockCalendarRefresh(...args),
  revokeTutorCalendar: (...args: unknown[]) => mockCalendarRevoke(...args),
}));
jest.mock('expo-linking', () => ({
  createURL: () => 'glidelingo:///tutor/availability',
  openURL: (...args: unknown[]) => mockOpenUrl(...args),
}));
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light }));
jest.mock('@/components/screen-header', () => ({ ScreenHeader: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const availability: ManualAvailability = {
  tutorId: '2382f687-0ca0-4340-8e78-21ba32912869', profileVersion: 2,
  timeZone: 'America/Chicago', leadTimeMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10,
  dialects: ['el-cy'], rules: [
    { weekday: 0, startLocal: '09:00', endLocal: '12:00', effectiveFrom: '2026-09-04', effectiveUntil: null },
    { weekday: 2, startLocal: '13:00', endLocal: '16:00', effectiveFrom: '2026-09-04', effectiveUntil: null },
  ], exceptions: [{ localDate: '2026-09-09', startLocal: '13:00', endLocal: '14:00', kind: 'unavailable' }],
};
const preview: TutorSlots = { tutorId: availability.tutorId, timeZone: availability.timeZone, source: 'manual', freshness: 'current', slots: [] };
const previousCalendarFlag = process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED;

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED;
  mockGet.mockReset(); mockPreview.mockReset(); mockReplace.mockReset();
  mockCalendar.mockReset(); mockCalendarStart.mockReset(); mockCalendarRefresh.mockReset();
  mockCalendarRevoke.mockReset(); mockOpenUrl.mockReset();
});
afterEach(() => {
  cleanup();
  if (previousCalendarFlag === undefined) delete process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED;
  else process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED = previousCalendarFlag;
});

test('tutor can recover from load failure and save a bounded weekly rule', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(availability);
  mockPreview.mockResolvedValue(preview);
  mockReplace.mockResolvedValue({ ...availability, profileVersion: 3, rules: [{ weekday: 0, startLocal: '09:00', endLocal: '12:00', effectiveFrom: '2026-09-04', effectiveUntil: null }] });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorAvailabilityScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.getByText('Two-week preview')).toBeTruthy());
  await act(async () => {
    fireEvent.press(screen.getByText('Save availability'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({
    expectedProfileVersion: 2,
    dialects: ['el-cy'],
    rules: availability.rules,
    exceptions: availability.exceptions,
    leadTimeMinutes: 60,
    bufferBeforeMinutes: 5,
    bufferAfterMinutes: 10,
  }));
});

test('calendar connection is explicit, minimal, and never blocks manual availability', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED = 'true';
  mockGet.mockResolvedValue(availability);
  mockPreview.mockResolvedValue(preview);
  mockCalendar.mockResolvedValue({
    status: 'disconnected', freshness: 'not_connected', lastRefreshedAt: null, safeFailureCode: null,
  });
  let resolveStart: (value: CalendarOAuthStart) => void = () => undefined;
  const startPromise = new Promise<CalendarOAuthStart>((resolve) => { resolveStart = resolve; });
  mockCalendarStart.mockReturnValue(startPromise);
  mockOpenUrl.mockResolvedValue();
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorAvailabilityScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByText('Google Calendar free/busy')).toBeTruthy());
  expect(screen.getByText(/Event names, descriptions, attendees, and locations are never retained/)).toBeTruthy();
  const connectButton = screen.getByRole('button', { name: 'Connect Google Calendar' });
  const pressConnect = connectButton.props.onClick ?? connectButton.props.onResponderRelease;
  expect(typeof pressConnect).toBe('function');
  await act(() => {
    pressConnect({ nativeEvent: {} });
    pressConnect({ nativeEvent: {} });
  });
  expect(mockCalendarStart).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveStart({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?scope=freebusy',
      expiresAt: '2026-09-04T12:10:00Z',
    });
    await startPromise;
  });
  await waitFor(() => expect(mockOpenUrl).toHaveBeenCalledTimes(1));
  expect(mockCalendarStart).toHaveBeenCalledWith('glidelingo:///tutor/availability');
});

test('calendar refresh and disconnect share a synchronous in-flight guard', async () => {
  process.env.EXPO_PUBLIC_HUMAN_TUTOR_GOOGLE_CALENDAR_ENABLED = 'true';
  const connected: CalendarConnection = {
    status: 'connected', freshness: 'current', lastRefreshedAt: '2026-09-04T12:00:00Z', safeFailureCode: null,
  };
  const disconnected: CalendarConnection = {
    status: 'disconnected', freshness: 'not_connected', lastRefreshedAt: null, safeFailureCode: null,
  };
  let resolveRefresh: (value: CalendarConnection) => void = () => undefined;
  const refreshPromise = new Promise<CalendarConnection>((resolve) => { resolveRefresh = resolve; });
  mockGet.mockResolvedValue(availability);
  mockPreview.mockResolvedValue(preview);
  mockCalendar.mockResolvedValue(connected);
  mockCalendarRefresh.mockReturnValue(refreshPromise);
  mockCalendarRevoke.mockResolvedValue(disconnected);
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorAvailabilityScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh calendar' })).toBeTruthy());
  const refreshButton = screen.getByRole('button', { name: 'Refresh calendar' });
  const disconnectButton = screen.getByRole('button', { name: 'Disconnect calendar' });
  const pressRefresh = refreshButton.props.onClick ?? refreshButton.props.onResponderRelease;
  const pressDisconnect = disconnectButton.props.onClick ?? disconnectButton.props.onResponderRelease;
  expect(typeof pressRefresh).toBe('function');
  expect(typeof pressDisconnect).toBe('function');
  await act(() => {
    pressRefresh({ nativeEvent: {} });
    pressDisconnect({ nativeEvent: {} });
  });
  expect(mockCalendarRefresh).toHaveBeenCalledTimes(1);
  expect(mockCalendarRevoke).not.toHaveBeenCalled();
  await act(async () => {
    resolveRefresh(connected);
    await refreshPromise;
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect calendar' })).toBeTruthy());
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Disconnect calendar' }));
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(mockCalendarRevoke).toHaveBeenCalledTimes(1));
});

test('manual availability save ignores a same-tick duplicate submission', async () => {
  let resolveReplace: (value: ManualAvailability) => void = () => undefined;
  let resolvePreview: (value: TutorSlots) => void = () => undefined;
  const replacePromise = new Promise<ManualAvailability>((resolve) => { resolveReplace = resolve; });
  const previewPromise = new Promise<TutorSlots>((resolve) => { resolvePreview = resolve; });
  mockGet.mockResolvedValue(availability);
  mockPreview.mockResolvedValueOnce(preview).mockReturnValueOnce(previewPromise);
  mockReplace.mockReturnValue(replacePromise);
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorAvailabilityScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByRole('button', { name: 'Save availability' })).toBeTruthy());
  const saveButton = screen.getByRole('button', { name: 'Save availability' });
  const pressSave = saveButton.props.onClick ?? saveButton.props.onResponderRelease;
  expect(typeof pressSave).toBe('function');
  await act(() => {
    pressSave({ nativeEvent: {} });
    pressSave({ nativeEvent: {} });
  });
  expect(mockReplace).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveReplace({ ...availability, profileVersion: 3 });
    await replacePromise;
    await Promise.resolve();
    resolvePreview(preview);
    await previewPromise;
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save availability' })).toBeTruthy());
});

test('tutor can set and clear an optional recurring-rule end date', async () => {
  mockGet.mockResolvedValue(availability);
  mockPreview.mockResolvedValue(preview);
  mockReplace.mockResolvedValue(availability);
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorAvailabilityScreen /></SafeAreaProvider>);

  await waitFor(() => expect(screen.getByText('Two-week preview')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Rule 1 effective until (optional YYYY-MM-DD)'), '2026-12-31');
  await waitFor(() => expect(screen.getByLabelText('Rule 1 effective until (optional YYYY-MM-DD)').props.value).toBe('2026-12-31'));
  await act(async () => {
    fireEvent.press(screen.getByText('Save availability'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({
    rules: expect.arrayContaining([expect.objectContaining({ effectiveUntil: '2026-12-31' })]),
  })));

  fireEvent.changeText(screen.getByLabelText('Rule 1 effective until (optional YYYY-MM-DD)'), '');
  await waitFor(() => expect(screen.getByLabelText('Rule 1 effective until (optional YYYY-MM-DD)').props.value).toBe(''));
  await act(async () => {
    fireEvent.press(screen.getByText('Save availability'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(mockReplace).toHaveBeenLastCalledWith(expect.objectContaining({
    rules: expect.arrayContaining([expect.objectContaining({ effectiveUntil: null })]),
  })));
});
