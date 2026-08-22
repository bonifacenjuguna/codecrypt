const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const github = require('../lib/github');
const repoCache = require('../lib/repoCache');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const bbtb = require('../keyboards/bbtb');
const activity = require('../lib/activity');
const tags = require('../lib/tags');
const repoView = require('./repoView');
const config = require('../config');

const PER_PAGE = 8;

function getSelection(ctx) {
  ctx.session.bulkSelected = ctx.session.bulkSelected || [];
  return ctx.session.bulkSelected;
}

async function startBulkSelect(ctx, { page = 1, edit = false } = {}) {
  const token = await requireConnected(ctx);
  if (!token) return;

  ctx.session.bulkPage = page;
  const selected = getSelection(ctx);
  const allRepos = await repoCache.getRepos(ctx.from.id, token);
  ctx.session.bulkAllRepoNames = allRepos.map((r) => r.name); // for Select All / Invert without refetching

  const totalPages = Math.max(1, Math.ceil(allRepos.length / PER_PAGE));
  const pageRepos = allRepos.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const rows = [
    [
      style.callback('✅ Select All', 'bulk:selectall'),
      style.callback('↩️ Invert', 'bulk:invert'),
    ],
    [style.callback('😴 Select Stale (6mo+)', 'bulk:selectstale')],
    [
      style.callback('🔒 Select Private', 'bulk:selectprivate'),
      style.callback('🌐 Select Public', 'bulk:selectpublic'),
    ],
  ];

  const userTags = await tags.listTags(ctx.from.id);
  if (userTags.length > 0) {
    rows.push([style.callback('🏷️ Select by Tag', 'bulk:tagmenu')]);
  }

  for (const r of pageRepos) {
    const checked = selected.includes(r.name) ? '☑️' : '⬜';
    rows.push([style.callback(`${checked} ${r.name}`, `bulk:toggle:${r.name}`)]);
  }

  const pagination = [];
  if (page > 1) pagination.push(style.callback('⬅️ Prev', `bulk:page:${page - 1}`, style.BLUE));
  if (page < totalPages) pagination.push(style.callback('Next ➡️', `bulk:page:${page + 1}`, style.BLUE));
  if (pagination.length) rows.push(pagination);

  const text =
    `${format.sectionHeader('Bulk Select', `${selected.length} selected`)}\n\n` +
    `${selected.length > 0 ? format.escapeMd(previewNames(selected)) : format.escapeMd('None selected yet')}\n\n` +
    `Page ${page} of ${totalPages}`;

  // #33 — every checkbox tap, filter button, and page flip used to resend
  // the whole screen as a brand-new message. Now it edits the same message
  // in place (matching how Notifications already worked), so selecting 10
  // repos doesn't produce 10 messages.
  if (edit) {
    try {
      return await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
    } catch (_) {
      // Message unchanged (Telegram errors on a no-op edit) or too old to
      // edit — fall through to a fresh send so the action never silently fails.
    }
  }

  await ctx.reply('🧹 Bulk Select', bbtb.bulkSelect);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

function previewNames(names) {
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')}, +${names.length - 3} more`;
}

async function toggleRepo(ctx, repoName, page) {
  const selected = getSelection(ctx);
  const idx = selected.indexOf(repoName);
  if (idx === -1) selected.push(repoName);
  else selected.splice(idx, 1);
  return startBulkSelect(ctx, { page, edit: true });
}

async function selectAll(ctx) {
  ctx.session.bulkSelected = [...(ctx.session.bulkAllRepoNames || [])];
  return startBulkSelect(ctx, { page: ctx.session.bulkPage || 1, edit: true });
}

async function invertSelection(ctx) {
  const all = ctx.session.bulkAllRepoNames || [];
  const selected = new Set(getSelection(ctx));
  ctx.session.bulkSelected = all.filter((name) => !selected.has(name));
  return startBulkSelect(ctx, { page: ctx.session.bulkPage || 1, edit: true });
}

async function selectStale(ctx) {
  const token = await requireConnected(ctx);
  if (!token) return;
  const allRepos = await repoCache.getRepos(ctx.from.id, token);
  const sixMonthsAgo = Date.now() - 6 * 30 * 24 * 60 * 60 * 1000;
  ctx.session.bulkSelected = allRepos
    .filter((r) => new Date(r.updated_at).getTime() < sixMonthsAgo)
    .map((r) => r.name);
  return startBulkSelect(ctx, { page: ctx.session.bulkPage || 1, edit: true });
}

async function selectByVisibility(ctx, isPrivate) {
  const token = await requireConnected(ctx);
  if (!token) return;
  const allRepos = await repoCache.getRepos(ctx.from.id, token);
  ctx.session.bulkSelected = allRepos.filter((r) => r.private === isPrivate).map((r) => r.name);
  return startBulkSelect(ctx, { page: ctx.session.bulkPage || 1, edit: true });
}

async function showTagSelectMenu(ctx) {
  const userTags = await tags.listTags(ctx.from.id);
  const rows = userTags.map((t) => [
    style.callback(`${t.emoji} ${t.name} (${t.repo_count})`, `bulk:selecttag:${t.id}`),
  ]);
  rows.push([style.callback('⬅️ Back', 'bulk:back')]);
  // #29 — single-pick menu: edit briefly, then this whole message gets
  // replaced by the re-rendered Bulk Select screen on pick (selectByTag
  // below calls startBulkSelect with edit:true), so nothing lingers.
  try {
    await ctx.editMessageText('🏷️ Select all repos with this tag:', Markup.inlineKeyboard(rows));
  } catch (_) {
    await ctx.reply('🏷️ Select all repos with this tag:', Markup.inlineKeyboard(rows));
  }
}

async function selectByTag(ctx, tagId) {
  const repoNames = await tags.reposWithTag(ctx.from.id, Number(tagId));
  ctx.session.bulkSelected = repoNames;
  return startBulkSelect(ctx, { page: ctx.session.bulkPage || 1, edit: true });
}

async function showActionMenu(ctx) {
  const selected = getSelection(ctx);
  if (selected.length === 0) {
    await ctx.reply('⚠️ Select at least one repo first.');
    return startBulkSelect(ctx, { page: ctx.session.bulkPage || 1 });
  }

  const text = `${format.sectionHeader('Selected', `${selected.length} repos`)}\n${format.escapeMd(previewNames(selected))}`;
  const rows = [
    [style.callback('🗑 Delete All', 'bulk:action:delete')],
    [
      style.callback('🔒 Make All Private', 'bulk:action:private'),
      style.callback('🌐 Make All Public', 'bulk:action:public'),
    ],
    [style.callback('⬇️ Download All as Zips', 'bulk:action:download')],
  ];

  await ctx.reply('🧹 Bulk Actions', bbtb.bulkActionMenu);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

async function confirmAction(ctx, action) {
  const selected = getSelection(ctx);
  const list = selected.map((name, i) => `${i + 1}. ${name}`).join('\n');

  const labels = {
    delete: { verb: 'Delete', warn: 'This cannot be undone.' },
    private: { verb: 'Make Private', warn: 'These repos will no longer be publicly visible.' },
    public: { verb: 'Make Public', warn: 'These repos will become visible to anyone.' },
    download: { verb: 'Download', warn: 'Each repo will be sent as a separate zip file.' },
  };
  const l = labels[action];

  await ctx.reply(
    `⚠️ ${l.verb} ${selected.length} repos${action === 'delete' ? ' permanently' : ''}?\n\n${list}\n\n${l.warn}`,
    Markup.inlineKeyboard([
      // Delete matches single-repo Delete Repo exactly (real loss = red,
      // backing out = green). Private/Public/Download aren't a gain or
      // loss either way — same reasoning as the single-repo Visibility
      // toggle already being blue/blue — so both sides stay blue instead.
      [style.callback(`✅ Yes, ${l.verb} All ${selected.length}`, `bulk:execute:${action}`, action === 'delete' ? style.RED : style.BLUE)],
      [style.callback('❌ Cancel', 'bulk:cancel', action === 'delete' ? style.GREEN : style.BLUE)],
    ])
  );
}

async function execute(ctx, action) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'bulkExecute', () => _execute(ctx, action));
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function _execute(ctx, action) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const selected = getSelection(ctx);
  const user = await repoCache.getUser(ctx.from.id, token);

  const progressMsg = await ctx.reply(
    `${actionVerb(action)} ${selected.length} repos...\n\n` + selected.map((n) => `⏳ ${n}`).join('\n')
  );

  const results = [];
  for (let i = 0; i < selected.length; i++) {
    const name = selected[i];
    try {
      await runAction(token, user.login, name, action, ctx.from.id);
      results.push({ name, ok: true });
    } catch (err) {
      const errorHelpers = require('../lib/errorHelpers');
      if (errorHelpers.isAuthError(err)) {
        // Token is bad for the whole session, not just this repo — every
        // remaining item would fail the same way, so stop instead of
        // grinding through a doomed loop and reporting the same error N times.
        for (let j = i; j < selected.length; j++) results.push({ name: selected[j], ok: false, error: 'session expired' });
        // Update the progress message one last time BEFORE breaking, or it
        // stays frozen showing "⏳ pending" on items that are actually
        // already known-failed until the summary arrives right after.
        const finalLines = selected.map((n, idx) => `${results[idx].ok ? '✅' : '⚠️'} ${n}`);
        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            progressMsg.message_id,
            undefined,
            `${actionVerb(action)} ${selected.length} repos...\n\n${finalLines.join('\n')}`
          );
        } catch (_) { /* non-fatal — the summary below covers it regardless */ }
        await errorHelpers.replyGithubError(ctx, err, `Bulk ${action} stopped`);
        break;
      }
      results.push({ name, ok: false, error: err.message });
    }

    const lines = selected.map((n, idx) => {
      if (idx < i) return `${results[idx].ok ? '✅' : '⚠️'} ${n}`;
      if (idx === i) return `${results[idx] ? (results[idx].ok ? '✅' : '⚠️') : '⏳'} ${n}`;
      return `⏳ ${n}`;
    });
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        undefined,
        `${actionVerb(action)} ${selected.length} repos...\n\n${lines.join('\n')}`
      );
    } catch (err) {
      // Telegram's own flood control — if it tells us how long to wait,
      // actually wait that long before the next edit instead of just
      // swallowing the error and immediately hitting the same limit again.
      const retryAfter = (err.response && err.response.parameters && err.response.parameters.retry_after)
        || (err.parameters && err.parameters.retry_after);
      if (retryAfter) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      }
      // Any other edit failure is non-fatal — the final summary below covers it regardless.
    }
  }

  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  await activity.log(
    ctx.from.id,
    action === 'delete' ? '🗑' : action === 'download' ? '⬇️' : '🔒',
    `Bulk ${action} → ${succeeded.length}/${selected.length} succeeded`,
    { isError: failed.length > 0 }
  );

  let summary = `✅ Bulk ${action} finished — ${succeeded.length} succeeded`;
  if (failed.length > 0) summary += `, ${failed.length} failed`;
  summary += `\n\n✅ ${succeeded.map((r) => r.name).join(', ') || 'None'}`;
  if (failed.length > 0) {
    summary += `\n\n⚠️ ` + failed.map((r) => `${r.name}: ${r.error}`).join('\n');
  }

  ctx.session.bulkSelected = [];
  await maybeAddLongOpNotice(ctx, selected.length);
  await ctx.reply(summary, bbtb.bulkComplete);
}

