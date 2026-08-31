import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';

import type { LessonEvidenceRecord } from '@/features/learning-progress/evidence-policy';
import { nextLearningRefreshAt } from '@/features/learning-progress/learning-clock-policy';

const TIMEZONE_HEARTBEAT_MS = 60_000;

export function useLearningClock(records: LessonEvidenceRecord[]) {
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(() => setNow(Date.now()), []);
  const nextBoundary = useMemo(() => nextLearningRefreshAt(records, now), [now, records]);

  useEffect(() => {
    const delay = Math.max(0, Math.min(nextBoundary - Date.now(), TIMEZONE_HEARTBEAT_MS));
    const timer = setTimeout(refresh, delay);
    return () => clearTimeout(timer);
  }, [nextBoundary, refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [refresh]);

  return now;
}
