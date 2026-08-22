const { Octokit } = require('@octokit/rest');

/**
 * Thin wrapper around Octokit implementing every GitHub operation GitroHub's
 * menus map to. One function per bot action, so handlers stay declarative
 * and error-shaping (per our "specific errors always" rule) happens in
 * exactly one place per operation.
 *
 * Clients are cached per token instead of constructed fresh on every call —
 * building a new Octokit instance isn't free (route methods, request
 * wrappers, hooks all get rebuilt), and doing it on every single API call
 * was adding real allocation churn under load. Capped at 3 entries as a
 * defensive bound (a single-owner bot only ever really has one token, but
 * this avoids unbounded growth across reconnects with different tokens).
 */
const clientCache = new Map();
function client(token) {
  if (clientCache.has(token)) return clientCache.get(token);
  const octo = new Octokit({ auth: token });
  clientCache.set(token, octo);
  if (clientCache.size > 3) {
    clientCache.delete(clientCache.keys().next().value);
  }
  return octo;
}

/**
 * True if the error looks like a genuine rate-limit rejection (403 with
 * the specific rate-limit headers/message GitHub uses), as opposed to a
 * permissions 403 — those need very different messages.
 */
function isRateLimitError(err) {
  return !!(err && err.status === 403 && /rate limit/i.test(err.message || ''));
}

/**
 * Retries ONE time, with a short delay, for transient failures only —
 * network blips and 5xx server errors. Deliberately only used on
 * idempotent READ operations below; wrapping writes (create/delete/put)
 * would risk double-executing a mutation if the first attempt actually
 * succeeded but the response was lost in transit.
 *
 * Also races every call against a hard timeout. This matters more than it
 * might look: incoming Telegram updates are now processed one at a time
 * (see bot.js), so a single GitHub call that hangs indefinitely would
 * block every subsequent interaction — including /start — behind it.
 * Bounding every call here is what makes that serialization safe.
 *
 * IMPORTANT (v0.8.4 hardening): earlier versions raced the request against
 * a timeout with Promise.race(), which only stops US from waiting — it
 * never actually cancelled the underlying HTTP request. A slow GitHub
 * response kept running in the background indefinitely, still holding a
 * socket and buffers, completely invisible to our own error handling —
 * and withRetry made this worse by firing a SECOND independent request on
 * top of a still-running first one. Every function below now uses a real
 * AbortController and passes `request: { signal }` into its Octokit
 * call(s), so a timeout genuinely tears down the in-flight request instead
 * of just giving up on waiting for it.
 */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Runs fn(signal) with a real, enforced timeout — fn must pass `signal`
 * into every Octokit call it makes via `request: { signal }`, or that
 * call won't actually be cancelled when the timeout fires (it'll just
 * become an orphaned background request again, same as before). The
 * timeout error message is kept in the exact same format as the old
 * Promise.race version so nothing reading `err.message` elsewhere breaks.
 */
async function withAbortTimeout(fn, label, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, label = 'GitHub API request') {
  try {
    return await withAbortTimeout(fn, label);
  } catch (err) {
    const transient = (err.status >= 500 && err.status < 600) || !err.status;
    if (!transient || isRateLimitError(err)) throw err; // rate limits shouldn't be retried immediately
    await new Promise((resolve) => setTimeout(resolve, 600));
    return withAbortTimeout(fn, `${label} (retry)`);
  }
}

async function getAuthenticatedUser(token) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.users.getAuthenticated({ request: { signal } });
    return data; // { login, avatar_url, ... }
  })(), 'Get authenticated user');
}

async function getRateLimit(token) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.rateLimit.get({ request: { signal } });
    return data.resources.core; // { limit, remaining, reset }
  })(), 'Get rate limit');
}

async function listRepos(token, { sort = 'updated', direction = 'desc' } = {}) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    return octo.paginate(octo.repos.listForAuthenticatedUser, {
      per_page: 100,
      sort,
      direction,
      request: { signal },
    });
  })(), 'List repos');
}

async function getRepo(token, owner, repo) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.get({ owner, repo, request: { signal } });
    return data;
  })(), 'Get repo');
}

