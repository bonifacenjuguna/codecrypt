const { client } = require('../db/redis');
const config = require('../config');

/**
 * Telegraf-compatible session store backed by Redis.
 * Used with telegraf's session() middleware so Scenes/Wizard state
 * (Create Repo, Upload, Rename, Edit File flows) survives a Railway
 * restart/redeploy instead of silently losing the user's progress.
 *
 * This runs on literally every single interaction (every tap, every
 * message), so it's the one piece of I/O that — if it ever stalled
 * without a timeout — could freeze the whole bot. Postgres and every
 * GitHub call already got hard timeouts; this was the missing piece.
 * Fails fast and loud (throws, doesn't silently swallow) so a stall here
 * surfaces as a clear error via bot.catch() instead of infinite silence.
 */
const SESSION_IO_TIMEOUT_MS = 5000;

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${SESSION_IO_TIMEOUT_MS}ms`)), SESSION_IO_TIMEOUT_MS)),
  ]);
}

const redisStore = {
  async get(key) {
    const raw = await withTimeout(client.get(`tg-session:${key}`), 'Session read');
    return raw ? JSON.parse(raw) : undefined;
  },
  async set(key, value) {
    await withTimeout(
      client.set(`tg-session:${key}`, JSON.stringify(value), { EX: config.SESSION_TTL_SECONDS }),
      'Session write'
    );
  },
  async delete(key) {
    await withTimeout(client.del(`tg-session:${key}`), 'Session delete');
  },
};

module.exports = redisStore;
