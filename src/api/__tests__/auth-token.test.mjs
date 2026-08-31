import assert from 'node:assert/strict';
import test from 'node:test';

import { getApiAuthorizationHeader, setApiAccessTokenProvider } from '../auth-token.ts';

test('builds a bearer header from the active Clerk token provider', async () => {
  const cleanup = setApiAccessTokenProvider(async () => 'session-token');

  assert.deepEqual(await getApiAuthorizationHeader(), { Authorization: 'Bearer session-token' });
  cleanup();
});

test('never emits an authorization header for a signed-out session', async () => {
  const cleanup = setApiAccessTokenProvider(async () => null);

  assert.deepEqual(await getApiAuthorizationHeader(), {});
  cleanup();
});

test('stale effect cleanup cannot clear a newer account token provider', async () => {
  const cleanupFirst = setApiAccessTokenProvider(async () => 'first-user');
  const cleanupSecond = setApiAccessTokenProvider(async () => 'second-user');

  cleanupFirst();
  assert.deepEqual(await getApiAuthorizationHeader(), { Authorization: 'Bearer second-user' });

  cleanupSecond();
  assert.deepEqual(await getApiAuthorizationHeader(), {});
});

test('one stable provider reads the current account during an immediate account switch', async () => {
  let currentAccountToken = async () => 'first-user';
  const cleanup = setApiAccessTokenProvider(() => currentAccountToken());

  assert.deepEqual(await getApiAuthorizationHeader(), { Authorization: 'Bearer first-user' });

  currentAccountToken = async () => 'second-user';
  assert.deepEqual(await getApiAuthorizationHeader(), { Authorization: 'Bearer second-user' });

  currentAccountToken = async () => null;
  assert.deepEqual(await getApiAuthorizationHeader(), {});
  cleanup();
});
