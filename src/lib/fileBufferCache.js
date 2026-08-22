const crypto = require('crypto');
const config = require('../config');

/**
 * Short-lived in-process cache for file content during the Upload wizard.
 *
 * Why this exists: Telegraf serializes and writes ctx.wizard.state to Redis
 * on every single step transition. Storing raw file bytes there meant a
 * ~1MB zip's worth of content got JSON-stringified and round-tripped
 * through Redis repeatedly as the user moved through path-selection →
 * summary → commit — real, avoidable memory pressure on every upload.
 *
 * Instead, file content lives here (in-process memory, never serialized),
 * and only a short reference ID + metadata goes into the Redis-persisted
 * wizard state. Entries are cleaned up immediately after commit/cancel,
 * with a TTL safety net matching the wizard session TTL in case a flow
 * gets abandoned without a clean exit.
 *
 * Trade-off, stated plainly: if Railway restarts the process mid-upload,
 * this cache is lost (the wizard session itself may survive in Redis, but
 * the actual file bytes won't). That's an acceptable cost — a rare
 * mid-flow restart losing one in-progress upload is far cheaper than every
 * normal upload straining memory the way the old approach did.
 */
const store = new Map(); // id -> { content, timer }

function put(content) {
  const id = crypto.randomBytes(8).toString('hex');
  const timer = setTimeout(() => store.delete(id), config.WIZARD_SESSION_TTL_SECONDS * 1000);
  timer.unref?.(); // don't let this timer keep the process alive on its own
  store.set(id, { content, timer });
  return id;
}

function get(id) {
  const entry = store.get(id);
  return entry ? entry.content : undefined;
}

function release(id) {
  const entry = store.get(id);
  if (entry) clearTimeout(entry.timer);
  store.delete(id);
}

function releaseAll(ids) {
  for (const id of ids) release(id);
}

module.exports = { put, get, release, releaseAll };
