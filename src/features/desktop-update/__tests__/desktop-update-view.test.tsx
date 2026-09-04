import { expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import { DesktopUpdateContext } from '../context';
import {
  DesktopUpdatePrompt,
  DesktopUpdateSidebarStatus,
} from '../desktop-update-view.web';
import type { DesktopUpdateContextValue, DesktopUpdateSnapshot } from '../types';

jest.mock('@/hooks/use-theme', () => ({
  useTheme: () =>
    jest.requireActual<typeof import('@/constants/theme')>('@/constants/theme').Colors.light,
}));

const baseSnapshot: DesktopUpdateSnapshot = {
  phase: 'idle',
  required: false,
  currentVersion: '1.0.0',
  targetVersion: null,
  percent: 0,
};

function createValue(
  snapshot: DesktopUpdateSnapshot,
  overrides: Partial<DesktopUpdateContextValue> = {},
): DesktopUpdateContextValue {
  return {
    snapshot,
    readyPromptDismissed: false,
    lessonActive: false,
    dismissReadyPrompt: jest.fn(),
    openOfficialDownloadPage: jest.fn(),
    quit: jest.fn(),
    restartAndInstall: jest.fn(),
    retry: jest.fn(),
    setLessonActive: jest.fn(),
    ...overrides,
  };
}

async function renderSidebar(value: DesktopUpdateContextValue, collapsed = false) {
  return await render(
    <DesktopUpdateContext.Provider value={value}>
      <DesktopUpdateSidebarStatus collapsed={collapsed} />
    </DesktopUpdateContext.Provider>,
  );
}

it('shows compact accessible progress in the expanded sidebar', async () => {
  const value = createValue({ ...baseSnapshot, phase: 'downloading', targetVersion: '1.1.0', percent: 42 });
  const result = await renderSidebar(value);

  expect(result.getByText('Downloading update 42%')).toBeTruthy();
  expect(result.getByLabelText('Downloading update 42%')).toBeTruthy();

});

it('keeps progress accessible when the sidebar is collapsed', async () => {
  const value = createValue({ ...baseSnapshot, phase: 'downloading', targetVersion: '1.1.0', percent: 42 });
  const result = await renderSidebar(value, true);

  expect(result.getByLabelText('Downloading update 42%')).toBeTruthy();
});

it('keeps optional failures usable with Retry', async () => {
  const retry = jest.fn();
  const result = await renderSidebar(createValue({ ...baseSnapshot, phase: 'error' }, { retry }));

  fireEvent.press(result.getByText('Retry update'));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('shows one optional ready prompt with Restart and Later', async () => {
  const restartAndInstall = jest.fn();
  const dismissReadyPrompt = jest.fn();
  const value = createValue(
    { ...baseSnapshot, phase: 'ready', targetVersion: '1.1.0', percent: 100 },
    { dismissReadyPrompt, restartAndInstall },
  );
  const result = await render(<DesktopUpdatePrompt value={value} />);

  expect(result.getByTestId('desktop-update-ready')).toBeTruthy();
  expect(result.getByText('Restart and update')).toBeTruthy();
  fireEvent.press(result.getByText('Later'));
  expect(restartAndInstall).not.toHaveBeenCalled();
  expect(dismissReadyPrompt).toHaveBeenCalledTimes(1);
});

it('leaves Restart to update in the sidebar after Later dismisses the prompt', async () => {
  const restartAndInstall = jest.fn();
  const value = createValue(
    { ...baseSnapshot, phase: 'ready', targetVersion: '1.1.0', percent: 100 },
    { readyPromptDismissed: true, restartAndInstall },
  );
  const result = await render(
    <>
      <DesktopUpdatePrompt value={value} />
      <DesktopUpdateContext.Provider value={value}>
        <DesktopUpdateSidebarStatus collapsed={false} />
      </DesktopUpdateContext.Provider>
    </>,
  );

  expect(result.queryByTestId('desktop-update-ready')).toBeNull();
  fireEvent.press(result.getByText('Restart to update'));
  expect(restartAndInstall).toHaveBeenCalledTimes(1);
});

it('blocks required updates with progress and fixed recovery actions but no Later', async () => {
  const openOfficialDownloadPage = jest.fn();
  const quit = jest.fn();
  const value = createValue(
    { ...baseSnapshot, phase: 'downloading', required: true, targetVersion: '2.0.0', percent: 25 },
    { openOfficialDownloadPage, quit },
  );
  const result = await render(<DesktopUpdatePrompt value={value} />);

  expect(result.getByTestId('desktop-update-required')).toBeTruthy();
  expect(result.getByLabelText('GlideLingo update 25 percent downloaded')).toBeTruthy();
  expect(result.queryByText('Later')).toBeNull();
  fireEvent.press(result.getByText('Download GlideLingo'));
  expect(result.getByText('Quit')).toBeTruthy();
  expect(openOfficialDownloadPage).toHaveBeenCalledTimes(1);
  expect(quit).not.toHaveBeenCalled();
  result.getByTestId('desktop-update-modal').props.onRequestClose();
  expect(quit).not.toHaveBeenCalled();
});

it('offers Retry after a required update failure', async () => {
  const retry = jest.fn();
  const failed = createValue({ ...baseSnapshot, phase: 'error', required: true }, { retry });
  const result = await render(<DesktopUpdatePrompt value={failed} />);
  fireEvent.press(result.getByText('Retry'));
  expect(retry).toHaveBeenCalledTimes(1);

});

it('defers update prompts during a lesson', async () => {
  const failed = createValue({ ...baseSnapshot, phase: 'error', required: true }, { lessonActive: true });
  const result = await render(<DesktopUpdatePrompt value={failed} />);

  expect(result.queryByTestId('desktop-update-required')).toBeNull();
  await result.rerender(<DesktopUpdatePrompt value={{ ...failed, lessonActive: false }} />);
  expect(result.getByTestId('desktop-update-required')).toBeTruthy();
});
