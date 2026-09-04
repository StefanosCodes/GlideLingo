import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ManualAvailability, TutorSlots } from '@/features/tutor-marketplace/api';
import { TutorAvailabilityScreen } from '@/features/tutor-marketplace/tutor-availability-screen';

const mockGet = jest.fn<(...args: unknown[]) => Promise<ManualAvailability>>();
const mockPreview = jest.fn<(...args: unknown[]) => Promise<TutorSlots>>();
const mockReplace = jest.fn<(...args: unknown[]) => Promise<ManualAvailability>>();
jest.mock('@/features/tutor-marketplace/api', () => ({
  ...jest.requireActual<typeof import('@/features/tutor-marketplace/api')>('@/features/tutor-marketplace/api'),
  getOwnManualAvailability: (...args: unknown[]) => mockGet(...args),
  previewOwnManualSlots: (...args: unknown[]) => mockPreview(...args),
  replaceOwnManualAvailability: (...args: unknown[]) => mockReplace(...args),
}));
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light }));
jest.mock('@/components/screen-header', () => ({ ScreenHeader: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const availability: ManualAvailability = {
  tutorId: '2382f687-0ca0-4340-8e78-21ba32912869', profileVersion: 2,
  timeZone: 'America/Chicago', leadTimeMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10,
  dialects: ['el-cy'], rules: [], exceptions: [],
};
const preview: TutorSlots = { tutorId: availability.tutorId, timeZone: availability.timeZone, source: 'manual', freshness: 'current', slots: [] };

beforeEach(() => { mockGet.mockReset(); mockPreview.mockReset(); mockReplace.mockReset(); });
afterEach(cleanup);

test('tutor can recover from load failure and save a bounded weekly rule', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(availability);
  mockPreview.mockResolvedValue(preview);
  mockReplace.mockResolvedValue({ ...availability, profileVersion: 3, rules: [{ weekday: 0, startLocal: '09:00', endLocal: '12:00', effectiveFrom: '2026-09-04', effectiveUntil: null }] });
  const screen = await render(<SafeAreaProvider initialMetrics={metrics}><TutorAvailabilityScreen /></SafeAreaProvider>);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.getByText('Two-week preview')).toBeTruthy());
  await fireEvent.press(screen.getByText('Save weekly hours'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
  expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ expectedProfileVersion: 2, dialects: ['el-cy'] }));
});
