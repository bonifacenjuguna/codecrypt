const { createClient } = require('redis');
const config = require('../config');
const logger = require('../lib/logger');

const client = createClient({
  url: config.REDIS_URL,
  socket: {
    connectTimeout: 5000, // fail fast instead of hanging if Redis is unreachable
  },
});

client.on('error', (err) => {
  logger.error('Redis client error', { message: err.message });
});
client.on('reconnecting', () => {
  logger.warn('Redis reconnecting...');
});
client.on('ready', () => {
  logger.info('Redis connection ready');
});

let connected = false;
async function connect() {
  if (!connected) {
    await client.connect();
    connected = true;
    logger.info('Redis connected');
  }
}

/**
 * Ping Redis and return round-trip latency in ms.
 * Used by Settings screen to show live DB health. Cached for 5s — same
 * reasoning as Postgres's ping cache (v0.8.1 hardening #A).
 */
let cachedPing = null;
async function ping() {
  if (cachedPing && Date.now() - cachedPing.timestamp < 5000) {
    return cachedPing.result;
  }
  const start = Date.now();
  let result;
  try {
    await Promise.race([
      client.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    result = { ok: true, ms: Date.now() - start };
  } catch (err) {
    result = { ok: false, ms: null, error: err.message };
  }
  cachedPing = { result, timestamp: Date.now() };
  return result;
}

/** Closes the Redis connection cleanly — used on graceful shutdown (SIGTERM). */
async function close() {
  if (connected) {
    await client.quit();
    connected = false;
  }
}

module.exports = { client, connect, ping, close };
