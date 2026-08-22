const { pool } = require('../db/postgres');
const { encrypt, decrypt } = require('./crypto');

async function getUser(telegramId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  return rows[0] || null;
}

async function isConnected(telegramId) {
  const user = await getUser(telegramId);
  return !!(user && user.github_token_enc && !user.disconnected_at);
}

async function getDecryptedToken(telegramId) {
  const user = await getUser(telegramId);
  if (!user || !user.github_token_enc) return null;
  return decrypt(user.github_token_enc);
}

/** Called by the OAuth /callback route once the token exchange succeeds */
async function saveConnection(telegramId, { accessToken, scope, githubUsername }) {
  const encToken = encrypt(accessToken);
  await pool.query(
    `INSERT INTO users (telegram_id, github_username, github_token_enc, github_scope, connected_at, disconnected_at)
     VALUES ($1, $2, $3, $4, now(), NULL)
     ON CONFLICT (telegram_id) DO UPDATE
       SET github_username = $2,
           github_token_enc = $3,
           github_scope = $4,
           connected_at = now(),
           disconnected_at = NULL`,
    [telegramId, githubUsername, encToken, scope]
  );
}

async function disconnect(telegramId) {
  await pool.query(
    `UPDATE users SET github_token_enc = NULL, disconnected_at = now() WHERE telegram_id = $1`,
    [telegramId]
  );
}

async function getNotificationPrefs(telegramId) {
  const user = await getUser(telegramId);
  if (!user) return null;
  return {
    githubActivity: user.notif_github_activity,
    systemAlerts: user.notif_system_alerts,
    longOps: user.notif_long_ops,
    tokenHealth: user.notif_token_health,
  };
}

async function toggleNotification(telegramId, key) {
  const columnMap = {
    githubActivity: 'notif_github_activity',
    systemAlerts: 'notif_system_alerts',
    longOps: 'notif_long_ops',
    tokenHealth: 'notif_token_health',
  };
  const column = columnMap[key];
  if (!column) throw new Error(`Unknown notification key: ${key}`);
  await pool.query(
    `UPDATE users SET ${column} = NOT ${column} WHERE telegram_id = $1`,
    [telegramId]
  );
  const user = await getUser(telegramId);
  return user[column];
}

module.exports = {
  getUser,
  isConnected,
  getDecryptedToken,
  saveConnection,
  disconnect,
  getNotificationPrefs,
  toggleNotification,
};
