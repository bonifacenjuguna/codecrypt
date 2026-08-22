const { pool } = require('../db/postgres');

async function record(telegramId, event, detail = null) {
  await pool.query(
    'INSERT INTO access_log (telegram_id, event, detail) VALUES ($1, $2, $3)',
    [telegramId, event, detail]
  );
}

async function recent(telegramId, limit = 10) {
  const { rows } = await pool.query(
    'SELECT event, detail, created_at FROM access_log WHERE telegram_id = $1 ORDER BY created_at DESC LIMIT $2',
    [telegramId, limit]
  );
  return rows;
}

module.exports = { record, recent };
