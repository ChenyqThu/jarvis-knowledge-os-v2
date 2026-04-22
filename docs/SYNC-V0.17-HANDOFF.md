# Next-session handoff — upstream v0.17.0 sync

> 2026-04-22 | Written at end of long session that synced v0.14 → v0.15.1.
> Target reader: Claude in a fresh session, picking this up without memory
> of the v0.15.1 session. Load this file first; `docs/JARVIS-ARCHITECTURE.md`
> second; `skills/kos-jarvis/TODO.md` third.

---

## 1. Where we are right now (runtime snapshot)

### Versions

- Fork master: `46cafe4` (as of 2026-04-22, pushed to `origin/master`)
- Upstream master when this was written: `55ca498` (v0.17.0, we are 8 commits behind)
- Rollback tag for the v0.15 sync: `pre-sync-v0.15.1` at commit `0c0ceec`
- `gbrain --version` → `0.15.1`
- `@electric-sql/pglite` installed: **0.4.4** (override vs upstream's pin at 0.4.3; documented in `docs/JARVIS-ARCHITECTURE.md §6.6`)

### Services (macOS launchd, `launchctl list | grep jarvis`)

| Plist | Port | Status | Notes |
|---|---|---|---|
| `com.jarvis.gemini-embed-shim` | 7222 | running | Always-on. Embedding bridge to Gemini (1536-dim base64). |
| `com.jarvis.kos-compat-api` | 7220 | running | Always-on. HTTP API: `/health` `/status` `/digest` `/query` `/ingest`. |
| `com.jarvis.cloudflared` | 7220→public | running | Tunnels `kos.chenge.ink` → localhost:7220. |
| `com.jarvis.notion-poller` | n/a | **Disabled=1** | **Do not enable.** Minion `--follow` wrapper deadlocks PGLite. See §4. |
| `com.jarvis.kos-patrol` | n/a | Disabled=1 | Daily patrol, paused. |
| `com.jarvis.enrich-sweep` | n/a | loaded, cron-driven | Not recently run. |
| `com.jarvis.kos-deep-lint` | n/a | loaded, cron-driven | Not recently run. |

### Database

- Path: `~/.gbrain/brain.pglite` (275M)
- Pages: **1768** | Chunks: 3288 | Embedded: 3288 (100%)
- **Schema version: 4** (PRE-migration; the v5→v15 sequence was deferred — see §3)
- Last known-good backup: `~/.gbrain/brain.pglite.pre-v0.15.1-sync-1776819001` (275M, 1767 pages, pre-v0.15.1-sync state)
- **Only keep one rolling pre-sync backup.** Delete older ones (user policy).

### Tokens / env (do NOT commit)

- `KOS_API_TOKEN` = `ed855ebd6989e0b286ddafa24094ef0a054fec9b71ab774a97d3339d58172c35` (lives in `~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist`, not in the repo)
- `OPENAI_API_KEY` = `stub-for-gemini-shim` (placeholder, shim ignores it)
- `OPENAI_BASE_URL` = `http://127.0.0.1:7222/v1` (Gemini shim endpoint)

### gbrain resolution

- `which gbrain` → `/Users/chenyuanquan/.bun/bin/gbrain`
- That path is a **symlink** → `/Users/chenyuanquan/Projects/jarvis-knowledge-os-v2/src/cli.ts`
- So `gbrain` runs via `bun` (not a compiled binary). **This matters** — see upstream issue [#332](https://github.com/garrytan/gbrain/issues/332) and §4.

---

## 2. What's pending upstream

8 commits ahead of us on `upstream/master`:

| Version | Landed | Short take | Priority for us |
|---|---|---|---|
| v0.15.2 | bulk-action progress streaming (stderr heartbeats, agent-visible) | Low |
| v0.15.4 | PgBouncer `prepare:false` for Supabase transaction pooler (#284) | None (PGLite) |
| v0.16.0 | Durable agent runtime: `gbrain agent` + subagent handler + plugin loader (#258) | Medium |
| v0.16.1 | **Minions worker deployment guide** `docs/guides/minions-deployment.md` (#317) | **High — resolves notion-poller P0 choice** |
| v0.16.3 | Subagent SDK binding fix + CI tsc (#318) | Low |
| v0.16.4 | `gbrain check-resolvable` CLI + skillify-check wiring (#325) | Low |
| `3596764` | `doctor --fix` — 7 DRY violations resolved | **High — closes our 9 DRY warnings** |
| v0.17.0 | **`gbrain dream` + `runCycle` primitive** (one-cycle cron maintenance, 6 phases, schema v16 `gbrain_cycle_locks` table) | **High — could retire 3/5 of `scripts/minions-wrap/` scripts** |

**Reading assignment for next session before syncing:**

1. `upstream/master:CHANGELOG.md` top-of-file (v0.17.0 entry is the lens)
2. `upstream/master:docs/guides/minions-deployment.md` — decides the notion-poller P0
3. `upstream/master:skills/migrations/v0.17.0.md` (if present) — what schema v16 brings

---

## 3. Why schema stayed at v4 (do not blindly retry apply-migrations)

During the v0.15.1 sync, `gbrain apply-migrations --yes --non-interactive`
walked the orchestrator from v0.11.0 up to v0.14.0. The v0.11.0 orchestrator's
phase A shells out `gbrain init --migrate-only`, which opens its own PGLite
handle. The outer orchestrator process **also** holds a PGLite handle. They
collide. Then mid-run, a launchd-fired `notion-poller.sh` wedged on the
PGLite lock; we killed it to unblock the CLI; the kill left the WASM page
cache in an inconsistent state, and `PGlite.create()` then threw `Aborted()`
on every subsequent open. The live DB was non-recoverable without the backup.

We restored from `brain.pglite.pre-v0.15.1-sync-<ts>` and **did not retry
migrations**. The pre-migration schema (v4) is production-safe — `/query`
and `/ingest` don't touch the v5→v15 surfaces (graph edges, BrainWriter
integrity, minion_jobs, cycle_locks). External consumers (Notion Knowledge
Agent, OpenClaw feishu, `kos.chenge.ink`) see a zero-delta HTTP contract.

`gbrain doctor` reports:
- `connection: Connected, 1767 pages` — OK
- `schema_version: 4` — out of date, but doctor doesn't fail on this alone
- `minions_migration: MINIONS HALF-INSTALLED (partial migration: 0.13.0)` — cosmetic, tracked as upstream #332

**When you DO re-attempt migrations (post-v0.17 sync):**

1. `launchctl unload` **all** jarvis launchd services first (kos-compat-api,
   notion-poller, kos-patrol, enrich-sweep, kos-deep-lint). Only
   `gemini-embed-shim` can stay (no DB access). **Double-check** no
   `gbrain` subprocess is running: `ps aux | grep gbrain | grep -v grep`.
2. Copy `~/.gbrain/brain.pglite` → `~/.gbrain/brain.pglite.pre-v0.17-sync-<ts>` BEFORE touching anything.
3. Run `gbrain apply-migrations --yes --non-interactive` to completion. **Do not kill it** — if it hangs >10 min, let it time out; do not SIGTERM.
4. Verify `gbrain doctor --json` shows `schema_version: 16` (post v0.17).
5. Then re-load launchd services in order: `gemini-embed-shim` (already up)
   → `kos-compat-api` → `cloudflared` (already up) → (optional) notion-poller.
6. Validate `/query` end-to-end: localhost + `kos.chenge.ink`.

If step 3 fails, **do not run surgery** (don't manually ALTER TABLE like
we did in the v0.15.1 session — it's fragile). Restore the backup and file
upstream with the exact error trace.

---

## 4. The notion-poller P0 (must decide in next session)

### Current state

`scripts/minions-wrap/notion-poller.sh` submits a `gbrain jobs submit shell
--follow` job whose inline shell runs `workers/notion-poller/run.ts`. That
script polls Notion and HTTP-posts `/ingest` to `kos-compat-api:7220`, which
in turn `spawnSync`s `gbrain import` — a subprocess that needs the PGLite
lock the outer `jobs submit --follow` still holds. **Deadlock.** Every
poll cycle hangs for the 10-minute `--timeout-ms` window.

### Three paths (pick one; v0.16.1 guide may recommend)

**A. Drop `--follow`, run `gbrain jobs work` as a daemon.** Separate
concerns: poller queues jobs, worker drains them. But PGLite is still
single-writer, so the worker itself becomes a serialization point — every
CLI call from anywhere else (autopilot, other crons) blocks on the
worker's lock. May be fine if Minions queue absorbs the scheduling.

**B. Retire the minion wrapper for notion-poller specifically.** The
original pre-v0.14 design was launchd → `bun run workers/notion-poller/run.ts`
direct; retry/timeout/audit can happen at the poller level (it's ~200
lines of TypeScript). Keep `minions-wrap/` only for leaf work that doesn't
call back into kos-compat-api (e.g. `kos-deep-lint.sh`, `kos-patrol.sh`
once they're ported to `gbrain dream --phase X`).

**C. Refactor kos-compat-api to import in-process.** Stop `spawnSync`ing
`gbrain import`; use `import { importFromContent } from '@electric-sql/gbrain'`
directly inside the server. Bigger change (~150 lines), but removes the
lock-contention root cause across all callers. Unblocks future async
work.

**The v0.17.0 `gbrain dream` command** is orthogonal — it's a cron-style
one-shot that exits cleanly (not a `--follow` wait-loop), so it doesn't
have this problem. `kos-patrol.sh` / `enrich-sweep.sh` / `kos-deep-lint.sh`
can plausibly all become `gbrain dream --phase <name>` one-liners.
`notion-poller` is still separate because dream doesn't poll Notion; it
only operates on pages already in the brain.

---

## 5. Minimum session goals for the v0.17 sync

Ordered by priority. Stop early if something breaks; don't try to hit all
of them if §3 migration turns nasty.

1. **Sync** upstream/master → local master (`git merge upstream/master`).
   Tag `pre-sync-v0.17` before merging.
2. **Run tests** (`bun test`). If anything fails, roll back — do not
   ship a red master.
3. **Upgrade `@electric-sql/pglite` pin**. Check whether upstream moved
   to ≥0.4.4 in any v0.16/v0.17 commit. If yes, drop our override. If no,
   keep the override and re-note it in the changelog of the sync commit.
4. **Apply migrations** per §3 runbook. Expect to reach schema v16.
5. **Decide notion-poller P0** using v0.16.1 minions-deployment.md. Pick
   path A/B/C; implement; re-enable `com.jarvis.notion-poller` launchd
   job; verify with 2 poll cycles.
6. **Retire redundant minions-wrap scripts**. Replace `kos-patrol.sh`
   with a launchd job that runs `gbrain dream --phase lint,orphans`.
   Likewise `enrich-sweep.sh`, `kos-deep-lint.sh`.
7. **Close TODO P0 items** whose upstream fix is now available (if
   gbrain#332 got merged, clear the orchestrator-partial ledger; etc).
8. **Update `docs/JARVIS-ARCHITECTURE.md`** with a §6.7 v0.17 sync section.
9. **Write a short release note** that Lucien can forward to the feishu
   / Notion channels if anything user-facing changed. Likely zero change
   for external consumers — `/query` and `/ingest` contracts are stable.

---

## 6. Safety nets

- **Rollback tags**: `pre-sync-v0.15.1` (current), create `pre-sync-v0.17`
  before the next merge.
- **DB backups**: always `cp -R ~/.gbrain/brain.pglite
  ~/.gbrain/brain.pglite.pre-v0.17-sync-$(date +%s)` before migrations.
  Delete older backups after verification. User wants exactly one rolling
  backup kept.
- **Launchd plist backups**: every modified plist has a `.plist.bak`
  sibling in `~/Library/LaunchAgents/`. Restore is
  `launchctl unload current && launchctl load bak`.
- **WASM corruption symptom**: if any `gbrain` CLI call errors with
  `PGLite failed to initialize its WASM runtime. Original error:
  Aborted()`, the live data directory is toast. Restore from backup
  immediately. Do not try to salvage via `gbrain doctor` or re-inits;
  the WASM page cache in `~/.gbrain/brain.pglite/base/` is physically
  inconsistent and every open will fail.

---

## 7. Open upstream threads

- [garrytan/gbrain#332](https://github.com/garrytan/gbrain/issues/332) —
  `process.execPath` bug in v0.13.0 migration orchestrator. Filed today.
  If it merges, the "MINIONS HALF-INSTALLED" doctor warning auto-clears
  after the next `apply-migrations` run.
- [garrytan/gbrain#223](https://github.com/garrytan/gbrain/issues/223) —
  macOS 26.3 PGLite WASM abort. We chose 0.4.4 empirically; upstream
  wants 0.4.3 until verified. Watch for their CI verification + any
  further PGLite version bumps.

---

## 8. How to use this doc

When the new session opens:

1. `Read /Users/chenyuanquan/Projects/jarvis-knowledge-os-v2/docs/SYNC-V0.17-HANDOFF.md`
2. `Read /Users/chenyuanquan/Projects/jarvis-knowledge-os-v2/docs/JARVIS-ARCHITECTURE.md`
3. `Read /Users/chenyuanquan/Projects/jarvis-knowledge-os-v2/skills/kos-jarvis/TODO.md`
4. `git log --oneline -15` — confirm you're at `46cafe4` or newer
5. `gbrain stats` — confirm 1768+ pages, 100% embedded. If you hit
   `Aborted()`, go to §6 WASM corruption path before anything else.

Then work through §5's ordered goals.
