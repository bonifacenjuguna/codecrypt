const github = require('../lib/github');
const repoCache = require('../lib/repoCache');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const activity = require('../lib/activity');
const users = require('../lib/users');
const pins = require('../lib/pins');
const tags = require('../lib/tags');
const pathMemory = require('../lib/pathMemory');

/**
 * Storage & Data's "auto-delete on repo deletion" setting — when on (the
 * default), removes any pins/tags/path-memory GitroHub kept for a repo the
 * moment it's actually deleted from GitHub, so orphaned data doesn't pile up.
 */
async function cleanupOrphanedData(telegramId, repoName) {
  const user = await users.getUser(telegramId);
  if (!user || !user.auto_cleanup_on_delete) return;
  await Promise.all([
    pins.removeByRepoName(telegramId, repoName),
    tags.removeAllForRepo(telegramId, repoName),
    pathMemory.removeForRepo(telegramId, repoName),
  ]);
}

async function showRepoView(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  let repo;
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    repo = await github.getRepo(token, user.login, repoName);
  } catch (err) {
    return ctx.reply(format.errorMessage(
      `Couldn\u2019t open "${repoName}"`,
      err.status === 404 ? 'repository not found or was renamed' : err.message,
      'Go back and refresh your repo list.'
    ));
  }

  // Language % breakdown (all languages, not just the dominant one) and real
  // tree-derived size/file/folder counts — both best-effort, since an empty
  // repo has no tree/languages at all and shouldn't block the rest of the card.
  let langBreakdown = 'No language detected';
  try {
    const languages = await repoCache.getLanguages(ctx.from.id, repo.owner.login, repo.name, token);
    langBreakdown = format.languageBreakdown(languages);
  } catch (_) {
    langBreakdown = repo.language || 'No language detected';
  }

  let treeStats = null;
  try {
    treeStats = await repoCache.getTreeStats(ctx.from.id, repo.owner.login, repo.name, token);
  } catch (_) { /* empty/new repo — fall back to repo.size below */ }

  // #56 — language breakdown is also GitHub's own async background scan
  // (linguist), not synchronous with a commit. "No language detected" is
  // only genuinely correct for a truly empty repo (fileCount === 0) — if
  // the repo actually has files but the breakdown still came back empty,
  // that's the specific symptom of detection not having caught up yet
  // (right after Create Repo, Replace Folder, or a first Upload), not a
  // real absence of code. Caveat it instead of stating it as settled fact.
  const langLagNote = (langBreakdown === 'No language detected' && treeStats && treeStats.fileCount > 0)
    ? '\n_\\(GitHub may still be detecting this — check back in a minute if it should have one\\.\\)_'
    : '';

  const [pinned, repoTags] = await Promise.all([
    pins.isPinned(ctx.from.id, repo.name),
    tags.tagsForRepo(ctx.from.id, repo.name),
  ]);

  const tagLine = repoTags.length > 0
    ? `🏷️ ${format.escapeMd(repoTags.map((t) => `${t.emoji} ${t.name}`).join(' · '))}`
    : '';

  const card = format.repoCard(repo, {
    pinned,
    sizeBytes: treeStats ? treeStats.sizeBytes : undefined,
    tagLine,
  });

  const fileFolderLine = treeStats
    ? `▸ ${treeStats.fileCount} files · ${treeStats.folderCount} folders${treeStats.sizeIncomplete ? ' (size is a lower bound — some very large files weren\u2019t sized)' : ''}\n`
    : '';

  const text =
    `${card}\n\n` +
    `💻 *LANGUAGES*\n${format.escapeMd(langBreakdown)}${langLagNote}\n\n` +
    `📊 *DETAILS*\n` +
    fileFolderLine +
    `▸ Last commit: ${format.escapeMd(format.relativeTime(repo.pushed_at))}\n` +
    `▸ Created: ${format.escapeMd(format.relativeTime(repo.created_at))}`;

  ctx.session = ctx.session || {};
  ctx.session.currentRepo = repo.name;
  ctx.session.repoOwner = repo.owner.login;

  // Reply keyboard (BBTB) and inline keyboard can't share one message — send
  // the BBTB once via a tiny marker message, then the real content with only inline.
  await ctx.reply('📦 Repo View', bbtb.repoView);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...inline.repoActions(repo.name, pinned) });
}

