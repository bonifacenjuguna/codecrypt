/**
 * Bot API 9.4 (Feb 2026) added a `style` field to both InlineKeyboardButton
 * and KeyboardButton — three preset colors: 'danger' (red), 'success'
 * (green), 'primary' (blue). Telegram just reads whatever JSON is sent, so
 * these helpers attach `style` directly onto the button object Telegraf's
 * own Markup.button.* produces, regardless of whether the installed
 * Telegraf version's own TypeScript types have caught up to this Bot API
 * version yet — sidesteps that uncertainty entirely rather than depending
 * on it.
 *
 * REVISED mapping (v0.8.6) — replaces v0.8.5's simpler 3-tier version after
 * seeing it rendered live: stacking Delete Repo's "Yes, Delete" and
 * "Cancel" both in red made it impossible to tell which one was actually
 * dangerous. Color only works as a signal if each one means exactly ONE
 * thing, always, everywhere — never context-dependent. Four tiers now:
 *
 *   RED       — ONLY the single button that actually executes something
 *               irreversible. Not "near danger" — IS the irreversible
 *               action. Reserved for exactly 5 buttons in the whole bot
 *               (Delete Repo, Delete File, Disconnect, Storage Clear,
 *               Bulk's destructive execute). Keeping this the smallest,
 *               rarest tier is what makes it alarming when you see it.
 *   GREEN     — means exactly one thing: "the safe way out." Every real
 *               Cancel button, everywhere, no exceptions.
 *   BLUE      — "the expected way to move forward" — general navigation
 *               AND the confirm side of already-safe actions (Rename,
 *               License, Fork, Create Repo, Upload/Commit, Replace
 *               Folder's continue). Both are the same underlying signal
 *               ("proceed, this is fine"), so one color for both is more
 *               coherent than splitting them.
 *   colorless — anything incidental: pagination, Skip, individual picks
 *               inside a longer flow (which license during Create Repo's
 *               wizard, which tag, which page), minor declines. No style
 *               key at all — Telegram renders its normal default. This is
 *               what makes the three real colors visible in the first
 *               place; if everything were colored, none of it would mean
 *               anything.
 */
const { Markup } = require('telegraf');

const RED = 'danger';
const GREEN = 'success';
const BLUE = 'primary';

/** Inline callback button. Pass RED/GREEN/BLUE explicitly, or omit the
 * 3rd argument entirely for a deliberately colorless (incidental) button —
 * there is no default color anymore; every button's tier is a conscious
 * choice made at its call site. */
function callback(text, data, colorStyle) {
  const button = Markup.button.callback(text, data);
  return colorStyle ? { ...button, style: colorStyle } : button;
}

/** BBTB (reply keyboard) text button, same no-default rule as above. */
function text(label, colorStyle) {
  const button = Markup.button.text(label);
  return colorStyle ? { ...button, style: colorStyle } : button;
}

module.exports = { RED, GREEN, BLUE, callback, text };
