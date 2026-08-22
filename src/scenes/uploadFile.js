const { Scenes, Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const github = require('../lib/github');
const repoCache = require('../lib/repoCache');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const bbtb = require('../keyboards/bbtb');
const activity = require('../lib/activity');
const { gitBlobSha } = require('../lib/gitHash');
const config = require('../config');
const { listDirectory } = require('../handlers/browseFiles');
const pathMemory = require('../lib/pathMemory');
const fileBufferCache = require('../lib/fileBufferCache');

const PATH_EXAMPLES =
  'Examples:\n' +
  '• src/index.js\n' +
  '• assets/images/logo.png\n' +
  '• config/settings.json';

const typePathBbtb = Markup.keyboard([
  ['📍 Use Root', '⬅️ Back'],
  ['❌ Cancel'],
]).resize();

/** Releases every cached file buffer for this wizard session — call at every exit point. */
function releasePendingFiles(ctx) {
  const files = ctx.wizard.state.pendingFiles;
  if (files) fileBufferCache.releaseAll(files.map((f) => f.contentRef).filter(Boolean));
}

/** Exposed so bot.js's global scene-escape handler can clean up cached
 * buffers even when the person leaves via a nav button instead of Cancel. */
function releaseOnExternalLeave(ctx) {
  if (ctx.wizard && ctx.wizard.state) releasePendingFiles(ctx);
}

const scene = new Scenes.WizardScene(
  'uploadFile',

  async (ctx) => {
    const state = ctx.scene.state || {};
    ctx.wizard.state.repoName = ctx.wizard.state.repoName || state.repoName;
    ctx.wizard.state.presetDir = state.presetDir;
    ctx.wizard.state.suggestedDir = state.suggestedDir;
    ctx.wizard.state.lockedPath = state.lockedPath;
    ctx.wizard.state.mode = state.mode || 'upload';

    if (ctx.wizard.state.mode === 'replaceFolder' && !ctx.wizard.state.syncConfirmed) {
      const dirLabel = ctx.wizard.state.presetDir || '(root)';
      await ctx.reply(
        `🔁 Replace ${dirLabel}\n` +
        `This makes the folder match exactly what you upload next:\n` +
        `• Files you send will be added or updated\n` +
        `• Any file already here that you DON'T include will be deleted\n\n` +
        `⚠️ This is a full sync, not a normal upload.`,
        Markup.inlineKeyboard([
          [style.callback('Understood, Continue', 'upload:sync:continue', style.GREEN)],
          [style.callback('❌ Cancel', 'upload:sync:cancel', style.RED)],
        ])
      );
      // Advance the wizard cursor to the step that actually handles the
      // button tap (below). Without this, Telegraf re-runs THIS step on the
      // next update, sees syncConfirmed still false, and resends this same
      // message forever — regardless of which button was tapped.
      return ctx.wizard.selectStep(1);
    }

    return promptForFile(ctx);
  },

  async (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'upload:sync:continue') {
      await ctx.answerCbQuery();
      ctx.wizard.state.syncConfirmed = true;
      return promptForFile(ctx);
    }
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'upload:sync:cancel') {
      await ctx.answerCbQuery();
      await ctx.reply('Cancelled.', bbtb.mainMenu);
      return ctx.scene.leave();
    }

    if (ctx.message && ctx.message.text === '❌ Cancel') {
      await ctx.reply('Upload cancelled.', bbtb.mainMenu);
      return ctx.scene.leave();
    }

    if (ctx.message && ctx.message.photo) {
      await ctx.reply(format.errorMessage(
        'Can\u2019t upload this file',
        'it was sent as a compressed photo, not a file attachment — Telegram compresses images sent via the photo picker, which alters the original bytes',
        'Use the 📎 attachment icon and choose "File" (not "Photo/Gallery") to send it unmodified, or ❌ Cancel.'
      ));
      return;
    }

    if (!ctx.message || !ctx.message.document) {
      await ctx.reply('Send a file as a document attachment, or ❌ Cancel.');
      return;
    }

    const doc = ctx.message.document;
    const isZip = doc.file_name.toLowerCase().endsWith('.zip');

    if (isZip && doc.file_size > config.MAX_ZIP_SIZE_BYTES) {
      await ctx.reply(format.errorMessage(
        'Zip exceeds size limit',
        `${doc.file_name} is ${format.formatBytes(doc.file_size)}, limit is ${format.formatBytes(config.MAX_ZIP_SIZE_BYTES)}`,
        'Please split or compress further, then resend.'
      ));
      return;
    }
    if (!isZip && doc.file_size > config.MAX_SINGLE_FILE_BYTES) {
      await ctx.reply(format.errorMessage(
        'File exceeds size limit',
        `${doc.file_name} is ${format.formatBytes(doc.file_size)}, limit is ${format.formatBytes(config.MAX_SINGLE_FILE_BYTES)}`,
        'For larger files, zip them first (up to 1MB compressed), then resend.'
      ));
      return;
    }

    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    let res;
    try {
      res = await fetch(fileLink.href, { signal: AbortSignal.timeout(20000) });
    } catch (err) {
      await ctx.reply(format.errorMessage(
        'Upload failed',
        err.name === 'TimeoutError' ? 'downloading the file from Telegram took too long' : err.message,
        'Try again.'
      ));
      return;
    }
    const buffer = Buffer.from(await res.arrayBuffer());

    if (isZip) {
      return processZip(ctx, buffer);
    }
    return processSingleFile(ctx, buffer, doc.file_name);
  },

  async (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'upload:choose:root') {
      await ctx.answerCbQuery();
      ctx.wizard.state.pendingFiles[0].path = ctx.wizard.state.pendingFiles[0].filename;
      return showSummary(ctx);
    }
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'upload:choose:suggested') {
      await ctx.answerCbQuery();
      const dir = ctx.wizard.state.suggestedDir;
      ctx.wizard.state.pendingFiles[0].path = dir ? `${dir}/${ctx.wizard.state.pendingFiles[0].filename}` : ctx.wizard.state.pendingFiles[0].filename;
      return showSummary(ctx);
    }
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'upload:choose:default') {
      await ctx.answerCbQuery();
      const defaultsLib = require('../lib/defaults');
      const d = await defaultsLib.getDefaults(ctx.from.id);
      const dir = d ? d.default_upload_path : '';
      ctx.wizard.state.pendingFiles[0].path = dir ? `${dir}/${ctx.wizard.state.pendingFiles[0].filename}` : ctx.wizard.state.pendingFiles[0].filename;
      return showSummary(ctx);
    }
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'upload:choose:browse') {
      await ctx.answerCbQuery();
      await ctx.reply('Browsing isn\u2019t available in this simplified flow — please type the path instead.');
      return;
    }
    if (ctx.message && ctx.message.text === '⌨️ Type Path Instead') {
      await ctx.reply(`⌨️ Type the destination path.\n\n${PATH_EXAMPLES}\n\nOr tap 📍 Use Root below.`, typePathBbtb);
      return;
    }
    if (ctx.message && ctx.message.text === '📍 Use Root') {
      ctx.wizard.state.pendingFiles[0].path = ctx.wizard.state.pendingFiles[0].filename;
      return showSummary(ctx);
    }
    if (ctx.message && ctx.message.text === '⬅️ Back') {
      return processSingleFile(ctx, null, null, true);
    }
    if (ctx.message && ctx.message.text === '❌ Cancel') {
      releasePendingFiles(ctx);
      await ctx.reply('Upload cancelled.', bbtb.mainMenu);
      return ctx.scene.leave();
    }
    if (ctx.message && ctx.message.text) {
      const path = ctx.message.text.trim();
      if (/\/\/|^\/|\s\/|\/\s/.test(path)) {
        await ctx.reply(format.errorMessage(
          'Invalid path',
          `"${path}" contains a double slash, leading slash, or space around a slash`,
          `${PATH_EXAMPLES}\n\nTry again, or tap 📍 Use Root below.`
        ));
        return;
      }
      ctx.wizard.state.pendingFiles[0].path = path || ctx.wizard.state.pendingFiles[0].filename;
      return showSummary(ctx);
    }
  },

  async (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'upload:summary:list') {
      await ctx.answerCbQuery();
      const list = ctx.wizard.state.pendingFiles
        .map((f) => `${statusIcon(f.status)} ${f.path}${f.status === 'modified' ? ` (${f.oldSize} → ${f.newSize})` : ''}`)
        .join('\n');
      const toDelete = ctx.wizard.state.toDelete || [];
      const delList = toDelete.length ? `\n\n🗑 Will be REMOVED:\n${toDelete.join('\n')}` : '';
      await ctx.reply(`📋 Files:\n${list}${delList}`);
      return;
    }
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'upload:cancel') {
      await ctx.answerCbQuery();
      releasePendingFiles(ctx);
      await ctx.reply('Upload cancelled.', bbtb.mainMenu);
      return ctx.scene.leave();
    }
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'upload:commit') {
      await ctx.answerCbQuery();
      const changed = ctx.wizard.state.pendingFiles.filter((f) => f.status !== 'unchanged');
      const toDelete = ctx.wizard.state.toDelete || [];
      if (changed.length === 0 && toDelete.length === 0) {
        releasePendingFiles(ctx);
        await ctx.reply('➖ Nothing to commit — every file matches what\u2019s already in the repo.', bbtb.mainMenu);
        return ctx.scene.leave();
      }
      await ctx.reply('Write a commit message, or use default.', bbtb.cancelWithSkip);
      return ctx.wizard.next();
    }
    await ctx.reply('Tap 📋 View File List, ✅ Commit Changes, or ❌ Cancel above.');
  },

  async (ctx) => {
    const defaultsLib = require('../lib/defaults');
    const d = await defaultsLib.getDefaults(ctx.from.id);
    let message = ctx.wizard.state.mode === 'replaceFolder'
      ? 'Sync via GitroHub'
      : (d && d.default_commit_message) || 'Update via GitroHub';
    if (ctx.message && ctx.message.text === '❌ Cancel') {
      releasePendingFiles(ctx);
      await ctx.reply('Upload cancelled.', bbtb.mainMenu);
      return ctx.scene.leave();
    }
    if (ctx.message && ctx.message.text && ctx.message.text !== '⏭️ Skip') {
      message = ctx.message.text.trim();
    } else if (!(ctx.message && ctx.message.text === '⏭️ Skip')) {
      await ctx.reply('Send a commit message, tap ⏭️ Skip for default, or ❌ Cancel.');
      return;
    }

    const token = await requireConnected(ctx);
    if (!token) return ctx.scene.leave();

    const changed = ctx.wizard.state.pendingFiles.filter((f) => f.status !== 'unchanged');
    const toDelete = ctx.wizard.state.toDelete || [];
    const actionLock = require('../lib/actionLock');
    const { skipped } = await actionLock.withLock(ctx.from.id, 'uploadCommit', async () => {
    try {
      const user = await repoCache.getUser(ctx.from.id, token);
      await github.commitMultipleFiles(
        token,
        user.login,
        ctx.wizard.state.repoName,
        changed.map((f) => ({ path: f.path, content: fileBufferCache.get(f.contentRef) })),
        message,
        toDelete
      );
      repoCache.invalidateRepos(ctx.from.id);
      repoCache.invalidateLanguages(ctx.from.id, ctx.wizard.state.repoName);
      repoCache.invalidateTreeStats(ctx.from.id, ctx.wizard.state.repoName);
      await activity.log(
        ctx.from.id,
        '⬆️',
        `${ctx.wizard.state.mode === 'replaceFolder' ? 'Synced' : 'Uploaded'} ${changed.length} file(s)${toDelete.length ? `, removed ${toDelete.length}` : ''} → ${ctx.wizard.state.repoName}`
      );

      if (changed.length > 0) {
        const dir = changed[0].path.split('/').slice(0, -1).join('/');
        await pathMemory.setLastPath(ctx.from.id, ctx.wizard.state.repoName, dir);
      }

      let summary = `✅ Pushed ${changed.length} changes to ${ctx.wizard.state.repoName}`;
      if (toDelete.length) summary += `, removed ${toDelete.length}`;
      summary += `\nCommit: "${message}"`;

      const bulkActions = require('../handlers/bulkActions');
      await bulkActions.maybeAddLongOpNotice(ctx, changed.length + toDelete.length, { label: 'files' });
      await ctx.reply(summary, bbtb.mainMenu);
    } catch (err) {
      await activity.log(ctx.from.id, '⚠️', `Upload commit failed → ${ctx.wizard.state.repoName}`, { detail: err.message, isError: true });
      const errorHelpers = require('../lib/errorHelpers');
      const wasAuthError = await errorHelpers.replyGithubError(ctx, err, 'Upload failed');
      if (!wasAuthError) await ctx.reply('📍 Main Menu', bbtb.mainMenu);
    }
    });
    if (skipped) await ctx.reply('⏳ Already uploading — please wait a moment.');
    releasePendingFiles(ctx);
    return ctx.scene.leave();
  }
);

