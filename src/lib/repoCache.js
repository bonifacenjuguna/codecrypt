const github = require('./github');

/**
 * Short-lived in-process caches, all per-Telegram-user. GitroHub re-fetches
 * the full repo list (and a separate language call per visible repo) on
 * nearly every screen — My Repos, Pinned, Bulk Select, Search all hit this
 * independently, often within seconds of each other for information that
 * hasn't changed. These caches cut that down without needing a "did
 * anything change" check — a 60s TTL is short enough that staleness is
 * never noticeable, and every write path explicitly invalidates anyway.
 */

const REPO_LIST_TTL_MS = 60 * 1000;
const LANGUAGE_TTL_MS = 60 * 1000;
const TREE_STATS_TTL_MS = 60 * 1000;
const USERNAME_TTL_MS = 10 * 60 * 1000; // username essentially never changes mid-session

const repoListCache = new Map(); // telegramId -> { repos, timestamp }
const languageCache = new Map(); // `${telegramId}:${repoName}` -> { languages, timestamp }
const treeStatsCache = new Map(); // `${telegramId}:${repoName}` -> { stats, timestamp }
const usernameCache = new Map(); // telegramId -> { user, timestamp }

async function getRepos(telegramId, token) {
  const cached = repoListCache.get(telegramId);
  if (cached && Date.now() - cached.timestamp < REPO_LIST_TTL_MS) {
    return cached.repos;
  }
  const repos = await github.listRepos(token);
  repoListCache.set(telegramId, { repos, timestamp: Date.now() });
  return repos;
}

async function getLanguages(telegramId, owner, repoName, token) {
  const key = `${telegramId}:${repoName}`;
  const cached = languageCache.get(key);
  if (cached && Date.now() - cached.timestamp < LANGUAGE_TTL_MS) {
    return cached.languages;
  }
  const languages = await github.getLanguages(token, owner, repoName);
  languageCache.set(key, { languages, timestamp: Date.now() });
  return languages;
}

/** Repo size/file/folder counts, computed from the real file tree (see
 * github.getTreeStats) instead of GitHub's lagging cached `repo.size`. */
async function getTreeStats(telegramId, owner, repoName, token) {
  const key = `${telegramId}:${repoName}`;
  const cached = treeStatsCache.get(key);
  if (cached && Date.now() - cached.timestamp < TREE_STATS_TTL_MS) {
    return cached.stats;
  }
  const stats = await github.getTreeStats(token, owner, repoName);
  treeStatsCache.set(key, { stats, timestamp: Date.now() });
  return stats;
}

async function getUser(telegramId, token) {
  const cached = usernameCache.get(telegramId);
  if (cached && Date.now() - cached.timestamp < USERNAME_TTL_MS) {
    return cached.user;
  }
  const user = await github.getAuthenticatedUser(token);
  usernameCache.set(telegramId, { user, timestamp: Date.now() });
  return user;
}

/** Call after ANY write (create/delete/rename/upload/visibility/bulk actions)
 * so the next read reflects reality instead of serving stale cached data. */
function invalidateRepos(telegramId) {
  repoListCache.delete(telegramId);
}

function invalidateLanguages(telegramId, repoName) {
  languageCache.delete(`${telegramId}:${repoName}`);
}

/** Call after anything that changes a repo's file tree (upload, replace,
 * commit, delete) so Repo View's size/file/folder counts aren't stale. */
function invalidateTreeStats(telegramId, repoName) {
  treeStatsCache.delete(`${telegramId}:${repoName}`);
}

/** Called on disconnect — the cached username would otherwise be wrong for whoever connects next. */
function invalidateUser(telegramId) {
  usernameCache.delete(telegramId);
  repoListCache.delete(telegramId);
  for (const key of languageCache.keys()) {
    if (key.startsWith(`${telegramId}:`)) languageCache.delete(key);
  }
  for (const key of treeStatsCache.keys()) {
    if (key.startsWith(`${telegramId}:`)) treeStatsCache.delete(key);
  }
}

module.exports = {
  getRepos,
  getLanguages,
  getTreeStats,
  getUser,
  invalidateRepos,
  invalidateLanguages,
  invalidateTreeStats,
  invalidateUser,
};
