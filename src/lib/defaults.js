const { pool } = require('../db/postgres');

async function getDefaults(telegramId) {
  const { rows } = await pool.query(
    `SELECT default_visibility, default_commit_message, default_upload_path,
            default_sort, default_filter, auto_suggest_defaults
     FROM users WHERE telegram_id = $1`,
    [telegramId]
  );
  return rows[0] || null;
}

async function setDefault(telegramId, field, value) {
  const allowed = new Set([
    'default_visibility', 'default_commit_message', 'default_upload_path',
    'default_sort', 'default_filter', 'auto_suggest_defaults',
  ]);
  if (!allowed.has(field)) throw new Error(`Unknown default field: ${field}`);
  await pool.query(`UPDATE users SET ${field} = $1 WHERE telegram_id = $2`, [value, telegramId]);
}

/**
 * "Learn from me" check — looks at the last 3 activity_log entries recording
 * a repo-creation visibility choice and, if all 3 agree and disagree with
 * the current default, returns the suggested value. Returns null if there's
 * no clear pattern yet, or the pattern already matches the current default.
 */
async function checkVisibilityPattern(telegramId) {
  const { rows } = await pool.query(
    `SELECT detail FROM activity_log
     WHERE telegram_id = $1 AND icon = '➕' AND detail LIKE 'visibility:%'
     ORDER BY created_at DESC LIMIT 3`,
    [telegramId]
  );
  if (rows.length < 3) return null;

  const choices = rows.map((r) => r.detail.replace('visibility:', ''));
  const allSame = choices.every((c) => c === choices[0]);
  if (!allSame) return null;

  const defaults = await getDefaults(telegramId);
  if (!defaults || !defaults.auto_suggest_defaults) return null;
  if (defaults.default_visibility === choices[0]) return null; // already matches

  return choices[0]; // 'private' or 'public'
}

module.exports = { getDefaults, setDefault, checkVisibilityPattern };
