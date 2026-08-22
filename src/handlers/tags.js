const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const tags = require('../lib/tags');
const format = require('../lib/format');
const requireConnected = require('../lib/requireConnected');

// Every write function below is gated behind requireConnected (v0.8.1 #25/#22)
// — previously NONE of them checked connection state at all, so a stale
// button from an old message could add/remove/create tags for a repo with
// zero indication anything was wrong, even fully disconnected.

async function showRepoTags(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;
  const telegramId = ctx.from.id;
  const current = await tags.tagsForRepo(telegramId, repoName);

  const currentLine = current.length > 0
    ? current.map((t) => `${t.emoji} ${t.name}`).join(', ')
    : 'None yet';

  const rows = [
    [style.callback('➕ Add Tag', `tags:add:${repoName}`, style.BLUE)],
  ];
  if (current.length > 0) {
    rows.push([style.callback('🗑 Remove Tag', `tags:removemenu:${repoName}`, style.BLUE)]);
  }
  rows.push([style.callback('⬅️ Back to Repo', `repo:${repoName}`, style.BLUE)]);

  await ctx.reply(
    `🏷️ *Tags for ${format.escapeMd(repoName)}*\nCurrent: ${format.escapeMd(currentLine)}`,
    { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) }
  );
}

async function showAddTagMenu(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;
  const telegramId = ctx.from.id;
  const [allTags, assigned] = await Promise.all([
    tags.listTags(telegramId),
    tags.tagsForRepo(telegramId, repoName),
  ]);
  const assignedIds = new Set(assigned.map((t) => t.id));
  const available = allTags.filter((t) => !assignedIds.has(t.id));

  const rows = available.map((t) => [
    style.callback(`${t.emoji} ${t.name}`, `tags:assign:${repoName}:${t.id}`),
  ]);
  rows.push([style.callback('➕ Create New Tag', `tags:create:${repoName}`, style.BLUE)]);
  rows.push([style.callback('⬅️ Back', `repo:tags:${repoName}`, style.BLUE)]);

  const text = available.length > 0
    ? `🏷️ Add a tag to ${format.escapeMd(repoName)}:`
    : `🏷️ You don't have any unused tags yet — create one:`;

  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

async function assignExistingTag(ctx, repoName, tagId) {
  const token = await requireConnected(ctx);
  if (!token) return;
  await tags.assignTag(ctx.from.id, repoName, Number(tagId));
  await ctx.reply('✅ Tag added.');
  return showRepoTags(ctx, repoName);
}

async function showRemoveTagMenu(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;
  const current = await tags.tagsForRepo(ctx.from.id, repoName);
  const rows = current.map((t) => [
    style.callback(`${t.emoji} ${t.name}`, `tags:removeconfirm:${repoName}:${t.id}`),
  ]);
  rows.push([style.callback('⬅️ Back', `repo:tags:${repoName}`, style.BLUE)]);
  await ctx.reply('🗑 Tap a tag to remove it:', Markup.inlineKeyboard(rows));
}

async function removeTag(ctx, repoName, tagId) {
  const token = await requireConnected(ctx);
  if (!token) return;
  await tags.removeTagFromRepo(ctx.from.id, repoName, Number(tagId));
  await ctx.reply('✅ Tag removed.');

  // If that was the tag's last assignment anywhere, offer to delete the
  // tag definition entirely instead of leaving an unused tag lingering.
  const allTags = await tags.listTags(ctx.from.id);
  const tag = allTags.find((t) => t.id === Number(tagId));
  if (tag && tag.repo_count === 0) {
    await ctx.reply(
      `🏷️ "${tag.emoji} ${tag.name}" isn't used on any repos anymore. Delete this tag entirely?`,
      Markup.inlineKeyboard([
        [style.callback('🗑 Delete Tag', `tags:deletetag:${tagId}:${repoName}`)],
        [style.callback('➖ Keep It', `repo:tags:${repoName}`)],
      ])
    );
    return;
  }
  return showRepoTags(ctx, repoName);
}

async function deleteTagDefinition(ctx, tagId, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;
  await tags.deleteTag(ctx.from.id, Number(tagId));
  await ctx.reply('✅ Tag deleted.');
  return showRepoTags(ctx, repoName);
}

/** Starts the 2-step "create a new tag" text-input flow (name, then emoji) */
async function startCreateTag(ctx, repoName) {
  const token = await requireConnected(ctx);
  if (!token) return;
  ctx.session.creatingTag = { repoName, step: 'name' };
  await ctx.reply(
    '🏷️ New tag — send a short name (e.g. "Client Work")',
    Markup.keyboard([['❌ Cancel']]).resize()
  );
}

/** Called from the text router when ctx.session.creatingTag is set */
async function handleCreateTagInput(ctx) {
  const state = ctx.session.creatingTag;
  const text = ctx.message.text.trim();

  if (text === '❌ Cancel') {
    delete ctx.session.creatingTag;
    await ctx.reply('Cancelled.');
    return showRepoTags(ctx, state.repoName);
  }

  if (state.step === 'name') {
    if (text.length > 30) {
      await ctx.reply(format.errorMessage('Tag name too long', `"${text}" is over 30 characters`, 'Try a shorter name.'));
      return;
    }
    state.name = text;
    state.step = 'emoji';
    await ctx.reply('Now send a single emoji for this tag (e.g. 🤖):');
    return;
  }

  if (state.step === 'emoji') {
    const token = await requireConnected(ctx);
    if (!token) { delete ctx.session.creatingTag; return; }
    // Basic sanity check — a real emoji is short; reject obvious plain text
    if (text.length > 4) {
      await ctx.reply(format.errorMessage('That doesn\u2019t look like an emoji', `"${text}" is too long`, 'Send a single emoji, e.g. 🤖'));
      return;
    }
    const created = await tags.createTag(ctx.from.id, state.name, text);
    await tags.assignTag(ctx.from.id, state.repoName, created.id);
    delete ctx.session.creatingTag;
    await ctx.reply(`✅ Created and added tag: ${text} ${state.name}`);
    return showRepoTags(ctx, state.repoName);
  }
}

module.exports = {
  showRepoTags,
  showAddTagMenu,
  assignExistingTag,
  showRemoveTagMenu,
  removeTag,
  deleteTagDefinition,
  startCreateTag,
  handleCreateTagInput,
};
