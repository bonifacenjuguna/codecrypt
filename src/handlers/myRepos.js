const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const repoCache = require('../lib/repoCache');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const config = require('../config');
const pins = require('../lib/pins');
const tags = require('../lib/tags');

// Simple in-memory view-state per user (filter/sort/page) — not sensitive,
// fine to keep in process memory; resets on restart which is harmless here.
const viewState = new Map();

function getState(telegramId) {
  if (!viewState.has(telegramId)) {
    viewState.set(telegramId, { filterType: 'all', filterValue: null, sort: 'updated', page: 1, initialized: false });
  }
  return viewState.get(telegramId);
}

async function applyFilterSort(repos, state, telegramId) {
  let filtered = repos;
  if (state.filterType === 'public') filtered = repos.filter((r) => !r.private);
  if (state.filterType === 'private') filtered = repos.filter((r) => r.private);
  if (state.filterType === 'forks') filtered = repos.filter((r) => r.fork);
  if (state.filterType === 'language') filtered = repos.filter((r) => (r.language || 'None') === state.filterValue);
  if (state.filterType === 'tag') {
    const repoNames = new Set(await tags.reposWithTag(telegramId, Number(state.filterValue)));
    filtered = repos.filter((r) => repoNames.has(r.name));
  }

  const sorted = [...filtered];
  if (state.sort === 'updated') sorted.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  if (state.sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  if (state.sort === 'stars') sorted.sort((a, b) => b.stargazers_count - a.stargazers_count);
  if (state.sort === 'created') sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (state.sort === 'language') sorted.sort((a, b) => (a.language || 'zzz').localeCompare(b.language || 'zzz'));

  return sorted;
}

const SORT_LABELS = { updated: 'Recently Updated', name: 'Name (A-Z)', stars: 'Most Stars', created: 'Recently Created', language: 'Dominant Language (A-Z)' };

async function filterLabel(state, telegramId) {
  if (state.filterType === 'all') return 'All';
  if (state.filterType === 'public') return '🌐 Public';
  if (state.filterType === 'private') return '🔒 Private';
  if (state.filterType === 'forks') return '🍴 Forks';
  if (state.filterType === 'language') return `💻 ${state.filterValue}`;
  if (state.filterType === 'tag') {
    const allTags = await tags.listTags(telegramId);
    const t = allTags.find((x) => x.id === Number(state.filterValue));
    return t ? `🏷️ ${t.emoji} ${t.name}` : '🏷️ Tag';
  }
  return 'All';
}

/**
 * Renders one repo using the locked bot-wide card format (see
 * format.repoCard). Kept as its own export (rather than every screen
 * calling format.repoCard directly) so Pinned and any future screen render
 * identically to My Repos with one shared call.
 *
 * Note: a prior version of this took a `ctx` that was never actually in
 * scope (masked by a surrounding try/catch), which silently broke the
 * per-repo language-breakdown lookup on every call. The new card format
 * doesn't need that lookup at all — it shows repo.language directly — so
 * this version has no hidden dependency on caller scope.
 */
function renderRepoLine(r, { pinned = false, tagLine = '', sizeBytes } = {}) {
  return format.repoCard(r, { pinned, tagLine, sizeBytes });
}

/** Builds the 🏷️ tag-chip line for a repo, if it has any tags. */
function tagLineFor(repoName, tagMap) {
  const repoTags = tagMap[repoName];
  if (!repoTags || repoTags.length === 0) return '';
  return `🏷️ ${format.escapeMd(repoTags.map((t) => `${t.emoji} ${t.name}`).join(' · '))}`;
}

async function showMyRepos(ctx, { edit = false } = {}) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const telegramId = ctx.from.id;
  const state = getState(telegramId);

  if (!state.initialized) {
    state.initialized = true;
    try {
      const defaultsLib = require('../lib/defaults');
      const d = await defaultsLib.getDefaults(telegramId);
      if (d) {
        state.sort = d.default_sort || 'updated';
        state.filterType = d.default_filter || 'all';
      }
    } catch (_) { /* best-effort — fall back to hardcoded defaults */ }
  }

  const allRepos = await repoCache.getRepos(ctx.from.id, token);
  const filtered = await applyFilterSort(allRepos, state, telegramId);

  const perPage = config.REPOS_PER_PAGE;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  state.page = Math.min(state.page, totalPages);
  const pageRepos = filtered.slice((state.page - 1) * perPage, state.page * perPage);

  const fLabel = await filterLabel(state, telegramId);
  let text = `${format.sectionHeader('Repositories', `${allRepos.length} total`)}\n`;
  text += `  Filter: ${format.escapeMd(fLabel)} · Sort: ${format.escapeMd(SORT_LABELS[state.sort])}\n\n`;

  if (pageRepos.length === 0) {
    text += format.escapeMd(`No repos match filter "${fLabel}".`);
  } else {
    const [pinList, tagMap, treeStatsResults] = await Promise.all([
      pins.list(telegramId),
      tags.tagsForRepos(telegramId, pageRepos.map((r) => r.name)),
      // Real size, not GitHub's lagging cache (v0.8.1 #14 — this now
      // matches Repo View's behavior). Only fetched for the 3 repos on
      // THIS page, not the whole list, so pagination keeps this cheap —
      // each page load costs one extra tree call per visible repo, not per
      // repo you own.
      Promise.all(pageRepos.map((r) =>
        repoCache.getTreeStats(telegramId, r.owner.login, r.name, token).catch(() => null)
      )),
    ]);
    const pinnedSet = new Set(pinList.map((p) => p.repo_name));
    const sizeByRepo = new Map(pageRepos.map((r, i) => [r.name, treeStatsResults[i]]));

    const cards = pageRepos.map((r) => {
      const stats = sizeByRepo.get(r.name);
      return renderRepoLine(r, {
        pinned: pinnedSet.has(r.name),
        tagLine: tagLineFor(r.name, tagMap),
        sizeBytes: stats ? stats.sizeBytes : undefined,
      });
    });
    text += cards.join(`\n${format.CARD_DIVIDER}\n`);
    text += `\n\nPage ${state.page} of ${totalPages}`;
  }

  const keyboard = inline.repoList(pageRepos, state.page, totalPages);

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', ...keyboard });
  } else {
    // Reply keyboard (BBTB) and inline keyboard can't share one message —
    // send the BBTB once via a tiny marker message, then content with only inline.
    await ctx.reply('📁 My Repos', bbtb.myRepos);
    await ctx.reply(text, { parse_mode: 'MarkdownV2', ...keyboard });
  }
}