/** Long Operations notification: for a batch big enough to actually take a
 * noticeable while (3+ items — lowered from 5+, which was unreachable at
 * typical real-world repo counts), send an extra "long operation done"
 * callout before the normal summary, when that preference is on. Shared
 * with Batch Upload (scenes/uploadFile.js), not just Bulk Actions. */
async function maybeAddLongOpNotice(ctx, count, { label = 'repos' } = {}) {
  if (count < 3) return;
  try {
    const users = require('../lib/users');
    const prefs = await users.getNotificationPrefs(ctx.from.id);
    if (prefs && prefs.longOps) {
      await ctx.reply(`🔔 Long operation finished — ${count} ${label} processed.`);
    }
  } catch (_) { /* best-effort */ }
}

function actionVerb(action) {
  return { delete: '🗑 Deleting', private: '🔒 Making Private', public: '🌐 Making Public', download: '⬇️ Downloading' }[action];
}

async function runAction(token, owner, repoName, action, telegramId) {
  if (action === 'delete') {
    await github.deleteRepo(token, owner, repoName);
    await repoView.cleanupOrphanedData(telegramId, repoName);
    repoCache.invalidateRepos(telegramId);
    repoCache.invalidateLanguages(telegramId, repoName);
    repoCache.invalidateTreeStats(telegramId, repoName);
    return;
  }
  if (action === 'private' || action === 'public') {
    await github.setVisibility(token, owner, repoName, action === 'private');
    repoCache.invalidateRepos(telegramId);
    return;
  }
}

