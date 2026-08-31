import assert from 'node:assert/strict';
import test from 'node:test';

import { RevenueCatIdentitySession } from '../billing-session.ts';

function fakeSession() {
  const calls = [];
  const session = new RevenueCatIdentitySession({
    configure(apiKey, appUserId) {
      calls.push(['configure', apiKey, appUserId]);
    },
    logIn(appUserId) {
      calls.push(['logIn', appUserId]);
    },
  });
  return { calls, session };
}

test('configures RevenueCat with the stable authenticated user ID', async () => {
  const { calls, session } = fakeSession();
  await session.connect('public_key', 'user_clerk_123');

  assert.deepEqual(calls, [['configure', 'public_key', 'user_clerk_123']]);
  assert.equal(session.currentUserId(), 'user_clerk_123');
});

test('switches accounts without reusing or reconfiguring the first identity', async () => {
  const { calls, session } = fakeSession();
  await session.connect('public_key', 'user_a');
  await session.connect('public_key', 'user_b');
  await session.connect('public_key', 'user_b');

  assert.deepEqual(calls, [
    ['configure', 'public_key', 'user_a'],
    ['logIn', 'user_b'],
  ]);
  assert.equal(session.currentUserId(), 'user_b');
});

test('disconnects visible ownership without creating an anonymous RevenueCat alias', async () => {
  const { calls, session } = fakeSession();
  await session.connect('public_key', 'user_a');
  await session.disconnect();
  await session.connect('public_key', 'user_b');

  assert.deepEqual(calls, [
    ['configure', 'public_key', 'user_a'],
    ['logIn', 'user_b'],
  ]);
  assert.equal(session.currentUserId(), 'user_b');
});

test('serializes a rapid account switch and sign-out in request order', async () => {
  const calls = [];
  let releaseLogin;
  const loginBlocked = new Promise((resolve) => {
    releaseLogin = resolve;
  });
  const session = new RevenueCatIdentitySession({
    configure(_apiKey, appUserId) {
      calls.push(['configure', appUserId]);
    },
    async logIn(appUserId) {
      calls.push(['logIn', appUserId]);
      await loginBlocked;
    },
  });

  await session.connect('public_key', 'user_a');
  const switchAccount = session.connect('public_key', 'user_b');
  const signOut = session.disconnect();
  releaseLogin();
  await Promise.all([switchAccount, signOut]);

  assert.deepEqual(calls, [
    ['configure', 'user_a'],
    ['logIn', 'user_b'],
  ]);
  assert.equal(session.currentUserId(), null);
});

test('requires an explicit authenticated user ID', () => {
  const { session } = fakeSession();
  assert.throws(() => session.connect('public_key', '   '), /authenticated user ID/);
});

test('keeps a purchase operation on its owner before processing sign-out', async () => {
  const { calls, session } = fakeSession();
  let releasePurchase;
  const purchaseBlocked = new Promise((resolve) => {
    releasePurchase = resolve;
  });

  const purchase = session.runForUser('public_key', 'user_a', async () => {
    calls.push(['purchase:start', session.currentUserId()]);
    await purchaseBlocked;
    calls.push(['purchase:end', session.currentUserId()]);
    return 'purchased';
  });
  const signOut = session.disconnect();
  releasePurchase();

  assert.equal(await purchase, 'purchased');
  await signOut;
  assert.deepEqual(calls, [
    ['configure', 'public_key', 'user_a'],
    ['purchase:start', 'user_a'],
    ['purchase:end', 'user_a'],
  ]);
  assert.equal(session.currentUserId(), null);
});
