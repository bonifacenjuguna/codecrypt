const { pool } = require('../db/postgres');
const users = require('./users');
const pins = require('./pins');
const tags = require('./tags');
const activity = require('./activity');

async function getCounts(telegramId) {
  const [pinCount, tagCount, activityStats, user] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS c FROM pinned_repos WHERE telegram_id = $1', [telegramId]),
    pool.query('SELECT COUNT(*)::int AS c FROM tags WHERE telegram_id = $1', [telegramId]),
    pool.query(
      `SELECT COUNT(*)::int AS c, MIN(created_at) AS oldest FROM activity_log WHERE telegram_id = $1`,
      [telegramId]
    ),
    users.getUser(telegramId),
  ]);

  const oldest = activityStats.rows[0].oldest;
  const days = oldest ? Math.ceil((Date.now() - new Date(oldest).getTime()) / 86400000) : 0;

  return {
    pinnedRepos: pinCount.rows[0].c,
    tags: tagCount.rows[0].c,
    activityEntries: activityStats.rows[0].c,
    activityDays: days,
    hasToken: !!(user && user.github_token_enc),
  };
}

async function clearActivityLog(telegramId) {
  await pool.query('DELETE FROM activity_log WHERE telegram_id = $1', [telegramId]);
}

async function clearPins(telegramId) {
  await pins.clearAll(telegramId);
}

async function clearDefaults(telegramId) {
  await pool.query(
    `UPDATE users SET
       default_visibility = 'private',
       default_commit_message = 'Update via GitroHub',
       default_upload_path = '',
       default_sort = 'updated',
       default_filter = 'all'
     WHERE telegram_id = $1`,
    [telegramId]
  );
}

/** Full reset: pins, tags, defaults, activity, path memory — NOT the GitHub connection itself */
async function fullReset(telegramId) {
  await Promise.all([
    pool.query('DELETE FROM pinned_repos WHERE telegram_id = $1', [telegramId]),
    pool.query('DELETE FROM tags WHERE telegram_id = $1', [telegramId]), // cascades repo_tags
    pool.query('DELETE FROM activity_log WHERE telegram_id = $1', [telegramId]),
    pool.query('DELETE FROM repo_path_memory WHERE telegram_id = $1', [telegramId]),
    clearDefaults(telegramId),
  ]);
}

/** Prunes activity_log entries older than the user's configured retention window */
async function pruneOldActivity(telegramId) {
  const user = await users.getUser(telegramId);
  if (!user) return;
  await pool.query(
    `DELETE FROM activity_log WHERE telegram_id = $1 AND created_at < now() - ($2 || ' days')::interval`,
    [telegramId, user.activity_retention_days]
  );
}

async function exportData(telegramId, format) {
  const [user, pinList, tagList, activityRows] = await Promise.all([
    users.getUser(telegramId),
    pins.list(telegramId),
    tags.listTags(telegramId),
    activity.recent(telegramId, { limit: 500 }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    account: {
      githubUsername: user ? user.github_username : null,
      connectedSince: user ? user.connected_at : null,
    },
    pinnedRepos: pinList.map((p) => p.repo_name),
    tags: tagList.map((t) => ({ name: t.name, emoji: t.emoji, repoCount: t.repo_count })),
    defaults: user
      ? {
          visibility: user.default_visibility,
          commitMessage: user.default_commit_message,
          uploadPath: user.default_upload_path,
          sort: user.default_sort,
          filter: user.default_filter,
        }
      : null,
    activityLog: activityRows.rows.map((r) => ({
      time: r.created_at,
      icon: r.icon,
      summary: r.summary,
      isError: r.is_error,
    })),
  };

  if (format === 'json') {
    return JSON.stringify(payload, null, 2);
  }

  // Readable .txt summary
  let text = `GitroHub — Your Data Export\nGenerated: ${payload.exportedAt}\n\n`;
  text += `ACCOUNT\nGitHub: ${payload.account.githubUsername || 'Not connected'}\nConnected since: ${payload.account.connectedSince || '—'}\n\n`;
  text += `PINNED REPOS (${payload.pinnedRepos.length})\n${payload.pinnedRepos.join(', ') || 'None'}\n\n`;
  text += `TAGS (${payload.tags.length})\n${payload.tags.map((t) => `${t.emoji} ${t.name} (${t.repoCount} repos)`).join('\n') || 'None'}\n\n`;
  text += `DEFAULTS\n${payload.defaults ? Object.entries(payload.defaults).map(([k, v]) => `${k}: ${v}`).join('\n') : 'None'}\n\n`;
  text += `ACTIVITY LOG (${payload.activityLog.length} entries)\n`;
  text += payload.activityLog.map((e) => `[${e.time}] ${e.icon} ${e.summary}`).join('\n');

  return text;
}

module.exports = { getCounts, clearActivityLog, clearPins, clearDefaults, fullReset, pruneOldActivity, exportData };
