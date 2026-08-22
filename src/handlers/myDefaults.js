const { Markup } = require('telegraf');
const style = require('../keyboards/buttonStyle');
const defaults = require('../lib/defaults');
const format = require('../lib/format');
const bbtb = require('../keyboards/bbtb');

const SORT_LABELS = { updated: '🕒 Recently Updated', name: '🔤 Name (A-Z)', stars: '⭐ Most Stars', created: '📅 Recently Created', language: '💻 Dominant Language' };
const FILTER_LABELS = { all: 'All', public: '🌐 Public', private: '🔒 Private', forks: '🍴 Forks' };

async function showDefaults(ctx) {
  const d = await defaults.getDefaults(ctx.from.id);
  if (!d) return;

  const users = require('../lib/users');
  const prefs = await users.getNotificationPrefs(ctx.from.id);
  const onCount = prefs ? Object.values(prefs).filter(Boolean).length : 0;
  const totalCount = prefs ? Object.keys(prefs).length : 4;

  const text =
    `⚙️ *My Defaults*\n\n` +
    `📦 New Repo visibility: ${d.default_visibility === 'private' ? '🔒 Private' : '🌐 Public'}\n` +
    `📝 Default commit message: "${format.escapeMd(d.default_commit_message)}"\n` +
    `📁 Default upload path: ${d.default_upload_path ? format.escapeMd(d.default_upload_path) : '\\(Root\\)'}\n` +
    `↕️ Default repo sort: ${format.escapeMd(SORT_LABELS[d.default_sort] || d.default_sort)}\n` +
    `🔎 Default repo filter: ${format.escapeMd(FILTER_LABELS[d.default_filter] || d.default_filter)}\n` +
    `🧠 Auto\\-suggest defaults: ${d.auto_suggest_defaults ? 'On' : 'Off'}\n\n` +
    `🔔 *NOTIFICATIONS*\n` +
    `${onCount}/${totalCount} categories on`;

  const rows = [
    [style.callback('🔒 Visibility', 'defaults:visibility', style.BLUE), style.callback('📝 Commit Message', 'defaults:commit', style.BLUE)],
    [style.callback('📁 Upload Path', 'defaults:path', style.BLUE), style.callback('↕️ Sort & Filter', 'defaults:sortfilter', style.BLUE)],
    [style.callback(d.auto_suggest_defaults ? '🧠 Turn Off Auto-Suggest' : '🧠 Turn On Auto-Suggest', 'defaults:togglelearn')],
    [style.callback('🔔 Notifications', 'defaults:notifications', style.BLUE)],
  ];

  await ctx.reply('⚙️ My Defaults', bbtb.backToSettings);
  await ctx.reply(text, { parse_mode: 'MarkdownV2', ...Markup.inlineKeyboard(rows) });
}

async function editVisibility(ctx) {
  await ctx.reply('Choose your default visibility for new repos:', Markup.inlineKeyboard([
    [style.callback('🔒 Private', 'defaults:setvisibility:private')],
    [style.callback('🌐 Public', 'defaults:setvisibility:public')],
  ]));
}

async function setVisibility(ctx, value) {
  await defaults.setDefault(ctx.from.id, 'default_visibility', value);
  await ctx.reply('✅ Default visibility updated.');
  return showDefaults(ctx);
}

async function editSortFilter(ctx) {
  const rows = Object.entries(SORT_LABELS).map(([key, label]) => [style.callback(label, `defaults:setsort:${key}`)]);
  await ctx.reply('Choose your default sort order:', Markup.inlineKeyboard(rows));
}

async function setSort(ctx, value) {
  await defaults.setDefault(ctx.from.id, 'default_sort', value);
  const rows = Object.entries(FILTER_LABELS).map(([key, label]) => [style.callback(label, `defaults:setfilter:${key}`)]);
  await ctx.reply('Now choose your default filter:', Markup.inlineKeyboard(rows));
}

async function setFilter(ctx, value) {
  await defaults.setDefault(ctx.from.id, 'default_filter', value);
  await ctx.reply('✅ Default sort & filter updated.');
  return showDefaults(ctx);
}

async function toggleLearn(ctx) {
  const d = await defaults.getDefaults(ctx.from.id);
  await defaults.setDefault(ctx.from.id, 'auto_suggest_defaults', !d.auto_suggest_defaults);
  return showDefaults(ctx);
}

/** Text-input flows for commit message and upload path, driven by session flags (see bot.js text router) */
async function startEditCommitMessage(ctx) {
  ctx.session.editingDefault = 'commit';
  await ctx.reply('📝 Send your new default commit message.', bbtb.cancelOnly);
}

async function startEditUploadPath(ctx) {
  ctx.session.editingDefault = 'path';
  await ctx.reply('📁 Send your new default upload path, or send "root" for the repo root.', bbtb.cancelOnly);
}

async function handleTextInput(ctx) {
  const field = ctx.session.editingDefault;
  const text = ctx.message.text.trim();

  if (text === '❌ Cancel') {
    delete ctx.session.editingDefault;
    await ctx.reply('Cancelled.');
    return showDefaults(ctx);
  }

  if (field === 'commit') {
    if (text.length > 200) {
      await ctx.reply(format.errorMessage('Message too long', 'commit messages over 200 characters get unwieldy in git history', 'Try something shorter.'));
      return;
    }
    await defaults.setDefault(ctx.from.id, 'default_commit_message', text);
  } else if (field === 'path') {
    const path = text.toLowerCase() === 'root' ? '' : text;
    if (/\/\/|^\/|\s\/|\/\s/.test(path)) {
      await ctx.reply(format.errorMessage('Invalid path', `"${path}" contains a double slash, leading slash, or space around a slash`, 'Try again.'));
      return;
    }
    await defaults.setDefault(ctx.from.id, 'default_upload_path', path);
  }

  delete ctx.session.editingDefault;
  await ctx.reply('✅ Default updated.');
  return showDefaults(ctx);
}

module.exports = {
  showDefaults,
  editVisibility,
  setVisibility,
  editSortFilter,
  setSort,
  setFilter,
  toggleLearn,
  startEditCommitMessage,
  startEditUploadPath,
  handleTextInput,
};