function statusIcon(status) {
  return { new: '🆕', modified: '✏️', unchanged: '➖' }[status] || '•';
}

async function promptForFile(ctx) {
  const dirLabel = ctx.wizard.state.presetDir ? ` (into ${ctx.wizard.state.presetDir}/)` : '';
  await ctx.reply(
    `📤 Send a file or a .zip (max ${format.formatBytes(config.MAX_ZIP_SIZE_BYTES)}) to upload to ${ctx.wizard.state.repoName}${dirLabel}\n\n` +
    `⚠️ Send it as a document/file attachment (📎 icon → File) — not via the photo/gallery picker, which compresses images and would alter the file's bytes.`,
    bbtb.cancelOnly
  );
  return ctx.wizard.selectStep(1);
}

function withPresetDir(ctx, path) {
  const dir = ctx.wizard.state.presetDir;
  return dir ? `${dir}/${path}` : path;
}

async function classifyFiles(ctx, fileRefs) {
  const token = await requireConnected(ctx);
  if (!token) return null;
  const user = await repoCache.getUser(ctx.from.id, token);

  let existingTree = [];
  try {
    existingTree = await github.getTree(token, user.login, ctx.wizard.state.repoName);
  } catch (_) {
    // empty/new repo — everything is new
  }
  const existingByPath = new Map(existingTree.map((e) => [e.path, e.sha]));

  const classified = await Promise.all(fileRefs.map(async (f) => {
    const content = fileBufferCache.get(f.contentRef);
    const existingSha = existingByPath.get(f.path);
    const localSha = gitBlobSha(content);
    let status = 'new';
    let oldSize;
    if (existingSha) {
      status = existingSha === localSha ? 'unchanged' : 'modified';
      if (status === 'modified') {
        try {
          const existing = await github.getFileContent(token, user.login, ctx.wizard.state.repoName, f.path);
          oldSize = format.formatBytes(existing.size);
        } catch (_) { /* best-effort */ }
      }
    }
    return { ...f, status, oldSize, newSize: format.formatBytes(f.size) };
  }));

  if (ctx.wizard.state.mode === 'replaceFolder') {
    const targetDir = ctx.wizard.state.presetDir || '';
    const prefix = targetDir ? `${targetDir}/` : '';
    const uploadedPaths = new Set(fileRefs.map((f) => f.path));
    ctx.wizard.state.toDelete = existingTree
      .filter((e) => e.path.startsWith(prefix) && !uploadedPaths.has(e.path))
      .map((e) => e.path);
  }

  return classified;
}

