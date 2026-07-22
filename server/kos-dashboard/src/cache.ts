// Tiny per-key in-memory TTL cache. One process, one cache — good enough for
// a single-instance internal dashboard API (design.md §6: don't hammer the
// serve-http connection pool, and PRD F6 wants 60s response caching).

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
// In-flight promises, keyed the same as `store`. Lets concurrent requests for
// the same (still-uncached) key share one DB round trip instead of each
// kicking off its own — cheap single-flight protection against a cache
// stampede (M1 opus review P2).
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 60_000;

/** Returns the cached value for `key` if still fresh, else computes, stores, and returns it. */
export async function cached<T>(key: string, fn: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit) {
    if (hit.expiresAt > now) {
      return hit.value as T;
    }
    // Lazily evict expired entries on access instead of letting the map grow
    // forever — the trends key space alone spans granularity x days x source,
    // and a `set`-without-`delete` cache never shrinks (M1 opus review P2).
    store.delete(key);
  }

  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = fn()
    .then(value => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
