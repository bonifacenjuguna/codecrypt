const github = require('../lib/github');
const repoCache = require('../lib/repoCache');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const inline = require('../keyboards/inline');
const bbtb = require('../keyboards/bbtb');
const activity = require('../lib/activity');
const config = require('../config');

const TEXT_EXTENSIONS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'json', 'md', 'txt', 'html', 'css', 'py', 'java',
  'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'sh', 'yml', 'yaml', 'xml', 'sql',
  'env', 'gitignore', 'toml', 'ini', 'lock',
]);

function isTextFile(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

/** Builds a one-level directory listing from the full recursive tree */
function listDirectory(tree, dirPath) {
  const prefix = dirPath ? `${dirPath}/` : '';
  const seen = new Map();

  for (const entry of tree) {
    if (!entry.path.startsWith(prefix)) continue;
    const rest = entry.path.slice(prefix.length);
    if (!rest) continue;
    const [first, ...remainder] = rest.split('/');
    if (remainder.length === 0) {
      seen.set(first, { name: first, path: entry.path, type: 'blob' });
    } else if (!seen.has(first)) {
      seen.set(first, { name: first, path: `${prefix}${first}`, type: 'tree' });
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function showDirectory(ctx, repoName, dirPath = '', page = 1) {
  const token = await requireConnected(ctx);
  if (!token) return;

  ctx.session = ctx.session || {};
  ctx.session.currentBrowseDir = dirPath; // used by "Upload Here" / "Replace Folder" BBTB buttons

  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const tree = await github.getTree(token, user.login, repoName);

    if (tree.length === 0) {
      const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
      return ctx.reply(
        '📁 This repo is empty — nothing uploaded yet\\.',
        { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard([[style.callback('⬆️ Upload Files', `upload:start:${repoName}`, style.BLUE)]]) }
      );
    }

    const allEntries = listDirectory(tree, dirPath);
    const perPage = config.FILES_PER_PAGE;
    const totalPages = Math.max(1, Math.ceil(allEntries.length / perPage));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const entries = allEntries.slice((safePage - 1) * perPage, safePage * perPage);

    let label = dirPath ? `📁 /${dirPath}` : '📁 / (root)';
    if (allEntries.length > perPage) label += ` — ${allEntries.length} items, page ${safePage} of ${totalPages}`;

    await ctx.reply('📁 Browse Files', bbtb.browseFiles);
    await ctx.reply(format.escapeMd(label), {
      parse_mode: 'MarkdownV2',
      ...inline.fileTree(
        entries.map((e) => ({ ...e, type: e.type === 'tree' ? 'tree' : 'blob' })),
        dirPath,
        { page: safePage, totalPages }
      ),
    });
  } catch (err) {
    await ctx.reply(format.errorMessage(
      `Couldn\u2019t load files for "${repoName}"`,
      err.message,
      'Try again, or go back to the repo.'
    ));
  }
}

async function showFileActions(ctx, repoName, filePath) {
  const fileName = filePath.split('/').pop();
  await ctx.reply(
    `📄 *${format.escapeMd(fileName)}*\n📍 \`${format.escapeMd(filePath)}\``,
    { parse_mode: 'MarkdownV2', ...inline.fileActions(filePath) }
  );
}

async function viewFileContent(ctx, repoName, filePath) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const fileName = filePath.split('/').pop();

  if (!isTextFile(fileName)) {
    return ctx.reply(
      format.errorMessage(`Can\u2019t show content`, `${fileName} is likely a binary file`, 'Use "Send as File" instead.'),
      inline.fileActions(filePath)
    );
  }

  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const { content, size } = await github.getFileContent(token, user.login, repoName, filePath);
    const lines = content.split('\n');
    const preview = lines.slice(0, 40).join('\n');
    const truncated = lines.length > 40;

    let text = `📄 *${format.escapeMd(fileName)}* \\(${format.escapeMd(format.formatBytes(size))}\\)\n\n`;
    text += '```\n' + format.escapeCodeBlock(preview.slice(0, 3500)) + '\n```';
    if (truncated) text += `\n⚠️ Showing first 40 lines only\\. Use "Send as File" for full file\\.`;

    await ctx.reply(text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    await ctx.reply(format.errorMessage('Couldn\u2019t load file', err.message, 'Try again.'));
  }
}

async function sendFileAsDocument(ctx, repoName, filePath) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const fileName = filePath.split('/').pop();
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const { content } = await github.getFileContent(token, user.login, repoName, filePath);
    await ctx.replyWithDocument({ source: Buffer.from(content, 'utf8'), filename: fileName });
  } catch (err) {
    await ctx.reply(format.errorMessage('Couldn\u2019t send file', err.message, 'Try again.'));
  }
}

async function askDeleteFile(ctx, repoName, filePath) {
  await ctx.reply(
    `⚠️ Delete "${format.escapeMd(filePath)}" from ${format.escapeMd(repoName)}\\?\nThis cannot be undone\\.`,
    { parse_mode: 'MarkdownV2', ...inline.deleteFileConfirm(filePath) }
  );
}

async function executeDeleteFile(ctx, repoName, filePath) {
  const actionLock = require('../lib/actionLock');
  const { skipped } = await actionLock.withLock(ctx.from.id, 'deleteFile', () => _executeDeleteFile(ctx, repoName, filePath));
  if (skipped) await ctx.reply('⏳ Already processing — please wait a moment.');
}

async function _executeDeleteFile(ctx, repoName, filePath) {
  const token = await requireConnected(ctx);
  if (!token) return;

  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const { sha } = await github.getFileContent(token, user.login, repoName, filePath);
    await github.deleteFile(token, user.login, repoName, filePath, sha, `Delete ${filePath} via GitroHub`);
    repoCache.invalidateRepos(ctx.from.id);
    repoCache.invalidateLanguages(ctx.from.id, repoName);
    repoCache.invalidateTreeStats(ctx.from.id, repoName);
    await activity.log(ctx.from.id, '🗑', `Deleted file → ${filePath} (${repoName})`);
    await ctx.reply(format.successMessage(`Deleted "${filePath}"`));
  } catch (err) {
    await activity.log(ctx.from.id, '⚠️', `Delete file failed → ${filePath}`, { detail: err.message, isError: true });
    await ctx.reply(format.errorMessage('Couldn\u2019t delete file', err.message, 'Try again.'));
  }
}

async function searchFiles(ctx, repoName, query) {
  const token = await requireConnected(ctx);
  if (!token) return;

  const user = await repoCache.getUser(ctx.from.id, token);
  const tree = await github.getTree(token, user.login, repoName);
  const matches = tree.filter((f) => f.path.toLowerCase().includes(query.toLowerCase())).slice(0, 15);

  if (matches.length === 0) {
    return ctx.reply(format.errorMessage(
      `No files matched "${query}"`,
      `checked ${tree.length} files across all folders in ${repoName}`,
      'Check spelling, or browse manually.'
    ));
  }

  let text = `🔍 *File results for "${format.escapeMd(query)}" in ${format.escapeMd(repoName)}* \\(${matches.length} matches\\)\n\n`;
  text += matches.map((m, i) => `${i + 1}\\. 📄 ${format.escapeMd(m.path)}`).join('\n');

  const { Markup } = require('telegraf');
  const rows = matches.map((m) => [style.callback(m.path, `browse:file:${m.path}`, style.BLUE)]);

  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

module.exports = {
  showDirectory,
  showFileActions,
  viewFileContent,
  sendFileAsDocument,
  askDeleteFile,
  executeDeleteFile,
  searchFiles,
  isTextFile,
  listDirectory,
};
