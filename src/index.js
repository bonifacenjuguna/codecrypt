const config = require('./config');
const { migrate } = require('./db/migrate');
const redisDb = require('./db/redis');
const pgDb = require('./db/postgres');
const createBot = require('./bot');
const createApp = require('./server/app');
const logger = require('./lib/logger');

let bot;
let httpServer;
let shuttingDown = false;
let botMode = null; // 'webhook' | 'polling' — tracks which so shutdown knows whether bot.stop() is even valid

/**
 * Closes everything in order (bot polling/webhook, HTTP server, Redis,
 * Postgres) before the process exits. Used for real SIGTERM/SIGINT from
 * Railway, the voluntary memory-watchdog restart, and an uncaught
 * exception — every path ends here so connections close cleanly instead
 * of the process just disappearing mid-write.
 *
 * v0.8.4 hardening: every step below now has its own timeout, AND the
 * whole sequence is capped by a hard deadline. Previously none of this
 * had any bound — httpServer.close() famously hangs waiting for idle
 * keep-alive connections to close on their own (it doesn't force them),
 * and Redis's client.quit() has known hangs under certain reconnect
 * states. Either one hanging meant process.exit() never ran, silently
 * defeating the entire point of the watchdog: instead of a clean
 * preemptive restart, the process would just sit there — still consuming
 * memory — until Railway's kernel eventually force-killed it anyway.
 */
const SHUTDOWN_STEP_TIMEOUT_MS = 5000;
const SHUTDOWN_HARD_DEADLINE_MS = 8000;

function withStepTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), SHUTDOWN_STEP_TIMEOUT_MS)),
  ]);
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down', { reason });

  // Absolute last resort: if the graceful sequence below is still running
  // past this deadline for ANY reason, force-exit anyway. A forced exit
  // that skips some cleanup is still strictly better than never exiting —
  // Railway's kernel would eventually force-kill it regardless, just
  // later and after more memory had piled up in the meantime.
  const hardDeadline = setTimeout(() => {
    logger.error('Shutdown exceeded hard deadline — forcing exit', { reason });
    process.exit(1);
  }, SHUTDOWN_HARD_DEADLINE_MS);
  hardDeadline.unref?.();

  // bot.stop() only means something in polling mode (it stops the getUpdates
  // loop). In webhook mode there's no such loop running, so calling it just
  // throws "Bot is not running!" every time — noise that was cluttering the
  // exact logs needed to debug real issues. Skipped entirely in webhook mode.
  if (botMode === 'polling') {
    try {
      if (bot) bot.stop(reason);
    } catch (err) {
      logger.error('Error stopping bot', { message: err.message });
    }
  }
  try {
    if (httpServer) await withStepTimeout(new Promise((resolve) => httpServer.close(resolve)), 'HTTP server close');
  } catch (err) {
    logger.error('Error closing HTTP server', { message: err.message });
  }
  try {
    await withStepTimeout(redisDb.close(), 'Redis close');
  } catch (err) {
    logger.error('Error closing Redis', { message: err.message });
  }
  try {
    await withStepTimeout(pgDb.close(), 'Postgres pool close');
  } catch (err) {
    logger.error('Error closing Postgres pool', { message: err.message });
  }

  clearTimeout(hardDeadline);
  logger.info('Shutdown complete');
  process.exit(0);
}

/**
 * Checks RSS memory against a self-imposed ceiling comfortably under
 * Railway's hard container limit, and triggers the SAME clean shutdown
 * path above rather than waiting for the kernel to SIGKILL the process.
 *
 * v0.8.4 hardening — two changes:
 *
 * 1. Adaptive check interval, not just a fixed 2-minute post-boot window.
 *    A flat 30s cadence after boot leaves a real blind spot: a sharp spike
 *    well after startup (e.g. a burst of concurrent GitHub requests) could
 *    blow past the ceiling within that 30s gap before the watchdog even
 *    looks again. Now checks every 5s whenever RSS is within 20% of the
 *    ceiling, regardless of how long the process has been up — the fast
 *    cadence follows actual risk, not just a fixed post-boot window.
 *
 * 2. An early-warning log at 80% of the ceiling. I can't verify from
 *    static analysis alone whether MEMORY_WATCHDOG_MB's margin under
 *    --max-old-space-size is actually right — that needs real Railway
 *    telemetry, not more guessing. This doesn't change the threshold
 *    itself; it makes the trend visible in the logs before a restart
 *    happens, so if the margin ever IS wrong, there's real data to look
 *    at instead of another unverified assumption.
 */
