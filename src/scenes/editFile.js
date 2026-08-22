const { Scenes, Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const github = require('../lib/github');
const repoCache = require('../lib/repoCache');
const requireConnected = require('../lib/requireConnected');
const format = require('../lib/format');
const bbtb = require('../keyboards/bbtb');
const activity = require('../lib/activity');

/**
 * Returns the user to exactly where they were — the Browse Files folder
 * containing this file — instead of dumping them at Main Menu. This was a
 * reported bug: Cancel (and every exit path) used to hard-reset to
 * bbtb.mainMenu regardless of context.
 */
async function returnToFolder(ctx, repoName, filePath) {
  const browseFiles = require('../handlers/browseFiles');
  const parentDir = filePath.split('/').slice(0, -1).join('/');
  return browseFiles.showDirectory(ctx, repoName, parentDir);
}

const scene = new Scenes.WizardScene(
  'editFile',

  async (ctx) => {
    const { repoName, filePath } = ctx.scene.state;
    ctx.wizard.state.repoName = repoName;
    ctx.wizard.state.filePath = filePath;

    const token = await requireConnected(ctx);
    if (!token) return ctx.scene.leave();

    try {
      const user = await repoCache.getUser(ctx.from.id, token);
      const { content, sha } = await github.getFileContent(token, user.login, repoName, filePath);
      ctx.wizard.state.originalContent = content;
      ctx.wizard.state.sha = sha;

      await ctx.reply(
        `✏️ Editing ${filePath}\nCurrent content sent below. Reply with the full new content to replace it, or Cancel.`,
        bbtb.cancelOnly
      );
      if (content.length < 3500) {
        await ctx.reply('```\n' + format.escapeCodeBlock(content) + '\n```', { parse_mode: 'MarkdownV2' }).catch(() =>
          ctx.replyWithDocument({ source: Buffer.from(content), filename: filePath.split('/').pop() })
        );
      } else {
        await ctx.replyWithDocument({ source: Buffer.from(content), filename: filePath.split('/').pop() });
      }
      return ctx.wizard.next();
    } catch (err) {
      const errorHelpers = require('../lib/errorHelpers');
      await errorHelpers.replyGithubError(ctx, err, 'Couldn\u2019t load file for editing');
      await ctx.scene.leave();
      return returnToFolder(ctx, repoName, filePath);
    }
  },

  async (ctx) => {
    const { repoName, filePath } = ctx.wizard.state;

    if (ctx.message && ctx.message.text === '❌ Cancel') {
      await ctx.reply('Edit cancelled.');
      await ctx.scene.leave();
      return returnToFolder(ctx, repoName, filePath);
    }
    if (!ctx.message || !ctx.message.text) {
      await ctx.reply('Reply with the new file content as text, or ❌ Cancel.');
      return;
    }

    ctx.wizard.state.newContent = ctx.message.text;
    const oldLines = ctx.wizard.state.originalContent.split('\n').length;
    const newLines = ctx.message.text.split('\n').length;
    const diff = newLines - oldLines;
    const diffLabel = diff >= 0 ? `+${diff} lines added` : `${Math.abs(diff)} lines removed`;

    await ctx.reply(
      `✏️ Confirm edit to ${filePath}\n${diffLabel}`,
      Markup.inlineKeyboard([
        [style.callback('✅ Commit Change', 'edit:confirm', style.GREEN)],
        [style.callback('❌ Cancel', 'edit:cancel', style.RED)],
      ])
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const { repoName, filePath, newContent, sha } = ctx.wizard.state;

    if (!ctx.callbackQuery) {
      await ctx.reply('Tap ✅ Commit Change or ❌ Cancel above.');
      return;
    }
    await ctx.answerCbQuery();
    if (ctx.callbackQuery.data === 'edit:cancel') {
      await ctx.reply('Edit cancelled.');
      await ctx.scene.leave();
      return returnToFolder(ctx, repoName, filePath);
    }
    if (ctx.callbackQuery.data !== 'edit:confirm') {
      // Stray/stale callback from an unrelated old message — don't treat
      // it as a commit confirmation.
      await ctx.reply('Tap ✅ Commit Change or ❌ Cancel above.');
      return;
    }

    const token = await requireConnected(ctx);
    if (!token) return ctx.scene.leave();

    const actionLock = require('../lib/actionLock');
    const { skipped } = await actionLock.withLock(ctx.from.id, 'editFile', async () => {
    try {
      const user = await repoCache.getUser(ctx.from.id, token);
      const current = await github.getFileContent(token, user.login, repoName, filePath);
      if (current.sha !== sha) {
        await ctx.reply(format.errorMessage(
          'Edit failed',
          `${filePath} was modified on GitHub since you opened it`,
          'Your changes weren\u2019t lost — view the latest version first to avoid overwriting it.'
        ));
        return;
      }

      await github.putFile(token, user.login, repoName, filePath, newContent, `Update ${filePath} via GitroHub`, sha);
      repoCache.invalidateRepos(ctx.from.id);
      repoCache.invalidateLanguages(ctx.from.id, repoName);
      repoCache.invalidateTreeStats(ctx.from.id, repoName);
      await activity.log(ctx.from.id, '✏️', `Edited file → ${filePath} (${repoName})`);
      await ctx.reply(format.successMessage(`Updated ${filePath}`));
    } catch (err) {
      await activity.log(ctx.from.id, '⚠️', `Edit failed → ${filePath}`, { detail: err.message, isError: true });
      const errorHelpers = require('../lib/errorHelpers');
      await errorHelpers.replyGithubError(ctx, err, 'Edit failed');
    }
    });
    if (skipped) await ctx.reply('⏳ Already saving — please wait a moment.');
    await ctx.scene.leave();
    return returnToFolder(ctx, repoName, filePath);
  }
);

module.exports = scene;
