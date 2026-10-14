// A bounded, generic fixed-window rate limiter. The key map is LRU-capped, so a flood
// of distinct keys (rotating emails or addresses) can't grow memory without limit.

export function createRateLimiter({ maxKeys = 20_000, now = Date.now, enabled = true } = {}) {
  /** @type {Map<string, { count: number, start: number, windowMs: number }>} */
  const map = new Map();

  const touch = (key, entry) => {
    map.delete(key);
    map.set(key, entry);
    while (map.size > maxKeys) map.delete(map.keys().next().value);
  };

  const current = (key, windowMs) => {
    const e = map.get(key);
    if (!e || now() - e.start >= (e.windowMs || windowMs)) return null;
    return e;
  };

  return {
    enabled,
    /** Counts one hit. `{ ok:false }` once more than `max` hits land in the window. */
    hit(key, max, windowMs) {
      if (!enabled) return { ok: true, remaining: max, retryAfterMs: 0 };
      const e = current(key, windowMs) || { count: 0, start: now(), windowMs };
      e.count += 1;
      touch(key, e);
      const retryAfterMs = Math.max(0, e.start + windowMs - now());
      return { ok: e.count <= max, remaining: Math.max(0, max - e.count), retryAfterMs };
    },
    /** True when `key` already has `max` or more hits in its window (does not count). */
    blocked(key, max, windowMs) {
      if (!enabled) return false;
      const e = current(key, windowMs);
      return !!e && e.count >= max;
    },
    reset(key) {
      map.delete(key);
    },
    /** Drops expired windows. Optional: the LRU cap bounds memory anyway. */
    prune() {
      const t = now();
      for (const [k, e] of map) if (t - e.start >= e.windowMs) map.delete(k);
    },
    get size() {
      return map.size;
    },
  };
}
