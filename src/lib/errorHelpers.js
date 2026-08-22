const format = require('./format');
const github = require('./github');

/** True for GitHub API auth failures — expired/revoked token, bad credentials */
function isAuthError(err) {
  return !!(err && (err.status === 401 || /bad credentials/i.test(err.message || '')));
}

/**
 * Replies to a failed GitHub API call with the right message for the
 * situation:
 * - Rate limit hit → shows the actual reset time (we already have this
 *   data via the same headers Settings reads), instead of a generic error.
 * - Auth failure (token expired/revoked mid-action) → the specific
 *   "reconnect" message + button, and if Token Health notifications are
 *   on, records it as a distinct security event in the Access Log.
 * - Anything else → generic error with the real message.
 *
 * Returns `true` if it was an auth error (so callers can skip anything
 * that implies "still fully connected", like showing the normal main
 * menu bar), `false` otherwise.
 */
async function replyGithubError(ctx, err, actionDescription) {
  if (github.isRateLimitError(err)) {
    let resetLine = 'Try again in a few minutes.';
    try {
      const resetHeader = err.response && err.response.headers && err.response.headers['x-ratelimit-reset'];
      if (resetHeader) {
        const resetMins = Math.max(1, Math.round((Number(resetHeader) * 1000 - Date.now()) / 60000));
        resetLine = `Resets in about ${resetMins} minute${resetMins === 1 ? '' : 's'}.`;
      }
    } catch (_) { /* fall back to the generic line above */ }

    await ctx.reply(format.errorMessage(actionDescription, 'GitHub\u2019s API rate limit was reached', resetLine));
    return false;
  }

  if (isAuthError(err)) {
    try {
      const users = require('./users');
      const prefs = await users.getNotificationPrefs(ctx.from.id);
      if (prefs && prefs.tokenHealth) {
        const accessLog = require('./accessLog');
        await accessLog.record(ctx.from.id, 'disconnected', 'Token rejected by GitHub mid-action (likely expired/revoked)');
        // The Access Log entry above is a silent record — Token Health being
        // "on" should also mean an actual push, same as every other
        // Notification category. Sent as its own message (not folded into
        // the reconnect prompt below) so it reads as a distinct alert.
        await ctx.reply(`🔔 Token Health: your GitHub token was rejected during "${actionDescription}" — it likely expired or was revoked.`);
      }
    } catch (_) { /* best-effort, never let logging failure mask the real error */ }

    const oauth = require('./oauth');
    const inline = require('../keyboards/inline');
    const url = oauth.buildAuthorizeUrl(ctx.from.id);

    await ctx.reply(
      format.errorMessage(actionDescription, 'your GitHub session expired mid-action', 'Reconnect to continue.'),
      inline.connectButton(url)
    );
    return true;
  }

  await ctx.reply(format.errorMessage(actionDescription, err.message, 'Try again.'));
  return false;
}

module.exports = { isAuthError, replyGithubError };
