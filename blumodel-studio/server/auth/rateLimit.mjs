// A bounded, generic rate limiter: fixed windows (hit) and token buckets (take). The key map is LRU-capped, so a flood
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
    /**
     * A token bucket: `burst` tokens to start, `refill` more every `everyMs` (smoothly), never above
     * `burst`. Takes one; `{ ok:false, retryAfterMs }` when the bucket is empty. Generous for a
     * person (a burst of page loads is fine), tight for a script (it soon runs at the refill rate).
     */
    take(key, burst, refill, everyMs) {
      if (!enabled) return { ok: true, remaining: burst, retryAfterMs: 0 };
      const t = now();
      const perMs = refill / everyMs;
      const prev = map.get(key);
      // A bucket idle long enough to be full again is the same as a new one.
      const tokens = prev ? Math.min(burst, prev.tokens + (t - prev.at) * perMs) : burst;
      const ok = tokens >= 1;
      const left = ok ? tokens - 1 : tokens;
      // windowMs/start/count keep prune() working: the entry expires once it would be full again.
      touch(key, { tokens: left, at: t, start: t, count: 0, windowMs: Math.ceil((burst - left) / perMs) + 1 });
      return { ok, remaining: Math.floor(left), retryAfterMs: ok ? 0 : Math.ceil((1 - left) / perMs) };
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