async function processSingleFile(ctx, buffer, filename, isBackNav = false) {
  if (!isBackNav) {
    const content = buffer.toString('utf8');
    const contentRef = fileBufferCache.put(content);
    ctx.wizard.state.pendingFiles = [{ filename, contentRef, size: Buffer.byteLength(content, 'utf8'), path: null }];
    delete ctx.wizard.state.pendingFiles[0].status;
  }

  if (ctx.wizard.state.lockedPath && !isBackNav) {
    ctx.wizard.state.pendingFiles[0].path = ctx.wizard.state.lockedPath;
    return showSummary(ctx);
  }

  if (ctx.wizard.state.presetDir && !isBackNav) {
    ctx.wizard.state.pendingFiles[0].path = withPresetDir(ctx, ctx.wizard.state.pendingFiles[0].filename);
    return showSummary(ctx);
  }

  const token = await requireConnected(ctx);
  if (!token) return ctx.scene.leave();

  let structureLine = '';
  try {
    const user = await repoCache.getUser(ctx.from.id, token);
    const tree = await github.getTree(token, user.login, ctx.wizard.state.repoName);
    const topLevel = listDirectory(tree, '');
    if (topLevel.length > 0) {
      const preview = topLevel.slice(0, 8).map((e) => (e.type === 'tree' ? `📁 ${e.name}/` : `📄 ${e.name}`)).join('\n');
      structureLine = `\n\n📂 Current top-level contents:\n${preview}${topLevel.length > 8 ? `\n… and ${topLevel.length - 8} more` : ''}`;
    } else {
      structureLine = '\n\n📂 This repo is currently empty.';
    }
  } catch (_) { /* best-effort */ }

  const f = ctx.wizard.state.pendingFiles[0];
  const defaultsLib = require('../lib/defaults');
  const d = await defaultsLib.getDefaults(ctx.from.id);
  const pathButtons = [
    [style.callback('📁 Browse Folders', 'upload:choose:browse')],
    [style.callback('📍 Root Directory', 'upload:choose:root')],
  ];
  if (d && d.default_upload_path) {
    pathButtons.push([style.callback(`⭐ Use Default (${d.default_upload_path}/)`, 'upload:choose:default')]);
  }
  if (ctx.wizard.state.suggestedDir && ctx.wizard.state.suggestedDir !== (d && d.default_upload_path)) {
    pathButtons.push([style.callback(`🕘 Last Used Here (${ctx.wizard.state.suggestedDir}/)`, 'upload:choose:suggested')]);
  }
  await ctx.reply(
    `📄 Received: ${f.filename} (${format.formatBytes(f.size)})\nWhere should this go?${structureLine}`,
    {
      ...Markup.inlineKeyboard(pathButtons),
      ...Markup.keyboard([['⌨️ Type Path Instead'], ['❌ Cancel']]).resize(),
    }
  );
  return ctx.wizard.selectStep(2);
}

