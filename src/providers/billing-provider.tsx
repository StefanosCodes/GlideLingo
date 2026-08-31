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

import {
  type BillingMode,
  type BillingPackage,
  type BillingSnapshot,
  type BillingStatus,
} from '@/features/billing/billing-types';
import { selectBillingMode } from '@/features/billing/billing-config';
import {
  disconnectRevenueCatIdentity,
  hasRevenueCatApiKey,
  isPurchaseCancellation,
  loadRevenueCatSnapshot,
  purchaseRevenueCatPackage,
  restoreRevenueCatPurchases,
  revenueCatCustomerHasPro,
  subscribeToRevenueCat,
} from '@/features/billing/revenuecat-client';

const MOCK_PACKAGE: BillingPackage = {
  identifier: 'mock_pro',
  title: 'GlideLingo Pro preview',
  description: 'Preview Pro locally with the explicit development-only mock setting.',
  priceLabel: 'Mock purchase',
};

type BillingState = {
  ownerUserId: string | null;
  mode: BillingMode;
  status: BillingStatus;
  packages: BillingPackage[];
  errorMessage: string | null;
};

type BillingContextValue = Omit<BillingState, 'ownerUserId'> & {
  isPro: boolean;
  purchase: (identifier: string) => Promise<void>;
  refresh: () => Promise<void>;
  restore: () => Promise<void>;
  resetMockAccess: () => void;
};

type BillingProviderProps = PropsWithChildren<{
  /** Stable authenticated Clerk user ID. Never pass an email address or phone number. */
  userId: string | null;
}>;

const BillingContext = createContext<BillingContextValue | null>(null);

function modeForEnvironment(): BillingMode {
  return selectBillingMode({
    development: __DEV__,
    hasApiKey: hasRevenueCatApiKey(),
    mockBillingEnabled: process.env.EXPO_PUBLIC_ENABLE_MOCK_BILLING === 'true',
  });
}

function emptyState(userId: string | null, mode = modeForEnvironment()): BillingState {
  const unavailable = userId !== null && mode === 'unavailable';
  return {
    ownerUserId: userId,
    mode,
    status: unavailable ? 'error' : userId ? 'loading' : 'signed-out',
    packages: [],
    errorMessage: unavailable
      ? 'Subscriptions are unavailable because this build has no RevenueCat key.'
      : null,
  };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Subscription access could not be updated. Please try again.';
}

