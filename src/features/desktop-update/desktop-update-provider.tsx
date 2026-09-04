import type { PropsWithChildren } from 'react';

import { DesktopUpdateContext } from './context';
import type { DesktopUpdateContextValue } from './types';

const nativeValue: DesktopUpdateContextValue = {
  snapshot: null,
  readyPromptDismissed: false,
  lessonActive: false,
  dismissReadyPrompt() {},
  openOfficialDownloadPage() {},
  quit() {},
  restartAndInstall() {},
  retry() {},
  setLessonActive() {},
};

export function DesktopUpdateProvider({ children }: PropsWithChildren) {
  return (
    <DesktopUpdateContext.Provider value={nativeValue}>
      {children}
    </DesktopUpdateContext.Provider>
  );
}
