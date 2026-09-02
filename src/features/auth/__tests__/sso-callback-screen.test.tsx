import { beforeEach, expect, jest, test } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';

import SsoCallbackRoute from '@/app/sso-callback.web';

const mockHandleRedirectCallback = jest.fn(async () => {});
const mockReload = jest.fn(async () => {});
const mockReplace = jest.fn();
let mockIsLoaded = false;

jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ isLoaded: mockIsLoaded }),
  useClerk: () => ({
    client: { signIn: { reload: mockReload } },
    handleRedirectCallback: mockHandleRedirectCallback,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));

beforeEach(() => {
  mockHandleRedirectCallback.mockClear();
  mockReload.mockClear();
  mockReplace.mockClear();
  mockIsLoaded = false;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: 'https://desktop.glidelingo.com/sso-callback?rotating_token_nonce=nonce-123' },
  });
});

test('cold callback waits for Clerk readiness before reloading and completing exactly once', async () => {
  const screen = await render(<SsoCallbackRoute />);

  expect(mockReload).not.toHaveBeenCalled();
  expect(mockHandleRedirectCallback).not.toHaveBeenCalled();

  mockIsLoaded = true;
  await screen.rerender(<SsoCallbackRoute />);

  await waitFor(() => {
    expect(mockReload).toHaveBeenCalledWith({ rotatingTokenNonce: 'nonce-123' });
    expect(mockHandleRedirectCallback).toHaveBeenCalledWith({
      signInFallbackRedirectUrl: '/',
      signUpFallbackRedirectUrl: '/',
    });
  });
  expect(mockReload).toHaveBeenCalledTimes(1);
  expect(mockHandleRedirectCallback).toHaveBeenCalledTimes(1);
});