async function processZip(ctx, buffer) {
  await ctx.reply(`📦 Zip received (${format.formatBytes(buffer.length)}) — extracting...`);

  let zip;
  try {
    const AdmZip = require('adm-zip');
    zip = new AdmZip(buffer);
  } catch (err) {
    await ctx.reply(format.errorMessage('Upload failed', 'the zip file appears corrupted or empty', 'Re-export the zip and try again.'));
    return;
  }

  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length === 0) {
    await ctx.reply(format.errorMessage('Upload failed', 'the zip contains no files', 'Check the archive and try again.'));
    return;
  }

  // Zip bomb guard: check total UNCOMPRESSED size from the entries'
  // metadata (available without actually decompressing anything) before
  // extracting a single byte. A small compressed file can still expand to
  // an enormous amount in memory — this catches that before it happens,
  // not after.
  const totalUncompressed = entries.reduce((sum, e) => sum + (e.header ? e.header.size : 0), 0);
  if (totalUncompressed > config.MAX_ZIP_UNCOMPRESSED_BYTES) {
    await ctx.reply(format.errorMessage(
      'Upload failed',
      `this zip decompresses to ${format.formatBytes(totalUncompressed)}, which exceeds the ${format.formatBytes(config.MAX_ZIP_UNCOMPRESSED_BYTES)} limit`,
      'This is usually caused by a highly-compressed or corrupted archive — check the zip and try again.'
    ));
    return;
  }

  const topLevels = new Set(entries.map((e) => e.entryName.split('/')[0]));
  let stripPrefix = '';
  if (topLevels.size === 1) {
    const only = [...topLevels][0];
    if (entries.every((e) => e.entryName.startsWith(`${only}/`))) {
      stripPrefix = `${only}/`;
    }
  }

  const fileRefs = entries.map((e) => {
    const relativePath = stripPrefix ? e.entryName.slice(stripPrefix.length) : e.entryName;
    const content = e.getData().toString('utf8');
    const contentRef = fileBufferCache.put(content);
    return {
      path: withPresetDir(ctx, relativePath),
      contentRef,
      size: Buffer.byteLength(content, 'utf8'),
    };
  });

  const classified = await classifyFiles(ctx, fileRefs);
  if (!classified) return ctx.scene.leave();

  ctx.wizard.state.pendingFiles = classified;
  return showSummary(ctx);
}

