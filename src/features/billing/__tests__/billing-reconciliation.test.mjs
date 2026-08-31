import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcilePostPurchaseCustomerInfo } from '../billing-reconciliation.ts';

test('refreshes CustomerInfo after checkout completes', async () => {
  let refreshCalls = 0;
  const refreshed = await reconcilePostPurchaseCustomerInfo(
    { source: 'purchase', isPro: false },
    async () => {
      refreshCalls += 1;
      return { source: 'refresh', isPro: true };
    },
  );

  assert.equal(refreshCalls, 1);
  assert.deepEqual(refreshed, { source: 'refresh', isPro: true });
});

test('keeps successful checkout CustomerInfo when only reconciliation fails', async () => {
  const purchaseInfo = { source: 'purchase', isPro: true };
  const reconciled = await reconcilePostPurchaseCustomerInfo(purchaseInfo, async () => {
    throw new Error('follow-up request failed');
  });

  assert.equal(reconciled, purchaseInfo);
});
