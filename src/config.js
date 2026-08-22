require('dotenv').config();
const crypto = require('crypto');

function required(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`❌ Missing required environment variable: ${name}`);
    console.error('   Check your .env file against .env.example');
    process.exit(1);
  }
  return val;
}

module.exports = {
  BOT_TOKEN: required('BOT_TOKEN'),
  OWNER_ID: Number(required('OWNER_ID')),

  GITHUB_CLIENT_ID: required('GITHUB_CLIENT_ID'),
  GITHUB_CLIENT_SECRET: required('GITHUB_CLIENT_SECRET'),

  BASE_URL: required('BASE_URL').replace(/\/$/, ''),
  PORT: Number(process.env.PORT || 3000),

  SESSION_JWT_SECRET: required('SESSION_JWT_SECRET'),
  TOKEN_ENCRYPTION_KEY: required('TOKEN_ENCRYPTION_KEY'),

  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: required('REDIS_URL'),

  BOT_VERSION: process.env.BOT_VERSION || '0.8.7',

  // Hard limits (from design spec)
  MAX_ZIP_SIZE_BYTES: 1 * 1024 * 1024, // 1MB
  MAX_ZIP_UNCOMPRESSED_BYTES: 15 * 1024 * 1024, // 15MB decompressed — zip bomb guard
  MAX_SINGLE_FILE_BYTES: 5 * 1024 * 1024, // 5MB — single-file uploads (not zips) were previously uncapped
  MAX_TELEGRAM_FILE_SIZE_BYTES: 20 * 1024 * 1024, // 20MB (bot send limit)
  REPOS_PER_PAGE: 3, // v0.8.1 #36 — richer card format needs fewer per page to stay glanceable on a phone
  FILES_PER_PAGE: 8,
  ACTIVITY_PER_PAGE: 6,
  // Two DIFFERENT things were sharing one constant (v0.8.1 hardening #B):
  // WIZARD_SESSION_TTL_SECONDS genuinely only governs abandoned-upload file
  // buffers (in-process memory, correctly short-lived). SESSION_TTL_SECONDS
  // is the actual Redis TTL on the GLOBAL Telegraf session store — every
  // ctx.session field, bot-wide (ctx.session.currentRepo, bulk selections,
  // etc.), not just active wizards. The old shared 30-min value meant
  // things like "which repo you're currently viewing" silently vanished
  // after 30 min of any idle time, even with Repo View's own buttons still
  // on screen. Kept separate now, with the general one long enough to
  // survive normal gaps in checking the bot throughout a day.
  WIZARD_SESSION_TTL_SECONDS: 30 * 60, // 30 min — abandoned upload file buffers only
  SESSION_TTL_SECONDS: Number(process.env.SESSION_TTL_SECONDS || 24 * 60 * 60), // 24h — general ctx.session state

  // Memory management — tuned for Railway's 512MB free-tier ceiling.
  // See README "Memory & stability" section for the full explanation.
  PG_POOL_MAX: Number(process.env.PG_POOL_MAX || 3),
  MEMORY_WATCHDOG_MB: Number(process.env.MEMORY_WATCHDOG_MB || 400),
  MEMORY_WATCHDOG_CHECK_INTERVAL_MS: 30 * 1000,

  // Verifies incoming webhook requests actually came from Telegram. Falls
  // back to a value derived from SESSION_JWT_SECRET if not explicitly set,
  // so the bot still works without extra setup — but a dedicated secret
  // (openssl rand -hex 24) is strongly recommended for a public URL.
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET ||
    crypto.createHash('sha256').update(process.env.SESSION_JWT_SECRET || 'fallback').digest('hex').slice(0, 32),
};
