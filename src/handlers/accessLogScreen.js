const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const accessLog = require('../lib/accessLog');
const users = require('../lib/users');
const format = require('../lib/format');
const bbtb = require('../keyboards/bbtb');

const EVENT_ICON = { connected: '🟢', reconnected: '🟢', disconnected: '🔴' };
const EVENT_LABEL = { connected: 'Connected', reconnected: 'Reconnected (scope updated)', disconnected: 'Disconnected' };

async function showAccessLog(ctx, { fromActivity = false } = {}) {
  const [events, user] = await Promise.all([
    accessLog.recent(ctx.from.id, 10),
    users.getUser(ctx.from.id),
  ]);

  let text = `🔑 *Access Log*\n\nYour last ${events.length} authenticated GitHub sessions:\n\n`;
  if (events.length === 0) {
    text += 'No connection events recorded yet\\.';
  } else {
    text += events
      .map((e) => `${EVENT_ICON[e.event] || '⚪'} ${format.escapeMd(format.relativeTime(e.created_at))} — ${format.escapeMd(EVENT_LABEL[e.event] || e.event)}`)
      .join('\n');
  }

  const alertOn = user ? user.alert_on_new_connection : true;
  // Relocated here from its own Settings BBTB row (#47) — reachable from
  // inside Activity now, so "back" goes to Activity, not Settings.
  if (!fromActivity) await ctx.reply('🔑 Access Log', bbtb.backToSettings);
  await ctx.reply(text, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([
      [style.callback(
        alertOn ? '🔔 Turn Off New-Connection Alerts' : '🔕 Turn On New-Connection Alerts',
        'accesslog:togglealert'
      )],
      ...(fromActivity ? [[style.callback('⬅️ Back to Activity', 'accesslog:backtoactivity', style.BLUE)]] : []),
    ]),
  });
}

async function toggleAlert(ctx, fromActivity = false) {
  const { pool } = require('../db/postgres');
  const user = await users.getUser(ctx.from.id);
  await pool.query('UPDATE users SET alert_on_new_connection = $1 WHERE telegram_id = $2', [!user.alert_on_new_connection, ctx.from.id]);
  return showAccessLog(ctx, { fromActivity });
}

module.exports = { showAccessLog, toggleAlert };
