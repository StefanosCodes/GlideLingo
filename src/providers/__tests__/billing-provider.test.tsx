import { beforeEach, expect, jest, test } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import type { BillingSnapshot } from '@/features/billing/billing-types';
import type { ServerProEntitlement } from '@/features/billing/server-entitlement-client';
import { BillingProvider, useBilling } from '@/providers/billing-provider';

jest.mock('@/features/billing/revenuecat-client', () => ({
  disconnectRevenueCatIdentity: jest.fn(async () => undefined),
  hasRevenueCatApiKey: jest.fn(() => true),
  loadRevenueCatSnapshot: jest.fn(),
  openRevenueCatCustomerManagement: jest.fn(),
  purchaseRevenueCatPackage: jest.fn(),
  restoreRevenueCatPurchases: jest.fn(),
  revenueCatCustomerHasPro: jest.fn(() => false),
  revenueCatCustomerManagementUrl: jest.fn(() => null),
  subscribeToRevenueCat: jest.fn(() => () => true),
}));

jest.mock('@/features/billing/server-entitlement-client', () => ({
  loadServerProEntitlement: jest.fn(),
  reconcileServerProEntitlement: jest.fn(),
  serverEntitlementIsActive: jest.fn(
    (entitlement: ServerProEntitlement) => entitlement.state === 'active' && entitlement.isPro,
  ),
}));

const mockedRevenueCatClient = jest.requireMock<typeof import('@/features/billing/revenuecat-client')>(
  '@/features/billing/revenuecat-client',
);
const mockDisconnectRevenueCatIdentity = jest.mocked(mockedRevenueCatClient.disconnectRevenueCatIdentity);
const mockHasRevenueCatApiKey = jest.mocked(mockedRevenueCatClient.hasRevenueCatApiKey);
const mockLoadRevenueCatSnapshot = jest.mocked(mockedRevenueCatClient.loadRevenueCatSnapshot);
const mockOpenRevenueCatCustomerManagement = jest.mocked(mockedRevenueCatClient.openRevenueCatCustomerManagement);
const mockPurchaseRevenueCatPackage = jest.mocked(mockedRevenueCatClient.purchaseRevenueCatPackage);
const mockRestoreRevenueCatPurchases = jest.mocked(mockedRevenueCatClient.restoreRevenueCatPurchases);
const mockSubscribeToRevenueCat = jest.mocked(mockedRevenueCatClient.subscribeToRevenueCat);
const mockedServerEntitlementClient = jest.requireMock<
  typeof import('@/features/billing/server-entitlement-client')
>('@/features/billing/server-entitlement-client');
const mockLoadServerProEntitlement = jest.mocked(mockedServerEntitlementClient.loadServerProEntitlement);
const mockReconcileServerProEntitlement = jest.mocked(mockedServerEntitlementClient.reconcileServerProEntitlement);

const packages = [
  {
    identifier: '$rc_monthly',
    interval: 'monthly' as const,
    title: 'Monthly',
    description: 'Monthly tutor assistance',
    priceLabel: '$9.99',
  },
  {
    identifier: '$rc_annual',
    interval: 'annual' as const,
    title: 'Annual',
    description: 'Annual tutor assistance',
    priceLabel: '$79.99',
  },
];

const freeSnapshot: BillingSnapshot = { isPro: false, packages, managementUrl: null };
const proSnapshot: BillingSnapshot = {
  isPro: true,
  packages,
  managementUrl: 'https://billing.example.com/portal',
};
const inactiveServerEntitlement: ServerProEntitlement = {
  entitlementId: 'pro',
  state: 'inactive',
  isPro: false,
  environment: 'SANDBOX',
  expiresAt: null,
  verifiedAt: '2026-08-31T12:00:00Z',
};
const activeServerEntitlement: ServerProEntitlement = {
  ...inactiveServerEntitlement,
  state: 'active',
  isPro: true,
  expiresAt: '2026-09-30T12:00:00Z',
};
const unavailableServerEntitlement: ServerProEntitlement = {
  ...inactiveServerEntitlement,
  state: 'unavailable',
};

const mockObserveBilling = jest.fn<(value: ReturnType<typeof useBilling>) => void>();

function Probe() {
  const currentBilling = useBilling();
  useEffect(() => mockObserveBilling(currentBilling), [currentBilling]);
  return <Text testID="billing-status">{currentBilling.status}</Text>;
}

function billing() {
  const latestCall = mockObserveBilling.mock.calls.at(-1);
  if (!latestCall) throw new Error('Billing probe has not rendered.');
  return latestCall[0];
}

