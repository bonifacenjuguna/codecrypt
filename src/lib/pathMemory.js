const { pool } = require('../db/postgres');

async function getLastPath(telegramId, repoName) {
  const { rows } = await pool.query(
    'SELECT last_path FROM repo_path_memory WHERE telegram_id = $1 AND repo_name = $2',
    [telegramId, repoName]
  );
  return rows[0] ? rows[0].last_path : null;
}

async function setLastPath(telegramId, repoName, path) {
  await pool.query(
    `INSERT INTO repo_path_memory (telegram_id, repo_name, last_path, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (telegram_id, repo_name) DO UPDATE SET last_path = $3, updated_at = now()`,
    [telegramId, repoName, path]
  );
}

async function removeForRepo(telegramId, repoName) {
  await pool.query('DELETE FROM repo_path_memory WHERE telegram_id = $1 AND repo_name = $2', [telegramId, repoName]);
}

module.exports = { getLastPath, setLastPath, removeForRepo };
