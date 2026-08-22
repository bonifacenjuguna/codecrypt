const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Builds the GitHub "Authorize" URL for the Web Application Flow.
 * The `state` param is a short-lived signed JWT carrying the Telegram
 * user id — this is how /callback knows which Telegram chat to reply to
 * once GitHub redirects back, without needing a Redis round-trip.
 */
function buildAuthorizeUrl(telegramId) {
  const state = jwt.sign({ telegramId }, config.SESSION_JWT_SECRET, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: config.GITHUB_CLIENT_ID,
    redirect_uri: `${config.BASE_URL}/callback`,
    scope: 'repo,delete_repo',
    state,
    allow_signup: 'false',
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/** Verifies + decodes the state param. Throws if invalid/expired/tampered. */
function verifyState(state) {
  const payload = jwt.verify(state, config.SESSION_JWT_SECRET);
  return payload.telegramId;
}

/** Exchanges the temporary `code` for a real GitHub access token */
async function exchangeCodeForToken(code) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${config.BASE_URL}/callback`,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange returned HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  return data; // { access_token, scope, token_type }
}

module.exports = { buildAuthorizeUrl, verifyState, exchangeCodeForToken };
