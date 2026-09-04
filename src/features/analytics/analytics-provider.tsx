import { usePathname } from 'expo-router';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { AnalyticsClient } from './analytics-client';
import { AnalyticsIdentityController } from './analytics-identity';
import { analyticsSurfaceForPath, AnalyticsScreenSession } from './analytics-screen-session';
import { createRuntimeAnalyticsClient } from './runtime-client';

type AnalyticsContextValue = {
  analytics: AnalyticsClient;
  beginIdentityBoundary: () => void;
  identityEpoch: number;
  screenSession: AnalyticsScreenSession;
};

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

export function AnalyticsProvider({
  children,
  client,
}: PropsWithChildren<{ client?: AnalyticsClient }>) {
  const [analytics] = useState(() => client ?? createRuntimeAnalyticsClient());
  const [screenSession] = useState(
    () => new AnalyticsScreenSession(analytics, AppState.currentState === 'active'),
  );
  const [identityEpoch, setIdentityEpoch] = useState(0);
  const beginIdentityBoundary = useCallback(() => {
    screenSession.endIdentitySession(Date.now());
    setIdentityEpoch((current) => current + 1);
  }, [screenSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      screenSession.setForeground(state === 'active', Date.now());
    });
    return () => subscription.remove();
  }, [screenSession]);

  return (
    <AnalyticsContext.Provider
      value={{ analytics, beginIdentityBoundary, identityEpoch, screenSession }}
    >
      {children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalytics() {
  const value = useContext(AnalyticsContext);
  if (!value) throw new Error('useAnalytics must be used inside AnalyticsProvider.');
  return value.analytics;
}

export function useAnalyticsIdentity(isLoaded: boolean, opaqueUserId: string | null) {
  const value = useContext(AnalyticsContext);
  if (!value) throw new Error('useAnalyticsIdentity must be used inside AnalyticsProvider.');
  const [controller] = useState(
    () => new AnalyticsIdentityController(value.analytics, value.beginIdentityBoundary),
  );

  useLayoutEffect(() => {
    controller.synchronize(isLoaded, opaqueUserId);
  }, [controller, isLoaded, opaqueUserId]);
}

export function AnalyticsScreenTracker({ lessonActive = false }: { lessonActive?: boolean }) {
  const value = useContext(AnalyticsContext);
  if (!value) throw new Error('AnalyticsScreenTracker must be used inside AnalyticsProvider.');
  const pathname = usePathname();

  useEffect(() => {
    value.screenSession.setSurface(analyticsSurfaceForPath(pathname, lessonActive), Date.now());
  }, [lessonActive, pathname, value.identityEpoch, value.screenSession]);

  return null;
}
