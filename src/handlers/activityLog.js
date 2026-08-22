const activity = require('../lib/activity');
const format = require('../lib/format');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const config = require('../config');
const dataStore = require('../lib/dataStore');

async function showActivity(ctx, { page = 1, errorsOnly = false, edit = false, skipBbtb = false } = {}) {
  const telegramId = ctx.from.id;
  const limit = config.ACTIVITY_PER_PAGE;
  const offset = (page - 1) * limit;

  // Opportunistic cleanup: prunes anything past the user's configured
  // retention window (Storage & Data → Auto-Cleanup) whenever this screen
  // loads — cheap single DELETE query, no separate scheduler needed.
  if (!edit) {
    await dataStore.pruneOldActivity(telegramId).catch(() => {});
  }

  const { rows, total } = await activity.recent(telegramId, { limit, offset, errorsOnly });
  const totalPages = Math.max(1, Math.ceil(total / limit));

  let text = errorsOnly ? '📜 *Activity — Errors Only*\n\n' : '📜 *Recent Activity*\n\n';

  if (rows.length === 0) {
    text += errorsOnly ? 'No errors recorded — everything\u2019s running clean\\.' : 'No activity yet\\.';
  } else {
    text += rows
      .map((r) => `🕐 ${format.escapeMd(format.relativeTime(r.created_at))}   ${r.icon} ${format.escapeMd(r.summary)}`)
      .join('\n');
    text += `\n\nShowing ${errorsOnly ? 'last' : 'last'} ${rows.length} of ${total} ${errorsOnly ? 'errors' : 'events'}`;
  }

  const keyboard = inline.activityPagination(page, totalPages, errorsOnly);

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', ...keyboard });
  } else {
    // BBTB marker only on first open — chained refresh taps (#49) pass
    // skipBbtb since the reply keyboard is already showing correctly and
    // resending it every tap would be exactly the clutter this pass fixed.
    if (!skipBbtb) await ctx.reply('📜 Activity', bbtb.activityLog);
    await ctx.reply(text, { parse_mode: 'MarkdownV2', ...keyboard });
  }
}

module.exports = { showActivity };
