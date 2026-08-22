const Fuse = require('fuse.js');
const github = require('../lib/github');
const repoCache = require('../lib/repoCache');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const activity = require('../lib/activity');
const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');

const GITHUB_URL_RE = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9._-]+?)(?:\.git)?\/?$/;

function parseGithubUrl(input) {
  const match = input.trim().match(GITHUB_URL_RE);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function handleSearchInput(ctx, query) {
  const parsed = parseGithubUrl(query);
  if (parsed) return handleExternalRepo(ctx, parsed.owner, parsed.repo);
  return handleRepoSearch(ctx, query);
}

/** 📁 My Repos search entry point — fuzzy-searches only your own repos.
 * No longer guesses intent from a single shared box (see handlePublicRepoInput
 * for the other half of the v0.8.0 search split) — a GitHub link pasted here
 * is treated as a literal (probably not matching) search term, not auto-detected. */
async function handleMyReposSearchInput(ctx, query) {
  return handleRepoSearch(ctx, query);
}

/** 🌐 Public Repo entry point — expects a GitHub link, view/fork/download only. */
async function handlePublicRepoInput(ctx, input) {
  const parsed = parseGithubUrl(input);
  if (!parsed) {
    return ctx.reply(format.errorMessage(
      'Not a GitHub repo link',
      `"${input}" doesn\u2019t look like a github.com/owner/repo URL`,
      'Paste a full repo link, e.g. https://github.com/owner/repo, or ❌ Cancel.'
    ));
  }
  return handleExternalRepo(ctx, parsed.owner, parsed.repo);
}

async function handleRepoSearch(ctx, query) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const repos = await repoCache.getRepos(ctx.from.id, token);
  const fuse = new Fuse(repos, { keys: ['name'], threshold: 0.4, includeScore: true });
  const results = fuse.search(query);

  if (results.length === 0) {
    return ctx.reply(
      format.errorMessage(
        `No repos matched "${query}"`,
        `you have ${repos.length} repos total — check spelling, or browse the full list instead`,
      ),
      bbtb.searchAgain
    );
  }

  const close = results.filter((r) => r.score <= 0.15).map((r) => r.item);
  const similar = results.filter((r) => r.score > 0.15).map((r) => r.item);

  const sections = [];
  const rows = [];
  let counter = 1;

  if (close.length) {
    const cards = close.map((r) => {
      rows.push([style.callback(`${counter}. ${r.name}`, `repo:${r.name}`, style.BLUE)]);
      const card = `${counter}\\. ` + format.repoCard(r);
      counter++;
      return card;
    });
    sections.push(`🎯 *Close Matches*\n\n${cards.join(`\n${format.CARD_DIVIDER}\n`)}`);
  }
  if (similar.length) {
    const cards = similar.map((r) => {
      rows.push([style.callback(`${counter}. ${r.name}`, `repo:${r.name}`, style.BLUE)]);
      const card = `${counter}\\. ` + format.repoCard(r);
      counter++;
      return card;
    });
    sections.push(`🔁 *Similar Spelling*\n\n${cards.join(`\n${format.CARD_DIVIDER}\n`)}`);
  }

  const text = `${format.sectionHeader('Search Results', `"${query}"`)}\n\n${sections.join('\n\n')}`;

  await ctx.reply('🔍 Search Results', bbtb.searchAgain);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

async function handleExternalRepo(ctx, owner, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;

  try {
    const repo = await github.getRepo(token, owner, repoName);
    if (repo.private) {
      return ctx.reply(format.errorMessage(
        `Couldn\u2019t find "${owner}/${repoName}"`,
        'it\u2019s private and you don\u2019t have access (only public repos can be downloaded/forked this way)',
      ));
    }

    ctx.session = ctx.session || {};
    ctx.session.externalRepo = { owner, repo: repoName };

    const text =
      `🔗 *External Repo Detected*\n\n` +
      `📦 ${format.escapeMd(repo.name)}\n` +
      `👤 by ${format.escapeMd(owner)}\n` +
      `${format.visibilityLine(repo.private)} · ${format.languageLine(repo.language)} · ⭐ ${repo.stargazers_count} · 🍴 ${repo.forks_count}`;

    const keyboard = Markup.inlineKeyboard([
      [style.callback('⬇️ Download as ZIP', 'external:download', style.BLUE)],
      [style.callback('🍴 Fork to My Account', 'external:fork', style.BLUE)],
      [Markup.button.url('🔗 View on GitHub', repo.html_url)],
      [style.callback('⬅️ Cancel', 'external:cancel', style.BLUE)],
    ]);

    await ctx.reply(text, { parse_mode: 'MarkdownV2', ...keyboard });
  } catch (err) {
    if (err.status === 404) {
      return ctx.reply(format.errorMessage(
        `Couldn\u2019t find "${owner}/${repoName}"`,
        'it doesn\u2019t exist, was renamed, or is private',
      ));
    }
    await ctx.reply(format.errorMessage('Lookup failed', err.message, 'Try again.'));
  }
}

async function downloadExternalZip(ctx) {
  const { owner, repo } = ctx.session.externalRepo;
  const token = await requireConnected(ctx);
  if (!token) return;

  await ctx.reply(`📦 Preparing zip of ${format.escapeMd(owner)}/${format.escapeMd(repo)}\\.\\.\\.`, { parse_mode: 'MarkdownV2' });
  try {
    const repoData = await github.getRepo(token, owner, repo);
    const buffer = await github.downloadZip(token, owner, repo, repoData.default_branch);

    if (buffer.length > 20 * 1024 * 1024) {
      const fallbackUrl = github.zipDownloadUrl(owner, repo, repoData.default_branch);
      return ctx.reply(format.errorMessage(
        'Download failed',
        `repo is ${format.formatBytes(buffer.length)} — exceeds Telegram's 20MB limit for bot-sent files`,
        `Here's a direct download link instead:\n${fallbackUrl}`
      ));
    }

    await ctx.replyWithDocument({ source: buffer, filename: `${repo}.zip` });
    await activity.log(ctx.from.id, '⬇️', `Downloaded external repo → ${owner}/${repo}`);
  } catch (err) {
    await ctx.reply(format.errorMessage('Download failed', err.message, 'Try again later.'));
  }
}

async function forkExternal(ctx) {
  const { owner, repo } = ctx.session.externalRepo;
  await ctx.reply(
    `🍴 Fork "${format.escapeMd(repo)}" to your GitHub account\\?\n\nThis creates a copy under your account that you can edit, upload to, and manage like any other repo\\.`,
    { parse_mode: 'MarkdownV2', ...inline.forkConfirm() }
  );
}

/** actionLock-protected — Fork was the one destructive action in this file
 * without double-tap protection (see v0.8.1 #17). */
async function executeForkExternal(ctx) {
  const { owner, repo } = ctx.session.externalRepo;
  const token = await requireConnected(ctx);
  if (!token) return;

  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'fork', async () => {
    try {
      const forked = await github.forkRepo(token, owner, repo);
      repoCache.invalidateRepos(ctx.from.id);
      await activity.log(ctx.from.id, '🍴', `Forked → ${owner}/${repo}`);
      await ctx.reply(
        `✅ Forked\\! ${format.escapeMd(repo)} is now in your account\\.`,
        { parse_mode: 'MarkdownV2', ...inline.createRepoSuccess(forked.name) }
      );
    } catch (err) {
      const reason = err.message.includes('name already exists')
        ? `you already have a repo named "${repo}" — GitHub forks must keep the original name`
        : err.message;
      await activity.log(ctx.from.id, '⚠️', `Fork failed → ${owner}/${repo}`, { detail: err.message, isError: true });
      await ctx.reply(format.errorMessage('Fork failed', reason, 'Rename or delete your existing repo, then retry.'));
    }
  });
  if (skipped) await ctx.reply('⏳ Already forking — please wait a moment.');
}

module.exports = {
  handleSearchInput,
  handleMyReposSearchInput,
  handlePublicRepoInput,
  handleRepoSearch,
  handleExternalRepo,
  downloadExternalZip,
  forkExternal,
  executeForkExternal,
  parseGithubUrl,
};
