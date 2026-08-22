const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const dataStore = require('../lib/dataStore');
const users = require('../lib/users');
const format = require('../lib/format');
const bbtb = require('../keyboards/bbtb');
const actionLock = require('../lib/actionLock');

async function showStorageData(ctx) {
  const counts = await dataStore.getCounts(ctx.from.id);

  const text =
    `📦 *Storage & Data*\n\n` +
    `📌 Pinned repos: ${counts.pinnedRepos}\n` +
    `🏷️ Tags: ${counts.tags}\n` +
    `📜 Activity log: ${counts.activityEntries} entries \\(${counts.activityDays} days\\)\n` +
    `🔐 Encrypted GitHub token: ${counts.hasToken ? '1' : '0'}`;

  const rows = [
    [style.callback('🗑 Clear Data', 'storage:clearmenu')],
    [style.callback('⬇️ Export My Data', 'storage:exportmenu')],
    [style.callback('🧹 Auto-Cleanup Settings', 'storage:cleanupmenu')],
  ];

  await ctx.reply('📦 Storage & Data', bbtb.backToSettings);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

async function showClearMenu(ctx) {
  await ctx.reply('🗑 What would you like to clear?', Markup.inlineKeyboard([
    [style.callback('📜 Activity Log', 'storage:clear:activity')],
    [style.callback('📌 Pins', 'storage:clear:pins')],
    [style.callback('⚙️ Defaults', 'storage:clear:defaults')],
    [style.callback('🗑 Everything (Full Reset)', 'storage:clear:full')],
    [style.callback('⬅️ Back', 'storage:back')],
  ]));
}

async function confirmClear(ctx, scope) {
  if (scope === 'full') {
    ctx.session.awaitingFullReset = true;
    await ctx.reply(
      '⚠️ *Full Reset* — this clears pins, tags, defaults, and activity history\\.\n' +
      'Your GitHub connection stays intact \\(use Disconnect separately for that\\)\\.\n\n' +
      'Type RESET to confirm, or ❌ Cancel\\.',
      { parse_mode: 'MarkdownV2', ...bbtb.cancelOnly }
    );
    return;
  }

  const labels = { activity: 'your Activity Log', pins: 'all Pinned repos', defaults: 'your saved Defaults' };
  await ctx.reply(
    `⚠️ Clear ${labels[scope]}? This cannot be undone.`,
    Markup.inlineKeyboard([
      [style.callback('✅ Yes, Clear', `storage:doclear:${scope}`, style.RED)],
      [style.callback('❌ Cancel', `storage:clearcancel:${scope}`, style.GREEN)],
    ])
  );
}

/** actionLock-protected — see lib/actionLock.js. Clear was previously the
 * only destructive Storage & Data action without double-tap protection. */
async function executeClear(ctx, scope) {
  const telegramId = ctx.from.id;
  const { skipped } = await actionLock.withLock(telegramId, 'storageClear', async () => {
    if (scope === 'activity') await dataStore.clearActivityLog(telegramId);
    if (scope === 'pins') await dataStore.clearPins(telegramId);
    if (scope === 'defaults') await dataStore.clearDefaults(telegramId);
  });
  if (skipped) return; // a duplicate tap while the first is still running — silently ignore

  await ctx.reply(format.successMessage(`Cleared ${scope}`));
  return showStorageData(ctx);
}

/** Called from the text router when ctx.session.awaitingFullReset is set */
async function handleResetConfirmationText(ctx) {
  const text = ctx.message.text.trim();
  delete ctx.session.awaitingFullReset;

  if (text === '❌ Cancel') {
    await ctx.reply('Cancelled — nothing was cleared.');
    return showStorageData(ctx);
  }
  if (text !== 'RESET') {
    await ctx.reply(format.errorMessage(
      'Reset not confirmed',
      `you typed "${text}", not "RESET"`,
      'Nothing was cleared. Try again from Storage & Data if you still want to reset.'
    ));
    return showStorageData(ctx);
  }

  await dataStore.fullReset(ctx.from.id);
  await ctx.reply('✅ Full reset complete — pins, tags, defaults, and activity history cleared.');
  return showStorageData(ctx);
}

async function showExportMenu(ctx) {
  await ctx.reply('⬇️ Export format?', Markup.inlineKeyboard([
    [style.callback('📄 JSON (raw data)', 'storage:export:json')],
    [style.callback('📋 Readable Summary (.txt)', 'storage:export:txt')],
  ]));
}

async function executeExport(ctx, format_) {
  const content = await dataStore.exportData(ctx.from.id, format_);
  const filename = format_ === 'json' ? 'gitrohub-export.json' : 'gitrohub-export.txt';
  await ctx.replyWithDocument({ source: Buffer.from(content, 'utf8'), filename });
}

async function showCleanupMenu(ctx, { edit = false } = {}) {
  const user = await users.getUser(ctx.from.id);
  const text =
    `🧹 *Auto\\-Cleanup*\n\n` +
    `Activity Log retention: ${user.activity_retention_days} days\n` +
    `🗑 Auto\\-delete pins/tags on repo deletion: ${user.auto_cleanup_on_delete ? 'On' : 'Off'}`;
  const keyboard = Markup.inlineKeyboard([
    [
      style.callback('30d', 'storage:retention:30'),
      style.callback('90d', 'storage:retention:90'),
      style.callback('1yr', 'storage:retention:365'),
      style.callback('Forever', 'storage:retention:36500'),
    ],
    [style.callback(user.auto_cleanup_on_delete ? '🗑 Turn Off Auto-Delete' : '🗑 Turn On Auto-Delete', 'storage:toggleautodelete')],
  ]);

  // #34 — retention/auto-delete are a multi-toggle screen you flip
  // repeatedly, same shape as Notifications, so it edits in place instead
  // of resending a fresh menu every tap.
  if (edit) {
    try {
      return await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', ...keyboard });
    } catch (_) { /* fall through to a fresh send */ }
  }
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...keyboard });
}

async function setRetention(ctx, days) {
  const { pool } = require('../db/postgres');
  await pool.query('UPDATE users SET activity_retention_days = $1 WHERE telegram_id = $2', [Number(days), ctx.from.id]);
  return showCleanupMenu(ctx, { edit: true });
}

async function toggleAutoDelete(ctx) {
  const { pool } = require('../db/postgres');
  const user = await users.getUser(ctx.from.id);
  await pool.query('UPDATE users SET auto_cleanup_on_delete = $1 WHERE telegram_id = $2', [!user.auto_cleanup_on_delete, ctx.from.id]);
  return showCleanupMenu(ctx, { edit: true });
}

module.exports = {
  showStorageData,
  showClearMenu,
  confirmClear,
  executeClear,
  handleResetConfirmationText,
  showExportMenu,
  executeExport,
  showCleanupMenu,
  setRetention,
  toggleAutoDelete,
};
