const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const github = require('../lib/github');
const repoCache = require('../lib/repoCache');
const pins = require('../lib/pins');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const bbtb = require('../keyboards/bbtb');
const myRepos = require('./myRepos');

async function showPinned(ctx, { edit = false } = {}) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const telegramId = ctx.from.id;
  const pinList = await pins.list(telegramId);

  if (pinList.length === 0) {
    if (!edit) await ctx.reply('⭐ Pinned', bbtb.pinned);
    await ctx.reply(
      '📌 Pinned Repos\n\nYou haven\u2019t pinned any repos yet.\nOpen any repo and tap 📌 Pin below to add it here.'
    );
    return;
  }

  const user = await repoCache.getUser(ctx.from.id, token);
  const allRepos = await repoCache.getRepos(ctx.from.id, token);
  const repoByName = new Map(allRepos.map((r) => [r.name, r]));
  const tags = require('../lib/tags');
  const tagMap = await tags.tagsForRepos(telegramId, pinList.map((p) => p.repo_name));
  // Bounded to 3 concurrent fetches regardless of how many repos are
  // pinned (v0.8.4 hardening) — Pinned has no pagination cap like My
  // Repos does, so an unbounded Promise.all() here scaled the number of
  // simultaneous GitHub requests directly with pin count.
  const { mapWithConcurrency } = require('../lib/concurrency');
  const treeStatsResults = await mapWithConcurrency(pinList, 3, (p) => {
    const repo = repoByName.get(p.repo_name);
    if (!repo) return null;
    return repoCache.getTreeStats(ctx.from.id, repo.owner.login, repo.name, token).catch(() => null);
  });
  const sizeByRepo = new Map(pinList.map((p, i) => [p.repo_name, treeStatsResults[i]]));

  const rows = [];
  const lines = [];

  for (let i = 0; i < pinList.length; i++) {
    const repo = repoByName.get(pinList[i].repo_name);
    if (!repo) continue; // repo may have been deleted/renamed since pinning

    const stats = sizeByRepo.get(repo.name);
    const line = myRepos.renderRepoLine(repo, {
      pinned: true,
      tagLine: myRepos.tagLineFor(repo.name, tagMap),
      sizeBytes: stats ? stats.sizeBytes : undefined,
    });
    lines.push(line);

    const arrowRow = [];
    if (i > 0) arrowRow.push(style.callback('⬆️', `pin:up:${repo.name}`));
    if (i < pinList.length - 1) arrowRow.push(style.callback('⬇️', `pin:down:${repo.name}`));
    arrowRow.push(style.callback(`Open ${repo.name}`, `repo:${repo.name}`, style.BLUE));
    rows.push(arrowRow);
  }

  // #50 — Refresh relocated here (was its own BBTB row, colliding with My
  // Repos' Refresh button — see #49's discovery). #35 — reorder arrows and
  // refresh all edit this same message in place instead of resending the
  // whole pinned list on every tap.
  rows.push([style.callback('🔄 Refresh', 'pinned:refresh')]);

  const text = `${format.sectionHeader('Pinned Repos', `${lines.length} total`)}\n\n` + lines.join(`\n${format.CARD_DIVIDER}\n`);

  if (edit) {
    try {
      return await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
    } catch (_) { /* fall through to a fresh send */ }
  }

  await ctx.reply('⭐ Pinned', bbtb.pinned);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

async function movePin(ctx, repoName, direction) {
  await pins.move(ctx.from.id, repoName, direction === 'up' ? -1 : 1);
  return showPinned(ctx, { edit: true });
}

module.exports = { showPinned, movePin };
