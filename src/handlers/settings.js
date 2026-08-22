const os = require('os');
const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const github = require('../lib/github');
const users = require('../lib/users');
const format = require('../lib/format');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const pgDb = require('../db/postgres');
const redisDb = require('../db/redis');
const config = require('../config');
const activity = require('../lib/activity');

const startTime = Date.now();

function formatUptime(ms) {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

async function showSettings(ctx, { skipBbtb = false } = {}) {
  const telegramId = ctx.from.id;
  const user = await users.getUser(telegramId);
  const connected = !!(user && user.github_token_enc);

  const [pgStatus, redisStatus] = await Promise.all([pgDb.ping(), redisDb.ping()]);

  let rateLimitLine = 'Not connected — connect GitHub to see live usage';
  if (connected) {
    try {
      const token = await users.getDecryptedToken(telegramId);
      const rl = await github.getRateLimit(token);
      const resetMins = Math.max(0, Math.round((rl.reset * 1000 - Date.now()) / 60000));
      rateLimitLine = `${rl.remaining} / ${rl.limit} remaining \\(resets in ${resetMins}m\\)`;
    } catch (_) {
      rateLimitLine = 'Unable to fetch';
    }
  }

  const mem = process.memoryUsage();
  const memLine = `${Math.round(mem.rss / 1024 / 1024)}MB / ${Math.round(os.totalmem() / 1024 / 1024)}MB`;

  const dbLine = (s) => (s.ok ? `🟢 Connected \\(${s.ms}ms\\)` : `🔴 Unreachable \\(${format.escapeMd(s.error || 'timeout')}\\)`);
  const scopeLine = connected ? format.escapeMd((user.github_scope || 'repo').split(',').join(', ')) : '—';

  const text =
    `⚙️ *Settings & System Status*\n\n` +
    `👤 *ACCOUNT*\n` +
    `├ GitHub: ${connected ? format.escapeMd(user.github_username) : 'Not connected'}\n` +
    `├ Scope: ${scopeLine}\n` +
    `└ Linked since: ${connected ? format.escapeMd(format.relativeTime(user.connected_at)) : '—'}\n\n` +
    `📡 *GITHUB API*\n` +
    `└ Rate limit: ${rateLimitLine}\n\n` +
    `🗄️ *DATABASE*\n` +
    `├ PostgreSQL: ${dbLine(pgStatus)}\n` +
    `└ Redis: ${dbLine(redisStatus)}\n\n` +
    `🖥️ *SYSTEM*\n` +
    `├ Uptime: ${format.escapeMd(formatUptime(Date.now() - startTime))}\n` +
    `├ Host: Railway\n` +
    `├ Memory: ${format.escapeMd(memLine)}\n` +
    `└ Bot version: v${format.escapeMd(config.BOT_VERSION)}`;

  // System Alerts notification: push a distinct alert (not just an Activity
  // Log entry) when a DB is down and the person has this category on —
  // debounced to at most once per 10 minutes per DB. Checked BEFORE writing
  // this check's own log entries below, so the very first occurrence isn't
  // mistaken for "already alerted recently".
  await maybePushSystemAlert(telegramId, pgStatus, redisStatus, ctx);

  if (!pgStatus.ok) {
    await activity.log(telegramId, '⚠️', 'Postgres unreachable', { detail: pgStatus.error, isError: true }).catch(() => {});
  }
  if (!redisStatus.ok) {
    await activity.log(telegramId, '⚠️', 'Redis unreachable', { detail: redisStatus.error, isError: true }).catch(() => {});
  }

  // BBTB reply keyboard persists on screen once shown — only send the
  // marker message on first open, not on every chained refresh tap (#48),
  // or every refresh would needlessly resend it too (the exact clutter
  // this whole redesign pass was about avoiding elsewhere).
  if (!skipBbtb) await ctx.reply('⚙️ Settings', connected ? bbtb.settings : bbtb.disconnected);
  await ctx.reply(text, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([[style.callback('🔄 Refresh Status', 'settings:refresh')]]),
  });
}

async function maybePushSystemAlert(telegramId, pgStatus, redisStatus, ctx) {
  const down = [];
  if (!pgStatus.ok) down.push('PostgreSQL');
  if (!redisStatus.ok) down.push('Redis');
  if (down.length === 0) return;

  try {
    const prefs = await users.getNotificationPrefs(telegramId);
    if (!prefs || !prefs.systemAlerts) return;

    const { rows } = await activity.recent(telegramId, { limit: 5, errorsOnly: true });
    const recentlyAlerted = rows.some((r) =>
      down.some((name) => r.summary.includes(`${name} unreachable`)) &&
      Date.now() - new Date(r.created_at).getTime() < 10 * 60 * 1000
    );
    if (recentlyAlerted) return;

    await ctx.reply(`⚠️ System Alert: ${down.join(' and ')} ${down.length > 1 ? 'are' : 'is'} unreachable. Some features may fail until this recovers.`);
  } catch (_) { /* best-effort — never let alerting itself crash Settings */ }
}

async function askDisconnect(ctx) {
  const connected = await users.isConnected(ctx.from.id);
  if (!connected) return; // defensive — BBTB shouldn't offer this while disconnected anyway

  await ctx.reply(
    `⚠️ Disconnect GitHub account\\?\n\n` +
    `This will:\n` +
    `• Remove your stored access token from GitroHub\n` +
    `• Require reconnecting before using any repo features again\n` +
    `• NOT affect anything on GitHub itself \\(no repos deleted\\)`,
    { parse_mode: 'MarkdownV2', ...inline.disconnectConfirm() }
  );
}

async function executeDisconnect(ctx) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'disconnect', () => _executeDisconnect(ctx));
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function _executeDisconnect(ctx) {
  await users.disconnect(ctx.from.id);
  const repoCache = require('../lib/repoCache');
  repoCache.invalidateUser(ctx.from.id);
  await activity.log(ctx.from.id, '🚪', 'Disconnected GitHub account');
  const accessLog = require('../lib/accessLog');
  await accessLog.record(ctx.from.id, 'disconnected');

  const { sendConnectPrompt } = require('./start');
  await sendConnectPrompt(ctx, {
    intro: '✅ Disconnected\\. Your GitHub account is no longer linked\\.',
  });
}

async function showNotifications(ctx) {
  const connected = await users.isConnected(ctx.from.id);
  if (!connected) return;

  const prefs = await users.getNotificationPrefs(ctx.from.id);
  await ctx.reply(
    `🔔 *Notifications*\n\nChoose what GitroHub should alert you about:`,
    { parse_mode: 'MarkdownV2', ...inline.notificationsMenu(prefs) }
  );
}

async function toggleNotification(ctx, key) {
  await users.toggleNotification(ctx.from.id, key);
  const prefs = await users.getNotificationPrefs(ctx.from.id);
  await ctx.editMessageReplyMarkup(inline.notificationsMenu(prefs).reply_markup);
}

module.exports = { showSettings, askDisconnect, executeDisconnect, showNotifications, toggleNotification };
