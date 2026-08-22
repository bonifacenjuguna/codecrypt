/**
 * Runs an async mapper over items with a maximum number in flight at once,
 * instead of firing all of them simultaneously via Promise.all(items.map(...)).
 *
 * Why this exists (v0.8.4 hardening): Pinned Repos fetches tree-stats for
 * every pinned repo via Promise.all() with no cap — pin 15-20 repos and
 * opening the screen fires that many concurrent GitHub requests at once,
 * each holding a socket + response buffer simultaneously, on a
 * memory-constrained container. This runs the same work in small batches
 * instead, bounding how many requests are ever in flight together
 * regardless of how large the input list grows.
 */
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await mapper(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = { mapWithConcurrency };
