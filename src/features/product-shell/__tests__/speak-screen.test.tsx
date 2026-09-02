import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import SpeakScreen from '@/app/(app)/speak';

const mockPush = jest.fn();
const mockRefresh = jest.fn(async () => undefined);
let mockBillingState = {
  errorMessage: null as string | null,
  isPro: false,
  refresh: mockRefresh,
  status: 'free' as 'loading' | 'free' | 'pro' | 'error',
};

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/components/screen-frame', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ScreenFrame: ({ children }: import('react').PropsWithChildren) => React.createElement(View, null, children),
  };
});
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));
jest.mock('@/providers/billing-provider', () => ({ useBilling: () => mockBillingState }));
jest.mock('@/providers/learning-provider', () => ({
  useLearning: () => ({
    enrolledCourse: { id: 'el-from-zero', title: 'Greek Foundations' },
    language: { name: 'Greek' },
  }),
}));

beforeEach(() => {
  mockPush.mockClear();
  mockRefresh.mockClear();
  mockBillingState = { errorMessage: null, isPro: false, refresh: mockRefresh, status: 'free' };
});

test('does not offer an upgrade for unavailable speaking practice', async () => {
  const screen = await render(<SpeakScreen />);

  expect(screen.getByText('Upgrading today will not enable speaking here. GlideLingo will check verified access when the feature is ready.')).toBeTruthy();
  expect(screen.queryByText('View Pro access')).toBeNull();
  fireEvent.press(screen.getByText('Continue course'));
  expect(mockPush).toHaveBeenCalledWith('/course');
});

test('uses a stable busy region while verified access loads', async () => {
  mockBillingState = { errorMessage: null, isPro: false, refresh: mockRefresh, status: 'loading' };
  const screen = await render(<SpeakScreen />);

  expect(screen.getByLabelText('Loading speaking access').props.accessibilityState).toMatchObject({ busy: true });
  expect(screen.queryByText('Continue course')).toBeNull();
});

test('keeps an entitlement failure recoverable in place', async () => {
  mockBillingState = {
    errorMessage: 'Verified access is temporarily unavailable.',
    isPro: false,
    refresh: mockRefresh,
    status: 'error',
  };
  const screen = await render(<SpeakScreen />);

  expect(screen.getByRole('alert').props.children).toBeTruthy();
  fireEvent.press(screen.getByText('Retry'));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test('does not simulate voice readiness for a Pro learner', async () => {
  mockBillingState = { errorMessage: null, isPro: true, refresh: mockRefresh, status: 'pro' };
  const screen = await render(<SpeakScreen />);

  expect(screen.getByText('No speaking scenarios are available in this build.')).toBeTruthy();
  expect(screen.queryByText('Start conversation')).toBeNull();
});
