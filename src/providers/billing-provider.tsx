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
  type BillingManagementState,
  type BillingMode,
  type BillingPackage,
  type BillingPurchaseState,
  type BillingSnapshot,
  type BillingStatus,
} from '@/features/billing/billing-types';
import { classifyPurchaseFailure } from '@/features/billing/billing-errors';
import { selectBillingMode } from '@/features/billing/billing-config';
import {
  disconnectRevenueCatIdentity,
  hasRevenueCatApiKey,
  loadRevenueCatSnapshot,
  openRevenueCatCustomerManagement,
  purchaseRevenueCatPackage,
  restoreRevenueCatPurchases,
  revenueCatCustomerHasPro,
  revenueCatCustomerManagementUrl,
  subscribeToRevenueCat,
} from '@/features/billing/revenuecat-client';

const MOCK_PACKAGES: BillingPackage[] = [
  {
    identifier: 'mock_pro_monthly',
    interval: 'monthly',
    title: 'Monthly Pro preview',
    description: 'Preview monthly tutor access with the development-only mock setting.',
    priceLabel: 'Mock monthly',
  },
  {
    identifier: 'mock_pro_annual',
    interval: 'annual',
    title: 'Annual Pro preview',
    description: 'Preview annual tutor access with the development-only mock setting.',
    priceLabel: 'Mock annual',
  },
];

const IDLE_PURCHASE: BillingPurchaseState = {
  packageIdentifier: null,
  status: 'idle',
  message: null,
};

const IDLE_MANAGEMENT: BillingManagementState = { status: 'idle', message: null };

type BillingState = {
  ownerUserId: string | null;
  mode: BillingMode;
  status: BillingStatus;
  packages: BillingPackage[];
  managementUrl: string | null;
  purchaseState: BillingPurchaseState;
  managementState: BillingManagementState;
  errorMessage: string | null;
};

