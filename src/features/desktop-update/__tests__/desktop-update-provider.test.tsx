import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { DesktopUpdateSidebarStatus } from '../desktop-update-view.web';
import { DesktopUpdateProvider } from '../desktop-update-provider.web';
import type { DesktopUpdateBridge } from '../types';

const mockBridge = {
  getSnapshot: jest.fn<DesktopUpdateBridge['getSnapshot']>(async () => ({
    phase: 'ready',
    required: false,
    currentVersion: '1.0.0',
    targetVersion: '1.1.0',
    percent: 100,
  })),
  subscribe: jest.fn<DesktopUpdateBridge['subscribe']>(() => jest.fn()),
  retry: jest.fn<DesktopUpdateBridge['retry']>(async () => undefined),
  restartAndInstall: jest.fn<DesktopUpdateBridge['restartAndInstall']>(async () => undefined),
  openOfficialDownloadPage: jest.fn<DesktopUpdateBridge['openOfficialDownloadPage']>(async () => undefined),
};
let pushedSnapshot: ((value: unknown) => void) | null = null;
const storedValues = new Map<string, string>();

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));
jest.mock('../bridge.web', () => ({
  ...(jest.requireActual('../bridge.web') as object),
  getDesktopUpdateBridge: () => mockBridge,
}));

beforeEach(() => {
  jest.clearAllMocks();
  storedValues.clear();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => storedValues.set(key, value),
    },
  });
  pushedSnapshot = null;
  mockBridge.getSnapshot.mockImplementation(async () => ({
    phase: 'ready',
    required: false,
    currentVersion: '1.0.0',
    targetVersion: '1.1.0',
    percent: 100,
  }));
  mockBridge.subscribe.mockImplementation((listener) => {
    pushedSnapshot = listener;
    return jest.fn();
  });
});

it('persists Later while retaining the sidebar restart action', async () => {
  await render(
    <DesktopUpdateProvider>
      <DesktopUpdateSidebarStatus collapsed={false} />
    </DesktopUpdateProvider>,
  );

  await waitFor(() => expect(screen.getByTestId('desktop-update-ready')).toBeTruthy());
  fireEvent.press(screen.getByText('Later'));
  await waitFor(() => expect(screen.queryByTestId('desktop-update-ready')).toBeNull());
  fireEvent.press(screen.getByText('Restart to update'));
  expect(mockBridge.restartAndInstall).toHaveBeenCalledTimes(1);
  expect(mockBridge.subscribe).toHaveBeenCalledTimes(1);
  expect(storedValues.get('glidelingo.desktop-update.dismissed-target')).toBe('1.1.0');
});

it('restores Later after window recreation for the same target', async () => {
  storedValues.set('glidelingo.desktop-update.dismissed-target', '1.1.0');
  await render(
    <DesktopUpdateProvider>
      <DesktopUpdateSidebarStatus collapsed={false} />
    </DesktopUpdateProvider>,
  );
  await waitFor(() => expect(screen.getByText('Restart to update')).toBeTruthy());
  expect(screen.queryByTestId('desktop-update-ready')).toBeNull();
});

it('does not let a stale initial snapshot overwrite a newer required push', async () => {
  let resolveInitial!: (value: unknown) => void;
  mockBridge.getSnapshot.mockImplementationOnce(() => new Promise((resolve) => {
    resolveInitial = resolve;
  }));
  mockBridge.subscribe.mockImplementationOnce((listener) => {
    pushedSnapshot = listener;
    return jest.fn();
  });

  await render(<DesktopUpdateProvider><></></DesktopUpdateProvider>);
  await waitFor(() => expect(pushedSnapshot).not.toBeNull());
  await act(async () => {
    pushedSnapshot?.({
      phase: 'error',
      required: true,
      currentVersion: '1.0.0',
      targetVersion: null,
      percent: 0,
    });
  });
  await waitFor(() => expect(screen.getByTestId('desktop-update-required')).toBeTruthy());

  await act(async () => {
    resolveInitial({
      phase: 'checking',
      required: false,
      currentVersion: '1.0.0',
      targetVersion: null,
      percent: 0,
    });
  });

  expect(screen.getByTestId('desktop-update-required')).toBeTruthy();
  expect(screen.getByText('Retry')).toBeTruthy();
});