async function executeDownloads(ctx) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'bulkDownloads', () => _executeDownloads(ctx));
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function _executeDownloads(ctx) {
  const token = await requireConnected(ctx);
  if (!token) return;
  const selected = getSelection(ctx);
  const user = await repoCache.getUser(ctx.from.id, token);

  await ctx.reply(`⬇️ Preparing ${selected.length} zips — sent one at a time...`);

  let sent = 0;
  const failed = [];
  let stoppedForAuth = false;
  for (const name of selected) {
    if (stoppedForAuth) {
      failed.push({ name, error: 'session expired' });
      continue;
    }
    try {
      const repo = await github.getRepo(token, user.login, name);
      const buffer = await github.downloadZip(token, user.login, name, repo.default_branch);
      if (buffer.length > 20 * 1024 * 1024) {
        failed.push({ name, error: `exceeds 20MB (${format.formatBytes(buffer.length)})` });
        continue;
      }
      await ctx.replyWithDocument({ source: buffer, filename: `${name}.zip` });
      sent++;
    } catch (err) {
      const errorHelpers = require('../lib/errorHelpers');
      if (errorHelpers.isAuthError(err)) {
        stoppedForAuth = true;
        await errorHelpers.replyGithubError(ctx, err, 'Bulk download stopped');
        failed.push({ name, error: 'session expired' });
        continue;
      }
      failed.push({ name, error: err.message });
    }
  }

  await activity.log(ctx.from.id, '⬇️', `Bulk download → ${sent}/${selected.length} succeeded`, { isError: failed.length > 0 });

  let summary = `✅ Bulk download finished — ${sent} sent`;
  if (failed.length > 0) {
    summary += `, ${failed.length} failed\n\n⚠️ ` + failed.map((f) => `${f.name}: ${f.error}`).join('\n');
  }
  ctx.session.bulkSelected = [];
  await maybeAddLongOpNotice(ctx, selected.length);
  await ctx.reply(summary, bbtb.bulkComplete);
}

module.exports = {
  startBulkSelect,
  toggleRepo,
  selectAll,
  invertSelection,
  selectStale,
  selectByVisibility,
  showTagSelectMenu,
  selectByTag,
  showActionMenu,
  confirmAction,
  execute,
  executeDownloads,
  maybeAddLongOpNotice,
};