type BillingContextValue = Omit<BillingState, 'ownerUserId'> & {
  isPro: boolean;
  purchase: (identifier: string) => Promise<void>;
  refresh: () => Promise<void>;
  restore: () => Promise<void>;
  manage: () => Promise<void>;
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
    managementUrl: null,
    purchaseState: IDLE_PURCHASE,
    managementState: IDLE_MANAGEMENT,
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
        packages: MOCK_PACKAGES,
        managementUrl: null,
        purchaseState: IDLE_PURCHASE,
        managementState: IDLE_MANAGEMENT,
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
          managementUrl: snapshot.managementUrl,
          purchaseState: IDLE_PURCHASE,
          managementState: IDLE_MANAGEMENT,
          errorMessage: null,
        });

        unsubscribe = subscribeToRevenueCat((customerInfo) => {
          if (!active || !ownsCurrentIdentity(ownerUserId, generation)) return;
          setState((current) => ({
            ...current,
            ownerUserId,
            status: revenueCatCustomerHasPro(customerInfo) ? 'pro' : 'free',
            managementUrl: revenueCatCustomerManagementUrl(customerInfo),
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
          managementUrl: null,
          purchaseState: IDLE_PURCHASE,
          managementState: IDLE_MANAGEMENT,
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
    setState((current) =>
      current.ownerUserId === ownerUserId
        ? {
            ...current,
            ownerUserId,
            mode: 'revenuecat',
            status: snapshot.isPro ? 'pro' : 'free',
            packages: snapshot.packages,
            managementUrl: snapshot.managementUrl,
            errorMessage: null,
          }
        : current,
    );
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
        packages: MOCK_PACKAGES,
        purchaseState: IDLE_PURCHASE,
        errorMessage: null,
      }));
      return;
    }
    if (mode === 'unavailable') {
      setState(emptyState(ownerUserId, mode));
      return;
    }

    setState((current) => ({
      ...current,
      ownerUserId,
      mode,
      status: 'loading',
      purchaseState: IDLE_PURCHASE,
      managementState: IDLE_MANAGEMENT,
      errorMessage: null,
    }));
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

      setState((current) => ({
        ...current,
        ownerUserId,
        purchaseState: { packageIdentifier: identifier, status: 'loading', message: null },
        errorMessage: null,
      }));
      const mode = modeForEnvironment();
      if (mode === 'mock') {
        setState((current) => ({
          ...current,
          ownerUserId,
          status: 'pro',
          purchaseState: {
            packageIdentifier: identifier,
            status: 'success',
            message: 'Mock Pro tutor assistance is active for this local session.',
          },
          errorMessage: null,
        }));
        return;
      }
      if (mode === 'unavailable') {
        setState(emptyState(ownerUserId, mode));
        return;
      }

      try {
        const snapshot = await purchaseRevenueCatPackage(ownerUserId, identifier);
        if (userIdRef.current !== ownerUserId) return;
        applySnapshot(ownerUserId, snapshot);
        setState((current) =>
          current.ownerUserId === ownerUserId && userIdRef.current === ownerUserId
            ? {
                ...current,
                purchaseState: {
                  packageIdentifier: identifier,
                  status: snapshot.isPro ? 'success' : 'error',
                  message: snapshot.isPro
                    ? 'Pro tutor assistance is active.'
                    : 'Checkout finished, but Pro is not active yet. Refresh access before trying again.',
                },
              }
            : current,
        );
      } catch (error) {
        if (userIdRef.current !== ownerUserId) return;
        const failure = classifyPurchaseFailure(error);
        setState((current) =>
          current.ownerUserId === ownerUserId && userIdRef.current === ownerUserId
            ? {
                ...current,
                ownerUserId,
                purchaseState: { ...failure, packageIdentifier: identifier },
              }
            : current,
        );
      }
    },
    [applySnapshot],
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

  const manage = useCallback(async () => {
    const ownerUserId = userIdRef.current;
    if (!ownerUserId) return;

    const mode = modeForEnvironment();
    if (mode !== 'revenuecat') {
      setState((current) => ({
        ...current,
        managementState: {
          status: 'unavailable',
          message: mode === 'mock'
            ? 'Subscription management is not available for local mock access.'
            : 'Subscription management is unavailable because billing is not configured.',
        },
      }));
      return;
    }

    setState((current) => ({
      ...current,
      managementState: { status: 'loading', message: null },
    }));

    try {
      const result = await openRevenueCatCustomerManagement(ownerUserId);
      if (userIdRef.current !== ownerUserId) return;
      applySnapshot(ownerUserId, result.snapshot);
      setState((current) =>
        current.ownerUserId === ownerUserId && userIdRef.current === ownerUserId
          ? {
              ...current,
              managementState: result.opened
                ? { status: 'opened', message: 'Subscription management opened securely.' }
                : {
                    status: 'unavailable',
                    message: 'No management portal is available for this subscription. Refresh access or contact support.',
                  },
            }
          : current,
      );
    } catch {
      if (userIdRef.current !== ownerUserId) return;
      setState((current) =>
        current.ownerUserId === ownerUserId && userIdRef.current === ownerUserId
          ? {
              ...current,
              managementState: {
                status: 'error',
                message: 'Subscription management could not be opened. Refresh access and try again.',
              },
            }
          : current,
      );
    }
  }, [applySnapshot]);

  const resetMockAccess = useCallback(() => {
    const ownerUserId = userIdRef.current;
    if (!ownerUserId || modeForEnvironment() !== 'mock') return;
    setState({
      ownerUserId,
      mode: 'mock',
      status: 'free',
      packages: MOCK_PACKAGES,
      managementUrl: null,
      purchaseState: IDLE_PURCHASE,
      managementState: IDLE_MANAGEMENT,
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
      managementUrl: visibleState.managementUrl,
      purchaseState: visibleState.purchaseState,
      managementState: visibleState.managementState,
      errorMessage: visibleState.errorMessage,
      manage,
      purchase,
      refresh,
      restore,
      resetMockAccess,
    }),
    [manage, purchase, refresh, resetMockAccess, restore, visibleState],
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) throw new Error('useBilling must be used within BillingProvider');
  return context;
}
