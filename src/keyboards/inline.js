const { Markup } = require('telegraf');
const style = require('./buttonStyle');

/** Repo list — each repo is its own tappable row, plus pagination + filter/sort labels */
function repoList(repos, page, totalPages, filterLabel, sortLabel) {
  const rows = repos.map((r) => [style.callback(`📦 ${r.name}`, `repo:${r.name}`, style.BLUE)]);
  const pagination = [];
  if (page > 1) pagination.push(style.callback('⬅️ Prev', `repos:page:${page - 1}`, style.BLUE));
  if (page < totalPages) pagination.push(style.callback('Next ➡️', `repos:page:${page + 1}`, style.BLUE));
  if (pagination.length) rows.push(pagination);
  return Markup.inlineKeyboard(rows);
}

const filterMenu = Markup.inlineKeyboard([
  [style.callback('All', 'filter:all'), style.callback('🌐 Public', 'filter:public')],
  [style.callback('🔒 Private', 'filter:private'), style.callback('🍴 Forks', 'filter:forks')],
  [style.callback('🏷️ By Tag ▾', 'filter:tagmenu'), style.callback('💻 By Language ▾', 'filter:langmenu')],
  [style.callback('⬅️ Back', 'repos:back', style.BLUE)],
]);

const sortMenu = Markup.inlineKeyboard([
  [style.callback('🕒 Recently Updated', 'sort:updated')],
  [style.callback('🔤 Name (A-Z)', 'sort:name')],
  [style.callback('⭐ Most Stars', 'sort:stars')],
  [style.callback('📅 Recently Created', 'sort:created')],
  [style.callback('💻 Dominant Language (A-Z)', 'sort:language')],
  [style.callback('⬅️ Back', 'repos:back', style.BLUE)],
]);

/** Repo View info card — Rename, Pin/Unpin, Tags stay inline; Delete Repo is the destructive one */
function repoActions(repoName, pinned = false) {
  return Markup.inlineKeyboard([
    [
      style.callback('✏️ Rename', `repo:rename:${repoName}`, style.BLUE),
      style.callback('✏️ Description', `repo:description:${repoName}`, style.BLUE),
    ],
    [
      style.callback(pinned ? '📌 Unpin' : '📌 Pin', `repo:pin:${repoName}`, style.BLUE),
      style.callback('🏷️ Tags', `repo:tags:${repoName}`, style.BLUE),
    ],
    [style.callback('🗑 Delete Repo', `repo:delete:${repoName}`, style.BLUE)],
  ]);
}

function deleteRepoConfirm(repoName) {
  return Markup.inlineKeyboard([
    [style.callback('✅ Yes, Delete', `repo:delete:confirm:${repoName}`, style.RED)],
    [style.callback('❌ Cancel', `repo:delete:cancel:${repoName}`, style.GREEN)],
  ]);
}

function visibilityConfirm(repoName, currentlyPrivate) {
  const label = currentlyPrivate ? '🌐 Switch to Public' : '🔒 Switch to Private';
  return Markup.inlineKeyboard([
    [style.callback(label, `repo:visibility:confirm:${repoName}`, style.BLUE)],
    [style.callback('❌ Cancel', `repo:visibility:cancel:${repoName}`, style.BLUE)],
  ]);
}

const createRepoVisibility = Markup.inlineKeyboard([
  [style.callback('🔒 Private', 'create:visibility:private')],
  [style.callback('🌐 Public', 'create:visibility:public')],
]);

const createRepoConfirm = Markup.inlineKeyboard([
  [style.callback('✅ Create', 'create:confirm', style.GREEN)],
  [style.callback('❌ Cancel', 'create:cancel', style.RED)],
]);

const cancelConfirm = (scenePrefix) => Markup.inlineKeyboard([
  [style.callback('✅ Yes, Cancel', `${scenePrefix}:cancel:confirm`, style.RED)],
  [style.callback('⬅️ No, Go Back', `${scenePrefix}:cancel:abort`, style.GREEN)],
]);

function createRepoSuccess(repoName) {
  return Markup.inlineKeyboard([
    [style.callback('📦 Open Repo', `repo:${repoName}`, style.BLUE)],
    [style.callback('⬆️ Upload Files', `upload:start:${repoName}`, style.BLUE)],
  ]);
}

/** File/folder tree navigator — folders and files both rendered as rows */
/** Folder/file tree navigator — folders and files rendered as rows, with pagination for large folders */
function fileTree(entries, currentPath, pagination = null) {
  const rows = entries.map((e) => {
    const label = e.type === 'tree' ? `📁 ${e.name}/` : `📄 ${e.name}`;
    const action = e.type === 'tree' ? `browse:dir:${e.path}` : `browse:file:${e.path}`;
    return [style.callback(label, action, style.BLUE)];
  });

  if (pagination && pagination.totalPages > 1) {
    const nav = [];
    if (pagination.page > 1) nav.push(style.callback('⬅️ Prev', `browse:dirpage:${pagination.page - 1}:${currentPath}`, style.BLUE));
    if (pagination.page < pagination.totalPages) nav.push(style.callback('Next ➡️', `browse:dirpage:${pagination.page + 1}:${currentPath}`, style.BLUE));
    if (nav.length) rows.push(nav);
  }

  if (currentPath) {
    const parent = currentPath.split('/').slice(0, -1).join('/');
    rows.push([style.callback('⬅️ Up One Level', `browse:dir:${parent}`, style.BLUE)]);
  }
  return Markup.inlineKeyboard(rows);
}

