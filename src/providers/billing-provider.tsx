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
  revenueCatCustomerManagementUrl,
  subscribeToRevenueCat,
} from '@/features/billing/revenuecat-client';
import {
  loadServerProEntitlement,
  reconcileServerProEntitlement,
  serverEntitlementIsActive,
  type ServerProEntitlement,
} from '@/features/billing/server-entitlement-client';

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

function billingStatusForServer(entitlement: ServerProEntitlement): BillingStatus {
  if (serverEntitlementIsActive(entitlement)) return 'pro';
  return entitlement.state === 'inactive' ? 'free' : 'error';
}

function serverStatusMessage(entitlement: ServerProEntitlement) {
  return entitlement.state === 'stale' || entitlement.state === 'unavailable'
    ? 'Pro access could not be verified by the server. Refresh access before using tutor assistance.'
    : null;
}

function syncUnavailableMessage(entitlement?: ServerProEntitlement) {
  if (entitlement?.state === 'inactive') {
    return 'Checkout completed, but the server has not confirmed Pro yet. Refresh access in a moment.';
  }
  return 'Checkout completed, but Pro access could not be confirmed by the server. Your purchase was not lost; refresh access before using tutor assistance.';
}

export function BillingProvider({ children, userId }: BillingProviderProps) {
  const [state, setState] = useState<BillingState>(() => emptyState(userId));
  const userIdRef = useRef(userId);
  const identityGenerationRef = useRef(0);
  const entitlementRequestSequenceRef = useRef(0);
  userIdRef.current = userId;

  const ownsCurrentIdentity = useCallback(
    (ownerUserId: string, generation: number) =>
      userIdRef.current === ownerUserId && identityGenerationRef.current === generation,
    [],
  );

  const beginEntitlementRequest = useCallback(
    () => ++entitlementRequestSequenceRef.current,
    [],
  );

  const ownsLatestEntitlementRequest = useCallback(
    (ownerUserId: string, generation: number, requestSequence: number) =>
      ownsCurrentIdentity(ownerUserId, generation) &&
      entitlementRequestSequenceRef.current === requestSequence,
    [ownsCurrentIdentity],
  );

  const applyConfirmedEntitlement = useCallback(
    (
      ownerUserId: string,
      generation: number,
      requestSequence: number,
      entitlement: ServerProEntitlement,
    ) => {
      if (!ownsLatestEntitlementRequest(ownerUserId, generation, requestSequence)) return;
      setState((current) => {
        if (
          current.ownerUserId !== ownerUserId ||
          !ownsLatestEntitlementRequest(ownerUserId, generation, requestSequence)
        ) return current;

        const active = serverEntitlementIsActive(entitlement);
        const settlesPurchase = current.purchaseState.status === 'syncing';
        const syncMessage = settlesPurchase && !active ? syncUnavailableMessage(entitlement) : null;
        return {
          ...current,
          status: settlesPurchase && !active ? 'error' : billingStatusForServer(entitlement),
          purchaseState: settlesPurchase
            ? {
                ...current.purchaseState,
                status: active ? 'success' : 'sync-unavailable',
                message: active ? 'Pro tutor assistance is active.' : syncMessage,
              }
            : current.purchaseState,
          errorMessage: syncMessage ?? serverStatusMessage(entitlement),
        };
      });
    },
    [ownsLatestEntitlementRequest],
  );

  const applyEntitlementFailure = useCallback(
    (ownerUserId: string, generation: number, requestSequence: number, error: unknown) => {
      if (!ownsLatestEntitlementRequest(ownerUserId, generation, requestSequence)) return;
      setState((current) => {
        if (
          current.ownerUserId !== ownerUserId ||
          !ownsLatestEntitlementRequest(ownerUserId, generation, requestSequence)
        ) return current;

        const settlesPurchase = current.purchaseState.status === 'syncing';
        const message = settlesPurchase ? syncUnavailableMessage() : errorText(error);
        return {
          ...current,
          status: 'error',
          purchaseState: settlesPurchase
            ? { ...current.purchaseState, status: 'sync-unavailable', message }
            : current.purchaseState,
          errorMessage: message,
        };
      });
    },
    [ownsLatestEntitlementRequest],
  );

  useEffect(() => {
    const generation = ++identityGenerationRef.current;
    const ownerUserId = userId;
    const mode = modeForEnvironment();
    let active = true;
    let unsubscribe: (() => boolean) | undefined;
    let initialEntitlementRequestSequence: number | null = null;

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
        const requestSequence = beginEntitlementRequest();
        initialEntitlementRequestSequence = requestSequence;
        const serverEntitlement = await loadServerProEntitlement();
        if (
          !active ||
          !ownsLatestEntitlementRequest(ownerUserId, generation, requestSequence)
        ) return;
        setState((current) =>
          active &&
          ownsLatestEntitlementRequest(ownerUserId, generation, requestSequence)
            ? {
                ownerUserId,
                mode: 'revenuecat',
                status: billingStatusForServer(serverEntitlement),
                packages: snapshot.packages,
                managementUrl: snapshot.managementUrl,
                purchaseState: IDLE_PURCHASE,
                managementState: IDLE_MANAGEMENT,
                errorMessage: serverStatusMessage(serverEntitlement),
              }
            : current,
        );

        unsubscribe = subscribeToRevenueCat((customerInfo) => {
          if (!active || !ownsCurrentIdentity(ownerUserId, generation)) return;
          setState((current) => ({
            ...current,
            ownerUserId,
            managementUrl: revenueCatCustomerManagementUrl(customerInfo),
          }));
          const requestSequence = beginEntitlementRequest();
          void reconcileServerProEntitlement()
            .then((entitlement) => {
              if (!active) return;
              applyConfirmedEntitlement(ownerUserId, generation, requestSequence, entitlement);
            })
            .catch((error) => {
              if (!active) return;
              applyEntitlementFailure(ownerUserId, generation, requestSequence, error);
            });
        });

      } catch (error) {
        if (!active || !ownsCurrentIdentity(ownerUserId, generation)) return;
        if (
          initialEntitlementRequestSequence !== null &&
          !ownsLatestEntitlementRequest(ownerUserId, generation, initialEntitlementRequestSequence)
        ) return;
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
  }, [
    applyConfirmedEntitlement,
    applyEntitlementFailure,
    beginEntitlementRequest,
    ownsCurrentIdentity,
    ownsLatestEntitlementRequest,
    userId,
  ]);

  const applyClientMetadata = useCallback((ownerUserId: string, generation: number, snapshot: BillingSnapshot) => {
    if (!ownsCurrentIdentity(ownerUserId, generation)) return;
    setState((current) =>
      current.ownerUserId === ownerUserId
        ? {
            ...current,
            ownerUserId,
            mode: 'revenuecat',
            packages: snapshot.packages,
            managementUrl: snapshot.managementUrl,
          }
        : current,
    );
  }, [ownsCurrentIdentity]);

  const refresh = useCallback(async () => {
    const ownerUserId = userIdRef.current;
    if (!ownerUserId) return;
    const generation = identityGenerationRef.current;

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
    let entitlementRequestSequence: number | null = null;
    try {
      const snapshot = await loadRevenueCatSnapshot(ownerUserId);
      if (!ownsCurrentIdentity(ownerUserId, generation)) return;
      applyClientMetadata(ownerUserId, generation, snapshot);
      entitlementRequestSequence = beginEntitlementRequest();
      const entitlement = await reconcileServerProEntitlement();
      applyConfirmedEntitlement(ownerUserId, generation, entitlementRequestSequence, entitlement);
    } catch (error) {
      if (entitlementRequestSequence !== null) {
        applyEntitlementFailure(ownerUserId, generation, entitlementRequestSequence, error);
        return;
      }
      if (!ownsCurrentIdentity(ownerUserId, generation)) return;
      setState((current) => ({ ...current, ownerUserId, status: 'error', errorMessage: errorText(error) }));
    }
  }, [
    applyClientMetadata,
    applyConfirmedEntitlement,
    applyEntitlementFailure,
    beginEntitlementRequest,
    ownsCurrentIdentity,
  ]);

  const purchase = useCallback(
    async (identifier: string) => {
      const ownerUserId = userIdRef.current;
      if (!ownerUserId) return;
      const generation = identityGenerationRef.current;

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
        if (!ownsCurrentIdentity(ownerUserId, generation)) return;
        applyClientMetadata(ownerUserId, generation, snapshot);
        setState((current) =>
          current.ownerUserId === ownerUserId && ownsCurrentIdentity(ownerUserId, generation)
            ? {
                ...current,
                purchaseState: {
                  packageIdentifier: identifier,
                  status: 'syncing',
                  message: 'Checkout completed. Confirming Pro access with the GlideLingo server…',
                },
              }
            : current,
        );
        const entitlementRequestSequence = beginEntitlementRequest();
        try {
          const entitlement = await reconcileServerProEntitlement();
          applyConfirmedEntitlement(ownerUserId, generation, entitlementRequestSequence, entitlement);
        } catch (error) {
          applyEntitlementFailure(ownerUserId, generation, entitlementRequestSequence, error);
        }
      } catch (error) {
        if (!ownsCurrentIdentity(ownerUserId, generation)) return;
        const failure = classifyPurchaseFailure(error);
        setState((current) =>
          current.ownerUserId === ownerUserId && ownsCurrentIdentity(ownerUserId, generation)
            ? {
                ...current,
                ownerUserId,
                purchaseState: { ...failure, packageIdentifier: identifier },
              }
            : current,
        );
      }
    },
    [
      applyClientMetadata,
      applyConfirmedEntitlement,
      applyEntitlementFailure,
      beginEntitlementRequest,
      ownsCurrentIdentity,
    ],
  );

  const restore = useCallback(async () => {
    const ownerUserId = userIdRef.current;
    if (!ownerUserId) return;
    const generation = identityGenerationRef.current;

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
    let entitlementRequestSequence: number | null = null;
    try {
      const snapshot = await restoreRevenueCatPurchases(ownerUserId);
      if (!ownsCurrentIdentity(ownerUserId, generation)) return;
      applyClientMetadata(ownerUserId, generation, snapshot);
      entitlementRequestSequence = beginEntitlementRequest();
      const entitlement = await reconcileServerProEntitlement();
      applyConfirmedEntitlement(ownerUserId, generation, entitlementRequestSequence, entitlement);
    } catch (error) {
      if (entitlementRequestSequence !== null) {
        applyEntitlementFailure(ownerUserId, generation, entitlementRequestSequence, error);
        return;
      }
      if (!ownsCurrentIdentity(ownerUserId, generation)) return;
      setState((current) => ({ ...current, ownerUserId, status: 'error', errorMessage: errorText(error) }));
    }
  }, [
    applyClientMetadata,
    applyConfirmedEntitlement,
    applyEntitlementFailure,
    beginEntitlementRequest,
    ownsCurrentIdentity,
  ]);

  const manage = useCallback(async () => {
    const ownerUserId = userIdRef.current;
    if (!ownerUserId) return;
    const generation = identityGenerationRef.current;

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
      if (!ownsCurrentIdentity(ownerUserId, generation)) return;
      applyClientMetadata(ownerUserId, generation, result.snapshot);
      setState((current) =>
        current.ownerUserId === ownerUserId && ownsCurrentIdentity(ownerUserId, generation)
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
      if (!ownsCurrentIdentity(ownerUserId, generation)) return;
      setState((current) =>
        current.ownerUserId === ownerUserId && ownsCurrentIdentity(ownerUserId, generation)
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
  }, [applyClientMetadata, ownsCurrentIdentity]);

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
