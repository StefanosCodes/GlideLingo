export type DesktopUpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

export type DesktopUpdateSnapshot = {
  phase: DesktopUpdatePhase;
  required: boolean;
  currentVersion: string;
  targetVersion: string | null;
  percent: number;
};

export type DesktopUpdateBridge = {
  getSnapshot(): Promise<unknown>;
  subscribe(listener: (snapshot: unknown) => void): () => void;
  retry(): Promise<unknown>;
  restartAndInstall(): Promise<unknown>;
  openOfficialDownloadPage(): Promise<unknown>;
};

export type DesktopUpdateContextValue = {
  snapshot: DesktopUpdateSnapshot | null;
  readyPromptDismissed: boolean;
  lessonActive: boolean;
  dismissReadyPrompt(): void;
  openOfficialDownloadPage(): void;
  quit(): void;
  restartAndInstall(): void;
  retry(): void;
  setLessonActive(active: boolean): void;
};

declare global {
  interface Window {
    __glidelingoDesktopUpdates?: DesktopUpdateBridge;
  }
}
