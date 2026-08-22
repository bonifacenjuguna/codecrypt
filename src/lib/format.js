/**
 * Central formatting helpers — implements the standing "Formatting Standard"
 * rule agreed on during design: consistent headers, key-value lines, relative
 * timestamps, language-color emoji, and the locked error/success message shapes.
 *
 * Keeping ALL formatting logic here means every screen in the bot renders
 * consistently, and if the style ever changes we only edit one file.
 */

// GitHub's real language colors, approximated with the closest emoji circle.
const LANGUAGE_EMOJI = {
  JavaScript: '🟨',
  TypeScript: '🔵',
  Python: '🔵',
  HTML: '🟧',
  CSS: '🟪',
  Shell: '🟩',
  Java: '🟫',
  Go: '🔷',
  Rust: '🟠',
  C: '⬜',
  'C++': '🩷',
  'C#': '🟢',
  PHP: '🟣',
  Ruby: '🔴',
  Swift: '🟠',
  Kotlin: '🟣',
  Dart: '🔵',
};

function languageEmoji(lang) {
  if (!lang) return '⚪';
  return LANGUAGE_EMOJI[lang] || '⚪';
}

function languageLine(lang) {
  return lang ? `${languageEmoji(lang)} ${lang}` : '⚪ No language detected';
}

/** Turns { JavaScript: 12000, HTML: 4000 } into "JavaScript 75% · HTML 25%" (top 3) */
function languageBreakdown(languages) {
  const entries = Object.entries(languages || {});
  if (entries.length === 0) return 'No language detected';
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([lang, bytes]) => `${lang} ${Math.round((bytes / total) * 100)}%`)
    .join(' · ');
}

function visibilityLine(isPrivate) {
  return isPrivate ? '🔒 Private' : '🌐 Public';
}

/** Relative timestamp per the locked rule: "12m ago" / "2h ago" / "3d ago" / "Month Year" */
function relativeTime(dateInput) {
  const date = new Date(dateInput);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;

  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Locked error shape: "⚠️ [What failed]: [specific reason].\n[Next step]" */
function errorMessage(what, reason, nextStep) {
  let msg = `⚠️ ${what}: ${reason}.`;
  if (nextStep) msg += `\n${nextStep}`;
  return msg;
}

/** Locked success shape: "✅ [What happened].\n[optional detail]" */
function successMessage(what, detail) {
  let msg = `✅ ${what}.`;
  if (detail) msg += `\n${detail}`;
  return msg;
}

/**
 * Locked bot-wide repo-card layout (v0.8.0 redesign) — used everywhere a
 * repo is listed: My Repos, Repo View, Pinned, Search results, Bulk Select
 * previews, and Stats. One function so every screen renders identically and
 * a future style change only touches one place.
 *
 *   📌 GitroHub
 *   ▸ JS · 🌐 Public · 2.4 MB · MIT
 *   ▸ ★ 0  🍴 0  ·  🕒 37m ago
 *   ▸ "A Telegram bot for tracking GitHub repos"
 *
 * `sizeBytes`, when provided (Repo View/Details, which already fetch the
 * tree), overrides GitHub's lagging cached `repo.size` field — see
 * lib/github.js getTreeStats(). List screens that don't already fetch a
 * per-repo tree fall back to repo.size to avoid an extra API call per row.
 */
function repoCard(repo, { pinned = false, license, description, sizeBytes, tagLine = '' } = {}) {
  const pin = pinned ? '📌 ' : '';
  const name = `${pin}*${escapeMd(repo.name)}*`;
  const lang = escapeMd(repo.language || 'No language');
  const vis = visibilityLine(repo.private);
  const bytes = typeof sizeBytes === 'number' ? sizeBytes : (repo.size || 0) * 1024;
  const size = escapeMd(formatBytes(bytes));
  const licName = license !== undefined ? license : (repo.license && (repo.license.name || repo.license.spdx_id));
  const lic = escapeMd(licName && licName !== 'NOASSERTION' ? licName : 'No license');
  const desc = description !== undefined ? description : repo.description;
  const descLine = desc ? `"${escapeMd(desc)}"` : 'No description yet';
  const updated = escapeMd(relativeTime(repo.updated_at || repo.pushed_at));

  let card =
    `${name}\n` +
    `▸ ${lang} · ${vis} · ${size} · ${lic}\n` +
    `▸ ★ ${repo.stargazers_count || 0}  🍴 ${repo.forks_count || 0}  ·  🕒 ${updated}\n` +
    `▸ ${descLine}`;
  if (tagLine) card += `\n${tagLine}`;
  return card;
}

/** The solid divider used between cards in every repo list. */
const CARD_DIVIDER = '──────────────────';

/** Locked ◆ section header: "◆ REPOSITORIES ──────── 4 total" */
function sectionHeader(title, countLabel) {
  const upper = title.toUpperCase();
  const dashes = '─'.repeat(Math.max(4, 24 - upper.length));
  return `◆ ${escapeMd(upper)} ${dashes} ${escapeMd(countLabel)}`;
}

/** Escapes MarkdownV2 reserved characters for safe Telegram rendering */
function escapeMd(text = '') {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/** Inside ``` code blocks, MarkdownV2 only requires escaping backslash and backtick */
function escapeCodeBlock(text = '') {
  return String(text).replace(/([\\`])/g, '\\$1');
}

module.exports = {
  languageEmoji,
  languageLine,
  languageBreakdown,
  visibilityLine,
  relativeTime,
  formatBytes,
  errorMessage,
  successMessage,
  escapeMd,
  escapeCodeBlock,
  repoCard,
  CARD_DIVIDER,
  sectionHeader,
};
