const OAUTH_TRANSPORT_TIMEOUT_MS = 15 * 60 * 1000;

function createOAuthTransportCoordinator({
  timeoutMs = OAUTH_TRANSPORT_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let pending = null;

  function clearPending() {
    if (!pending) return null;
    const current = pending;
    pending = null;
    clearTimer(current.timeout);
    return current;
  }

  function rejectPending(error) {
    const current = clearPending();
    if (!current) return false;
    current.reject(error);
    return true;
  }

  function open({ senderId, targetUrl, openExternalUrl }) {
    if (pending) {
      return Promise.reject(new Error('A desktop OAuth request is already in progress.'));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimer(() => {
        rejectPending(new Error('Desktop sign-in timed out. Please try again.'));
      }, timeoutMs);

      pending = { reject, resolve, senderId, timeout };

      Promise.resolve(openExternalUrl(targetUrl)).catch((error) => {
        rejectPending(error instanceof Error ? error : new Error('Could not open the system browser.'));
      });
    });
  }

  function complete(callbackUrl) {
    const current = clearPending();
    if (!current) return false;
    current.resolve({ callbackUrl });
    return true;
  }

  function cancelForSender(senderId) {
    if (!pending || pending.senderId !== senderId) return false;
    return rejectPending(new Error('The desktop sign-in window closed before authentication completed.'));
  }

  function cancel() {
    return rejectPending(new Error('Desktop sign-in was cancelled.'));
  }

  function hasPending() {
    return Boolean(pending);
  }

  return { cancel, cancelForSender, complete, hasPending, open };
}

module.exports = { OAUTH_TRANSPORT_TIMEOUT_MS, createOAuthTransportCoordinator };