beforeEach(() => {
  mockObserveBilling.mockClear();
  mockDisconnectRevenueCatIdentity.mockClear();
  mockHasRevenueCatApiKey.mockReset().mockReturnValue(true);
  mockLoadRevenueCatSnapshot.mockReset().mockResolvedValue(freeSnapshot);
  mockOpenRevenueCatCustomerManagement.mockReset();
  mockPurchaseRevenueCatPackage.mockReset();
  mockRestoreRevenueCatPurchases.mockReset().mockResolvedValue(freeSnapshot);
  mockSubscribeToRevenueCat.mockClear();
  mockLoadServerProEntitlement.mockReset().mockResolvedValue(inactiveServerEntitlement);
  mockReconcileServerProEntitlement.mockReset().mockResolvedValue(inactiveServerEntitlement);
  delete process.env.EXPO_PUBLIC_ENABLE_MOCK_BILLING;
});

test('RevenueCat client entitlement alone never grants server-gated Pro access', async () => {
  mockLoadRevenueCatSnapshot.mockResolvedValue(proSnapshot);
  mockLoadServerProEntitlement.mockResolvedValue(inactiveServerEntitlement);
  await render(
    <BillingProvider userId="user_a">
      <Probe />
    </BillingProvider>,
  );

  await waitFor(() => expect(billing().status).toBe('free'));
  expect(billing().isPro).toBe(false);
  expect(billing().managementUrl).toBe('https://billing.example.com/portal');
});

test('a stale account load cannot paint Pro access after switching Clerk users', async () => {
  let resolveAccountA: ((snapshot: BillingSnapshot) => void) | undefined;
  mockLoadRevenueCatSnapshot.mockImplementation((userId) => {
    if (userId === 'user_a') {
      return new Promise((resolve) => {
        resolveAccountA = resolve;
      });
    }
    return Promise.resolve(freeSnapshot);
  });

  const screen = await render(
    <BillingProvider userId="user_a">
      <Probe />
    </BillingProvider>,
  );
  await screen.rerender(
    <BillingProvider userId="user_b">
      <Probe />
    </BillingProvider>,
  );
  await waitFor(() => expect(billing().status).toBe('free'));

  await act(async () => {
    resolveAccountA?.(proSnapshot);
    await Promise.resolve();
  });

  expect(billing().status).toBe('free');
  expect(billing().isPro).toBe(false);
});

test('a purchase finishing after an account switch cannot update the new account', async () => {
  let resolvePurchase: ((snapshot: BillingSnapshot) => void) | undefined;
  mockPurchaseRevenueCatPackage.mockImplementation(
    () => new Promise((resolve) => {
      resolvePurchase = resolve;
    }),
  );
  const screen = await render(
    <BillingProvider userId="user_a">
      <Probe />
    </BillingProvider>,
  );
  await waitFor(() => expect(billing().status).toBe('free'));

  let pendingPurchase: Promise<void> | undefined;
  await act(async () => {
    pendingPurchase = billing().purchase('$rc_monthly');
    await Promise.resolve();
  });
  expect(billing().purchaseState.status).toBe('loading');

  await screen.rerender(
    <BillingProvider userId="user_b">
      <Probe />
    </BillingProvider>,
  );
  await waitFor(() => expect(billing().status).toBe('free'));
  await act(async () => {
    resolvePurchase?.(proSnapshot);
    await pendingPurchase;
  });

  expect(billing().status).toBe('free');
  expect(billing().purchaseState.status).toBe('idle');
});

test('checkout cancellation and decline stay distinct without erasing known access state', async () => {
  const screen = await render(
    <BillingProvider userId="user_a">
      <Probe />
    </BillingProvider>,
  );
  await waitFor(() => expect(billing().status).toBe('free'));

  mockPurchaseRevenueCatPackage.mockRejectedValueOnce({ code: '1' });
  await act(async () => billing().purchase('$rc_monthly'));
  expect(billing().purchaseState.status).toBe('cancelled');
  expect(billing().status).toBe('free');

  mockPurchaseRevenueCatPackage.mockRejectedValueOnce({ code: '3' });
  await act(async () => billing().purchase('$rc_annual'));
  expect(billing().purchaseState.status).toBe('declined');
  expect(billing().status).toBe('free');
  await screen.unmount();
});

test('successful checkout exposes success only after the refreshed entitlement is Pro', async () => {
  mockPurchaseRevenueCatPackage.mockResolvedValue(proSnapshot);
  let resolveReconciliation: ((entitlement: ServerProEntitlement) => void) | undefined;
  mockReconcileServerProEntitlement.mockImplementation(
    () => new Promise((resolve) => {
      resolveReconciliation = resolve;
    }),
  );
  await render(
    <BillingProvider userId="user_a">
      <Probe />
    </BillingProvider>,
  );
  await waitFor(() => expect(billing().status).toBe('free'));

  let pendingPurchase: Promise<void> | undefined;
  await act(async () => {
    pendingPurchase = billing().purchase('$rc_monthly');
    await Promise.resolve();
  });
  await waitFor(() => expect(billing().purchaseState.status).toBe('syncing'));

  expect(billing().status).toBe('free');
  expect(billing().isPro).toBe(false);

  await act(async () => {
    resolveReconciliation?.(activeServerEntitlement);
    await pendingPurchase;
  });

  expect(billing().status).toBe('pro');
  expect(billing().purchaseState).toMatchObject({
    packageIdentifier: '$rc_monthly',
    status: 'success',
  });
});