function fileActions(path) {
  return Markup.inlineKeyboard([
    [style.callback('👁 View Content', `file:view:${path}`, style.BLUE), style.callback('📥 Send as File', `file:raw:${path}`, style.BLUE)],
    [style.callback('✏️ Edit', `file:edit:${path}`, style.BLUE), style.callback('🔁 Replace', `file:replace:${path}`, style.BLUE)],
    [style.callback('🗑 Delete File', `file:delete:${path}`, style.BLUE)],
    [style.callback('⬅️ Back to Folder', `browse:parent:${path}`, style.BLUE)],
  ]);
}

function deleteFileConfirm(path) {
  return Markup.inlineKeyboard([
    [style.callback('✅ Yes, Delete', `file:delete:confirm:${path}`, style.RED)],
    [style.callback('❌ Cancel', `file:delete:cancel:${path}`, style.GREEN)],
  ]);
}

function uploadPathChoice() {
  return Markup.inlineKeyboard([
    [style.callback('📁 Browse Folders', 'upload:choose:browse', style.BLUE)],
    [style.callback('📍 Root Directory', 'upload:choose:root', style.BLUE)],
  ]);
}

function uploadSummaryConfirm() {
  return Markup.inlineKeyboard([
    [style.callback('📋 View File List', 'upload:summary:list')],
    [style.callback('✅ Commit Changes', 'upload:commit', style.GREEN), style.callback('❌ Cancel', 'upload:cancel', style.RED)],
  ]);
}

function externalRepoActions() {
  return Markup.inlineKeyboard([
    [style.callback('⬇️ Download as ZIP', 'external:download', style.BLUE)],
    [style.callback('🍴 Fork to My Account', 'external:fork', style.BLUE)],
    [Markup.button.url('🔗 View on GitHub', '{{url}}')], // url patched by caller
    [style.callback('⬅️ Cancel', 'external:cancel', style.BLUE)],
  ]);
}

function forkConfirm() {
  return Markup.inlineKeyboard([
    [style.callback('✅ Confirm Fork', 'external:fork:confirm', style.GREEN)],
    [style.callback('❌ Cancel', 'external:fork:cancel', style.RED)],
  ]);
}

function notificationsMenu(prefs) {
  const check = (b) => (b ? '✅' : '⬜');
  return Markup.inlineKeyboard([
    [style.callback(`${check(prefs.githubActivity)} GitHub Activity`, 'notif:toggle:githubActivity')],
    [style.callback(`${check(prefs.systemAlerts)} System Alerts`, 'notif:toggle:systemAlerts')],
    [style.callback(`${check(prefs.longOps)} Long Operations`, 'notif:toggle:longOps')],
    [style.callback(`${check(prefs.tokenHealth)} Token Health`, 'notif:toggle:tokenHealth')],
    [style.callback('⬅️ Back', 'settings:back', style.BLUE)],
  ]);
}

function disconnectConfirm() {
  return Markup.inlineKeyboard([
    [style.callback('✅ Yes, Disconnect', 'settings:disconnect:confirm', style.RED)],
    [style.callback('❌ Cancel', 'settings:disconnect:cancel', style.GREEN)],
  ]);
}

function connectButton(url) {
  return Markup.inlineKeyboard([[Markup.button.url('🔗 Connect GitHub Account', url)]]);
}

function activityPagination(page, totalPages, errorsOnly) {
  const rows = [];
  const nav = [];
  if (page > 1) nav.push(style.callback('⬅️ Prev', `activity:page:${page - 1}:${errorsOnly}`, style.BLUE));
  if (page < totalPages) nav.push(style.callback('Next ➡️', `activity:page:${page + 1}:${errorsOnly}`, style.BLUE));
  if (nav.length) rows.push(nav);
  rows.push([
    style.callback(errorsOnly ? '⬅️ Back to Full Log' : '⚠️ Errors Only', `activity:filter:${!errorsOnly}`),
  ]);
  // Access Log relocated here from its own Settings BBTB row (#47) — same
  // content/flow as before, just reachable from inside Activity now.
  // Refresh relocated here too (#49), same chained-fresh-message pattern
  // as Settings' Refresh Status, instead of its own BBTB row that (per a
  // v0.8.1 audit) was actually colliding with My Repos' Refresh button.
  rows.push([
    style.callback('🔑 Access Log', 'activity:accesslog', style.BLUE),
    style.callback('🔄 Refresh', `activity:refresh:${errorsOnly}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

/** v0.8.0 search split — two explicit entry points instead of one box that
 * guessed intent from the input (fuzzy name vs pasted URL). */
function searchTypeMenu() {
  return Markup.inlineKeyboard([
    [style.callback('📁 My Repos', 'search:type:myrepos', style.BLUE)],
    [style.callback('🌐 Public Repo', 'search:type:public', style.BLUE)],
  ]);
}

module.exports = {
  repoList,
  filterMenu,
  sortMenu,
  repoActions,
  deleteRepoConfirm,
  visibilityConfirm,
  createRepoVisibility,
  createRepoConfirm,
  cancelConfirm,
  createRepoSuccess,
  fileTree,
  fileActions,
  deleteFileConfirm,
  uploadPathChoice,
  uploadSummaryConfirm,
  externalRepoActions,
  forkConfirm,
  notificationsMenu,
  disconnectConfirm,
  connectButton,
  activityPagination,
  searchTypeMenu,
};