async function showSummary(ctx) {
  if (ctx.wizard.state.pendingFiles.length === 1 && !ctx.wizard.state.pendingFiles[0].status) {
    const classified = await classifyFiles(ctx, ctx.wizard.state.pendingFiles);
    if (!classified) return ctx.scene.leave();
    ctx.wizard.state.pendingFiles = classified;
  }

  const files = ctx.wizard.state.pendingFiles;
  const counts = { new: 0, modified: 0, unchanged: 0 };
  files.forEach((f) => counts[f.status]++);
  const toDelete = ctx.wizard.state.toDelete || [];

  await ctx.reply('📦 Upload Summary', bbtb.uploadSummary);

  if (counts.new === 0 && counts.modified === 0 && toDelete.length === 0) {
    const names = files.map((f) => f.path).join(', ');
    releasePendingFiles(ctx);
    await ctx.reply(
      `📦 Upload Summary → ${ctx.wizard.state.repoName}\n` +
      `➖ No changes detected — ${files.length === 1 ? `"${names}" matches` : `all ${files.length} files match`} what's already in the repo.\n\n` +
      `Nothing to upload.`,
      Markup.inlineKeyboard([[style.callback('📦 Open Repo', `repo:${ctx.wizard.state.repoName}`)]])
    );
    return ctx.scene.leave();
  }

  const changeDetail = files
    .filter((f) => f.status === 'modified')
    .slice(0, 3)
    .map((f) => `✏️ ${f.path}: ${f.oldSize || '?'} → ${f.newSize}`)
    .join('\n');

  let text =
    `📦 Upload Summary → ${ctx.wizard.state.repoName}\n` +
    `🆕 New: ${counts.new}   ✏️ Modified: ${counts.modified}   ➖ Unchanged: ${counts.unchanged} (skipped)`;
  if (toDelete.length > 0) text += `   🗑 To Delete: ${toDelete.length}`;
  if (changeDetail) text += `\n\n${changeDetail}`;
  if (toDelete.length > 0) {
    text += `\n\n🗑 Will be REMOVED:\n${toDelete.slice(0, 5).join('\n')}${toDelete.length > 5 ? `\n… and ${toDelete.length - 5} more` : ''}`;
  }

  await ctx.reply(text, {
    ...Markup.inlineKeyboard([
      [style.callback('📋 View File List', 'upload:summary:list')],
      [style.callback('✅ Commit Changes', 'upload:commit'), style.callback('❌ Cancel', 'upload:cancel')],
    ]),
  });
  return ctx.wizard.selectStep(3);
}

module.exports = scene;
module.exports.releaseOnExternalLeave = releaseOnExternalLeave;
