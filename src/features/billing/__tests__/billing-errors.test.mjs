import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPurchaseFailure, safeManagementUrl } from '../billing-errors.ts';

test('classifies explicit RevenueCat cancellation without treating access as an error', () => {
  assert.deepEqual(classifyPurchaseFailure({ code: '1' }), {
    packageIdentifier: null,
    status: 'cancelled',
    message: 'Checkout was cancelled. Your access and payment details were not changed.',
  });
  assert.equal(classifyPurchaseFailure({ userCancelled: true }).status, 'cancelled');
});

test('classifies payment-not-allowed and invalid-payment failures as declines', () => {
  assert.equal(classifyPurchaseFailure({ code: '3' }).status, 'declined');
  assert.equal(classifyPurchaseFailure({ code: '4' }).status, 'declined');
});

test('keeps ambiguous purchase failures distinct from cancellation or decline', () => {
  assert.equal(classifyPurchaseFailure({ code: '2' }).status, 'error');
  assert.equal(classifyPurchaseFailure(new Error('network unavailable')).status, 'error');
});

test('accepts secure RevenueCat management URLs and rejects unsafe or absent values', () => {
  assert.equal(safeManagementUrl(' https://billing.example.com/portal '), 'https://billing.example.com/portal');
  assert.equal(
    safeManagementUrl('itms-apps://apps.apple.com/account/subscriptions'),
    'itms-apps://apps.apple.com/account/subscriptions',
  );
  assert.equal(safeManagementUrl('javascript:alert(1)'), null);
  assert.equal(safeManagementUrl('http://billing.example.com/portal'), null);
  assert.equal(safeManagementUrl(null), null);
});