async function showStats(ctx) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const allRepos = await repoCache.getRepos(ctx.from.id, token);

  if (allRepos.length === 0) {
    await ctx.reply('📊 Stats\n\nYou don\u2019t have any repos yet — create one to see stats here.');
    return;
  }

  const publicCount = allRepos.filter((r) => !r.private).length;
  const privateCount = allRepos.length - publicCount;
  const totalStars = allRepos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);

  const langCounts = {};
  for (const r of allRepos) {
    if (!r.language) continue;
    langCounts[r.language] = (langCounts[r.language] || 0) + 1;
  }
  const topLangEntry = Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0];
  const topLanguage = topLangEntry ? `${topLangEntry[0]} (${topLangEntry[1]} repo${topLangEntry[1] === 1 ? '' : 's'})` : 'No language data';

  const mostActive = [...allRepos].sort((a, b) => new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at))[0];
  const oldest = [...allRepos].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];

  const text =
    `${format.sectionHeader('Stats', `${allRepos.length} total`)}\n\n` +
    `▸ 🌐 Public: ${publicCount}  ·  🔒 Private: ${privateCount}\n` +
    `▸ ⭐ Total stars: ${totalStars}\n` +
    `▸ 💻 Top language: ${format.escapeMd(topLanguage)}\n\n` +
    `📌 *Most active repo*\n` +
    `${format.escapeMd(mostActive.name)} · 🕒 ${format.escapeMd(format.relativeTime(mostActive.pushed_at || mostActive.updated_at))}\n\n` +
    `🕰️ *Oldest repo*\n` +
    `${format.escapeMd(oldest.name)} · 📅 ${format.escapeMd(format.relativeTime(oldest.created_at))}`;

  await ctx.reply(text, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([
      [style.callback(`📦 Open ${mostActive.name}`, `repo:${mostActive.name}`, style.BLUE)],
      [style.callback('⬅️ Back', 'repos:back', style.BLUE)],
    ]),
  });
}

