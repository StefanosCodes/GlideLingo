import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

import {
  createOnboardingState,
  onboardingStorageKey,
  parseOnboardingState,
  type OnboardingAccess,
  type OnboardingGoal,
  type OnboardingRhythm,
  type OnboardingState,
  type OnboardingStep,
} from '@/features/onboarding/onboarding-state';

type OnboardingContextValue = {
  state: OnboardingState;
  ready: boolean;
  storageError: string | null;
  setStep: (step: OnboardingStep) => void;
  selectGoal: (goal: OnboardingGoal) => void;
  selectRhythm: (rhythm: OnboardingRhythm) => void;
  completeSample: () => void;
  completeOnboarding: (access: OnboardingAccess) => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

async function readStoredState(key: string) {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function writeStoredState(key: string, state: OnboardingState) {
  const value = JSON.stringify(state);
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export function OnboardingProvider({
  children,
  storageScope,
}: PropsWithChildren<{ storageScope: string }>) {
  const storageKey = onboardingStorageKey(storageScope);
  const [state, setState] = useState<OnboardingState>(() => createOnboardingState());
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const writeQueue = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;

    void readStoredState(storageKey)
      .then((raw) => {
        if (!active) return;
        setState(parseOnboardingState(raw));
      })
      .catch(() => {
        if (!active) return;
        setState(createOnboardingState());
        setStorageError('Your onboarding progress could not be restored. You can still continue.');
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, [storageKey]);

  const persist = useCallback(
    (next: OnboardingState) => {
      writeQueue.current = writeQueue.current
        .then(() => writeStoredState(storageKey, next))
        .then(() => setStorageError(null))
        .catch(() => {
          setStorageError('Your choices are saved for this session, but may not survive an app restart.');
        });
      return writeQueue.current;
    },
    [storageKey],
  );

  const update = useCallback(
    (transform: (current: OnboardingState) => OnboardingState) => {
      setState((current) => {
        const next = transform(current);
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  const setStep = useCallback((step: OnboardingStep) => update((current) => ({ ...current, step })), [update]);
  const selectGoal = useCallback(
    (goal: OnboardingGoal) => update((current) => ({ ...current, goal })),
    [update],
  );
  const selectRhythm = useCallback(
    (rhythm: OnboardingRhythm) => update((current) => ({ ...current, rhythm })),
    [update],
  );
  const completeSample = useCallback(
    () => update((current) => ({ ...current, sampleCompleted: true, step: 'result' })),
    [update],
  );
  const completeOnboarding = useCallback(
    async (access: OnboardingAccess) => {
      const next: OnboardingState = { ...state, completed: true, step: 'paywall', access };
      setState(next);
      await persist(next);
    },
    [persist, state],
  );

  const value = useMemo<OnboardingContextValue>(
    () => ({
      state,
      ready,
      storageError,
      setStep,
      selectGoal,
      selectRhythm,
      completeSample,
      completeOnboarding,
    }),
    [completeOnboarding, completeSample, ready, selectGoal, selectRhythm, setStep, state, storageError],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) throw new Error('useOnboarding must be used within OnboardingProvider');
  return context;
}