async function showRepoDetails(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const user = await repoCache.getUser(ctx.from.id, token);
  const repo = await github.getRepo(token, user.login, repoName);
  let treeStats = null;
  try {
    treeStats = await repoCache.getTreeStats(ctx.from.id, user.login, repoName, token);
  } catch (_) { /* best-effort, non-fatal */ }

  const sizeBytes = treeStats ? treeStats.sizeBytes : (repo.size || 0) * 1024;
  const fileLine = treeStats
    ? `📂 ${treeStats.fileCount} files · ${treeStats.folderCount} folders · ${format.escapeMd(format.formatBytes(sizeBytes))} total\n\n`
    : `📂 ${format.escapeMd(format.formatBytes(sizeBytes))} total\n\n`;

  const text =
    `🔍 *${format.escapeMd(repo.name)} — Full Details*\n\n` +
    `📊 *Stats*\n` +
    `⭐ ${repo.stargazers_count} stars · 🍴 ${repo.forks_count} forks · 👁 ${repo.watchers_count} watchers\n` +
    fileLine +
    `🌐 *Activity*\n` +
    `Created: ${format.escapeMd(format.relativeTime(repo.created_at))}\n` +
    `Last push: ${format.escapeMd(format.relativeTime(repo.pushed_at))}\n` +
    `Default branch: ${format.escapeMd(repo.default_branch)}\n\n` +
    `🔗 *Links*\n${format.escapeMd(repo.html_url)}`;

  await ctx.reply(text, { parse_mode: 'MarkdownV2' });
}

async function askDeleteRepo(ctx, repoName) {
  await ctx.reply(
    `⚠️ Delete "${format.escapeMd(repoName)}" permanently? \nThis cannot be undone\\.`,
    { parse_mode: 'MarkdownV2', ...inline.deleteRepoConfirm(repoName) }
  );
}

async function executeDeleteRepo(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'deleteRepo', async () => {
    try {
      const user = await repoCache.getUser(ctx.from.id, token);
      await github.deleteRepo(token, user.login, repoName);
      repoCache.invalidateRepos(ctx.from.id);
      repoCache.invalidateLanguages(ctx.from.id, repoName);
      repoCache.invalidateTreeStats(ctx.from.id, repoName);
      await activity.log(ctx.from.id, '🗑', `Deleted repo → ${repoName}`);
      await cleanupOrphanedData(ctx.from.id, repoName);
      await ctx.reply(format.successMessage(`Deleted repository "${repoName}"`), bbtb.mainMenu);
    } catch (err) {
      await activity.log(ctx.from.id, '⚠️', `Delete repo failed → ${repoName}`, { detail: err.message, isError: true });
      const errorHelpers = require('../lib/errorHelpers');
      const wasAuthError = await errorHelpers.replyGithubError(ctx, err, `Couldn\u2019t delete "${repoName}"`);
      if (!wasAuthError) {
        await ctx.reply(format.errorMessage(
          `Couldn\u2019t delete "${repoName}"`,
          err.message,
          'Check your token permissions and try again.'
        ));
      }
    }
  });
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function askToggleVisibility(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const user = await repoCache.getUser(ctx.from.id, token);
  const repo = await github.getRepo(token, user.login, repoName);

  const text = repo.private
    ? `🔒 *${format.escapeMd(repoName)}* is currently Private\\.\n\nSwitching to Public will:\n• Make the code visible to anyone\n• Show it in your public GitHub profile`
    : `🌐 *${format.escapeMd(repoName)}* is currently Public\\.\n\nSwitching to Private will:\n• Hide it from search and public listings\n• Revoke access for anyone who isn\u2019t a collaborator`;

  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...inline.visibilityConfirm(repoName, repo.private) });
}