test('an older listener reconciliation cannot overwrite a newer successful purchase reconciliation', async () => {
  let resolveListenerReconciliation: ((entitlement: ServerProEntitlement) => void) | undefined;
  mockPurchaseRevenueCatPackage.mockResolvedValue(proSnapshot);
  mockReconcileServerProEntitlement
    .mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveListenerReconciliation = resolve;
      }),
    )
    .mockResolvedValueOnce(activeServerEntitlement);
  await render(
    <BillingProvider userId="user_a">
      <Probe />
    </BillingProvider>,
  );
  await waitFor(() => expect(billing().status).toBe('free'));

  const listener = mockSubscribeToRevenueCat.mock.calls.at(-1)?.[0];
  if (!listener) throw new Error('RevenueCat listener was not registered.');
  await act(async () => {
    listener({ managementURL: null } as never);
    await Promise.resolve();
  });
  expect(mockReconcileServerProEntitlement).toHaveBeenCalledTimes(1);

  await act(async () => billing().purchase('$rc_monthly'));
  expect(billing().status).toBe('pro');
  expect(billing().purchaseState.status).toBe('success');

  await act(async () => {
    resolveListenerReconciliation?.(inactiveServerEntitlement);
    await Promise.resolve();
  });

  expect(billing().status).toBe('pro');
  expect(billing().isPro).toBe(true);
  expect(billing().purchaseState.status).toBe('success');
});

test('checkout completion without a Pro entitlement remains fail closed', async () => {
  mockPurchaseRevenueCatPackage.mockResolvedValue(proSnapshot);
  mockReconcileServerProEntitlement.mockResolvedValue(unavailableServerEntitlement);
  await render(
    <BillingProvider userId="user_a">
      <Probe />
    </BillingProvider>,
  );
  await waitFor(() => expect(billing().status).toBe('free'));

  await act(async () => billing().purchase('$rc_monthly'));

  expect(billing().status).toBe('error');
  expect(billing().isPro).toBe(false);
  expect(billing().purchaseState.status).toBe('sync-unavailable');
});

test('manual refresh reconciles entitlement and management portal state', async () => {
  mockLoadRevenueCatSnapshot.mockResolvedValueOnce(freeSnapshot).mockResolvedValueOnce(proSnapshot);
  mockReconcileServerProEntitlement.mockResolvedValue(activeServerEntitlement);
  await render(
    <BillingProvider userId="user_a">
      <Probe />
    </BillingProvider>,
  );
  await waitFor(() => expect(billing().status).toBe('free'));

  await act(async () => billing().refresh());

  expect(billing().status).toBe('pro');
  expect(billing().managementUrl).toBe('https://billing.example.com/portal');
});

test('customer management reports an unavailable portal without losing Pro', async () => {
  const proWithoutPortal = { ...proSnapshot, managementUrl: null };
  mockLoadRevenueCatSnapshot.mockResolvedValue(proWithoutPortal);
  mockLoadServerProEntitlement.mockResolvedValue(activeServerEntitlement);
  mockOpenRevenueCatCustomerManagement.mockResolvedValue({ opened: false, snapshot: proWithoutPortal });
  await render(
    <BillingProvider userId="user_a">
      <Probe />
    </BillingProvider>,
  );
  await waitFor(() => expect(billing().status).toBe('pro'));

  await act(async () => billing().manage());

  expect(billing().managementState.status).toBe('unavailable');
  expect(billing().status).toBe('pro');
});

test('customer management records that the RevenueCat portal was opened', async () => {
  mockLoadRevenueCatSnapshot.mockResolvedValue(proSnapshot);
  mockLoadServerProEntitlement.mockResolvedValue(activeServerEntitlement);
  mockOpenRevenueCatCustomerManagement.mockResolvedValue({ opened: true, snapshot: proSnapshot });
  await render(
    <BillingProvider userId="user_a">
      <Probe />
    </BillingProvider>,
  );
  await waitFor(() => expect(billing().status).toBe('pro'));

  await act(async () => billing().manage());

  expect(billing().managementState.status).toBe('opened');
  expect(mockOpenRevenueCatCustomerManagement).toHaveBeenCalledWith('user_a');
});
