/**
 * Prevents a destructive action from running twice if the person double-taps
 * a button (network lag, impatience) before the first tap's response comes
 * back. Single-user bot, so a simple in-process Set is enough — no need for
 * anything Redis-backed or cross-process.
 *
 * Keyed by `${telegramId}:${actionKey}`, not just telegramId — a lock
 * scoped to the whole user would block two genuinely unrelated actions
 * from ever overlapping (e.g. Delete Repo on one repo blocking a Fork on a
 * completely different one), which isn't what this is for. Only a second
 * tap of the SAME action should be blocked.
 */
const locked = new Set();

function tryAcquire(key) {
  if (locked.has(key)) return false;
  locked.add(key);
  return true;
}

function release(key) {
  locked.delete(key);
}

/** Runs fn only if no matching action is already in flight for this
 * person. `actionKey` scopes the lock (e.g. 'deleteRepo', 'fork') so
 * unrelated actions never block each other. Returns { skipped: true } if
 * a duplicate tap of the SAME action was blocked. */
async function withLock(telegramId, actionKey, fn) {
  // Backward-compatible with the old 2-arg call shape (telegramId, fn) —
  // treated as one shared 'default' action key, same behavior as before.
  if (typeof actionKey === 'function') {
    fn = actionKey;
    actionKey = 'default';
  }
  const key = `${telegramId}:${actionKey}`;
  if (!tryAcquire(key)) return { skipped: true };
  try {
    await fn();
    return { skipped: false };
  } finally {
    release(key);
  }
}

module.exports = { withLock };
