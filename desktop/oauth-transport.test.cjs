const assert = require('node:assert/strict');
const test = require('node:test');

const { createOAuthTransportCoordinator } = require('./oauth-transport.cjs');

function createManualTimers() {
  const timers = new Set();
  return {
    clearTimer: (timer) => timers.delete(timer),
    fireAll: () => {
      for (const timer of [...timers]) {
        timers.delete(timer);
        timer();
      }
    },
    setTimer: (callback) => {
      timers.add(callback);
      return callback;
    },
  };
}

test('OAuth transport opens externally and resolves exactly one pending callback', async () => {
  const timers = createManualTimers();
  const coordinator = createOAuthTransportCoordinator(timers);
  const opened = [];
  const request = coordinator.open({
    senderId: 7,
    targetUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    openExternalUrl: async (url) => opened.push(url),
  });

  assert.equal(coordinator.hasPending(), true);
  assert.equal(
    coordinator.complete('glidelingo://app/sso-callback?rotating_token_nonce=nonce'),
    true,
  );
  assert.deepEqual(await request, {
    callbackUrl: 'glidelingo://app/sso-callback?rotating_token_nonce=nonce',
  });
  assert.deepEqual(opened, ['https://accounts.google.com/o/oauth2/v2/auth']);
  assert.equal(coordinator.complete('glidelingo://app/sso-callback'), false);
  assert.equal(coordinator.hasPending(), false);
});

test('OAuth transport rejects concurrent requests and clears on matching renderer destruction', async () => {
  const timers = createManualTimers();
  const coordinator = createOAuthTransportCoordinator(timers);
  const request = coordinator.open({
    senderId: 4,
    targetUrl: 'https://appleid.apple.com/auth/authorize',
    openExternalUrl: async () => {},
  });

  await assert.rejects(
    coordinator.open({ senderId: 5, targetUrl: 'https://example.test', openExternalUrl: async () => {} }),
    /already in progress/,
  );
  assert.equal(coordinator.cancelForSender(5), false);
  assert.equal(coordinator.cancelForSender(4), true);
  await assert.rejects(request, /window closed/);
  assert.equal(coordinator.hasPending(), false);
});

test('OAuth transport clears on timeout and external browser failure', async () => {
  const timers = createManualTimers();
  const coordinator = createOAuthTransportCoordinator(timers);
  const timedOut = coordinator.open({
    senderId: 1,
    targetUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    openExternalUrl: async () => {},
  });
  timers.fireAll();
  await assert.rejects(timedOut, /timed out/);

  const failed = coordinator.open({
    senderId: 1,
    targetUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    openExternalUrl: async () => {
      throw new Error('browser unavailable');
    },
  });
  await assert.rejects(failed, /browser unavailable/);
  assert.equal(coordinator.hasPending(), false);
});

test('OAuth transport completes two sequential sign-in attempts without retaining stale state', async () => {
  const timers = createManualTimers();
  const coordinator = createOAuthTransportCoordinator(timers);

  for (const nonce of ['first', 'second']) {
    const request = coordinator.open({
      senderId: 9,
      targetUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      openExternalUrl: async () => {},
    });
    const callbackUrl = `glidelingo://app/sso-callback?rotating_token_nonce=${nonce}`;
    assert.equal(coordinator.complete(callbackUrl), true);
    assert.deepEqual(await request, { callbackUrl });
    assert.equal(coordinator.hasPending(), false);
  }
});