async function createRepo(token, { name, isPrivate, description, licenseTemplate }) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.createForAuthenticatedUser({
      name,
      private: isPrivate,
      description: description || undefined,
      license_template: licenseTemplate || undefined,
      auto_init: true, // ensures a default branch + initial commit exist immediately
      request: { signal },
    });
    return data;
  })(), 'Create repo');
}

async function deleteRepo(token, owner, repo) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    await octo.repos.delete({ owner, repo, request: { signal } });
  })(), 'Delete repo');
}

async function renameRepo(token, owner, repo, newName) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.update({ owner, repo, name: newName, request: { signal } });
    return data;
  })(), 'Rename repo');
}

async function setVisibility(token, owner, repo, isPrivate) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.update({ owner, repo, private: isPrivate, request: { signal } });
    return data;
  })(), 'Change visibility');
}

async function updateDescription(token, owner, repo, description) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.update({ owner, repo, description: description || '', request: { signal } });
    return data;
  })(), 'Update description');
}

/** GitHub's Repos API has no "set license" field — a repo's detected
 * license comes from actually scanning a LICENSE file in the tree
 * (licensee). To change it, we fetch the real license body text from
 * GitHub's own /licenses/{key} endpoint and write/replace a LICENSE file —
 * same mechanism a person clicking "Add license" on github.com uses. */
async function getLicenseText(token, licenseKey) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.licenses.get({ license: licenseKey, request: { signal } });
    return data.body;
  })(), 'Fetch license text');
}

async function forkRepo(token, owner, repo) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.createFork({ owner, repo, request: { signal } });
    return data;
  })(), 'Fork repo');
}

/** Fetches the full recursive git tree, unfiltered (files + folders). Shared
 * by getTree() (files-only, for Browse Files/upload change-detection) and
 * getTreeStats() (size/file/folder counts, for Repo View). */
async function getRawTree(token, owner, repo, branch = null) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    const repoData = branch ? { default_branch: branch } : await getRepo(token, owner, repo);
    const { data: refData } = await octo.git.getRef({
      owner,
      repo,
      ref: `heads/${repoData.default_branch}`,
      request: { signal },
    });
    const { data } = await octo.git.getTree({
      owner,
      repo,
      tree_sha: refData.object.sha,
      recursive: 'true',
      request: { signal },
    });
    return data.tree;
  })(), 'Get file tree');
}

/** Full recursive file tree — used for both Browse Files and file search */
async function getTree(token, owner, repo, branch = null) {
  const tree = await getRawTree(token, owner, repo, branch);
  return tree.filter((entry) => entry.type === 'blob'); // files only
}

/**
 * Repo size/file/folder counts computed from the tree we already fetch —
 * GitHub's own `repo.size` field (KB) is a periodically-recomputed cache on
 * their end and visibly lags real changes (e.g. right after an upload), so
 * we derive the real numbers from the same tree data instead of trusting it.
 * Falls back to `null` sizeBytes for entries GitHub returns without a size
 * (only happens for very large blobs it declines to size inline) — those are
 * summed as 0 and callers should treat the total as a lower bound in that case.
 */
async function getTreeStats(token, owner, repo, branch = null) {
  const tree = await getRawTree(token, owner, repo, branch);
  let sizeBytes = 0;
  let fileCount = 0;
  let folderCount = 0;
  let sizeIncomplete = false;
  for (const entry of tree) {
    if (entry.type === 'blob') {
      fileCount++;
      if (typeof entry.size === 'number') sizeBytes += entry.size;
      else sizeIncomplete = true;
    } else if (entry.type === 'tree') {
      folderCount++;
    }
  }
  return { sizeBytes, fileCount, folderCount, sizeIncomplete };
}

async function getFileContent(token, owner, repo, path) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.getContent({ owner, repo, path, request: { signal } });
    if (Array.isArray(data)) throw new Error('Path is a directory, not a file');
    const content = Buffer.from(data.content, data.encoding).toString('utf8');
    return { content, sha: data.sha, size: data.size };
  })(), 'Get file content');
}