async function executeToggleVisibility(ctx, repoName) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'toggleVisibility', () => _executeToggleVisibility(ctx, repoName));
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function _executeToggleVisibility(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const repo = await github.getRepo(token, user.login, repoName);
    const updated = await github.setVisibility(token, user.login, repoName, !repo.private);
    repoCache.invalidateRepos(ctx.from.id);
    await activity.log(ctx.from.id, '🔒', `Visibility changed → ${repoName} (${repo.private ? 'Private→Public' : 'Public→Private'})`);
    await ctx.reply(format.successMessage(
      `Visibility updated: ${repoName} is now ${updated.private ? '🔒 Private' : '🌐 Public'}`
    ));
  } catch (err) {
    await activity.log(ctx.from.id, '⚠️', `Visibility change failed → ${repoName}`, { detail: err.message, isError: true });
    const errorHelpers = require('../lib/errorHelpers');
    const wasAuthError = await errorHelpers.replyGithubError(ctx, err, 'Couldn\u2019t change visibility');
    if (!wasAuthError) {
      await ctx.reply(format.errorMessage(
        `Couldn\u2019t change visibility`,
        err.message.includes('403') ? 'your token may not have admin rights on this repo' : err.message,
        'Try reconnecting GitHub with full scope.'
      ));
    }
  }
}

/** ✏️ Description — v0.8.1 #46. Low-risk/instantly-reversible, unlike
 * Rename (which affects clone URLs), so no confirm step, matching how
 * Description is entered during Create Repo (type it, move on). */
async function askEditDescription(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  ctx.session.editingDescription = repoName;
  const user = await repoCache.getUser(ctx.from.id, token);
  const repo = await github.getRepo(token, user.login, repoName);
  await ctx.reply(
    `✏️ Current description: ${repo.description ? `"${repo.description}"` : '(none)'}\n\nSend a new description, or ⏭️ Skip to clear it.`,
    bbtb.cancelWithSkip
  );
}

/** Called from the text router when ctx.session.editingDescription is set */
async function handleDescriptionInput(ctx, text) {
  const repoName = ctx.session.editingDescription;
  delete ctx.session.editingDescription;
  if (!repoName) return;

  const token = await requireConnected(ctx);
  if (!token) return;

  const description = text === '⏭️ Skip' ? '' : text.trim();
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    await github.updateDescription(token, user.login, repoName, description);
    repoCache.invalidateRepos(ctx.from.id);
    await activity.log(ctx.from.id, '✏️', `Description updated → ${repoName}`);
    await ctx.reply(format.successMessage('Description updated'), bbtb.repoView);
  } catch (err) {
    await activity.log(ctx.from.id, '⚠️', `Description update failed → ${repoName}`, { detail: err.message, isError: true });
    await ctx.reply(format.errorMessage('Couldn\u2019t update description', err.message, 'Try again.'));
  }
  return showRepoView(ctx, repoName);
}

const LICENSE_OPTIONS = [
  ['mit', 'MIT'],
  ['apache-2.0', 'Apache 2.0'],
  ['gpl-3.0', 'GPL v3'],
  ['bsd-3-clause', 'BSD'],
];

/** ⚖️ License — v0.8.1 #15. GitHub has no "set license" API field; a
 * repo's detected license comes from GitHub actually scanning a LICENSE
 * file (licensee). Same mechanism as the visibility flow otherwise:
 * show current state, confirm before changing. */
async function showLicenseMenu(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
  const user = await repoCache.getUser(ctx.from.id, token);
  const repo = await github.getRepo(token, user.login, repoName);
  const current = repo.license ? (repo.license.name || repo.license.spdx_id) : 'No license';

  const rows = LICENSE_OPTIONS.map(([key, label]) =>
    [style.callback(label, `repo:license:confirm:${repoName}:${key}`, style.GREEN)]
  );
  rows.push([style.callback('🚫 None', `repo:license:confirm:${repoName}:none`, style.GREEN)]);
  rows.push([style.callback('❌ Cancel', `repo:license:cancel:${repoName}`, style.RED)]);

  await ctx.reply(
    `⚖️ *${format.escapeMd(repoName)}* — current license: ${format.escapeMd(current)}\n\nChoose a new one, or ❌ Cancel:`,
    { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) }
  );
}

