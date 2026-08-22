/**
 * Guard used at the top of every handler that touches GitHub.
 * Returns the decrypted token if connected, otherwise sends the shared
 * connect prompt (which also resets BBTB to the disconnected-state bar,
 * so stale buttons from before a disconnect stop offering dead actions)
 * and returns null so the caller can bail out.
 *
 * Fetches the user row once (v0.8.1 hardening) instead of the previous
 * isConnected() + getDecryptedToken() pair, which each independently
 * called getUser() — two full Postgres queries where one suffices. This
 * function is called at the top of nearly every gated handler in the bot,
 * so the duplicate query was a real, if small, cost on every single call.
 */
async function requireConnected(ctx) {
  const telegramId = ctx.from.id;
  const users = require('./users');
  const user = await users.getUser(telegramId);
  const connected = !!(user && user.github_token_enc && !user.disconnected_at);

  if (!connected) {
    // Lazy require to avoid a circular dependency with handlers/start.js
    const { sendConnectPrompt } = require('../handlers/start');
    await sendConnectPrompt(ctx, {
      intro: '🔒 You need to connect your GitHub account first.',
    });
    return null;
  }

  const { decrypt } = require('./crypto');
  return decrypt(user.github_token_enc);
}

module.exports = requireConnected;
