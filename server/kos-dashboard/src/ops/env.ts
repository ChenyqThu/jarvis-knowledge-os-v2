// Curated child environment for spawned `gbrain` subprocesses (F7 ops panel).
//
// The dashboard process is launched by launchd with WorkingDirectory=repo root,
// so Bun auto-loads the repo-root `.env.local` — which already carries
// OPENAI_API_KEY, GBRAIN_EMBEDDING_MODEL/DIMENSIONS, the CRS ANTHROPIC creds and
// GBRAIN_QUERY_EMBED_TIMEOUT_MS, and (per §6.41) leaves OPENAI_BASE_URL unset.
// A spawned child inherits all of that.
//
// Even so, we DON'T pass the ambient env through verbatim. Bun.spawn's `env`
// option REPLACES the environment (it does not merge), so we build the child
// env explicitly and enforce the two brain-wide embedding invariants from
// CLAUDE.md as belt-and-suspenders, regardless of what the ambient login/launchd
// environment happens to hold:
//   1. OPENAI_BASE_URL must be ABSENT — §6.41 took the embedding path direct to
//      api.openai.com on an official key; a stray base URL would silently route
//      embeds through a channel avman no longer has (or a wrong vector space).
//   2. GBRAIN_QUERY_EMBED_TIMEOUT_MS must be present (§6.42). Irrelevant to
//      `embed`, but harmless and keeps any query-issuing child (doctor) correct.
// launchd hands this process a MINIMAL PATH (`launchctl getenv PATH` is empty →
// /usr/bin:/bin only), but the maintenance scripts we spawn call bare `psql`
// (jarvis-*.sh) and bare `gbrain` (enrich-sweep/kos-patrol run.ts). The vetted
// crons run in an environment where these resolve; the dashboard plist
// deliberately carries no env, so we reconstruct the needed prefix here:
//   - postgres@17 + homebrew bins → `psql` (label-normalize/chunkless guard
//     queries; without it they find no psql, return empty, and silently SKIP —
//     a no-op button, not an error),
//   - ~/.bun/bin → the `gbrain` symlink the sweep/patrol preflights shell out to.
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const REQUIRED_PATH_DIRS = [
  '/opt/homebrew/opt/postgresql@17/bin',
  '/opt/homebrew/bin',
  resolve(homedir(), '.bun', 'bin'),
];

export function curatedChildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'OPENAI_BASE_URL') continue; // iron rule (§6.41): never on the embed path
    env[k] = v;
  }
  // §6.42: keep the query-embed deadline generous so any CJK query a child
  // issues doesn't degrade to keyword-only under load.
  env.GBRAIN_QUERY_EMBED_TIMEOUT_MS = env.GBRAIN_QUERY_EMBED_TIMEOUT_MS ?? '30000';
  // Prepend the homebrew/postgres bins so bare `psql` (and friends) resolve.
  const existing = env.PATH ? env.PATH.split(':').filter(Boolean) : ['/usr/bin', '/bin'];
  env.PATH = [...REQUIRED_PATH_DIRS, ...existing.filter(d => !REQUIRED_PATH_DIRS.includes(d))].join(':');
  return env;
}