export function BillingProvider({ children, userId }: BillingProviderProps) {
  const [state, setState] = useState<BillingState>(() => emptyState(userId));
  const userIdRef = useRef(userId);
  const identityGenerationRef = useRef(0);
  userIdRef.current = userId;

  const ownsCurrentIdentity = useCallback(
    (ownerUserId: string, generation: number) =>
      userIdRef.current === ownerUserId && identityGenerationRef.current === generation,
    [],
  );

  useEffect(() => {
    const generation = ++identityGenerationRef.current;
    const ownerUserId = userId;
    const mode = modeForEnvironment();
    let active = true;
    let unsubscribe: (() => boolean) | undefined;

    setState(emptyState(ownerUserId, mode));

    if (!ownerUserId) {
      void disconnectRevenueCatIdentity().catch(() => {
        // No signed-in UI remains to receive this recoverable cleanup failure.
      });
      return;
    }

    if (mode === 'mock') {
      setState({
        ownerUserId,
        mode,
        status: 'free',
        packages: [MOCK_PACKAGE],
        errorMessage: null,
      });
      return;
    }

    if (mode === 'unavailable') return;

    void (async () => {
      try {
        const snapshot = await loadRevenueCatSnapshot(ownerUserId);
        if (!active || !ownsCurrentIdentity(ownerUserId, generation)) return;
        setState({
          ownerUserId,
          mode: 'revenuecat',
          status: snapshot.isPro ? 'pro' : 'free',
          packages: snapshot.packages,
          errorMessage: null,
        });

        unsubscribe = subscribeToRevenueCat((customerInfo) => {
          if (!active || !ownsCurrentIdentity(ownerUserId, generation)) return;
          setState((current) => ({
            ...current,
            ownerUserId,
            status: revenueCatCustomerHasPro(customerInfo) ? 'pro' : 'free',
            errorMessage: null,
          }));
        });

      } catch (error) {
        if (!active || !ownsCurrentIdentity(ownerUserId, generation)) return;
        setState({
          ownerUserId,
          mode: 'revenuecat',
          status: 'error',
          packages: [],
          errorMessage: errorText(error),
        });
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
      void disconnectRevenueCatIdentity().catch(() => {
        // A following identity connection remains serialized behind this cleanup.
      });
    };
  }, [ownsCurrentIdentity, userId]);

  const applySnapshot = useCallback((ownerUserId: string, snapshot: BillingSnapshot) => {
    if (userIdRef.current !== ownerUserId) return;
    setState({
      ownerUserId,
      mode: 'revenuecat',
      status: snapshot.isPro ? 'pro' : 'free',
      packages: snapshot.packages,
      errorMessage: null,
    });
  }, []);

  const refresh = useCallback(async () => {
    const ownerUserId = userIdRef.current;
    if (!ownerUserId) return;

    const mode = modeForEnvironment();
    if (mode === 'mock') {
      setState((current) => ({
        ...current,
        ownerUserId,
        mode,
        status: current.ownerUserId === ownerUserId && current.status === 'pro' ? 'pro' : 'free',
        packages: [MOCK_PACKAGE],
        errorMessage: null,
      }));
      return;
    }
    if (mode === 'unavailable') {
      setState(emptyState(ownerUserId, mode));
      return;
    }

    setState((current) => ({ ...current, ownerUserId, mode, status: 'loading', errorMessage: null }));
    try {
      applySnapshot(ownerUserId, await loadRevenueCatSnapshot(ownerUserId));
    } catch (error) {
      if (userIdRef.current !== ownerUserId) return;
      setState((current) => ({ ...current, ownerUserId, status: 'error', errorMessage: errorText(error) }));
    }
  }, [applySnapshot]);

  const purchase = useCallback(
    async (identifier: string) => {
      const ownerUserId = userIdRef.current;
      if (!ownerUserId) return;

      setState((current) => ({ ...current, ownerUserId, status: 'loading', errorMessage: null }));
      const mode = modeForEnvironment();
      if (mode === 'mock') {
        setState((current) => ({ ...current, ownerUserId, status: 'pro', errorMessage: null }));
        return;
      }
      if (mode === 'unavailable') {
        setState(emptyState(ownerUserId, mode));
        return;
      }

      try {
        applySnapshot(ownerUserId, await purchaseRevenueCatPackage(ownerUserId, identifier));
      } catch (error) {
        if (userIdRef.current !== ownerUserId) return;
        if (isPurchaseCancellation(error)) {
          await refresh();
          return;
        }
        setState((current) => ({ ...current, ownerUserId, status: 'error', errorMessage: errorText(error) }));
      }
    },
    [applySnapshot, refresh],
  );

  const restore = useCallback(async () => {
    const ownerUserId = userIdRef.current;
    if (!ownerUserId) return;

    const mode = modeForEnvironment();
    if (mode === 'mock') {
      setState((current) => ({ ...current, ownerUserId, errorMessage: null }));
      return;
    }
    if (mode === 'unavailable') {
      setState(emptyState(ownerUserId, mode));
      return;
    }

    setState((current) => ({ ...current, ownerUserId, status: 'loading', errorMessage: null }));
    try {
      applySnapshot(ownerUserId, await restoreRevenueCatPurchases(ownerUserId));
    } catch (error) {
      if (userIdRef.current !== ownerUserId) return;
      setState((current) => ({ ...current, ownerUserId, status: 'error', errorMessage: errorText(error) }));
    }
  }, [applySnapshot]);

  const resetMockAccess = useCallback(() => {
    const ownerUserId = userIdRef.current;
    if (!ownerUserId || modeForEnvironment() !== 'mock') return;
    setState({
      ownerUserId,
      mode: 'mock',
      status: 'free',
      packages: [MOCK_PACKAGE],
      errorMessage: null,
    });
  }, []);

  // Scope visible state during render, before effects run, so an account switch
  // cannot paint the previous account's Pro state for even one frame.
  const visibleState = state.ownerUserId === userId ? state : emptyState(userId);
  const value = useMemo<BillingContextValue>(
    () => ({
      mode: visibleState.mode,
      status: visibleState.status,
      isPro: visibleState.status === 'pro',
      packages: visibleState.packages,
      errorMessage: visibleState.errorMessage,
      purchase,
      refresh,
      restore,
      resetMockAccess,
    }),
    [purchase, refresh, resetMockAccess, restore, visibleState],
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) throw new Error('useBilling must be used within BillingProvider');
  return context;
}
