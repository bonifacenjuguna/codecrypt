/**
 * ROOT FIX for the "stale confirm/cancel button" bug class (v0.8.1, items
 * #13/#16, found in 7 separate flows: Delete Repo, Delete File, Bulk
 * Actions, Toggle Visibility, Disconnect, Fork, Storage Clear).
 *
 * The bug: every confirm/cancel handler sent a brand-new "Cancelled."
 * message instead of touching the original confirmation message. Since
 * Telegram inline buttons stay live until a message is edited, the
 * original Confirm/Cancel buttons kept working — so tapping Cancel, then
 * going back and tapping the original Confirm, still fired the action.
 *
 * The fix is structural, not a per-flow patch: every confirm/cancel screen
 * now goes through `resolveConfirmation`, which edits the SAME message
 * that held the buttons — stripping the keyboard and replacing the text
 * with the outcome — the instant either button is tapped. Once a message
 * is resolved, its buttons are gone; there is no message left for a stale
 * tap to land on. A future confirm/cancel flow that calls this helper
 * inherits the fix automatically instead of needing its own patch.
 */

/**
 * @param {object} ctx - Telegraf context (must be a callback_query update)
 * @param {'confirmed'|'cancelled'} outcome
 * @param {string} resolvedText - what the message becomes once resolved
 * @param {object} [opts]
 * @param {string} [opts.parse_mode] - defaults to none (plain text)
 */
async function resolveConfirmation(ctx, outcome, resolvedText, opts = {}) {
  try {
    await ctx.editMessageText(resolvedText, {
      parse_mode: opts.parse_mode,
      // No reply_markup at all — this is what actually removes the buttons.
    });
  } catch (err) {
    // Message too old to edit (Telegram's ~48h window) or already edited by
    // a race — fall back to a plain reply so the person still sees the
    // outcome, even though we couldn't retroactively disarm the old buttons.
    await ctx.reply(resolvedText, { parse_mode: opts.parse_mode });
  }
}

module.exports = { resolveConfirmation };
