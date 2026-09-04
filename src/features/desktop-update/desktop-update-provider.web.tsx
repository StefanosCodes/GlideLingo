import type { PropsWithChildren } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getDesktopUpdateBridge, parseDesktopUpdateSnapshot } from './bridge.web';
import { DesktopUpdateContext } from './context';
import { DesktopUpdatePrompt } from './desktop-update-view.web';
import type { DesktopUpdateContextValue, DesktopUpdateSnapshot } from './types';

const DISMISSED_TARGET_STORAGE_KEY = 'glidelingo.desktop-update.dismissed-target';

function readDismissedTarget(targetVersion: string | null) {
  if (!targetVersion) return null;
  try {
    return window.localStorage?.getItem(DISMISSED_TARGET_STORAGE_KEY) === targetVersion
      ? targetVersion
      : null;
  } catch {
    return null;
  }
}

function persistDismissedTarget(targetVersion: string | null) {
  if (!targetVersion) return;
  try {
    window.localStorage?.setItem(DISMISSED_TARGET_STORAGE_KEY, targetVersion);
  } catch {
    // Storage denial must not make the update controls unusable.
  }
}

export function DesktopUpdateProvider({ children }: PropsWithChildren) {
  const bridge = useMemo(() => getDesktopUpdateBridge(), []);
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot | null>(null);
  const [dismissedTarget, setDismissedTarget] = useState<string | null>(null);
  const [lessonActive, setLessonActive] = useState(false);
  const targetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    let pushedSnapshotAccepted = false;
    const receive = (value: unknown) => {
      const parsed = parseDesktopUpdateSnapshot(value);
      if (mounted && parsed) {
        if (targetRef.current !== parsed.targetVersion) {
          targetRef.current = parsed.targetVersion;
          setDismissedTarget(readDismissedTarget(parsed.targetVersion));
        }
        setSnapshot(parsed);
        return true;
      }
      return false;
    };
    const unsubscribe = bridge.subscribe((value) => {
      if (receive(value)) pushedSnapshotAccepted = true;
    });
    void bridge.getSnapshot().then((value) => {
      if (!pushedSnapshotAccepted) receive(value);
    }).catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge]);

  const run = useCallback((operation: (() => Promise<unknown>) | undefined) => {
    if (!operation) return;
    void operation().catch(() => undefined);
  }, []);

  const value = useMemo<DesktopUpdateContextValue>(() => ({
    snapshot,
    readyPromptDismissed: Boolean(snapshot?.targetVersion && dismissedTarget === snapshot.targetVersion),
    lessonActive,
    dismissReadyPrompt: () => {
      const targetVersion = snapshot?.targetVersion ?? null;
      persistDismissedTarget(targetVersion);
      setDismissedTarget(targetVersion);
    },
    openOfficialDownloadPage: () => run(bridge?.openOfficialDownloadPage.bind(bridge)),
    quit: () => window.close(),
    restartAndInstall: () => run(bridge?.restartAndInstall.bind(bridge)),
    retry: () => run(bridge?.retry.bind(bridge)),
    setLessonActive,
  }), [bridge, dismissedTarget, lessonActive, run, snapshot]);

  return (
    <DesktopUpdateContext.Provider value={value}>
      {children}
      <DesktopUpdatePrompt value={value} />
    </DesktopUpdateContext.Provider>
  );
}
