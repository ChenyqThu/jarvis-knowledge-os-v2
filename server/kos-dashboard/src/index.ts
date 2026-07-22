import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { bearerAuth } from './auth.ts';
import { overviewRoute } from './routes/overview.ts';
import { sourcesRoute } from './routes/sources.ts';
import { kindsRoute } from './routes/kinds.ts';
import { trendsRoute } from './routes/trends.ts';
import { healthRoute } from './routes/health.ts';
import { pagesRoute } from './routes/pages.ts';

const app = new Hono();

// Unauthenticated liveness probe. Deliberately has no DB dependency — a
// process-alive check, not a DB-alive check.
app.get('/healthz', c => c.json({ status: 'ok' }));

const api = new Hono();
api.use('*', bearerAuth());
api.route('/', overviewRoute);
api.route('/', sourcesRoute);
api.route('/', kindsRoute);
api.route('/', trendsRoute);
api.route('/', healthRoute);
api.route('/', pagesRoute);
app.route('/api/v1', api);

// Depth-in-defense: any unhandled error (e.g. a DB query throwing) falls
// through here instead of Hono's default error response, so internals
// (stack traces, connection strings) never leak to the client.
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal' }, 500);
});

// M1-ui reserve: once the frontend build lands at web/dist (sibling of
// src/), serve it statically. No-op until that directory exists.
//
// `root` must be absolute here: Hono's bun serveStatic resolves the final
// file path via `Bun.file(join(root, filename))`, which is relative to
// `process.cwd()`, NOT relative to this module file. A relative
// './web/dist' only works when the process happens to be launched with CWD
// == server/kos-dashboard/ — e.g. under launchd with a different
// WorkingDirectory, GET / and GET /assets/* would silently 404.
// import.meta.dir is already absolute, so building on top of it keeps
// static serving CWD-independent. Note: `path` must stay a *relative*
// filename ('index.html'), not a pre-joined absolute path — the underlying
// middleware does `join(root, path)` internally, and node's path.join()
// discards a leading '/' from the second segment when the first segment is
// relative (join('./', '/abs/x') -> 'abs/x'), which would silently
// reintroduce the same cwd-dependent bug for the SPA-fallback route.
const webDistDir = join(import.meta.dir, '..', 'web', 'dist');
if (existsSync(webDistDir)) {
  app.use('/*', serveStatic({ root: webDistDir }));
  app.get('/*', serveStatic({ root: webDistDir, path: 'index.html' }));
}

const port = Number(process.env.KOS_DASHBOARD_PORT ?? 7226);

console.log(`kos-dashboard listening on :${port}`);

export default {
  port,
  fetch: app.fetch,
};
