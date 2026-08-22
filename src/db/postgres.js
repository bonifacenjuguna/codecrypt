const { Pool } = require('pg');
const config = require('../config');
const logger = require('../lib/logger');

// Default pool size is up to 10 idle connections — far more than a
// single-owner bot ever needs, and each idle connection holds its own
// buffers in memory. Capped low to keep the baseline footprint small on
// Railway's 512MB free-tier limit.
//
// connectionTimeoutMillis / statement_timeout: previously UNSET, meaning a
// request that couldn't get a free connection (e.g. the pool exhausted by
// orphaned connections from a prior crashed instance) just waited forever
// instead of failing with a clear error — this is what caused the whole
// bot to appear frozen, including /start, since even the "are you
// connected" check is a DB query. Now both fail fast instead of hanging.
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.PG_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // fail fast if no connection is available
  statement_timeout: 10000, // cancel any single query that hangs server-side
  ssl: config.DATABASE_URL.includes('railway') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  logger.error('Unexpected Postgres pool error', { message: err.message });
});

/**
 * Ping the database and return round-trip latency in ms.
 * Used by Settings screen to show live DB health. Cached for 5s (v0.8.1
 * hardening #A) — this was previously an uncached fresh round-trip on
 * every call despite the README already claiming otherwise, and v0.8.1
 * made Settings' Refresh Status trivially spammable (inline, chained,
 * one tap = a fresh message with another refresh button), so an
 * uncached ping here is now real, easily-repeated DB load.
 */
let cachedPing = null;
async function ping() {
  if (cachedPing && Date.now() - cachedPing.timestamp < 5000) {
    return cachedPing.result;
  }
  const start = Date.now();
  let result;
  try {
    await pool.query('SELECT 1');
    result = { ok: true, ms: Date.now() - start };
  } catch (err) {
    result = { ok: false, ms: null, error: err.message };
  }
  cachedPing = { result, timestamp: Date.now() };
  return result;
}

/** Closes all pool connections cleanly — used on graceful shutdown (SIGTERM). */
async function close() {
  await pool.end();
}

module.exports = { pool, ping, close };