function startMemoryWatchdog() {
  const startTime = Date.now();
  const FAST_INTERVAL_MS = 5000;
  const FAST_WINDOW_MS = 2 * 60 * 1000;
  const WARNING_THRESHOLD_MB = config.MEMORY_WATCHDOG_MB * 0.8;
  const PROXIMITY_ZONE_MB = config.MEMORY_WATCHDOG_MB * 0.2; // "close to the ceiling" band
  let lastWarnedAt = 0;

  function check() {
    const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    if (rssMB >= config.MEMORY_WATCHDOG_MB) {
      logger.warn('Memory watchdog threshold crossed — restarting cleanly', { rssMB, ceilingMB: config.MEMORY_WATCHDOG_MB });
      shutdown('memory-watchdog');
      return;
    }
    if (rssMB >= WARNING_THRESHOLD_MB && Date.now() - lastWarnedAt > 60000) {
      // Debounced to once/minute — this is a heads-up, not a per-check spam risk
      logger.warn('Memory approaching watchdog ceiling', { rssMB, ceilingMB: config.MEMORY_WATCHDOG_MB });
      lastWarnedAt = Date.now();
    }

    const inFastWindow = Date.now() - startTime < FAST_WINDOW_MS;
    const nearCeiling = rssMB >= config.MEMORY_WATCHDOG_MB - PROXIMITY_ZONE_MB;
    const nextInterval = (inFastWindow || nearCeiling) ? FAST_INTERVAL_MS : config.MEMORY_WATCHDOG_CHECK_INTERVAL_MS;
    setTimeout(check, nextInterval).unref();
  }
  setTimeout(check, FAST_INTERVAL_MS).unref();
}

/**
 * Process-level safety net. An uncaught exception leaves Node in an
 * undefined state — best practice is to log it clearly and exit via the
 * same clean shutdown path. Unhandled promise rejections are logged but
 * don't trigger a restart on their own — most are already recoverable
 * errors caught one level up (e.g. bot.catch).
 */
function installCrashHandlers() {
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — shutting down', { message: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: reason && reason.message ? reason.message : String(reason) });
  });
}

async function main() {
  installCrashHandlers();

  logger.info('Running database migrations...');
  await migrate();

  logger.info('Connecting to Redis...');
  await redisDb.connect();

  logger.info('Starting Telegram bot...');
  bot = createBot();

  // Kept short — Telegram's own command list UI is a compact popup, long
  // descriptions get truncated or crowd out the command names.
  await bot.telegram.setMyCommands([
    { command: 'start', description: '🏠 Main menu' },
    { command: 'settings', description: '⚙️ Settings & status' },
    { command: 'cancel', description: '❌ Cancel & return to menu' },
  ]);

  logger.info('Starting web server (OAuth callback + health check)...');
  const app = createApp(bot);

  const useWebhook = process.env.NODE_ENV === 'production';

  if (useWebhook) {
    botMode = 'webhook';
    const webhookPath = '/telegram-webhook';
    app.use(bot.webhookCallback(webhookPath, { secretToken: config.TELEGRAM_WEBHOOK_SECRET }));
    httpServer = app.listen(config.PORT, async () => {
      logger.info('Server listening', { port: config.PORT });

      // Log how many updates were actually pending before discarding them —
      // turns "I think there's a backlog" into hard evidence in the logs.
      try {
        const info = await bot.telegram.getWebhookInfo();
        if (info.pending_update_count > 0) {
          logger.warn('Discarding pending update backlog on startup', { count: info.pending_update_count });
        }
      } catch (err) {
        logger.error('Could not check webhook backlog before clearing', { message: err.message });
      }

      // drop_pending_updates: without this, any updates that queued up on
      // Telegram's side while the bot was down all got delivered in a burst
      // the instant the webhook came back — each spinning up its own DB/
      // GitHub work roughly at once. Every boot now starts genuinely clean
      // instead of inheriting whatever piled up during any downtime.
      await bot.telegram.setWebhook(`${config.BASE_URL}${webhookPath}`, {
        secret_token: config.TELEGRAM_WEBHOOK_SECRET,
        drop_pending_updates: true,
      });
      logger.info('Telegram webhook set', { url: `${config.BASE_URL}${webhookPath}` });
    });
  } else {
    botMode = 'polling';
    httpServer = app.listen(config.PORT, () => {
      logger.info('Server listening (OAuth callback + health check)', { port: config.PORT });
    });
    await bot.launch({ dropPendingUpdates: true });
    logger.info('Bot running in polling mode (development)');
  }

  startMemoryWatchdog();

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { message: err.message, stack: err.stack });
  process.exit(1);
});