/**
 * Create or update a single file — one commit per call.
 * For multi-file zip uploads, use commitMultipleFiles() instead (one commit total).
 */
async function putFile(token, owner, repo, path, content, message, existingSha = null) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha: existingSha || undefined,
      request: { signal },
    });
    return data;
  })(), 'Update file');
}

async function deleteFile(token, owner, repo, path, sha, message) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.deleteFile({ owner, repo, path, message, sha, request: { signal } });
    return data;
  })(), 'Delete file');
}

/**
 * Commit multiple files (and optionally delete some) in ONE commit using the
 * Git Data API (blobs -> tree -> commit -> update ref). Deletions are done by
 * setting `sha: null` on that path's tree entry, which GitHub's Git Trees API
 * treats as "remove this path" when building on top of an existing base_tree.
 *
 * Given a large batch/zip can genuinely need several sequential API calls,
 * this gets a longer timeout window than the single-call operations above —
 * still bounded, just sized for what a real multi-file commit can take.
 * All calls (including the parallel blob creations) share ONE AbortController,
 * so if the 45s ceiling is hit, every still-in-flight request — not just the
 * one we happened to be awaiting — actually gets torn down together.
 */
async function commitMultipleFiles(token, owner, repo, files, message, deletions = []) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const repoData = await getRepo(token, owner, repo);
    const branch = repoData.default_branch;

    const { data: refData } = await octo.git.getRef({ owner, repo, ref: `heads/${branch}`, request: { signal } });
    const latestCommitSha = refData.object.sha;

    const { data: latestCommit } = await octo.git.getCommit({
      owner,
      repo,
      commit_sha: latestCommitSha,
      request: { signal },
    });
    const baseTreeSha = latestCommit.tree.sha;

    const blobs = await Promise.all(
      files.map(async (f) => {
        const { data: blob } = await octo.git.createBlob({
          owner,
          repo,
          content: Buffer.from(f.content).toString('base64'),
          encoding: 'base64',
          request: { signal },
        });
        return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
      })
    );

    const deletionEntries = deletions.map((path) => ({ path, mode: '100644', type: 'blob', sha: null }));

    const { data: newTree } = await octo.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: [...blobs, ...deletionEntries],
      request: { signal },
    });

    const { data: newCommit } = await octo.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.sha,
      parents: [latestCommitSha],
      request: { signal },
    });

    await octo.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha, request: { signal } });

    return newCommit;
  })(), 'Commit files', 45000);
}

/** Codeload zip URL — kept for reference/fallback links in error messages only */
function zipDownloadUrl(owner, repo, branch = 'main') {
  return `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
}

/**
 * Downloads a repo archive as a Buffer using the authenticated Git Archive API.
 * Unlike a plain fetch() against github.com/.../archive/...zip (which returns a
 * 9-byte "Not Found" for any private repo since it isn't authenticated), this
 * goes through Octokit with the user's token and works for private AND public repos.
 */
async function downloadZip(token, owner, repo, ref) {
  return withAbortTimeout((signal) => (async () => {
    const octo = client(token);
    const response = await octo.repos.downloadZipballArchive({ owner, repo, ref, request: { signal } });
    return Buffer.from(response.data);
  })(), 'Download zip');
}

/** Fetches per-language byte counts (used to compute language % breakdown) */
async function getLanguages(token, owner, repo) {
  return withRetry((signal) => (async () => {
    const octo = client(token);
    const { data } = await octo.repos.listLanguages({ owner, repo, request: { signal } });
    return data; // { JavaScript: 12345, HTML: 6789, ... } bytes per language
  })(), 'Get languages');
}

module.exports = {
  getAuthenticatedUser,
  getRateLimit,
  listRepos,
  getRepo,
  createRepo,
  deleteRepo,
  renameRepo,
  setVisibility,
  updateDescription,
  getLicenseText,
  forkRepo,
  getTree,
  getTreeStats,
  getFileContent,
  putFile,
  deleteFile,
  commitMultipleFiles,
  zipDownloadUrl,
  downloadZip,
  getLanguages,
  isRateLimitError,
};
