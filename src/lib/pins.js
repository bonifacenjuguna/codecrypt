const { pool } = require('../db/postgres');

async function list(telegramId) {
  const { rows } = await pool.query(
    'SELECT repo_name, position FROM pinned_repos WHERE telegram_id = $1 ORDER BY position ASC',
    [telegramId]
  );
  return rows;
}

async function isPinned(telegramId, repoName) {
  const { rows } = await pool.query(
    'SELECT 1 FROM pinned_repos WHERE telegram_id = $1 AND repo_name = $2',
    [telegramId, repoName]
  );
  return rows.length > 0;
}

async function pin(telegramId, repoName) {
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM pinned_repos WHERE telegram_id = $1',
    [telegramId]
  );
  await pool.query(
    `INSERT INTO pinned_repos (telegram_id, repo_name, position)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id, repo_name) DO NOTHING`,
    [telegramId, repoName, rows[0].next]
  );
}

async function unpin(telegramId, repoName) {
  await pool.query('DELETE FROM pinned_repos WHERE telegram_id = $1 AND repo_name = $2', [telegramId, repoName]);
}

/** Swaps the position of a pin with its immediate neighbor (up = -1, down = +1) */
async function move(telegramId, repoName, direction) {
  const pins = await list(telegramId);
  const idx = pins.findIndex((p) => p.repo_name === repoName);
  const swapIdx = idx + direction;
  if (idx === -1 || swapIdx < 0 || swapIdx >= pins.length) return; // no-op at either end

  const a = pins[idx];
  const b = pins[swapIdx];
  await pool.query('UPDATE pinned_repos SET position = $1 WHERE telegram_id = $2 AND repo_name = $3', [b.position, telegramId, a.repo_name]);
  await pool.query('UPDATE pinned_repos SET position = $1 WHERE telegram_id = $2 AND repo_name = $3', [a.position, telegramId, b.repo_name]);
}

async function clearAll(telegramId) {
  await pool.query('DELETE FROM pinned_repos WHERE telegram_id = $1', [telegramId]);
}

async function removeByRepoName(telegramId, repoName) {
  await unpin(telegramId, repoName);
}

module.exports = { list, isPinned, pin, unpin, move, clearAll, removeByRepoName };
