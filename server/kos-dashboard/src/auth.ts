import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

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

export const bearerAuth = (): MiddlewareHandler => {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!provided || !constantTimeEqual(provided, TOKEN)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
};
