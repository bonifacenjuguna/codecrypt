const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const oauth = require('../lib/oauth');
const github = require('../lib/github');
const users = require('../lib/users');
const activity = require('../lib/activity');
const logger = require('../lib/logger');

const PAGE_TEMPLATE = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'callback.html'), 'utf8');

const SUCCESS_STEPS = [
  'Verifying request',
  'Exchanging authorization code',
  'Encrypting access token',
  'Saving to secure storage',
  'Linking Telegram session',
];

function renderPage(data) {
  const inject = `<script>window.__GITROHUB__ = ${JSON.stringify(data)};</script>`;
  return PAGE_TEMPLATE.replace('</head>', `${inject}</head>`);
}

// Health check ping cache — avoids re-pinging both DBs on every single
// poll if Railway (or any external monitor) checks frequently.
const HEALTH_CACHE_TTL_MS = 5000;
let healthCache = null;

async function getHealthStatus() {
  if (healthCache && Date.now() - healthCache.timestamp < HEALTH_CACHE_TTL_MS) {
    return healthCache.result;
  }
  const pgDb = require('../db/postgres');
  const redisDb = require('../db/redis');
  const [pgStatus, redisStatus] = await Promise.all([pgDb.ping(), redisDb.ping()]);
  const result = { pgStatus, redisStatus };
  healthCache = { result, timestamp: Date.now() };
  return result;
}

function createApp(bot) {
  const app = express();
  // Bug fix: express.static() expects a DIRECTORY to serve from, not a
  // single file path — the old `express.static(path/to/logo.png)` mounted
  // at '/logo.png' never actually resolved correctly, which is why the
  // callback page's logo silently failed to load. Serving the whole
  // public/ directory at root is the standard, correct pattern — also
  // future-proofs any other static assets added to public/ later.
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));

  app.get('/', (req, res) => {
    res.send('GitroHub is running. This endpoint has nothing to show you directly — open the bot on Telegram.');
  });

  // Railway can poll this to detect a degraded instance and restart it
  // proactively, rather than only reacting after a hard OOM kill.
  app.get('/health', async (req, res) => {
    const { pgStatus, redisStatus } = await getHealthStatus();
    const mem = process.memoryUsage();
    const healthy = pgStatus.ok && redisStatus.ok;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      postgres: pgStatus.ok,
      redis: redisStatus.ok,
      memoryMB: Math.round(mem.rss / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get('/callback', async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    const botDeepLink = 'https://t.me/GitroHubBot';

    // GitHub itself reported denial/cancellation
    if (oauthError) {
      return res.send(renderPage({
        status: 'error',
        steps: ['Verifying request'],
        failStepIndex: 0,
        error: 'Authorization cancelled: you didn\u2019t approve access on GitHub, or closed the page before finishing.',
        botDeepLink,
      }));
    }

    let telegramId;
    try {
      telegramId = oauth.verifyState(state);
    } catch (err) {
      return res.send(renderPage({
        status: 'error',
        steps: ['Verifying request'],
        failStepIndex: 0,
        error: 'The authorization link was invalid or expired. This can happen if you waited too long or reused an old link.',
        botDeepLink,
      }));
    }

    try {
      const tokenData = await oauth.exchangeCodeForToken(code);
      const repoCache = require('../lib/repoCache');
      const ghUser = await repoCache.getUser(telegramId, tokenData.access_token);

      const existingUser = await users.getUser(telegramId);
      const isReconnect = !!(existingUser && existingUser.connected_at);

      await users.saveConnection(telegramId, {
        accessToken: tokenData.access_token,
        scope: tokenData.scope,
        githubUsername: ghUser.login,
      });

      await activity.log(telegramId, '🔗', `Connected GitHub account (@${ghUser.login})`, {});

      const accessLog = require('../lib/accessLog');
      await accessLog.record(telegramId, isReconnect ? 'reconnected' : 'connected', `scope: ${tokenData.scope}`);

      // Proactively push the confirmation into the chat (per design: bot pushes
      // this automatically, no need for the user to tap anything back in Telegram)
      const { escapeMd } = require('../lib/format');
      const bbtb = require('../keyboards/bbtb');
      const updatedUser = await users.getUser(telegramId);
      const alertLine = updatedUser.alert_on_new_connection
        ? '\n\n🔐 New session started — logged in 🔑 Access Log (Settings).'
        : '';
      await bot.telegram.sendMessage(
        telegramId,
        `✅ *GitHub Connected*\nLinked as: ${escapeMd(ghUser.login)}\nScope: repo, delete\\_repo \\(full control, including delete\\)${escapeMd(alertLine)}`,
        { parse_mode: 'MarkdownV2', reply_markup: bbtb.mainMenu.reply_markup }
      );

      return res.send(renderPage({
        status: 'success',
        steps: SUCCESS_STEPS,
        username: ghUser.login,
        botDeepLink,
      }));
    } catch (err) {
      logger.error('OAuth callback error', { message: err.message });
      await activity.log(telegramId, '⚠️', 'GitHub connection failed', { detail: err.message, isError: true }).catch(() => {});

      return res.send(renderPage({
        status: 'error',
        steps: SUCCESS_STEPS.slice(0, 2),
        failStepIndex: 1,
        error: `Couldn\u2019t complete the token exchange with GitHub: ${err.message}. This is usually temporary.`,
        botDeepLink,
      }));
    }
  });

  // Catch-all for anything unexpected in a route that wasn't already
  // handled by its own try/catch — fails clean with a generic 500 instead
  // of an unpredictable Express default error page or a hung response.
  app.use((err, req, res, next) => {
    logger.error('Unhandled Express error', { path: req.path, message: err.message });
    if (res.headersSent) return next(err);
    res.status(500).send('Something went wrong. Please try again.');
  });

  return app;
}

module.exports = createApp;
