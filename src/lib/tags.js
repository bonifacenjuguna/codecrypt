const { pool } = require('../db/postgres');

async function listTags(telegramId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.emoji, COUNT(rt.id)::int AS repo_count
     FROM tags t
     LEFT JOIN repo_tags rt ON rt.tag_id = t.id AND rt.telegram_id = t.telegram_id
     WHERE t.telegram_id = $1
     GROUP BY t.id
     ORDER BY t.name ASC`,
    [telegramId]
  );
  return rows;
}

async function createTag(telegramId, name, emoji) {
  const { rows } = await pool.query(
    `INSERT INTO tags (telegram_id, name, emoji) VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id, name) DO UPDATE SET emoji = $3
     RETURNING id, name, emoji`,
    [telegramId, name.trim(), emoji]
  );
  return rows[0];
}

async function deleteTag(telegramId, tagId) {
  await pool.query('DELETE FROM tags WHERE telegram_id = $1 AND id = $2', [telegramId, tagId]);
}

async function tagsForRepo(telegramId, repoName) {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.emoji FROM repo_tags rt
     JOIN tags t ON t.id = rt.tag_id
     WHERE rt.telegram_id = $1 AND rt.repo_name = $2
     ORDER BY t.name ASC`,
    [telegramId, repoName]
  );
  return rows;
}

async function assignTag(telegramId, repoName, tagId) {
  await pool.query(
    `INSERT INTO repo_tags (telegram_id, repo_name, tag_id) VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id, repo_name, tag_id) DO NOTHING`,
    [telegramId, repoName, tagId]
  );
}

async function removeTagFromRepo(telegramId, repoName, tagId) {
  await pool.query(
    'DELETE FROM repo_tags WHERE telegram_id = $1 AND repo_name = $2 AND tag_id = $3',
    [telegramId, repoName, tagId]
  );
}

async function reposWithTag(telegramId, tagId) {
  const { rows } = await pool.query(
    'SELECT repo_name FROM repo_tags WHERE telegram_id = $1 AND tag_id = $2',
    [telegramId, tagId]
  );
  return rows.map((r) => r.repo_name);
}

/** Bulk fetch: { repoName: [{id,name,emoji}, ...] } for a set of repos in one query */
async function tagsForRepos(telegramId, repoNames) {
  if (repoNames.length === 0) return {};
  const { rows } = await pool.query(
    `SELECT rt.repo_name, t.id, t.name, t.emoji FROM repo_tags rt
     JOIN tags t ON t.id = rt.tag_id
     WHERE rt.telegram_id = $1 AND rt.repo_name = ANY($2::text[])`,
    [telegramId, repoNames]
  );
  const map = {};
  for (const row of rows) {
    if (!map[row.repo_name]) map[row.repo_name] = [];
    map[row.repo_name].push({ id: row.id, name: row.name, emoji: row.emoji });
  }
  return map;
}

/** Cleanup hook for Storage & Data's auto-cleanup-on-delete setting */
async function removeAllForRepo(telegramId, repoName) {
  await pool.query('DELETE FROM repo_tags WHERE telegram_id = $1 AND repo_name = $2', [telegramId, repoName]);
}

module.exports = {
  listTags,
  createTag,
  deleteTag,
  tagsForRepo,
  assignTag,
  removeTagFromRepo,
  reposWithTag,
  tagsForRepos,
  removeAllForRepo,
};
