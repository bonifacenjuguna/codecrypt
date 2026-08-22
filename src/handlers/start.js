const users = require('../lib/users');
const repoCache = require('../lib/repoCache');
const oauth = require('../lib/oauth');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const config = require('../config');
const format = require('../lib/format');

/**
 * Shared "you need to connect" prompt — used by /start, requireConnected(),
 * Settings, Disconnect, and the "🔗 Connect GitHub" BBTB button, so every
 * entry point shows the exact same message and resets the BBTB to the
 * disconnected-state bar (per the "distinct disconnected flow" rule).
 *
 * `showVersion` is only true when called directly from /start — so you can
 * always confirm a deploy actually landed without checking Railway, without
 * cluttering every mid-flow "you need to connect" interruption with it too.
 */
async function sendConnectPrompt(ctx, { intro, showVersion = false } = {}) {
  const telegramId = ctx.from.id;
  const url = oauth.buildAuthorizeUrl(telegramId);
  const versionLine = showVersion ? `\n\n🔧 v${format.escapeMd(config.BOT_VERSION)}` : '';

  await ctx.reply('🔒 Not connected', bbtb.disconnected);
  await ctx.reply(
    (intro ||
      '👋 *Welcome to GitroHub*\n' +
      'Your GitHub, right inside Telegram\\.\n\n' +
      'Create, manage, upload, and download repositories\n' +
      '— all without leaving this chat\\.\n\n' +
      '🔒 Not connected yet\n' +
      'Link your GitHub account to get started\\.') + versionLine,
    { parse_mode: 'MarkdownV2', ...inline.connectButton(url) }
  );
}

async function handleStart(ctx) {
  const telegramId = ctx.from.id;
  const connected = await users.isConnected(telegramId);

  if (!connected) {
    return sendConnectPrompt(ctx, { showVersion: true });
  }

  const user = await users.getUser(telegramId);

  // Everything below the header is a nice-to-have, not essential — raced
  // against a short timeout so /start can never hang waiting on GitHub or
  // the DB, regardless of what's happening elsewhere.
  let statsBlock = '';
  try {
    const token = await users.getDecryptedToken(telegramId);
    const pins = require('../lib/pins');
    const activity = require('../lib/activity');

    const [repos, pinList, recentActivity] = await Promise.race([
      Promise.all([
        repoCache.getRepos(ctx.from.id, token),
        pins.list(telegramId),
        activity.recent(telegramId, { limit: 1 }),
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);

    const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
    const privateCount = repos.filter((r) => r.private).length;
    const publicCount = repos.length - privateCount;
    const lastActivityLine = recentActivity.rows[0]
      ? `▸ 🕒 Last activity: ${format.relativeTime(recentActivity.rows[0].created_at)}\n`
      : '';

    statsBlock =
      `▸ 📁 ${repos.length} repos · ⭐ ${totalStars} stars · 📌 ${pinList.length} pinned\n` +
      `▸ 🔒 ${privateCount} private · 🌐 ${publicCount} public\n` +
      lastActivityLine;
  } catch (_) {
    // best-effort — welcome message still shows without the stats block
  }

  await ctx.reply(
    `◆ WELCOME BACK\n` +
    `@${user.github_username}\n\n` +
    `▸ 🟢 GitHub connected\n` +
    statsBlock +
    `\nTap a button below to get started.\n` +
    `🔧 v${config.BOT_VERSION}`,
    bbtb.mainMenu
  );
}

module.exports = { handleStart, sendConnectPrompt };