async function executeSetLicense(ctx, repoName, licenseKey) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'setLicense', () => _executeSetLicense(ctx, repoName, licenseKey));
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function _executeSetLicense(ctx, repoName, licenseKey) {
  const token = await requireConnected(ctx);
  if (!token) return;

  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    if (licenseKey === 'none') {
      // Remove the existing LICENSE file, if any — this is what makes the
      // repo show "No license" again (GitHub can't be told directly).
      try {
        const existing = await github.getFileContent(token, user.login, repoName, 'LICENSE');
        await github.deleteFile(token, user.login, repoName, 'LICENSE', existing.sha, 'Remove license');
      } catch (_) { /* no LICENSE file existed — nothing to remove */ }
    } else {
      const body = await github.getLicenseText(token, licenseKey);
      let existingSha = null;
      try {
        const existing = await github.getFileContent(token, user.login, repoName, 'LICENSE');
        existingSha = existing.sha;
      } catch (_) { /* no existing LICENSE file — creating fresh */ }
      await github.putFile(token, user.login, repoName, 'LICENSE', body, 'Update license', existingSha);
    }
    repoCache.invalidateRepos(ctx.from.id);
    repoCache.invalidateTreeStats(ctx.from.id, repoName);
    await activity.log(ctx.from.id, '⚖️', `License updated → ${repoName} (${licenseKey})`);
    // #55 — GitHub's license detection is an async background scan
    // (licensee), not synchronous with the commit. Re-showing the repo
    // card immediately would display GitHub's still-stale answer as if it
    // were current — misleading, since it visibly "catches up" a minute
    // later with no action from the person. Confirm the commit succeeded
    // without claiming the shown license is already accurate, and let
    // them check back on their own terms instead of auto-rendering it.
    const { Markup } = require('telegraf');
    await ctx.reply(
      `✅ License commit pushed to ${repoName}.\n\n⏳ GitHub can take a moment to actually detect the new license from the file — if it still shows the old one when you check, give it a minute and look again.`,
      Markup.inlineKeyboard([[style.callback(`📦 View ${repoName}`, `repo:${repoName}`)]])
    );
  } catch (err) {
    await activity.log(ctx.from.id, '⚠️', `License update failed → ${repoName}`, { detail: err.message, isError: true });
    await ctx.reply(format.errorMessage('Couldn\u2019t update license', err.message, 'Try again.'));
    return showRepoView(ctx, repoName);
  }
}

async function downloadRepo(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  await ctx.reply(`📦 Preparing zip of ${format.escapeMd(repoName)}\\.\\.\\.`, { parse_mode: 'MarkdownV2' });
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const repo = await github.getRepo(token, user.login, repoName);
    const buffer = await github.downloadZip(token, user.login, repoName, repo.default_branch);

    if (buffer.length > 20 * 1024 * 1024) {
      const fallbackUrl = github.zipDownloadUrl(user.login, repoName, repo.default_branch);
      return ctx.reply(format.errorMessage(
        'Download failed',
        `repo is ${format.formatBytes(buffer.length)} — exceeds Telegram's 20MB limit for bot-sent files`,
        `Here's a direct download link instead:\n${fallbackUrl}`
      ));
    }

    await ctx.replyWithDocument({ source: buffer, filename: `${repoName}.zip` });
    await activity.log(ctx.from.id, '⬇️', `Downloaded repo → ${repoName}`);
  } catch (err) {
    await activity.log(ctx.from.id, '⚠️', `Download failed → ${repoName}`, { detail: err.message, isError: true });
    const errorHelpers = require('../lib/errorHelpers');
    await errorHelpers.replyGithubError(ctx, err, 'Download failed');
  }
}

async function togglePin(ctx, repoName) {
  // Gated behind requireConnected (v0.8.1 #25/#21) — this used to write to
  // the DB first and only discover we were disconnected on the follow-up
  // re-render, so a stale button could pin/unpin a repo with zero warning
  // until AFTER the write already happened. Check first, write second.
  const token = await requireConnected(ctx);
  if (!token) return;

  const telegramId = ctx.from.id;
  const isPinned = await pins.isPinned(telegramId, repoName);

  if (isPinned) {
    await pins.unpin(telegramId, repoName);
    await ctx.reply(`📌 Unpinned — removed from ⭐ Pinned.`);
  } else {
    await pins.pin(telegramId, repoName);
    await ctx.reply(`📌 Pinned — added to ⭐ Pinned for quick access.`);
  }
  // Re-render so the 📌 tag on the info card and the button label both update immediately
  return showRepoView(ctx, repoName);
}

module.exports = {
  showRepoView,
  showRepoDetails,
  askDeleteRepo,
  executeDeleteRepo,
  askToggleVisibility,
  executeToggleVisibility,
  askEditDescription,
  handleDescriptionInput,
  showLicenseMenu,
  executeSetLicense,
  downloadRepo,
  cleanupOrphanedData,
  togglePin,
};
