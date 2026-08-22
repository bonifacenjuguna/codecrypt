/**
 * Minimal structured logger — no new dependency, just consistent
 * timestamped, leveled output so Railway's log viewer is actually easy to
 * search/filter after the fact, instead of scattered plain console.log.
 */
function ts() {
  return new Date().toISOString();
}

function format(level, message, meta) {
  const base = `[${ts()}] [${level}] ${message}`;
  if (!meta) return base;
  try {
    return `${base} ${JSON.stringify(meta)}`;
  } catch (_) {
    return base;
  }
}

module.exports = {
  info: (message, meta) => console.log(format('INFO', message, meta)),
  warn: (message, meta) => console.warn(format('WARN', message, meta)),
  error: (message, meta) => console.error(format('ERROR', message, meta)),
};
