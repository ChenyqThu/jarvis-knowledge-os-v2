import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getConnInfo } from 'hono/bun';

// Static bearer token auth. Not session-based on purpose — see
// kos-dashboard design.md §6 ("admin's in-memory session dies on every
// restart"). Token lives in the repo-root .env.local (gitignored), format
// `KOS_DASHBOARD_TOKEN=...`.
//
// Fail-fast at startup (M1 opus review P1/P2): a missing token used to mean
// every request 500'd forever (fail-closed, but silently — and only
// discoverable per-request). Since this module is imported before the server
// starts listening, exiting here means a misconfigured deploy never comes up
// at all, instead of coming up and serving 500s.
const TOKEN = process.env.KOS_DASHBOARD_TOKEN;
if (!TOKEN) {
  console.error('FATAL: KOS_DASHBOARD_TOKEN is not set (expected in repo-root .env.local). Refusing to start.');
  process.exit(1);
}
// Once this dashboard is reachable from the public internet (M4) with the write
// (F5) + ops (F7) surface behind ONLY this token, a weak token is the whole
// risk. Refuse to start on an obviously-too-short one — a real token should be
// a long random string (≥24 chars). This is a floor, not a guarantee.
if (TOKEN.length < 24) {
  console.error(
    `FATAL: KOS_DASHBOARD_TOKEN is too short (${TOKEN.length} chars). Use a long random token — this is the only guard on the public write/ops surface.`,
  );
  process.exit(1);
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch rather than returning false, so
  // the length check must happen first — and comparing lengths is not itself
  // a timing side-channel worth defending (the token length isn't secret).
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// Defense-in-depth brute-force throttle (M4 public-exposure prep). It must NOT
// itself become a resource-exhaustion handle: an earlier version awaited an
// escalating delay before replying, which let an attacker pin many connections
// open (codex). Instead this is a per-IP sliding-window counter that replies
// IMMEDIATELY — a plain 401 until the window threshold is crossed, then a cheap
// 429 with Retry-After. No held connections, no per-request delay. A correct
// token always passes immediately and clears the IP's streak, so the owner is
// never locked out. Per-IP (not global) on purpose: a global cap would let a
// spoofed-IP spray lock the owner out. Cloudflare's edge is the volumetric layer.
const FAIL_WINDOW_MS = 60_000;
const FAIL_THRESHOLD = 30; // failures per IP per window before 429
const FAIL_MAP_CAP = 4096; // bound memory against a spray of spoofed IPs

interface FailState {
  count: number;
  windowStart: number;
}
const failures = new Map<string, FailState>();

function clientKey(c: Parameters<MiddlewareHandler>[0]): string {
  // Behind cloudflared the connection peer is the tunnel; the real client is in
  // CF-Connecting-IP (trustworthy from CF's edge on the public path). Fall back
  // to the socket peer for direct internal hits.
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return `cf:${cf}`;
  try {
    return `ip:${getConnInfo(c).remote.address ?? 'unknown'}`;
  } catch {
    return 'ip:unknown';
  }
}

function evictIfNeeded(now: number): void {
  if (failures.size < FAIL_MAP_CAP) return;
  // Cheap eviction: drop entries whose window has fully expired. No sort. If the
  // map is somehow still full of live entries (a genuine large spray), clear it
  // — losing throttle memory briefly is acceptable and O(n) once, not per-insert.
  for (const [k, v] of failures) {
    if (now - v.windowStart > FAIL_WINDOW_MS) failures.delete(k);
  }
  if (failures.size >= FAIL_MAP_CAP) failures.clear();
}

/** Records a failure for `key` and returns the count within the current window. */
function registerFailure(key: string, now: number): number {
  const prev = failures.get(key);
  if (!prev || now - prev.windowStart > FAIL_WINDOW_MS) {
    evictIfNeeded(now);
    failures.set(key, { count: 1, windowStart: now });
    return 1;
  }
  prev.count += 1;
  return prev.count;
}

export const bearerAuth = (): MiddlewareHandler => {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const key = clientKey(c);
    if (provided && constantTimeEqual(provided, TOKEN as string)) {
      failures.delete(key); // correct token → clear the streak, proceed
      await next();
      return;
    }
    const count = registerFailure(key, Date.now());
    if (count > FAIL_THRESHOLD) {
      return c.json({ error: 'too many attempts' }, 429, {
        'Retry-After': String(Math.ceil(FAIL_WINDOW_MS / 1000)),
      });
    }
    return c.json({ error: 'unauthorized' }, 401);
  };
};
