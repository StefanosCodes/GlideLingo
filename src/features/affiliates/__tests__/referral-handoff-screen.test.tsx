import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ReferralHandoffScreen } from '@/features/affiliates/referral-handoff-screen';

const token = 'U'.repeat(43);
const mockUseAuth = jest.fn();
const mockBindReferralAttribution = jest.fn();
const mockClassifyReferralBindFailure = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockClearReferralHandoff = jest.fn();
const mockDiscardCurrentReferralHandoff = jest.fn();

jest.mock('@clerk/expo', () => ({ useAuth: () => mockUseAuth() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }) }));
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () => jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));
jest.mock('@/features/affiliates/referral-client', () => ({
  bindReferralAttribution: (...args: unknown[]) => mockBindReferralAttribution(...args),
  classifyReferralBindFailure: (...args: unknown[]) => mockClassifyReferralBindFailure(...args),
}));
jest.mock('@/features/affiliates/referral-session', () => ({
  affiliateReferralsEnabled: () => true,
  captureCurrentReferralHandoff: () => ({ status: 'ready', handoffToken: 'U'.repeat(43) }),
  clearReferralHandoff: () => mockClearReferralHandoff(),
  discardCurrentReferralHandoff: () => mockDiscardCurrentReferralHandoff(),
}));

beforeEach(() => {
  mockUseAuth.mockReset();
  mockBindReferralAttribution.mockReset();
  mockClassifyReferralBindFailure.mockReset().mockReturnValue('unavailable');
  mockPush.mockReset();
  mockReplace.mockReset();
  mockClearReferralHandoff.mockReset();
  mockDiscardCurrentReferralHandoff.mockReset();
});

test('keeps the handoff in session while prompting a signed-out visitor to authenticate', async () => {
  mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false, userId: null });
  const screen = await render(<ReferralHandoffScreen />);

  expect(screen.getByText('Sign in to check your referral.')).toBeTruthy();
  expect(screen.getByTestId('referral-primary-action').props.accessibilityRole).toBe('button');
  expect(mockBindReferralAttribution).not.toHaveBeenCalled();
  expect(JSON.stringify(screen.toJSON())).not.toContain(token);
});

test('shows an accessible loading state while a signed-in handoff is pending', async () => {
  mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true, userId: 'user_123' });
  mockBindReferralAttribution.mockReturnValue(new Promise(() => {}));
  const screen = await render(<ReferralHandoffScreen />);

  expect(screen.getByLabelText('Preparing referral handoff')).toBeTruthy();
});

test('shows generic expiry/replay recovery for a signed-in account', async () => {
  mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true, userId: 'user_123' });
  mockBindReferralAttribution.mockImplementation(async () => ({ status: 'already_consumed' }));
  const screen = await render(<ReferralHandoffScreen />);

  await waitFor(() => expect(screen.getByText('This referral could not be applied.')).toBeTruthy());
  expect(screen.getByText(/expired, already been used, or no longer be eligible/)).toBeTruthy();
  expect(mockClearReferralHandoff).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(screen.toJSON())).not.toContain(token);
});

test('abandons an unavailable handoff before continuing through the ordinary flow', async () => {
  mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true, userId: 'user_123' });
  mockBindReferralAttribution.mockImplementation(async () => { throw new Error('unavailable'); });
  const screen = await render(<ReferralHandoffScreen />);

  await waitFor(() => expect(screen.getByText('This referral could not be applied.')).toBeTruthy());
  fireEvent.press(screen.getByTestId('referral-primary-action'));

  expect(mockClearReferralHandoff).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith('/subscription');
});

test('abandons a retryable handoff only when the visitor chooses the fallback action', async () => {
  mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true, userId: 'user_123' });
  mockClassifyReferralBindFailure.mockReturnValue('retryable');
  mockBindReferralAttribution.mockImplementation(async () => { throw new Error('network'); });
  const screen = await render(<ReferralHandoffScreen />);

  await waitFor(() => expect(screen.getByText('Continue without referral')).toBeTruthy());
  expect(mockClearReferralHandoff).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Continue without referral'));

  expect(mockClearReferralHandoff).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith('/subscription');
});
