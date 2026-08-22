const { pool } = require('../db/postgres');

/**
 * Records one line into the Activity Log (Settings -> 📜 Activity).
 * icon    e.g. '⬆️', '➕', '🗑', '⚠️', '🔒', '🍴'
 * summary e.g. "Uploaded 4 files → weather-app"
 * detail  optional longer text (full error message, stack, etc.)
 * isError marks it so it also shows under "⚠️ Errors Only" filter
 */
async function log(telegramId, icon, summary, { detail = null, isError = false } = {}) {
  await pool.query(
    `INSERT INTO activity_log (telegram_id, icon, summary, detail, is_error)
     VALUES ($1, $2, $3, $4, $5)`,
    [telegramId, icon, summary, detail, isError]
  );
}

async function recent(telegramId, { limit = 6, offset = 0, errorsOnly = false } = {}) {
  const where = errorsOnly ? 'AND is_error = TRUE' : '';
  const { rows } = await pool.query(
    `SELECT * FROM activity_log
     WHERE telegram_id = $1 ${where}
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [telegramId, limit, offset]
  );
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM activity_log WHERE telegram_id = $1 ${where}`,
    [telegramId]
  );
  return { rows, total: countRows[0].total };
}

module.exports = { log, recent };