async function showFilterMenu(ctx) {
  // Sent as a brand-new message (not an edit) — a BBTB tap has no prior
  // bot message to edit, which is exactly what caused the old
  // "400: message can't be edited" crash. The callback handler in bot.js
  // edits THIS fresh message, so that edit is always safe.
  await ctx.reply('🔎 *Filter repositories by:*', {
    parse_mode: 'MarkdownV2',
    ...inline.filterMenu,
  });
}

async function showSortMenu(ctx) {
  await ctx.reply('↕️ *Sort repositories by:*', {
    parse_mode: 'MarkdownV2',
    ...inline.sortMenu,
  });
}

async function showLanguageFilterMenu(ctx) {
  const token = await requireConnected(ctx);
  if (!token) return;
  const allRepos = await repoCache.getRepos(ctx.from.id, token);

  const counts = {};
  for (const r of allRepos) {
    const lang = r.language || 'None';
    counts[lang] = (counts[lang] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const rows = entries.map(([lang, count]) => [
    style.callback(`${lang} (${count})`, `filter:lang:${lang}`),
  ]);
  rows.push([style.callback('📊 Language Overview', 'filter:langoverview', style.BLUE)]);
  rows.push([style.callback('⬅️ Back', 'repos:back', style.BLUE)]);

  await ctx.reply('💻 Filter by language:', Markup.inlineKeyboard(rows));
}

async function showLanguageOverview(ctx) {
  const token = await requireConnected(ctx);
  if (!token) return;
  const allRepos = await repoCache.getRepos(ctx.from.id, token);

  const counts = {};
  for (const r of allRepos) {
    const lang = r.language || 'Other';
    counts[lang] = (counts[lang] || 0) + 1;
  }
  const total = allRepos.length || 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const barWidth = 10;
  let text = `📊 *Your Languages* — ${total} repos\n\n`;
  for (const [lang, count] of sorted.slice(0, 8)) {
    const pct = Math.round((count / total) * 100);
    const filled = Math.round((pct / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    text += `${format.escapeMd(lang.padEnd(12))} ${count} repos  ${bar}  ${pct}%\n`;
  }

  await ctx.reply(text, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([[style.callback('⬅️ Back to Filter', 'repos:langfiltermenu', style.BLUE)]]),
  });
}

async function showTagFilterMenu(ctx) {
  const userTags = await tags.listTags(ctx.from.id);
  if (userTags.length === 0) {
    await ctx.reply('🏷️ You don\u2019t have any tags yet — create one from a repo\u2019s Tags screen first.');
    return;
  }
  const rows = userTags.map((t) => [style.callback(`${t.emoji} ${t.name} (${t.repo_count})`, `filter:tag:${t.id}`)]);
  rows.push([style.callback('⬅️ Back', 'repos:back', style.BLUE)]);
  await ctx.reply('🏷️ Filter by tag:', Markup.inlineKeyboard(rows));
}

function setFilter(telegramId, type, value = null) {
  const state = getState(telegramId);
  state.filterType = type;
  state.filterValue = value;
  state.page = 1;
}

function setSort(telegramId, sort) {
  const state = getState(telegramId);
  state.sort = sort;
  state.page = 1;
}

function setPage(telegramId, page) {
  getState(telegramId).page = page;
}

module.exports = {
  showMyRepos,
  showStats,
  showFilterMenu,
  showSortMenu,
  showLanguageFilterMenu,
  showLanguageOverview,
  showTagFilterMenu,
  setFilter,
  setSort,
  setPage,
  getState,
  renderRepoLine,
  tagLineFor,
};
