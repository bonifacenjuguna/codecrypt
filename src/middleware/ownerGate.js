const config = require('../config');

/**
 * OWNER-ONLY GATE
 *
 * This must be the FIRST middleware registered on the bot, before logging,
 * before session lookup, before command parsing — anything.
 *
 * Per the design spec: the bot talks to the owner ONLY. Anyone else
 * (even a million messages) gets silently ignored — no reply, no log spam,
 * no downstream processing of any kind. This keeps cost and attack surface
 * at zero for non-owner traffic.
 */
function ownerGate() {
  return async (ctx, next) => {
    const senderId = ctx.from && ctx.from.id;

    if (senderId !== config.OWNER_ID) {
      // Deliberately no reply, no ctx logging, no next() — full stop.
      return;
    }

    return next();
  };
}

module.exports = ownerGate;
