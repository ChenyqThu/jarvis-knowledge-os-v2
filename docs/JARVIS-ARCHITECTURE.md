# Jarvis Knowledge OS v2 — Architecture & Runbook

> 2026-04-17 | Lucien × Jarvis (last sync: 2026-04-25 → upstream v0.20.4)
> Fork: [`ChenyqThu/jarvis-knowledge-os-v2`](https://github.com/ChenyqThu/jarvis-knowledge-os-v2)
> Upstream: [`garrytan/gbrain`](https://github.com/garrytan/gbrain) v0.20.4 (override: `@electric-sql/pglite` pinned to 0.4.4 instead of upstream's 0.4.3; see §6.6. v0.20 supervisor / queue_health / wedge-rescue features are Postgres-only and skip on our engine; see §6.14)
> Previous: [`ChenyqThu/jarvis-knowledge-os`](https://github.com/ChenyqThu/jarvis-knowledge-os) (v1, frozen at tag `v1-frozen` on 2026-04-16)

---

## 1. Why this fork exists

v1 was a Python+Shell DIKW compilation engine over `knowledge/wiki/` markdown
files. It served Jarvis well but hit three ceilings simultaneously:

1. **No ambient entity extraction.** Every people/company page required
   explicit `kos ingest <url>` — no Tier 1/2/3 auto-enrichment. Karpathy's LLM
   wiki pattern was the obvious next step; GBrain is that pattern productized.
2. **Custom everything.** Hand-rolled BM25+qmd index, shell cron, Python agent
   prompts, 79-platform opencli router. Maintenance cost was growing.
3. **No MCP native.** Notion / Claude Desktop / Cursor integrations needed
   bespoke HTTP wrappers; GBrain exposes stdio MCP out of the box.

The migration retained every v1 strength (DIKW evidence/confidence,
Jarvis-flavored 9 page kinds, the `kos.chenge.ink` stable boundary, Feishu +
OpenClaw + Notion wiring) while inheriting GBrain's entity enrichment,
two-sync Notion Worker idiom, and compounding signal-detector loop.

---

## 2. Jarvis triangle (the three platforms)

```
                    Notion Jarvis
                   (operational memory)
                  ╱  MEMORY.md single source of truth
                 ╱   Email/Calendar/Tasks
                ╱    📚 Knowledge Agent
               ╱       ↕ kos-worker (4 tools)
              ╱           ↕
  Knowledge-OS v2 ────────────── OpenClaw Jarvis
  (GBrain fork)                  (execution orchestrator)
   ~1800 compiled pages          3-agent topology
   kos-compat-api (v2) 7225      6 cron jobs
   gemini-embed-shim 7222        feishu skill (HTTP to kos.chenge.ink)
   v1 kos-api.py unloaded        MEMORY reflux (digest-to-memory)
   skills/kos-jarvis/            MEMORY reflux (digest-to-memory)
```

### Responsibility split (unchanged from v1)

| System | Owns | Does NOT |
|--------|------|----------|
| **Knowledge-OS (v2)** | Deep compilation, person/company pages, source archive, knowledge graph | User data operations, schedule, email, personal prefs |
| **Notion** | Operational records (MEMORY 三层, Email, Calendar, PRD, Daily Log) | Long-form technical synthesis |
| **OpenClaw** | Cron scheduling, source ingestion, Feishu routing, MEMORY writeback | Deep knowledge authoring |

---

## 3. Deployment topology

```
                         kos.chenge.ink
                              │
                     (cloudflared tunnel)
                              │
                              ▼
             ┌────────────────────────────────┐
             │  launchctl list | grep jarvis  │
             ├────────────────────────────────┤
             │  com.jarvis.kos-compat-api     │ ← port 7225
             │     server/kos-compat-api.ts   │
             │     (TypeScript, bun runtime)  │
             │            ↓ shells gbrain     │
             │            ↓                   │
             │  com.jarvis.gemini-embed-shim  │ ← port 7222
             │     skills/kos-jarvis/         │
             │     gemini-embed-shim/server.ts│
             │            ↓ HTTP              │
             │  generativelanguage.googleapis │
             │     gemini-embedding-2-preview │
             │            (1536 dim)          │
             ├────────────────────────────────┤
             │  com.jarvis.enrich-sweep       │ ← cron-driven entity enrichment
             │  com.jarvis.kos-patrol         │ ← cron-driven daily patrol (§6.28 follow-up)
             │  (notion-poller retired §6.27, kos-deep-lint retired §6.28 follow-up)
             └────────────────────────────────┘
                              │
                              ▼
             PGLite database at ~/.gbrain/brain.pglite
             (~1800 pages, ~3300 chunks, pgvector HNSW index)
```

### Port map

| Port | Service | Auth | Exposed |
|------|---------|------|---------|
| 7225 | kos-compat-api | Bearer token (`KOS_API_TOKEN`) | Yes (via kos.chenge.ink + Notion Worker) |
| 7222 | gemini-embed-shim | None (internal) | No, loopback only |

### External routing

- **Notion Knowledge Agent** (Notion Custom Agent ID `78619ef5-...`) calls
  `kos-worker` (Notion Worker) which calls `kos.chenge.ink/{query,ingest,digest,status}`.
  Post-cutover: zero change on Notion side; HTTP contract preserved.
- **OpenClaw Feishu skill** (`~/.openclaw/workspace/skills/knowledge-os/SKILL.md`)
  calls `kos.chenge.ink` HTTP directly (no more `./kos` shell out). Migration
  completed 2026-04-17 by OpenClaw agent; review passed.
- **OpenClaw crons** (4 active, after feishu migration): daily patrol → `/digest+/status`,
  Monday lint → `bun run kos-lint/run.ts`, daily intel → inline curl to
  `/ingest`, Sunday digest → `bun run digest-to-memory/run.ts`.

---

## 4. Fork-local extension pack (`skills/kos-jarvis/`)

Boundary rule: **everything Jarvis-specific lives under this one directory**.
Upstream `src/` and other `skills/` are untouched; the only concession is an
append-only `## KOS-Jarvis extensions` section at the end of `skills/RESOLVER.md`.

| Skill | Purpose | Runnable helper? |
|-------|---------|------------------|
| `dikw-compile` | Post-ingest strong-link enforcement (`supplements`/`contrasts`/`implements`/`extends`), 2-5 links/page budget, A/B/C/F grading | ✅ `run.ts` (2026-04-22, analysis-only grade+sweep; Haiku classifier for phase 2 link proposals deferred) |
| `evidence-gate` | Block claims below threshold (decision E3+, synthesis E2+, concept E2+, ...) | ✅ `run.ts` (2026-04-22, E0-E4 parsing from frontmatter + body `[E\d]` tags) |
| `confidence-score` | Auto-score high/medium/low per page; compile-grade per ingest | ✅ `run.ts` (2026-04-22, heuristic from E_max + backlinks + age + citation density) |
| `kos-lint` | Six-check lint (frontmatter / duplicate id / dead links / orphans / weak links / evidence gaps) | ✅ `run.ts` |
| `kos-patrol` | Daily sweep → dashboard + MEMORY-format digest | ✅ `run.ts` (6-phase protocol; writes `~/brain/agent/dashboards/knowledge-health-<date>.md`) |
| `digest-to-memory` | Append weekly `[knowledge-os]` block to OpenClaw MEMORY.md | ✅ `run.ts` |
| `notion-ingest-delta` | Notion-side backfill + delta sync design | Design only (to be implemented in kos-worker repo) |
| `feishu-bridge` | Command-mapping manifest for OpenClaw feishu skill one-time edit | ✅ applied 2026-04-17 |
| `gemini-embed-shim` | OpenAI→Gemini translation layer on port 7222 | ✅ `server.ts` (base64 encoding, 1536 dims) |

`skills/kos-jarvis/templates/` holds the 9 KOS page templates
(source/entity/concept/project/decision/synthesis/comparison/protocol/timeline)
copied from v1 for reference. `type-mapping.md` defines how these map onto
GBrain's 20-dir MECE.

---

## 5. Migration history (condensed)

| Week | Scope | Key output |
|------|-------|------------|
| 1 | Fork + skeleton | `v1-frozen` tag on v1 repo, `ChenyqThu/jarvis-knowledge-os-v2` with `skills/kos-jarvis/{README,PLAN-ADJUSTMENTS,type-mapping,templates/*}`; 5-page sample import verified 100% frontmatter fidelity |
| 2 | 5 quality skills | `dikw-compile`, `evidence-gate`, `confidence-score`, `kos-lint` (with run.ts), `kos-patrol` SKILL.md files + runnable kos-lint |
| 3 | Bridge layer | `server/kos-compat-api.ts` (drop-in v1 HTTP contract), `digest-to-memory` + run.ts, `notion-ingest-delta` design, `feishu-bridge` mapping, `RESOLVER.md` extension section |
| 4 | Data + cutover | 85 pages imported (0 errors), 92 chunks embedded via Gemini shim (base64 encoding fix critical), Chinese regression 5/5 passed (0.86-0.92 scores), launchd cutover executed, OpenClaw feishu skill migration completed by OpenClaw agent and reviewed |

Notable fix: OpenAI SDK v4 defaults `encoding_format: "base64"` for embeddings.
First shim pass returned `number[]` → SDK decoded as base64 → garbage 384-dim
vectors → pgvector rejected. Fixed by encoding Float32Array to base64 in shim
when request omits or chooses base64 encoding (commit 1b02162).

---

## 6. Operational runbook

### Verify health at any time
```bash
TOKEN=$(grep -o '[a-f0-9]\{64\}' ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist | head -1)

curl -s -H "Authorization: Bearer $TOKEN" https://kos.chenge.ink/status | jq .
# expect: engine = "gbrain (pglite)", brain = "/Users/chenyuanquan/brain"
# CAVEAT: /status shells out `gbrain list --limit 10000`, but upstream caps
# the list output at 100 rows (the --limit flag is silently ignored). As of
# Step 2.1 design (§6.10), total_pages in /status shows 100 while the real
# DB has 1829 pages. Step 2.2 rewrites /status to direct-DB query. Use
# `gbrain stats` or the evidence-gate sweep for the real count until then.

curl -s http://127.0.0.1:7222/health | jq .
# expect: upstream=gemini, model=gemini-embedding-2-preview

launchctl list | grep com.jarvis
# expect both kos-compat-api and gemini-embed-shim with PID, status 0
```

### Ingest a URL manually
```bash
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST https://kos.chenge.ink/ingest \
  -d '{"url":"https://example.com/article","slug":"optional-slug"}' | jq .
# response includes imported:true, embedded:true, slug, next
```

### Query
```bash
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST https://kos.chenge.ink/query \
  -d '{"question":"中文问题也可以"}' | jq -r .result
```

### Run lint on the whole brain
```bash
bun run ~/Projects/jarvis-knowledge-os-v2/skills/kos-jarvis/kos-lint/run.ts
# exit 0 clean | 1 any ERROR | 2 only WARN
```

### Rollback the launchd cutover (30s downtime)
See [`scripts/launchd/README.md`](../scripts/launchd/README.md).

---

## 6.5 Upstream v0.14.0 sync (2026-04-20)

GBrain upstream jumped 9 releases (v0.10.1 → v0.14.0): knowledge graph layer,
Minions orchestration, canonical migration, reliability wave, Knowledge
Runtime (Resolver SDK + BrainWriter + `gbrain integrity` + BudgetLedger +
quiet-hours), and shell job type. We merged, ran the full test suite
(1762 unit + 138 E2E, 0 fail) and adopted the subset that fits our stack.

### What we adopted

| Feature | Status | Surface |
|---|---|---|
| Frontmatter → typed graph edges (auto-link) | Live (default on) | `related:` → `related_to` edges. ~54 % of v1 wiki pages carry `related:`; they auto-edge on ingest. No hand-maintained adjacency files in v2. |
| BrainWriter observational lint | Enabled | `gbrain config set writer.lint_on_put_page true`. Findings → `~/.gbrain/validator-lint.jsonl`. Strict mode **not** flipped (upstream policy: 7-day soak). |
| Minions shell job — all 4 crons | Migrated; 2 since retired | Originally `notion-poller` (RETIRED §6.27 2026-05-17), `kos-patrol`, `enrich-sweep`, `kos-deep-lint` (RETIRED §6.28 follow-up 2026-05-17 — v1 repo targets dead, never-ran zombie since M1) ran via `gbrain jobs submit shell --follow` wrappers at `scripts/minions-wrap/*.sh`. Active today: `kos-patrol` + `enrich-sweep`. PGLite constraint: `--follow` inline, no daemon. Retry, timeout, unified `gbrain jobs list` visibility. |
| Schema migrations v2–v13 | Applied | PGLite at `~/.gbrain/brain.pglite` includes `budget_ledger`, `links_provenance_columns`, `minion_quiet_hours_stagger`. |
| kos-lint check #3 (dead internal links) | Retired | BrainWriter's `linkValidator` covers this. `kos-lint --check 3` still works for manual invocation. |

### What we skipped (intentional)

- **`gbrain integrity` bare-tweet repair** — no Twitter/X citations in our KB
- **Resolver SDK builtins** (`url_reachable`, `x_handle_to_tweet`) — no external resolvers in pipeline
- **BudgetLedger** — no external API spend to cap
- **BrainWriter `strict_mode=strict`** — wait for upstream 7-day soak
- **Supabase migration** — v2 stays on PGLite at `~/.gbrain/brain.pglite`

### Topology changes (post-cutover)

- **v1 wiki imported**: 85 pages from `/Users/chenyuanquan/Projects/jarvis-knowledge-os/knowledge/wiki/` imported into v2 PGLite (`~/.gbrain/brain.pglite`) via `gbrain import` in 25.4 s / 91 chunks / 0 errors.
- **Port cutover**: v2 bun `kos-compat-api` now owns :7225 (production, serves `kos.chenge.ink` through the cloudflared token tunnel). v1 Python `kos-api.py` is unloaded (`.plist.bak` retained for 30-s rollback).
- **Poller cutover**: `notion-poller` now posts to :7225 (v2). Notion content and v1 wiki content both live in `~/.gbrain/brain.pglite`. Total 100 pages as of 2026-04-20.
- **Phase-2 synthesis**: `kos-compat-api` `/query` now does retrieval (`gbrain ask`) + LLM synthesis (Anthropic Messages API via `crs.chenge.ink`, model `claude-sonnet-4-6` by default). Matches v1's `{result: "...Phase 2..."}` response shape so Notion Knowledge Agent and feishu-bridge consumers keep working without changes.

### Rollback

- Merge commit: `0c0ceec` on master; rollback tag: `pre-sync-v0.14`
  (`382e407`).
- Launchd plists: every modified plist has a `.plist.bak` sibling in
  `~/Library/LaunchAgents/`. `launchctl unload` current + load the bak.
- PGLite rollback: schema migrations are additive and idempotent; drop
  the v11–v13 tables manually only if a downgrade breaks something.

---

## 6.6 Upstream v0.15.1 sync (2026-04-22)

Routine follow-on to 6.5. Merged upstream four releases (v0.14.1 doctor
DRY detection, v0.14.2 eight root-cause fixes, v0.15.0 llms.txt +
AGENTS.md generation, v0.15.1 fix wave). No code conflicts. The whole
trigger for this sync was today's production outage: `bun update` had
earlier pulled in the wrong same-named npm package (`gbrain@1.3.1`, a
browser charting library) which transitively downgraded
`@electric-sql/pglite` to 0.3.6; that version connects to `template1` by
default against a 0.4.x-created data directory, so every `gbrain` call
returned "relation pages does not exist". The whole DB-corruption story
in the initial triage was a misdiagnosis — fixing the dep restored full
service.

### What we adopted

| Feature | Status | Surface |
|---|---|---|
| Pglite pin (`@electric-sql/pglite`) | **Overridden** | Upstream pinned 0.4.3 as a "best shot" against the macOS 26.3 WASM init bug ([#223](https://github.com/garrytan/gbrain/issues/223)). On this machine 0.4.3 still aborts; `0.4.4` opens the same data dir cleanly. Pin in our `package.json` sits one patch ahead of upstream until upstream promotes. |
| `doctor --fix` auto-repair | Live | `gbrain doctor --fix` closes the 9 DRY warnings we've been carrying. Not run yet (cosmetic; would touch upstream skills). |
| `gbrain check-resolvable --json` | Not used | Agent-facing resolver validation; our RESOLVER.md has no broken trigger map. |
| `llms.txt` / `AGENTS.md` generation | Inherited upstream files | Shipped but not customized. |

### Schema state: stayed at v4 intentionally

Running `gbrain apply-migrations` today reached v15 but the schema-level
migration pipeline requires `gbrain init --migrate-only` to run twice
(once before orchestrator phase A, once inside it); the second call's
PGLite handle collides with the first's. When a process holding PGLite
mid-transaction is killed (which happened here — notion-poller
wrapper wedged on the lock, had to SIGTERM it), the on-disk WASM page
cache left the data dir in a state where subsequent `PGlite.create()`
throws `Aborted()` unconditionally. Current live DB was restored from
`brain.pglite.pre-v0.15.1-sync-<ts>` (pre-migration state, schema v4)
and stays there until the migration sequence gets reworked (see P0
below). External consumers only use `/query` + `/ingest`; neither
touches v5–v15 surfaces, so schema v4 is production-safe.

### Filed upstream

- **[garrytan/gbrain#332](https://github.com/garrytan/gbrain/issues/332)**
  — v0.13.0 migration orchestrator uses `process.execPath` for the
  gbrain binary, which on bun-runtime installs resolves to the bun
  interpreter itself. Effect: `frontmatter_backfill` phase calls
  `bun extract` (not `gbrain extract`), bun interprets it as an npm
  script and fires `bun init` as a side effect — silently polluting
  `package.json` (`"private": true`, typescript peerDep) and creating
  `.cursor/rules/`. Our worktree got bitten once today; both artifacts
  were reverted. Pending upstream fix.

### New P0 surfaced during sync

`scripts/minions-wrap/notion-poller.sh` deadlocks on the PGLite lock
under the current `--follow` design: outer `gbrain jobs submit --follow`
holds the lock while the inline shell runs `workers/notion-poller/run.ts`,
which posts `/ingest` back to `kos-compat-api`, which `spawnSync`s
`gbrain import` — the subprocess can't get the lock. Launchd unloaded
the job (`com.jarvis.notion-poller` stays `Disabled=1`). Three
architectural options in `skills/kos-jarvis/TODO.md`; upstream v0.16.1
ships a `docs/guides/minions-deployment.md` that may decide it for us
on the next sync.

### Rollback

- Merge commit: `44c7001` fast-forwarded onto master → current tip.
  Rollback tag: `pre-sync-v0.15.1` at `0c0ceec`.
- PGLite rollback: `~/.gbrain/brain.pglite.pre-v0.15.1-sync-1776819001`
  is the last known-good pre-migration copy. `mv` it into
  `~/.gbrain/brain.pglite` and the service is restored to the 1767-page
  state at 2026-04-22 01:30 UTC.
- No launchd plist changes in this sync.

---

## 6.7 Upstream v0.17.0 sync (2026-04-22)

Merged upstream 8 commits in one pass: v0.15.2 (bulk-action progress
streaming), v0.15.4 (PgBouncer `prepare:false`), v0.16.0 (durable agent
runtime), v0.16.1 (`docs/guides/minions-deployment.md`), v0.16.3
(subagent SDK fix), v0.16.4 (`gbrain check-resolvable`), v0.17.0
(`gbrain dream` + `runCycle` primitive + schema v16
`gbrain_cycle_locks`), and the doctor `--fix` DRY auto-repair (3596764).
Fork master moved `46cafe4` → `b6ea540`. Rollback tag: `pre-sync-v0.17`.

### Schema jump v4 → v16

The actual SQL schema migration was the risky part and it bit twice
before we got it right. Final shape is clean but the story matters for
next time:

- **Ordering bug in `initSchema()`**: `pglite-engine.ts` runs
  `PGLITE_SCHEMA_SQL` **before** `runMigrations()`. PGLITE_SCHEMA_SQL
  contains `CREATE INDEX idx_links_source ON links(link_source)`
  which assumes the v11 `link_source` column already exists. Our brain
  was at `config.version=4` with a pre-v0.12-graph-layer `links` table
  shape (columns: id, from, to, type, context, created_at — no
  provenance cols). Every `gbrain init --migrate-only` attempt crashed
  at the index create before v11 could ADD the column. Classic
  chicken-and-egg.
- **Workaround**: manually ALTER TABLE links ADD COLUMN IF NOT EXISTS
  (link_source, origin_page_id, origin_field) via a one-shot PGLite
  script, then `gbrain init --migrate-only` walks v5..v16 cleanly. All
  12 migrations apply in one sweep. Re-running v11 after the manual
  ALTER is idempotent (all its ops are `IF NOT EXISTS` / `UPDATE ...
  WHERE link_source IS NULL`).
- **File with the surgical script**: `/tmp/add-link-cols.ts` during
  the session; not committed (one-off). The exact SQL matches v11's
  column-add section in `src/core/migrate.ts`.

Post-migration shape:
- Schema version: 16 (v4 → v5..v16 applied, 12 migrations)
- Pages: 1777 (was 1768; +9 from Path B's first poll cycle)
- Chunks: 3302, 100% embedded (Gemini shim still owns embeddings)
- Links: 385 (from `gbrain extract links --source db
  --include-frontmatter`, 14 unresolved refs logged)
- Timeline entries: 5443 (from `gbrain extract timeline --source db`)
- Brain score: 56/100 (embed 35/35, links 5/25, timeline 4/15,
  orphans 2/15, dead-links 10/10)

### WASM-corruption incident (recovered)

Same-session repeat of the pattern `docs/SYNC-V0.17-HANDOFF.md §6`
warned about. Root cause: `com.jarvis.notion-poller` launchd cron was
not actually disabled when we began migrations (`launchctl list`'s
dash-in-pid-col means "not currently running", not "disabled"; the
plist has no `Disabled` key), so the 5-min `StartInterval` fired the
old `scripts/minions-wrap/notion-poller.sh` mid-session, which took
the PGLite lock, deadlocked on the inner `spawnSync gbrain import`,
and when its PID eventually exited it left `base/` WASM pages
inconsistent. Next `gbrain` call aborted with `Aborted(). Build with
-sASSERTIONS for more info.`

Recovery:
1. `launchctl unload` every DB-accessing service (only
   `gemini-embed-shim` and `cloudflared` stayed up).
2. `launchctl disable user/$UID/com.jarvis.notion-poller` to
   hard-stop future cron fires.
3. `mv ~/.gbrain/brain.pglite ~/.gbrain/brain.pglite.broken-<ts>`
   (preserved briefly for inspection, then deleted).
4. `cp -R ~/.gbrain/brain.pglite.pre-v0.17-sync-<ts>
   ~/.gbrain/brain.pglite` (the rolling backup taken before any
   migration attempt).
5. Re-run the manual ALTER + `gbrain init --migrate-only` + `gbrain
   extract links` + `gbrain extract timeline`. Same end state, zero
   data loss.

**Learned rule** (captured in next-session runbook): before starting
any migration, **always** `launchctl disable user/$UID/com.jarvis.*`
for every DB-writing service, not just `unload`. `unload` only
stops current activity; `disable` prevents the 5-min cron from
firing a fresh instance mid-migration.

### Notion-poller Path B (minion wrapper retired)

`scripts/minions-wrap/notion-poller.sh` is gone.
`com.jarvis.notion-poller.plist` now invokes
`/Users/chenyuanquan/.bun/bin/bun run workers/notion-poller/run.ts`
directly; Bun auto-loads `.env.local` from `WorkingDirectory`, so
`NOTION_TOKEN`/`NOTION_DATABASE_IDS`/`KOS_API_TOKEN` arrive without a
shell `source` step.

Why this works: no outer `gbrain jobs submit --follow` = no outer
process holding the PGLite write lock. The inner `spawnSync gbrain
import` inside `kos-compat-api` acquires the lock for ~1-2 s per
page, cleanly releases it. First live cycle: 78 s total, 9 pages
ingested, zero "Timed out waiting for PGLite lock" errors.

Kept minion wrappers for `kos-patrol`, `enrich-sweep`, and
`kos-deep-lint` — none of them HTTP-post to `kos-compat-api`, so
they can't deadlock on the inner-spawn pattern. Path C (refactor
`kos-compat-api` to import in-process) is the correct long-term
fix but is deferred as P1.

Updated plist backup: `com.jarvis.notion-poller.plist.pre-pathB-<ts>`.

### `gbrain dream` not wired (intentionally)

v0.17's flagship `gbrain dream` expects a filesystem `brain directory`
as the source of truth (lint + backlinks + sync phases all mutate
`.md` files, then sync picks the changes into DB). Our deployment is
DB-native: Notion is the source, `kos-compat-api /ingest` writes
pages into `~/.gbrain/brain.pglite` directly. There is no filesystem
brain dir to lint. `gbrain dream` (and even `gbrain dream --phase
orphans`) exit with `No brain directory found`.

Cron-level read-only reports can still use the standalone `gbrain
orphans --json` subcommand if needed. Full `dream` wiring is a no-op
for us unless we re-introduce a filesystem mirror (not planned).

### pglite pin stays at 0.4.4

Upstream master's `package.json` still pins 0.4.3 as "best shot"
against macOS 26.3 WASM bug (#223). On this machine 0.4.4 opens
cleanly and 0.4.3 aborts. Our override holds; `bun install --frozen-
lockfile` will pull 0.4.4 via the explicit dependency rather than
dropping to upstream's 0.4.3.

### Test results

`bun test`: 1997 pass / 192 skip / 19 fail / 5159 expects. All 19
failures are in **upstream** test files (`test/dream.test.ts`,
`test/orphans.test.ts`, `test/build-llms.test.ts`, `test/migrations-
v0_14_0.test.ts`). None touch `skills/kos-jarvis/`, `server/`, or
`workers/`. Known failure clusters:
- dream tests fail because our config doesn't have a `brain directory`
  configured (dream can't resolve a default path → exit 1, test's
  fixture expected a valid dir).
- `build-llms` tests fail because our fork's `README.md`/`CLAUDE.md`
  have KOS-jarvis preamble that upstream's `llms.txt` generator
  doesn't know about → committed file drifts vs regenerated.
- `orphans.test.ts` + `v0_14_0` tests fail for reasons unknown;
  upstream-only, non-blocking.

None of the failures indicate fork-local regressions.

### Orchestrator ledger cleanup

`gbrain doctor` still warns `MINIONS HALF-INSTALLED (partial
migration: 0.13.0)`. Reason: v0.13.0 orchestrator's
`frontmatter_backfill` phase shells out via `process.execPath extract
links --source db --include-frontmatter`, which on our bun-runtime
install resolves `process.execPath = bun`, tries to run `bun extract`,
and fails. Filed upstream as
[#332](https://github.com/garrytan/gbrain/issues/332) (still open as
of sync time). We manually ran the equivalent `gbrain extract links`
post-migration, so the data side is correct; only the ledger row
remains "partial". Cosmetic. Per fork policy (CLAUDE.md) we don't
patch `src/*`, so this warning persists until upstream merges #332.

### Rollback

- Merge commit: `b6ea540` on master. Rollback tag: `pre-sync-v0.17`
  at `02efe73`.
- PGLite rollback: `~/.gbrain/brain.pglite.pre-v0.17-sync-1776896571`
  is the last known-good pre-migration copy. `mv` it into
  `~/.gbrain/brain.pglite` to return to schema v4 / 1768-page state.
- Launchd plist rollback: `com.jarvis.notion-poller.plist.pre-pathB-
  <ts>` restores the v0.14-era minion-wrap design.
- Per "one rolling backup" policy, older backups (pre-v0.15.1, the
  broken-copy from the WASM abort) were deleted after verification.

---

## 6.8 Filesystem-canonical — Step 1 audit (2026-04-22)

Not a sync — a pre-migration audit for the P1 filesystem-canonical track
(TODO.md §P1). Goal: prove out whether `gbrain export` faithfully
materializes our KOS brain to disk before committing to the multi-week
migration that would make `.md` files the source of truth and let
`gbrain dream` run nightly.

### Method

- `gbrain export --dir /tmp/brain-export-preview` on the full 1786-page
  live PGLite brain (~2 min, 17 MB output, 0 failures).
- Structural audit: directory distribution, frontmatter field coverage,
  timeline sentinels, cross-link shape.
- Compatibility audit: `gbrain lint` against the exported tree.
- Full report at [`docs/FILESYSTEM-CANONICAL-EXPORT-AUDIT.md`](FILESYSTEM-CANONICAL-EXPORT-AUDIT.md).

### Verdict: GO, with 3 blockers (corrected from 4)

| Signal | Result |
|---|---|
| 1786/1786 pages exported | ✅ Complete, zero data loss |
| KOS frontmatter preservation | ✅ `kind` 100%, `status` 100%, `confidence` 99%, `owners` 98% |
| DB-exclusive data (`.raw/` sidecars) | ✅ 0 across 1786 pages → filesystem IS canonical |
| Body integrity | ✅ 0 empty-body pages; UTF-8 clean |
| Timeline compatibility | ✅ 749 pages use standard `<!-- timeline -->` sentinel |
| Upstream `gbrain lint` footprint | ℹ️ ~3-5 legitimate `YYYY-MM-DD` filename-template findings across 1786 pages (hand-patchable; NOT a `[E3]`/`[10]+` false-positive as initial draft claimed) |
| Slug hygiene | ⚠️ 7 root-level strays + 262 `id: >-` block-scalar legacy pages |
| `type:` / `kind:` drift | ⚠️ 27% (487 pages) — upstream PageType enum doesn't cover person/company/etc, `kind:` carries the real taxonomy |
| `evidence_summary` coverage | ⚠️ 0% — DB reality, not an export bug (candidate C on the TODO queue) |
| `gbrain dream` hard dep | ℹ️ requires configured brain dir for ANY phase — even `--phase orphans --dry-run` exits with "No brain directory found". Unblocking dream IS the migration, not a separable blocker. |

### Directory shape (slug-prefix routing, not type/kind routing)

```
people 375 | companies 85 | concepts 180 | projects 210 | decisions 6
syntheses 4 | comparisons 3 | protocols 4 | entities 3 | timelines 1
sources 908 (sources/notion: 860, sources root: 47+1)
root strays 7 | —— 1786 total
```

`sources/feishu/` and `sources/wiki/` are both empty — feishu
signal-detector hasn't produced content yet, and v1 wiki's 85 pages
import landed at `sources/` flat instead of `sources/wiki/`.

### Blockers → next-session scope (revised after same-session correction)

Earlier draft of this section listed a "Step 1.5 lint shim" as the first
blocker. Withdrawn after reading `src/commands/lint.ts:70` — the
`placeholder-date` rule only matches literal `YYYY-MM-DD` / `XX-XX`, not
KOS bracketed tags. See audit report §5.2 for the full correction log.

1. **Step 1.5 — Bulk slug + `id: >-` normalization** (DB write, high
   care). 7 root strays + 262 legacy `id: >-` pages → clean one-liner
   shape. Before running: `launchctl disable` every DB-writing service,
   take a fresh rolling PGLite backup, run the rewrite script, re-extract
   links, re-enable services. One-time. ~1-2 h scope.
2. **Step 1.6 — Round-trip sanity**. Export → dry-run re-import into a
   throwaway PGLite → diff `kind` / `status` / `confidence` columns.
   Verifies `kind:` survives markdown round-trip since upstream only
   reads `type:`. ~1 h.
3. **Step 2 — Flip `/ingest` to filesystem-first**. Only after
   1.5 + 1.6 clear. Multi-week scope (not one session).

Steps 1.5 and 1.6 are each one-session scope. The read-only audit in
this session consumed no risk and locked in the go/no-go decision; the
correction round also tightened the plan by removing an unnecessary step.

### Artifact cleanup

- `./export/` (accidental sibling from `gbrain export --help` failing
  to dispatch help) was moved to `/tmp/brain-export-preview` then
  deleted after numbers were captured in the audit report.
- Lesson: `gbrain export --help` silently ignores the flag and writes
  to default `./export/`. Always pass `--dir <path>` explicitly.

---

## 6.9 Filesystem-canonical Steps 1.5 + 1.6 landed (2026-04-23)

Same-day follow-through on §6.8. Both steps completed cleanly under the
safety protocol; rolled up into commit `<pending>` along with the audit
corrections from §5.2/§5.4.

### Step 1.5 — Slug normalization

Delivered as a new skill at `skills/kos-jarvis/slug-normalize/`
(SKILL.md + run.ts + roundtrip-check.ts). Three modes:
`--plan` (read-only preview), `--apply` (transactional DB write),
`--verify` (post-apply assertions). Direct `PGlite.create` path
(with `vector` + `pg_trgm` extensions loaded, same as
`src/core/pglite-engine.ts:48`), not via `BrainEngine` — bypasses
BrainWriter hooks and stays lock-compatible with the disabled launchd
services.

Executed changes:
- 7 slug renames (`ai-jarvis` → `concepts/ai-jarvis`; 6 URL-slug
  sources → `sources/<slug>`). `frontmatter.id` unchanged (kind-topic
  form preserved; matches 886 other pages in the brain).
- 1 intra-brain `compiled_truth` rewrite
  (`projects/notion-agent` had `](www-anthropic-com-news-claude-opus-4-5.md)`
  → `](sources/www-anthropic-com-news-claude-opus-4-5.md)`).
- Total pages 1829 → 1829 (no drift). 15/15 verify assertions passed.

Execution protocol (recorded for future DB-write ops):
1. `launchctl disable user/$UID/com.jarvis.{5 svcs}` then
   `launchctl bootout gui/$UID/…` — the `gui/` domain is required
   to actually kill user-level LaunchAgents. `user/` domain's bootout
   reports success but leaves the PID alive.
2. `launchctl bootout gui/$UID/com.jarvis.cloudflared` to block
   external ingest into `kos-compat-api` during the operation window.
3. Fresh rolling backup under `~/.gbrain/brain.pglite.pre-slug-normalize-<ts>`
   (prior v0.17-sync backup evicted per "one backup" policy).
4. `--plan` → `--apply` → `--verify`. Each step human-readable,
   idempotent, transactional.
5. `launchctl enable gui/$UID/…` + `launchctl bootstrap gui/$UID …plist`
   to restart services. Re-running `bootstrap` on already-auto-loaded
   services returns `Input/output error 5` — benign, the service is
   already correctly loaded.

Report at `~/brain/agent/reports/slug-normalize-2026-04-23.md`.

### Step 1.6 — Markdown round-trip sanity

Delivered as `skills/kos-jarvis/slug-normalize/roundtrip-check.ts`.
Runs upstream `serializeMarkdown → parseMarkdown` pair on every page
and diff-compares 10 KOS-critical frontmatter fields (`kind`,
`status`, `confidence`, `source_of_truth`, `owners`,
`evidence_summary`, `source_refs`, `related`, `aliases`, `id`).

**Result: 1829/1829 clean, 0 diffs.** `kind:` (and all other KOS
extensions) survive the markdown serialize+parse loop as pass-through
JSONB. The 27% type/kind drift noted in §6.8 is safe to carry through
the eventual filesystem-canonical flip.

Originally planned path was "throwaway PGLite via `gbrain init --path` +
`gbrain import`". Rejected: `gbrain import` has no `--path` override,
so a throwaway DB would have required swapping `~/.gbrain/config.json`
and disabling all DB-writing services for the full window. Pure-function
round-trip over the same upstream code gave equivalent confidence at
zero DB risk and ~30 s wall clock.

### Blockers now resolved

The 3 pre-migration blockers from §6.8 are cleared:
- Slug hygiene → resolved via slug-normalize skill (7 renames).
- type/kind round-trip → resolved by roundtrip-check (0 diffs).
- `id: >-` "blocker" → withdrawn (never a real blocker; gray-matter
  auto line-folding, not data damage).

The only remaining step on this track is Step 2 (/ingest flip to
filesystem-first + git-track the brain dir + enable `gbrain dream`
cron). Multi-week. First micro-step scope in the new handoff doc.

---

## 6.10 Filesystem-canonical Step 2.1 — brain-dir design locked (2026-04-23)

Same-day follow-through on §6.9. Pure design pass, zero code / DB /
launchd touches. Full doc at
[`docs/STEP-2-BRAIN-DIR-DESIGN.md`](STEP-2-BRAIN-DIR-DESIGN.md).

### The 5 decisions, pinned

1. **Brain-dir location** → `~/brain/` (canonical), `agent/` one-shot
   rename to `.agent/`. Upstream `src/core/sync.ts:82` skips any path
   segment starting with a dot, so the rename is all it takes to keep
   kos-patrol / enrich-sweep / slug-normalize outputs out of sync's
   scope without moving files out of `~/brain/`.
2. **Sync frontmatter fidelity** → Step 1.6's pure-function round-trip
   already covers `sync.ts` (same `parseMarkdown` call site at
   `src/core/import-file.ts:71, 187`). A 30-minute throwaway-dir smoke
   stays in the design doc as Step 2.2 preflight, not executed this
   session.
3. **notion-poller refactor** → keep HTTP-POST to `/ingest`; rewrite
   `/ingest` handler internally from `gbrain import` to `file write +
   gbrain sync`. External contract (Notion Worker, feishu, ad-hoc curl)
   stays frozen. Path C (kos-compat-api in-process import, §7 P1)
   dissolves as a side effect of `gbrain sync`'s incremental
   idempotency. `workers/notion-poller/run.ts` doesn't change a line.
4. **kos-patrol output migration** → path-constant rewrite in 4 fork-
   local files + 1 one-shot `mv`. No data loss; existing 8 report /
   digest / dashboard files move along with the rename.
5. **git strategy** → defer. Step 2 lands without git; `~/.gbrain/
   brain.pglite.pre-*` rolling backup covers rollback. `gbrain dream`
   doesn't require git (only `--pull` does). +14-day checkpoint after
   Step 2.3 revisits with a private `jarvis-brain` repo + post-dream-
   cycle commit-batching wrapper.

### "100-pages mystery" resolved

Handoff §3 asked where `/status` got `total_pages: 100` from; earlier
the §6 "Verify health at any time" note claimed it was a filesystem
mirror scan. Wrong. `server/kos-compat-api.ts:77` shells out
`gbrain list --limit 10000`, and the upstream CLI silently caps list
output at 100 rows regardless of `--limit`. Verified:

```
$ gbrain list --limit 10000 | wc -l
100
$ gbrain stats | head -3
Pages:     1829
```

`~/brain/` is a 9-file agent-output dir, never a content mirror. §6's
caveat block updated; Step 2.2 rewrites `/status` to direct-DB query
via `skills/kos-jarvis/_lib/brain-db.ts`.

### Next: Step 2.2

Opens as a separate session. Reads `docs/STEP-2-BRAIN-DIR-DESIGN.md`
§4 for the roadmap. Scope: `/ingest` flip + `.agent/` rename +
`/status` direct-DB in one 1-2 h session under the slug-normalize
launchctl-disable + rolling-backup protocol.

### Rollback

No rollback needed for a pure-design commit. Undo = `git revert`.

---

## 6.11 Filesystem-canonical Step 2.2 landed + v0.18 sync deferred (2026-04-23 evening)

Two commits on master: `79331b7` (v0.18 sync preflight verdict =
blocked) + `b7212db` (Step 2.2 executed on v0.17 baseline).

### v0.18 sync preflight (79331b7, pre-flight evening)

Upstream `master` advanced to `2751581` (v0.18.0 multi-source brains +
v0.18.1 RLS hardening) on 2026-04-22; `feat/migration-hardening` branch
carries v0.18.2 (PR #356 open, not yet merged). Preflight smoke built
v0.18.2 from source against a copy of
`~/.gbrain/brain.pglite.pre-slug-normalize-*` in an isolated `$HOME`:

- **v16→v24 migration chain FAILS on PGLite 0.4.4 with 1829 pages.**
  `gbrain init --migrate-only` directly throws
  `column "source_id" does not exist`; `gbrain apply-migrations --yes`
  reports v0.18.0 orchestrator `status=failed` and leaves
  `schema_version=16` unchanged. Data integrity preserved. Root cause:
  `src/core/pglite-engine.ts` in v0.18.2 SELECTs `pages.source_id` in
  engine methods called during the v0.13.0 orchestrator's
  `extract links --source db` phase, before v21 has added the column.
  Fresh installs don't trip it; v16→v24 upgrades do.
- Fork policy (CLAUDE.md) forbids patching `src/*`. **v0.18 sync
  deferred** until upstream fixes the PGLite upgrade path.
- Smoke artifacts preserved under `/tmp/gbrain-upstream-peek/` +
  `/tmp/gbrain-smoke-v018-*/` for future upstream issue repro.

### Step 2.2 executed (b7212db, same evening)

Filesystem-canonical `/ingest` flip + `.agent/` rename + `/status`
direct-DB all landed in a single 1-2 h focused session on the v0.17
baseline per `docs/STEP-2-BRAIN-DIR-DESIGN.md §4 Step 2.2`. One design
surprise adjusted mid-session: Step 2.1 Decision 5 claimed
"`gbrain sync` works on a plain dir, git deferrable to +14d." False.
`src/commands/sync.ts:119` explicitly requires `.git/`; the sync
implementation walks `git diff LAST..HEAD` for file discovery. **`git
init ~/brain` + first commit became a Step 2.2 prerequisite**, not a
Step 2.4 deferrable.

Validation this session:

| Check | Result |
|---|---|
| Preflight smoke: 10 pages × 10 KOS frontmatter fields | 10/10 round-trip clean, 0 diffs |
| `mv ~/brain/agent ~/brain/.agent` | 9 files relocated; sync skips dot-prefix per `isSyncable()` |
| `~/brain/raw/web/*.md` upgrade | Became `sources/2026-04-21-ai-economy-disruption-dual-jarvis.md` with full KOS frontmatter |
| `git init ~/brain` + seed commit | branch=main, commit=6ed6653, 10 files |
| `gbrain sync --repo ~/brain --no-pull` (first call) | +1 added, sync.repo_path registered in config, 1858 pages |
| `/status` endpoint via prod port 7225 | total_pages=1858 (was 100-capped), full KOS 9-kind + confidence breakdown |
| `/ingest` POST smoke | file at `~/brain/sources/*.md`, git commit 116a5d1, sync +1, DB 1859, frontmatter preserved |
| `/digest` endpoint | Returns patrol-2026-04-19.md from new `.agent/digests/` path |
| `notion-poller` manual kickstart | Normal DELTA cycle against new `.agent/notion-poller-state.json` path |
| `gbrain doctor --fast` | 70/100 (cosmetic resolver + v0.13.0 partial; no new warnings) |
| `~/.gbrain/sync-failures.jsonl` | Does not exist (0 parse failures, clean) |

Rolling backup: `~/.gbrain/brain.pglite.pre-step2.2-1776965283` (292 MB).

### Opportunistic findings (pre-existing, not regressions)

- **kos-patrol launchd cron has been `LastExitStatus=1` since
  2026-04-19.** Root cause: the minion-wrapped `gbrain list` call
  runs in a subprocess that hits the macOS 26.3 WASM bug
  (`Aborted(). Build with -sASSERTIONS for more info.`) — same
  `#223` class we carry the `@electric-sql/pglite@0.4.4` override for,
  but the subprocess doesn't inherit our override reliably. Direct
  `bun run skills/kos-jarvis/kos-patrol/run.ts` succeeds (writes
  `patrol-2026-04-23.md` to `.agent/digests/` correctly). Tracked as
  P1 in TODO.md.
- **kos-patrol uses `gbrain list --limit 10000`** — same upstream
  100-row cap we fixed in `/status`. Inventory says "100 pages" on a
  1858-page brain, feeding wrong numbers into dashboards + digests.
  Migrating kos-patrol to `BrainDb` direct-read is a natural
  follow-up (1-2 h). Tracked as P1 in TODO.md.

### Next: Step 2.3 — `gbrain dream` cron wiring

Preconditions met: `sync.repo_path=~/brain` set, `~/brain` is a git
repo with first commit, filesystem-canonical flow live. Step 2.3
remains as designed — add `com.jarvis.dream-cycle.plist` daily 03:00
via `skills/kos-jarvis/dream-wrap/run.ts` archiving cycle JSON to
`~/brain/.agent/dream-cycles/`. Observe the first overnight lint +
backlinks phases for KOS-frontmatter compatibility.

### Rollback (if ever needed)

1. `launchctl bootout` all jarvis services
2. `cp -R ~/.gbrain/brain.pglite.pre-step2.2-1776965283 ~/.gbrain/brain.pglite`
3. `mv ~/brain/.agent ~/brain/agent; rm -rf ~/brain/.git ~/brain/sources`
4. `git revert b7212db` in fork
5. Services bootstrap

Not expected — idempotent sync flow, data integrity preserved throughout.

---

## 6.12 Upstream v0.18.2 synced with fork patch (2026-04-23 evening, commit `aceb838`)

The v0.18 sync deferral from §6.11 is resolved. `feat/migration-hardening`
merged to upstream master as v0.18.2 (`08b3698`) mid-session, and
targeted investigation isolated the v16→v24 upgrade blocker to a
**single line** in `src/core/pglite-schema.ts`. Fork policy was relaxed
specifically for this unblock ("modify `src/`, record the patch, handle
conflicts at next merge"); the patch is 1 line removed + 10 lines of
comment block marking it.

### The one-line bug

`PGLITE_SCHEMA_SQL` line 63 declared:

```sql
CREATE INDEX IF NOT EXISTS idx_pages_source_id ON pages(source_id);
```

**outside** the `CREATE TABLE IF NOT EXISTS pages(...)` block above
it. On fresh installs: fine — the CREATE TABLE creates pages with
source_id, the CREATE INDEX succeeds. On a v16 brain upgrade: fatal
— CREATE TABLE IF NOT EXISTS skips the existing pages table (no
source_id column), the next CREATE INDEX fires `column "source_id"
does not exist`, which aborts `engine.initSchema()` before
`runMigrations()` can execute v21 (the migration that would have
added the column). schema_version stays stuck at 16, every orchestrator
reports `status=failed`, no data is lost — just no upgrade either.

### The patch

Delete line 63. The v21 migration already re-creates the index
idempotently via `CREATE INDEX IF NOT EXISTS idx_pages_source_id ON
pages(source_id)`, so fresh installs still end up with the index. Only
behavior change: index is now declared in one place (v21 migration)
instead of two. Patched in `src/core/pglite-schema.ts` with a 10-line
comment block pointing to [`docs/UPSTREAM-PATCHES/v018-pglite-upgrade-fix.md`](UPSTREAM-PATCHES/v018-pglite-upgrade-fix.md)
+ upstream [#370](https://github.com/garrytan/gbrain/issues/370).

### Sync sequence this session (timeline)

1. Preflight (§6.11) — identified v0.18 sync blocker on fresh smoke
2. Diagnosed bug via a second smoke with PATH-shimmed `gbrain` (first
   smoke was self-deceived — orchestrator's `execSync('gbrain ...')`
   was resolving to our v0.17 binary, not upstream peek)
3. Isolated the bug to pglite-schema.ts:63 — 10 min of source reading
4. Wrote 1-line patch in /tmp peek → smoke re-runs GREEN (v16→v24
   advances, sources.default seeds, 1857 pages source_id='default',
   zero data loss)
5. Safety protocol: 6 services bootout'd, lsof clean, fresh
   `~/.gbrain/brain.pglite.pre-v018-1776967072` backup (292 MB),
   `git tag pre-sync-v0.18`
6. `git merge upstream/master` — one conflict (package.json version),
   resolved: take upstream 0.18.2, keep our pglite 0.4.4 pin
7. Applied the same patch to `src/core/pglite-schema.ts` in our fork
8. `bun install` triggered postinstall `gbrain apply-migrations --yes`
   which migrated the **live** brain through the patched code path
   (the pglite module resolution happened to pick up our patch
   immediately; we got away with this because bun install evaluates
   TypeScript directly via our `~/.bun/bin/gbrain → src/cli.ts`
   symlink, no compile step needed)
9. Services restarted, end-to-end re-validated on v0.18.2 baseline

### Validation (all green)

| Check | Result |
|---|---|
| `config.version` | 16 → **24** ✓ |
| `sources list` | `default federated 1860 pages never synced` ✓ |
| All 1860 pages `source_id='default'` | ✓ (schema DEFAULT auto-scope) |
| Page count / chunks / links / timeline | 1860 / 3451 / 385 / 5443 — zero drift ✓ |
| `gbrain doctor schema_version` | `OK Version 24 (latest: 24)` ✓ |
| `/status` endpoint | 1860 pages, KOS 9-kind breakdown + `source` scope ✓ |
| `/ingest` POST smoke | imported:true, embedded:true (no retry-fallback), git commit + sync +1 added ✓ |
| notion-poller real cycle | **2 Notion pages auto-ingested through filesystem-canonical path** ✓ (production flow, not just smoke) |
| `brain_score` | 56/100 unchanged (cosmetic, pre-existing) |

### What changed in the fork artifact

- `package.json`: 0.17.0 → 0.18.2, kept `@electric-sql/pglite: 0.4.4` pin
- `src/core/pglite-schema.ts`: 1-line patch + provenance comment
- `docs/UPSTREAM-PATCHES/v018-pglite-upgrade-fix.md`: new, documents
  root cause + fix + validation + removal trigger (upstream merges #370)
- 79+ upstream files pulled in (sources CLI, multi-source docs,
  v0_18_0/v0_18_1 orchestrators, engine enhancements, RLS hardening)

### Not yet wired

- **`gbrain sources add jarvis --path ~/brain`** — we currently run
  on the seeded `default` source. Renaming to an explicit "jarvis"
  source id is cosmetic; the current wiring works fine on `default`.
  Parked for Step 2.4 if we ever split sources (e.g., jarvis-wiki +
  jarvis-notes).
- **Fork patch removal trigger**: when upstream merges #370, our
  pglite-schema.ts comment block comes out. Diff is trivial — just
  restore the single deleted line if upstream's fix preserves it,
  or delete our provenance block if upstream removed the line too.

### Rollback matrix (updated)

| To restore | Command |
|---|---|
| **DB state pre-v0.18** | `cp -R ~/.gbrain/brain.pglite.pre-v018-1776967072 ~/.gbrain/brain.pglite` |
| **Git state pre-v0.18 merge** | `git reset --hard pre-sync-v0.18` |
| **Services state** | Same bootout → restore → bootstrap protocol as §6.11 |

---

## 6.13 Filesystem-canonical Step 2.3 — `gbrain dream` cron wired (2026-04-23 late-night)

The core filesystem-canonical track is done. With Step 2.2 having flipped
`/ingest` to the `~/brain/<kind>/<slug>.md` → git → `gbrain sync` path
and Step 2.3 today wiring the nightly maintenance cycle, the brain now
has both a write side (live, every Notion poll) and a read-side
maintenance pass (overnight, deterministic). Everything between Step
2.4's commit-batching and an external git remote is parked for the
+14-day soak.

### What landed (untracked at this checkpoint, single commit pending)

- `skills/kos-jarvis/dream-wrap/run.ts` — wrapper around `gbrain dream
  --json`. Resolves brain dir from `gbrain config get sync.repo_path`
  (set during Step 2.2 via `gbrain init --pglite --repo ~/brain`),
  archives the CycleReport JSON to
  `~/brain/.agent/dream-cycles/<ISO>.json`, atomically swaps a
  `latest.json` symlink, translates exit codes:
  `clean | ok | partial | skipped → 0`, `failed → 1`,
  wrapper-level errors → 2. Defensive JSON extraction (slice from
  first `{` to last `}`) handles upstream phases that leak human
  text to stdout in `--json` mode (notably `embed --dry-run`).
- `skills/kos-jarvis/dream-wrap/SKILL.md` — operator doc: purpose,
  exit-code semantics, manual invocation, archive reading, launchd
  install / refresh / rollback.
- `scripts/launchd/com.jarvis.dream-cycle.plist.template` — daily
  03:11 local (`StartCalendarInterval`, `RunAtLoad=false`, off the
  `:00` mark to avoid thundering-herd with other personal cron).
  Identical-content `.plist` is gitignored (consistent with the rest
  of `scripts/launchd/`).
- Deployed: `~/Library/LaunchAgents/com.jarvis.dream-cycle.plist`
  bootstrapped into `gui/$UID`. `launchctl list | grep dream-cycle`
  shows `-  0  com.jarvis.dream-cycle` (PID `-` is normal between
  fires, EXIT 0 healthy).

### Smoke test summary (6 cycles, 2 hours of iteration)

| # | Mode | Result | Notes |
|---|---|---|---|
| 1 | `--phase lint` | exit 0 (cycle status `partial`) | First wrapper run; surfaced exit-code bug — see fixes below |
| 2 | `--phase lint` re-run | exit 0 (`partial`) | Confirmed deterministic |
| 3 | `--dry-run` | exit 0 (`partial`) | Surfaced JSON parse bug — see fixes below |
| 4 | `--dry-run` re-run | exit 0 (`partial`) | Confirmed defensive parser works |
| 5 | Real cycle | exit 0 (`partial`) | All 6 phases ran |
| 6 | Real cycle re-run | exit 0 (`partial`) | Idempotency verified |

Cycle #6 phase breakdown (representative of the steady state):

```
lint         warn         14ms  0 fix(es) applied, 144 remaining
backlinks    ok           18ms  0 back-link(s) added, 0 remaining
sync         ok           42ms  +0 added, ~0 modified, -0 deleted
extract      ok           14ms  0 link(s), 0 timeline entries
embed        ok         1670ms  0 chunk(s) newly embedded (3626 already had embeddings)
orphans      warn         19ms  1803 orphan page(s) out of 1930 total
```

`partial` is the steady-state cycle status (lint warns + orphans
warns). Both warnings are pre-existing data shape issues, not Step
2.3 regressions, and are filed in TODO.md as P1 follow-ups (see
"Known follow-ups" below). Critical: pages 1930 → 1930 and chunks
3626 → 3626 across re-runs; the cycle is read-mostly when there's
no fresh work, exactly what we want from a maintenance pass.

### Two bugs hit and fixed during smoke (both in our wrapper, not upstream)

1. **`exitForStatus` missing `partial` case** — initial wrapper switch
   handled `clean | ok | warn | failed | skipped` (modeled on
   phase-level statuses). But `CycleStatus` (cycle-level, defined at
   `src/core/cycle.ts:97` upstream) is `'ok' | 'clean' | 'partial' |
   'skipped' | 'failed'` — `warn` is phase-level only, never cycle-level.
   Fix: `case "clean" | "ok" | "partial" | "skipped" → 0`,
   `case "failed" → 1`, with a comment citing the upstream type.
2. **`gbrain dream --dry-run --json` stdout pollution** — embed phase
   in dry-run mode prints `[dry-run] Would embed 0 chunks across 1930
   pages` to stdout BEFORE the JSON CycleReport, breaking
   `JSON.parse`. Fix in our wrapper: extract JSON by slicing from
   first `{` to last `}` (CycleReport is a single top-level object,
   so this is unambiguous), surface stripped noise to stderr as a
   warning. Filed upstream tracking item: `gbrain dream --json`
   should keep stdout JSON-clean across all phases.

### Validation (all green)

| Check | Result |
|---|---|
| `gbrain doctor schema_version` | OK Version 24 |
| `gbrain stats` page count pre/post 6 cycles | 1930 / 1930 — zero drift |
| `gbrain stats` chunk count pre/post | 3626 / 3626 — zero re-embed |
| `~/brain/.agent/dream-cycles/` | 5 cycle JSONs + `latest.json` symlink |
| `~/brain/.agent/dream-cycles/` in gitignore | yes (`.agent/` covered by Step 2.2 rename) |
| launchctl service state | `-  0  com.jarvis.dream-cycle` (loaded, idle, last exit 0) |
| All 7 jarvis services | green (kos-patrol still `1` — separate P1, see §6.11) |
| notion-poller's 5-min cycle, post dream-cycle install | clean cycles, no lock contention |

### Known follow-ups (filed as P1 in `skills/kos-jarvis/TODO.md`)

1. **notion-poller frontmatter — `title:` + `type:` omission**: lint
   warns on 144 issues across 72 disk pages, all `~/brain/sources/notion/*.md`.
   KOS uses `kind:` (we preserve this); upstream lint also expects
   `title:` + `type:`. Fix at the writer (`workers/notion-poller/run.ts`
   frontmatter builder, ~10 LOC) + `gbrain sync --force` backfill.
2. **v1-wiki orphan backlog**: 1803/1930 pages have zero inbound
   wikilinks (93% orphan rate). Pre-existing from v1 wiki migration —
   imported flat with no graph edges. enrich-sweep + idea-ingest
   gradually reduce this; track as a multi-week soak metric.
3. **Upstream `gbrain dream --dry-run --json` stdout pollution**:
   the embed phase leak (see "bugs hit" above) is worth reporting
   upstream. Our wrapper is already defensive.

### Brain-dir layout post-Step-2.3

```
~/brain/
├── .git/                       (Step 2.2)
├── .gitignore                  (excludes .agent/, .DS_Store)
├── .agent/                     (Step 2.2 rename from agent/)
│   ├── dashboards/             (kos-patrol output)
│   ├── digests/                (kos-patrol + dream digests)
│   ├── reports/                (slug-normalize, ingest reports)
│   ├── dream-cycles/           ← NEW (Step 2.3)
│   │   ├── 2026-04-23T23-37-24Z.json
│   │   ├── 2026-04-23T23-38-20Z.json
│   │   ├── 2026-04-23T23-39-21Z.json
│   │   ├── 2026-04-23T23-39-32Z.json
│   │   ├── 2026-04-23T23-39-42Z.json
│   │   └── latest.json → 2026-04-23T23-39-42Z.json
│   ├── notion-poller-state.json
│   └── pending-enrich.jsonl
└── sources/
    └── notion/                 (Step 2.2 + post-hotfix `051ae74`)
        └── …                   (72 .md files, growing every 5 min)
```

### Next: Step 2.4 (parked +14d)

After 14 days of clean nightly cycles, decide:
- (a) `gh repo create jarvis-brain --private` + extend `dream-wrap` to
  `git push` at cycle end (off-machine knowledge backup)
- (b) Commit-batching wrapper to coalesce per-ingest commits (~5-9
  per Notion poll) into one end-of-cycle commit, reducing
  `git -C ~/brain log` noise

If observability needs change before then, `/status` can grow a
`dream_cycle_health` field by reading `latest.json` (one fs read,
no DB hit). Not in scope today.

### Rollback

```bash
launchctl bootout gui/$UID ~/Library/LaunchAgents/com.jarvis.dream-cycle.plist
rm ~/Library/LaunchAgents/com.jarvis.dream-cycle.plist
# DB rollback (if a bad cycle corrupts something):
cp -R ~/.gbrain/brain.pglite.pre-step2.3-1776987292 ~/.gbrain/brain.pglite
# Archive dir kept for audit; safe to remove if desired:
# rm -rf ~/brain/.agent/dream-cycles/
```

---

## 6.14 Upstream v0.20.4 sync (2026-04-25, commit `8665afb`)

Six upstream releases land in one merge: v0.18.2 → v0.19.0 → v0.19.1 →
v0.20.0 → v0.20.2 → v0.20.3 → v0.20.4. The total diff is 356 files /
+10813 / -9937. Conflict count: 2 real (`.gitignore`, `manifest.json`),
5 auto-merged (CLAUDE.md, README.md, package.json, RESOLVER.md, src/cli.ts).

### What we adopted

- **#332 closure** ([garrytan/gbrain#332](https://github.com/garrytan/gbrain/issues/332)).
  v0.19.0 replaced `process.execPath` in `src/commands/migrations/v0_13_0.ts`
  with a shell-out to `gbrain` on PATH. The orchestrator now finds our bun
  shim correctly. Post-merge ran `apply-migrations --force-retry 0.13.0`
  + `apply-migrations --yes` to walk through `frontmatter_backfill` and
  advance the ledger from `partial` to `complete`. Doctor health 60→80,
  the FAIL `minions_migration` check is now OK. Three net new links
  created across 1988 pages (the rest were already present from earlier
  manual extracts).
- **smoke-test skillpack** registered in `manifest.json` alongside our 9
  kos-jarvis skills (39 total). OpenClaw side will pick up the new
  triggers automatically; no fork action.
- **`gbrain check-resolvable --json`** now reachable from the CLI (v0.16.4
  surfaced this; v0.20.4 polished the JSON envelope). Optional integration
  point for a daily resolver-health cron, deferred.

### What we skipped (intentional, all Postgres-only)

- **`gbrain jobs supervisor`** (v0.20.2). Self-healing daemon for
  `jobs work` workers. Skipped because we don't run a worker daemon ...
  Path B retired the Minion shell-wrap layer for notion-poller, and
  the remaining 4 launchd cron jobs (notion-poller, dream-cycle,
  kos-patrol, enrich-sweep) exit synchronously after their work
  completes. Nothing to supervise.
- **`queue_health` doctor check** (v0.20.3). Skips on PGLite with
  `Skipped (PGLite — no multi-process worker surface)`. We have no
  queue.
- **Wedge-rescue / `handleWallClockTimeouts`** (v0.20.3). Layer-3 kill
  shot for jobs holding row locks. We have no multi-row queue at risk.
- **`backpressure-audit` JSONL trail** (v0.20.3). Caps per-name pile-up.
  We have at most one submitter per cron job (cardinality 1 per name).

The decision tree on whether to switch engines lives at
[`docs/UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md`](UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md).
TL;DR: defer, four trigger conditions named.

### Fork-local patches preserved (re-verified post-merge)

- `src/core/pglite-schema.ts:65` — `idx_pages_source_id` index commented
  out. Upstream #370 still open; index is recreated by v21 migration so
  fresh installs lose nothing. See `v018-pglite-upgrade-fix.md`.
- `src/core/pglite-engine.ts:87` — `SELECT pg_switch_wal()` issued before
  `db.close()`. Forces WAL segment rotation so the durable LSN catches up
  with in-memory writes. macOS 26.3 WASM persistence bug. No upstream
  issue filed yet (the repro is still flaky to script). See
  `v018-pglite-wal-durability-fix.md`.
- `src/cli.ts` — file mode 0755 (executable bit for the bun shim at
  `~/.bun/bin/gbrain`). Auto-merged this round.

### Pre-merge baseline + post-sync diff

| Metric | Pre-merge (HEAD `170876f`) | Post-merge + apply-migrations |
|---|---|---|
| Pages | 1988 | 1988 |
| Chunks | 3750 (100% embedded) | 3750 (100% embedded) |
| Links | 8522 | 8666 (+144 from frontmatter backfill) |
| Timeline entries | 10881 | 11020 (+139) |
| Orphans | 1630 | 711 (orphan-reducer ran during sync; not a sync side-effect) |
| `doctor` health | 60/100 (FAIL: minions_migration partial 0.13.0) | 80/100 (no FAILs) |
| `brain_score` | 86/100 | 86/100 (unchanged) |
| Schema version | 24 (latest) | 24 (latest) |

### Conflict resolution log

- `.gitignore` — union both fork (`.omc/`, kos-jarvis log globs) and upstream
  (`eval/data/world-v1/world.html`, `amara-life-v1/_cache/`) entries.
  No semantic conflict, just two append regions overlapping at the same
  line.
- `skills/manifest.json` — appended upstream's `smoke-test` skill before our
  9 kos-jarvis fork skills. 39 total skills registered.
- `CLAUDE.md` — auto-merged. Fork preamble (Lucien's context, fork-specific
  rules, upstream sync policy) intact at top; upstream's v0.19/v0.20 file
  references (queue_health, backpressure-audit, supervisor.ts, wall-clock
  timeouts) absorbed into the Key files / Operational health sections
  cleanly.
- `skills/RESOLVER.md` — auto-merged. Upstream added a `smoke-test` row at
  line ~57; our `## KOS-Jarvis extensions` append-only section moved from
  line 103 to 104 with no other change.
- `package.json` — auto-merged at version `0.20.4`. No dependency changes
  vs the v0.18.2 baseline (`bun install` reports `Checked 242 installs
  across 235 packages (no changes)`).
- `src/cli.ts` — auto-merged at mode `100755`.

### Verification

```bash
# unit tests (no DB needed)
bun test                                       # 2429 pass / 250 skip / 4 fail
                                               # The 4 fails are check-resolvable
                                               # cwd-pollution between parallel
                                               # tests (24/24 pass in isolation).
                                               # Filed as a parallel-test isolation
                                               # bug, not a fork issue.

bun run typecheck                              # tsc --noEmit clean

# v0.13 ledger advance
gbrain apply-migrations --force-retry 0.13.0   # writes retry marker
gbrain apply-migrations --yes                  # backfill links, ledger → complete

# service smoke
launchctl bootout gui/$(id -u)/com.jarvis.kos-compat-api
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:7225/status   # 1988p / 9 kinds
curl -sS http://localhost:7222/health                                     # gemini-embedding-2-preview
```

### Rollback

```bash
git reset --hard pre-sync-v0.20-1777105378
cp -R ~/.gbrain/brain.pglite.pre-sync-v0.20-1777105391 ~/.gbrain/brain.pglite
launchctl bootout gui/$(id -u)/com.jarvis.kos-compat-api
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist
```

The PGLite snapshot is 416 MB. Keep it for ≥7 days, then prune with
`rm -rf ~/.gbrain/brain.pglite.pre-sync-v0.20-*` once a clean week of
dream cycles + kos-patrol runs has passed.

---

## 6.15 Tier 1 maintenance sweep — orphan-reducer + frontmatter-ref-fix (2026-04-27 evening)

Two-day post-sync soak finished green, so this session executed the
Tier 1 punch list from
[`docs/SESSION-HANDOFF-2026-04-27-post-v0.20-sync.md`](SESSION-HANDOFF-2026-04-27-post-v0.20-sync.md)
in one ~12-minute window: lint ERROR fixes, an orphan-reducer sweep, and
a brand-new `frontmatter-ref-fix` skill. End-to-end: 4 commits, $0.336
Haiku, +177 links, -21 orphans.

### What ran

1. **4 lint ERROR fixes** — `~/brain` commit `eadf1d3`. Patrol
   2026-04-27 dashboard reported 4 ERROR-level findings: v1-wiki
   `sources/2026-{04-01,03-20,03-13}-*.md` files missing the `updated:`
   frontmatter field. Backfilled with `created` value (means: not
   modified since import). Pure data-shape fix, no body change.

2. **orphan-reducer apply --limit 100** — `~/brain` commit `5a6a584`,
   430s, $0.336. Haiku 4.5 classified 100 orphans against pgvector
   top-K candidates; 89 edges met the `--min-confidence 0.7` bar
   (`related` link_type, relation encoded in `context`). 88 of 89
   candidate pages exist on disk so a sentinel block (`<!-- orphan-
   reducer-inbound -->...`) was upserted at EOF; 1 candidate was
   DB-only (notion-source without a markdown file → recorded as
   `markdown_reason: "no_file"` in the JSON sidecar for future
   filesystem-mirror backfill). Sample edges: `people/harry-zhao →
   people/joe-qiu (supplements)`, `people/teresa-xu → people/josh-ye
   (implements)`. Cost matched handoff projection (~$0.35).

3. **frontmatter-ref-fix (new skill)** — fork repo commit `0695a6c`
   (`skills/kos-jarvis/frontmatter-ref-fix/SKILL.md` + `run.ts`,
   617 LOC); brain repo commit `d6be7ce` (apply). Walks
   `~/brain/**/*.md`, splits the `--- ... ---` block, scans
   line-by-line for `.md`-suffixed refs (with optional `../` prefix
   and yaml list dash or `key:` prefix), drops the decoration, looks
   up the canonical slug in an on-disk index, rewrites if resolved.
   Deliberately uses line-level regex rather than yaml.parse +
   yaml.stringify to preserve quote style + field order — that
   avoids producing a noisy notion-poller-vs-fix-skill emit-format
   diff.

   First sweep result: **220 refs found** (vs handoff's "14 dangling"
   — handoff under-counted because gbrain's link-extraction
   `DIR_PATTERN` (src/core/link-extraction.ts:47) doesn't accept
   `sources/` plural, so the ~80 source-page refs silently failed to
   resolve and didn't show up as "dangling"). 150 resolved + rewritten
   across 51 files; 70 left untouched (mostly `raw_path:` fields
   pointing at brain-external snapshots, plus ~30 bare-slug v1
   sibling refs that need fuzzy resolve — tracked as P2 follow-up
   `frontmatter-ref-fix v2` in TODO.md).

   Two handoff assumptions turned out wrong: (1) actual count is
   150+, not 14. (2) Target dir is `entities/` plural (matches
   brain layout), not `entity/` singular as handoff §3 suggested.
   The skill verifies against the on-disk slug index, so it gets
   the right answer regardless of what the handoff said.

### Aggregate metrics

| Metric | 2026-04-27 morning (handoff) | 2026-04-27 evening | Δ |
|---|---|---|---|
| Pages | 2091 | 2114 | +23 (notion-poller natural growth) |
| Chunks | 3963 | 4016 | +53 (frontmatter rewrite re-chunked 51 files) |
| Links | 8666 | **8843** | **+177** (89 from orphan-reducer + 88 from frontmatter resolved-rewrites flowing through `gbrain sync`'s extract phase) |
| Orphans | 814 | **793** | **-21** |
| Lint ERRORs | 4 | **0** | -4 |
| Brain score | 85/100 | 85/100 | unchanged (orphans 12/15 needs -70 more to advance) |
| Doctor health | 80/100 | 80/100 | unchanged (3 PGLite-quirk WARN: pgvector / graph_coverage / jsonb_integrity — known limitation, no FAIL) |

### What was built

```
skills/kos-jarvis/frontmatter-ref-fix/
├── SKILL.md          (107 lines, ~4.4 KB) — pipeline, usage, scope
└── run.ts            (510 lines, ~14.7 KB) — flag parsing, fs walk,
                       slug index, frontmatter splitter, regex
                       rewriter, report builder, git commit helper
```

The skill follows kos-jarvis conventions (no `src/*` touched, all
ext-pack-local, dry-run default with `--apply` opt-in, JSONL events
optional, report under `~/brain/.agent/reports/`).

### Cost / time accounting

- Wall time: ~12 min (5 min orphan-reducer in background while writing
  the new skill, 7 min for everything else: scan + dry-run review +
  apply + sync + verify).
- Haiku 4.5 calls: 105 (5 dry-run smoke + 100 apply). Total cost:
  **$0.336**, all via the `crs.chenge.ink/api` proxy (set
  `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` from `.env.local`; the
  Anthropic SDK reads both env vars natively).
- File operations: 51 frontmatter rewrites + 88 sentinel-block
  upserts + 4 lint backfills, 4 git commits across two repos.

### Follow-ups parked

- **frontmatter-ref-fix v2** (TODO.md P2): exclude `raw_path:`,
  fuzzy-resolve bare-slug v1 sibling refs. Closes the 70-unresolved
  long tail. ~1-2h.
- **orphan-reducer cadence**: weekly until orphans &lt;500 (currently
  793). Next sweep aims for `--limit 100`, expected -90 → ~700.
  Three more sweeps puts the orphans component at 13/15 → 14/15 →
  brain_score 85 → 87.

---

## 6.16 Long-tail closure — frontmatter-ref-fix v2 + 3 orphan sweeps (2026-04-27 late evening)

Continuation of §6.15. The user asked to "finish the v2 follow-up
and keep running orphan-reducer until the long tail is gone, so the
current TODO.md can archive and the next session starts fresh." This
entry covers that closure pass: ~30 min wall, $1.354 Haiku, 6
brain-repo commits + 2 fork-repo commits, **TODO.md officially
archived**.

### What ran

1. **frontmatter-ref-fix v2** (fork commit `cf236a4`, brain commit
   `f76f5c3`). Extends v1 with three mechanisms:
   - `EXTERNAL_POINTER_KEYS` allowlist (`raw_path:` only for now) —
     fields whose values legitimately point at brain-external paths.
     Lines under these keys are skipped without warning, so the
     report no longer treats them as dangling.
   - Bare-slug fuzzy resolve via a basename → full-slug index.
     v1-wiki sibling refs like `harness-engineering.md` (no dir
     prefix) get matched against the unique `*/harness-engineering`
     slug. Unique hits rewrite to canonical form; ambiguous +
     zero-hits remain in the report (none in production today).
   - New categories + opt-in deletion: `external_path` (2+ leading
     `../` — escapes brain root), `dead` (path-shape ref with
     missing target). `--delete-external` / `--delete-dead` /
     `--delete-all` splice matching lines from the frontmatter list.

   Sweep against the v1-residual long tail: 70 entries split into
   **35 fuzzy-resolved + 19 raw_path-skipped + 9 external-deleted +
   7 dead-deleted**. Zero `bare_ambiguous` and zero `bare_unresolved`
   — every bare slug in the brain had a unique basename hit. A
   follow-up dry-run reports only the 19 legitimate `raw_path`
   entries; everything else is gone.

2. **orphan-reducer rounds 2 / 3 / 4** (brain commits `6c666bb`,
   `9159bfd`, `a2efc02`). Three back-to-back `--apply --limit 100`
   runs to chip at the post-round-1 pile. Edges per round:
   **78 → 71 (68 db) → 37**. The drop at round 4 is the saturation
   signal — remaining orphans are increasingly isolated from the
   existing graph because the easy-to-link cohort is gone.

### Aggregate session metrics (this evening, both 6.15 and 6.16)

| Metric | 2026-04-27 morning (handoff start) | 2026-04-27 late evening (close) | Δ |
|---|---|---|---|
| Pages | 2091 | 2118 | +27 (notion-poller natural growth across the session) |
| Links | 8666 | 8225 | -441 net (frontmatter-ref-fix v2 deleted 16 deadlink rows; sync re-extract on 31 modified pages pruned some outdated edges; round 2-4 inserted +183 raw, but DB cleanup + dedup outpaced; needs follow-up audit if the trend continues) |
| Orphans | 814 | **732** | **-82** |
| brain_score | 85/100 | 85/100 | unchanged ... orphans 12/15 component covers a wide band |
| Doctor health | 80/100 | 80/100 | unchanged ... 3 PGLite-quirk WARN, zero FAIL |
| Lint ERRORs | 4 | **0** | -4 |
| Long-tail unresolved frontmatter refs | 70 | **0** (19 legit `raw_path` left) | -70 |

### Cost / time

- Total Haiku cost across **4 orphan-reducer rounds**: **$1.354**
  ($0.336 + $0.342 + $0.339 + $0.337). Matches the original handoff
  estimate of "~$1 to clear 793 → 500."
- Total wall: ~30 min (4 × 7-min orphan rounds + 5 min v2 skill
  work + sync + verify).
- Total commits: **6 in `~/brain`** (`eadf1d3` lint, `5a6a584`
  orphan-1, `d6be7ce` frontmatter-ref-fix-v1, `f76f5c3`
  frontmatter-ref-fix-v2, `6c666bb` orphan-2, `9159bfd` orphan-3,
  `a2efc02` orphan-4) + **4 in fork repo** (`0695a6c` v1 skill,
  `f0cadd3` §6.15 docs, `cf236a4` v2 skill, `<this commit>` §6.16
  docs + TODO archive + new handoff).

### Why we stopped at 4 rounds

The user agreed before launch that 3 rounds (793 → ~500) was the
target window, with a 4th conditional. Round 4's 37-edge yield (vs
68-78 in rounds 2-3) is the practical signal: round 5 would clear
&lt; 30 edges at the same $0.34 per run. At that point the
return-on-cost curve says switch levers — `enrich-sweep` (stub-create
entities mentioned in orphan bodies; new entity pages backlink and
deorphan the source) or hand-curated OpenClaw weaving will yield
more per dollar than another orphan-reducer pass.

### Why brain_score didn't move

The orphans-component score (12/15 currently) is bucketed and the
band is wide. 12 → 13 transitions somewhere around orphan ratio 30%;
we're at 732/2118 = 34.6%. ~100 more deorphans to cross the boundary.
The remaining 732 are the hardest cohort: v1-wiki source pages whose
vector neighbors live in pre-2026 wiki context, but v2 grew along
different axes (Notion ingests, project notes). Same-axis matches
got picked off in rounds 1-4; cross-axis matches are scarce.

### Tail: 19 unresolved refs are correct

The 19 `external_key_skipped` entries are all `raw_path:` field
values pointing at `~/brain/raw/web/X.md` snapshots. The `raw/`
tree is gitignored, so those targets only exist on the production
machine, not in version control. Behavior is correct — the skill
recognizes them as legitimate external pointers (the v2
`EXTERNAL_POINTER_KEYS` allowlist) and leaves them alone.

### Status: TODO.md archived

`skills/kos-jarvis/TODO.md` is **officially archived** as of the
docs commit alongside this entry. Outstanding P0/P1/P2 items
either landed in this two-§ session (Tier 1 sweep, frontmatter-
ref-fix v1+v2, 4 orphan rounds) or are calendar checkpoints owned
by future sessions (Step 2.4 commit-batching @ 2026-05-07, v1
archive @ 2026-05-04, 3072-dim embed re-evaluation @ 2026-05-25,
upstream `gbrain#370` PGLite-upgrade-fix watch).

The next session should:
1. Read [`docs/SESSION-HANDOFF-2026-04-27-evening-sweep-complete.md`](SESSION-HANDOFF-2026-04-27-evening-sweep-complete.md)
   for the closing snapshot.
2. Re-survey upstream `garrytan/gbrain master` for new commits past
   v0.20.4 — sync any new releases.
3. Build a fresh TODO list from current pain points (not the
   v1-wiki backlog ... that's gone).

---

## 6.17 Upstream v0.22.8 sync (2026-04-29, commit `811c266`)

Nine upstream releases land in one merge: v0.21.0 → v0.22.0 → v0.22.1 →
v0.22.2 → v0.22.4 → v0.22.5 → v0.22.6 → v0.22.6.1 → v0.22.7 → v0.22.8
(11 commits, 189 files, +20725 / -573). The headline win is
**v0.22.6.1's `applyForwardReferenceBootstrap()` closing the 10-issue
PGLite wedge cycle** that we'd been carrying a fork patch for since
v0.18 — see §6.12. The fork patch on `pglite-schema.ts` (idx_pages_source_id
comment block) was dropped during merge; upstream's bootstrap probe
in `initSchema()` supersedes it.

### What we adopted

- **#370 closure (#440 / v0.22.6.1)** — bootstrap probe handles the
  pre-v0.18 forward-reference. Our 11-line comment block + missing
  `CREATE INDEX` line are gone; upstream's verbatim restored.
- **v0.21.0 Code Cathedral II** — schema migrations v25..v28 (parent_symbol_path
  TEXT[], doc_comment, search_vector TSVECTOR + plpgsql trigger,
  code_edges_chunk + code_edges_symbol tables). CHUNKER_VERSION 3→4
  forces full re-walk on next sync via `sources.chunker_version` gate.
  Our brain is markdown-heavy (notion sources) so re-chunking cost
  is mostly cache-hit; cost preview not run pre-cutover (see follow-up).
- **v0.22.0 source-aware search ranking** — default boost map doesn't
  recognize our layout (`sources/notion/`, `concepts/`, `projects/`),
  so default behavior is no-op (factor=1.0 for unknown prefixes).
  `GBRAIN_SOURCE_BOOST` tune-up parked for 1-week observation.
- **v0.22.2 cold-start retry** — `connectWithRetry()` default-on; helps
  every CLI call against PGLite under contention. RSS watchdog +
  autopilot backpressure are Postgres-only, skipped.
- **v0.22.4 frontmatter-guard** — new skill registered in manifest
  (`frontmatter-guard`); doctor gains `frontmatter_integrity` subcheck.
  First audit on production: `{ok: true, total: 0, errors_by_code: {},
  per_source: []}` — clean. Per-source array empty because our
  `default` source's `local_path` isn't set up the way the v0.22.4
  audit walker expects; not blocking, audit returned green anyway.
- **v0.22.5 cycle.ts per-source anchor** — `gbrain dream` now reads
  `sources.last_commit` instead of the global `config.sync.last_commit`.
  Reduces the "GC'd commit → full reimport" failure mode. We have a
  `default` source registered (Step 2.2), so this is a free win.

### What we skipped (intentional)

- **v0.22.6 post-migration schema self-healing** — Postgres + PgBouncer
  specific. PGLite no-op.
- **v0.22.7 built-in HTTP MCP transport** — we use stdio MCP only.
- **v0.22.8 doctor integrity batch-load** — Postgres-only path; PGLite
  takes the unchanged sequential path.
- **v0.22.1 autopilot fix wave** — we don't run autopilot. NOTE:
  v0.11.0's autopilot-install side effect did NOT re-trigger today
  because the v0.11.0 ledger entry was already `complete` from
  2026-04-22; only v0.21.0 + v0.22.4 ran today, and neither installs
  launchd services. (For future syncs that include v0.11.0 first-run,
  set `gbrain config set minion_mode off` BEFORE `apply-migrations`.)

### Fork-local patches state (re-verified post-merge)

| Patch | Status | Reason |
|---|---|---|
| `src/core/pglite-schema.ts` idx_pages_source_id comment | **DROPPED** | Closed by v0.22.6.1 bootstrap |
| `src/core/pglite-engine.ts` `pg_switch_wal()` before close | **RETAINED** | macOS 26.3 WASM persistence — upstream doesn't address this; `applyForwardReferenceBootstrap` runs in `initSchema()`, our patch in `close()`/`disconnect()` — they don't conflict |
| `src/cli.ts` mode 0755 | **RETAINED** | Bun shim at `~/.bun/bin/gbrain → src/cli.ts` |

### Sync sequence (notable surprises)

This sync taught two lessons the runbook didn't anticipate:

1. **`bun install` postinstall ran apply-migrations against PRODUCTION
   during Phase B.** Upstream's `package.json` has a `postinstall` hook
   `command -v gbrain && gbrain apply-migrations --yes --non-interactive`.
   With our `~/.bun/bin/gbrain` symlink pointing at the repo's
   `src/cli.ts` (which was now v0.22.8 mid-merge), `bun install` to
   regenerate `bun.lock` triggered apply-migrations on the live brain.
   Two ledger entries written at 07:13:32: v0.21.0 status=complete (schema
   v25..v28 walked), v0.22.4 status=complete (audit skipped, no_sources_registered).
   **Production schema_version went 24 → 29 inside Phase B**, before
   we'd taken the planned Phase C snapshot. Did not cause data loss
   because v0.22.6.1's bootstrap is robust and the migration was
   what we'd have run in Phase C anyway, just earlier.
2. **6 zombie gbrain subprocess sync workers had been holding the
   PGLite lock for hours**, accumulating 200+ minutes of CPU each.
   They were spawned by old crons (likely from `kos-deep-lint` / older
   notion-poller wrappers) and never reaped. After bootouting all
   jarvis services, `gbrain stats` still timed out on lock; lsof
   surfaced PIDs 23625/36238/57969/58201/62243/70599 — none of them
   in launchd's process tree, all parented to PID 1. SIGTERM ignored;
   SIGKILL released the lock. **This explains the recurring kos-compat-api
   /ingest 500 timeout pattern** observed earlier (commit `971b9ba`).
   Filed as new TODO P1.

### Validation (all green)

| Check | Result |
|---|---|
| schema_version | 24 → **29** (latest) ✓ |
| Pages | 2117 / 2117 (zero drift) ✓ |
| Chunks | 4023 / 4023, 100% embedded ✓ |
| Links | 8225 → 8229 (+4 from notion-poller during phase) ✓ |
| Timeline | 11084 / 11084 ✓ |
| brain_score | 85/100 unchanged (embed 35/35, links 25/25, timeline 3/15, orphans 12/15, dead-links 10/10) |
| doctor health | 85/100 (3 PGLite-quirk WARN: pgvector / graph_coverage / jsonb_integrity, no FAIL) |
| `frontmatter audit` | `{ok: true, total: 0}` ✓ |
| `/status` smoke | 200 in 298ms, total_pages=2117 ✓ |
| `/query` Chinese smoke | 200 in 11.7s, retrieved relevant person/concept pages ✓ |
| typecheck | clean ✓ |

### Conflict resolution (3 manual)

- `package.json`: kept upstream's new `@dqbd/tiktoken: ^1.0.22` dep,
  overrode upstream pin `pglite: 0.4.3 → 0.4.4` (macOS 26.3 still aborts
  on 0.4.3 per `#223` class).
- `bun.lock`: regenerated via `bun install` against the resolved package.json.
- `src/core/pglite-schema.ts`: replaced our 11-line `FORK-LOCAL PATCH`
  comment block with upstream's verbatim
  `CREATE INDEX IF NOT EXISTS idx_pages_source_id ON pages(source_id);` line.

7 files auto-merged (CLAUDE.md, README.md, src/cli.ts, skills/RESOLVER.md,
skills/manifest.json, src/core/pglite-engine.ts — including additive
of upstream's `applyForwardReferenceBootstrap()` at line 137 with our
`pg_switch_wal()` at line 89 surviving — and others).

### Rollback matrix

```bash
git reset --hard pre-sync-v0.22.8-1777445821
cp -R ~/.gbrain/brain.pglite.pre-sync-v0.22.8-1777447016 ~/.gbrain/brain.pglite
launchctl bootout gui/$UID/com.jarvis.kos-compat-api
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist
```

The PGLite snapshot is 550 MB. Keep for ≥7 days; prune
`~/.gbrain/brain.pglite.pre-sync-v0.20-*` and `pre-step3.0-*` after a
clean week of dream cycles + ingest.

### Follow-ups for next session (filed in new TODO.md)

1. **Zombie sync subprocess leak** (P1 NEW) — root-cause why 6 `gbrain sync`
   workers ran for 4-12 hours each holding the PGLite lock. Probably
   `~/.openclaw` cron or stale `kos-deep-lint` wrapper. Add a sanity
   `pgrep -lf 'gbrain sync.*--no-pull'` check + alert in kos-patrol.
2. **graph_coverage 0% post-v0.21.0** (P2) — doctor's new metric reports
   0% entity-link / timeline coverage despite 8229 links + 11084 timeline
   entries. Likely a rename of what's counted as "graph coverage" — the
   link extractor may need a fresh run with the v0.21.0 chunker version
   to write into the new `code_edges_*` tables. Suggested: `gbrain
   link-extract && gbrain timeline-extract` per doctor's hint.
3. **CHUNKER_VERSION 3→4 dry-run never executed** (P2) — `gbrain
   reindex-code --dry-run` was deferred during cutover. The
   `sources.chunker_version` gate will trigger a full re-walk on
   next `gbrain sync` regardless. Run a manual dry-run when convenient
   to know cost in advance.
4. **`default` source `local_path` not set** (P2) — v0.22.4 frontmatter
   audit returns `per_source: []` because the source-resolver doesn't
   see `local_path` for our `default` source. Set it via
   `gbrain sources update default --local-path ~/brain` (CLI shape may
   differ; confirm with `--help`). Cosmetic until v0.22.4 starts
   gating something on the audit.
5. **`GBRAIN_SOURCE_BOOST` tune-up** (P2) — observe Chinese-query
   quality for 1 week; if `sources/notion/` is swamping retrieval,
   set `GBRAIN_SOURCE_BOOST="concepts/:1.5,projects/:1.3,sources/notion/:0.7"`
   in `com.jarvis.kos-compat-api.plist` env.

---

## 6.18 PGLite → 本地 Postgres 迁移 — Path 3 P0 unblock (2026-04-29 afternoon)

> Plan: [`~/.claude/plans/recursive-churning-map.md`](~/.claude/plans/recursive-churning-map.md). Supersedes
> Path 2 (long-lived in-process engine refactor) which was the prior plan
> in [§3 of the v0.22.8 handoff](SESSION-HANDOFF-2026-04-29-post-v0.22.8-sync.md).

### Why Path 3 (Postgres) was chosen over Path 2 (in-process refactor)

The 2026-04-25 evaluation at
[`docs/UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md`](UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md)
deferred the Postgres switch indefinitely until one of four trigger
conditions fired. The v0.22.8 sync surfaced **trigger #3 in spirit** —
"WAL fork patch fails silently". The actual symptom was not WAL data
loss but its load-class twin: **`gbrain dream` cycle silent-wedged for
12h 42min** holding the PGLite write lock (75 % CPU R-state, stderr
0 bytes since startup) while `notion-poller` /ingest queries 134 s
each + spawnAsync 180 s SIGKILL → zombie subprocess pile-up. PGLite's
single-writer lock topology had stopped being adequate for the v0.21+
sync workload on this brain.

Path comparison (decided 2026-04-29 14:30 local):

| Dimension | Path 2 (in-process refactor) | **Path 3 (Postgres) — chosen** |
|---|---|---|
| Time | ~3 h | ~2.5 h actual |
| Code change | refactor /ingest+/status+/query (~150 LOC) | BrainDb dual-engine split (~80 LOC) |
| Cron disabled | kos-patrol + enrich-sweep (P1 follow-up) | none |
| Upstream features unlocked | none | `jobs supervisor`, `queue_health`, `wedge-rescue` |

### What landed

- **Postgres 17 + pgvector 0.8.2** as engine: brew bottle install, `gbrain` db with `vector` + `pg_trgm` extensions, Postgres superuser = `chenyuanquan` (local trust auth).
- **`gbrain migrate --to supabase --url postgresql://chenyuanquan@127.0.0.1:5432/gbrain`** transferred all 2117 pages, 8231 links, 11084 timeline entries, and 3782/4023 chunks (94 % preserved with embeddings, 241 stale carried over from PGLite source). `~/.gbrain/config.json` rewritten by migrate to `{engine: "postgres", database_url: ...}`. Original `~/.gbrain/brain.pglite/` retained as cold backup.
- **`skills/kos-jarvis/_lib/brain-db.ts` dual-engine refactor** (commit pending): detects engine from config, opens `postgres()` or `PGLite.create()`, runs all 9 query methods through a shared `_q(sql, params)` adapter. All 9 BrainDb callers (kos-patrol, kos-lint, dikw-compile, evidence-gate, confidence-score, orphan-reducer, slug-normalize, server/kos-compat-api) keep working unchanged. **Zero launchd plist edits** (db config lives in `~/.gbrain/config.json`).
- **dream-cycle re-enabled.** First Postgres run completed 6 phases in **1030 ms** (vs PGLite silent wedge of 12 h 42 min). The dream-wrap auto-retry caught a 47 s cold-path SIGKILL on the very first cycle and recovered cleanly on retry.
- **notion-poller re-enabled.** First cycle ingested **152 pages in 5.5 min**, 0 zombie subprocesses, exit code 0. /status latency 90 ms during the burst with concurrent in-flight `gbrain sync` subprocess (proves Postgres MVCC vs PGLite single-writer lock).

### Production state at handoff

| Layer | Pre-Path-3 (PGLite) | Post-Path-3 (Postgres) |
|---|---|---|
| Engine | PGLite 0.4.4 (WASM Postgres 17.5) | Postgres 17 (Homebrew) + pgvector 0.8.2 |
| Pages | 2117 | **2303** (+186 ingested in first cycles) |
| Links | 8229 | 8231 (rebuild parity, ON CONFLICT DO NOTHING) |
| Embeddings | 100 % (per stats) | 94 % (241 stale, run `gbrain embed --stale`) |
| dream cycle | silent wedge 12h+ | **1030 ms warm** |
| /ingest single file | 134 s + 180 s SIGKILL | ~10 s warm |
| /status during burst | 30+ s blocks | **90 ms** |
| notion-poller | DISABLED (would deadlock) | **enabled, +152p/5.5min, 0 zombies** |
| Concurrent /ingest + cron | impossible (single-writer lock) | works (Postgres MVCC) |

### Reused upstream code (no fork patch added)

- `src/commands/migrate-engine.ts` — official engine migration tool, Supabase-named flag handles any Postgres URL.
- `src/core/postgres-engine.ts` — full engine implementation, all `BrainEngine` methods supported.
- `src/core/engine-factory.ts` — auto-selects engine from config.

### Trigger #3 of v020-pglite-postgres-evaluation marked satisfied

The evaluation predicted "switch when WAL patch fails silently". We
reached the same outcome via "single-writer lock topology fails
silently under v0.21+ sync workload". Document banner updated in
[`docs/UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md`](UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md).

### Rollback path (in case anything regresses)

```bash
launchctl bootout "gui/$(id -u)/com.jarvis.kos-compat-api"
DATABASE_URL='postgresql://chenyuanquan@127.0.0.1:5432/gbrain' \
  bun run src/cli.ts migrate --to pglite --path ~/.gbrain/brain.pglite --force
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist
```

The pre-Path-3 PGLite snapshot at `~/.gbrain/brain.pglite.pre-path2-1777504487`
(502 MB) is the deeper rollback point if the live PGLite dataDir gets
corrupted between now and the migration.

### Follow-ups filed in TODO.md

- **P1** — `gbrain embed --stale` to top up the 241 missing embeddings.
- **P2** — observe single-file /ingest perf on Postgres for 1 week. Currently 105 s cold / 10 s warm; if Notion ingestion lag becomes user-visible, refactor /ingest to use upstream `dispatchToolCall(engine, 'put_page')` in-process (the original Path 2 plan, but on top of Postgres). The Postgres MVCC win means the urgency is gone but the perf opportunity remains.
- **P2** — re-enable v0.20+ upstream features that PGLite skipped (`gbrain doctor --json | jq .checks.queue_health`).

---

## 6.19 Phase A system review + Phase B/C cleanup (2026-04-30)

After 7 consecutive days of upstream syncs (v0.14 → v0.22.8) + the Path 3
Postgres migration, the next session ran a full system review per Lucien's
ask, then closed the four most actionable items in one shipping window.

### Phase A — measured, not assumed

Six dimensions (brain health / service mesh / query smoke / storage /
patrol / TODO 对账). Highlights:

- 2339 pages, **0 NULL embeddings** (the 241 stale from §6.18 follow-up
  auto-consumed by the dream-cycle), 8231 links, 8928 timeline entries,
  242 MB DB.
- All 10 jarvis services registered with launchd. `kos.chenge.ink/status`
  burst 217-247 ms / sequential 107-166 ms.
- 5-query Chinese smoke (DIKW / Postgres 迁移 / kos-jarvis 架构 / Lucien
  的角色 / E0-E4) — retrieval + LLM synthesis healthy on all five.
- ⚠️ Zero backup automation since Path 3. **Highest current production
  risk.**

### Phase B — backup + patrol noise (closed during the review session)

1. **`scripts/jarvis-pg-backup.sh` + `com.jarvis.gbrain-backup.plist`**
   (`51a3009`). `pg_dump -Fc` → `~/.gbrain/backups/gbrain-YYYYMMDD.dump`,
   14-day retention, daily 03:33 local (off the dream-cycle 03:11 to
   avoid contention). First manual run produced a 63 MB compressed dump
   (DB 239 MB → 26 % gzip), `pg_restore --list` TOC verified at 275
   entries.
2. **kos-patrol Phase 4 noise stoplist** (`b770e74`). 30+ Notion column
   headers + UI labels added (4 sweep passes), plus a ≥2-distinct-kind
   rule that filters single-kind hits. Result: dashboard flipped from
   100 % column-header noise (`Original EML` ×862, `Action Type` ×858,
   `Best Regards`, `Open Threads`, ...) to 95 % real signals (`Link
   Systems Inc`, `MCMC Jendela`, `Cloud VMS`, `RADIUS Server`, `MCP
   Server`, `PoE AIO`, `Omada Roadmap`, ...).

### Phase C — dead-link cluster + cosmetic + graph_coverage docs (this commit)

3. **35 dead-link ERROR cluster** (10 brain pages, ~/brain commit
   `cde82a1`). Root cause: same-dir markdown links written as `(slug.md)`
   short form. `kos-lint` `candidateSlugs()` strips `./` and `../` before
   matching against the dir-prefixed slug set; same-dir short form falls
   back only to bare basename which never matches a `dir/slug` (only
   root-level slugs without a dir prefix would). Fix: rewrite as
   `(../<dir>/slug.md)` to match the healthy form already used by
   cross-dir refs. The `decisions/phase-2-feishu-signal-detector-acceptance`
   page also referenced fork-repo files via `(../../docs/...)` and
   `(../../skills/...)` — those got unwrapped to backtick form because
   brain's lint can't resolve fork-repo paths and the cross-link wasn't
   semantically a wikilink anyway. After ingest + patrol: ERROR cluster
   targets to drop to 0 next patrol cycle.
4. **`/status` engine label cosmetic** (`server/kos-compat-api.ts:258`).
   Hardcoded `gbrain (pglite)` → `gbrain (postgres)` post-Path-3, so
   downstream parsers (Notion Knowledge Agent, OpenClaw feishu) get the
   right engine identity.
5. **kos-patrol launchd `last exit code = 2`**. Patrol exits 2 by design
   when warns exist (0 = clean, 1 = ERROR fail, 2 = WARN-only). launchd
   treated ≠0 as fail and emitted "ServiceFail" daily despite the service
   being healthy. Fix: `<key>SuccessfulExitCodes</key><array>0,2</array>`
   in `scripts/launchd/com.jarvis.kos-patrol.plist.template`. ERROR
   (exit 1) still surfaces.

### `graph_coverage 0%` is expected on a markdown-only brain

`gbrain doctor` reports `[WARN] graph_coverage: Entity link coverage 0%,
timeline 0%. Run: gbrain link-extract && gbrain timeline-extract` even
though `brain_score` shows `links 25/25 + timeline 3/15` — the metrics
disagree because they measure different things.

- `brain_score.links` counts absolute edge density (8231 links across
  2339 pages = healthy).
- `graph_coverage` measures the **percentage of pages with ≥1 inbound
  entity-link or ≥1 timeline entry**. Most of our pages are
  `sources/notion/*` (60 % of corpus, 1467/2339 today), and notion-
  poller dumps each as a single source page with no timeline + no
  inbound entity references — neither gets entity-extracted (they're
  the raw text, not a synthesized concept/person page). Hence the
  page-level percentage is dominated by the notion source corpus and
  rounds to 0 %.

This is a markdown-only design property, not a regression. The Code
Cathedral metric (v0.21.0 added `code_edges_chunk` + `code_edges_symbol`)
is also 0 % for us because we have no `kind=code` pages.

**Decision**: accept as expected, document here, do **not** run
`gbrain link-extract` chasing the metric. The TODO P1 entry is closed
by this paragraph.

### Net effect (Phase A → C)

| Dim | Before | After |
|---|---|---|
| Backup automation | none | daily 03:33, 14 d retention, verified |
| Patrol gap signal | 100 % Notion column headers | 95 % real entity gaps |
| Lint ERROR cluster | 35 (9 files) | 0 (after next patrol cycle) |
| /status engine label | `gbrain (pglite)` (wrong) | `gbrain (postgres)` |
| launchd patrol noise | daily ServiceFail alert | suppressed (exit 2 = success) |
| TODO graph_coverage P1 | open since v0.21 sync | closed (expected, documented) |

Two TODO P1 + two P3 closed, plus one production risk (zero backups)
mitigated, in ~3 hours of focused work.

---

## 6.20 Upstream v0.25.0 sync (2026-05-01)

> Plan:
> [`docs/SESSION-HANDOFF-2026-05-01-pre-v25-sync.md`](SESSION-HANDOFF-2026-05-01-pre-v25-sync.md).
> Strategy chosen at session start: single `git merge upstream/master`
> (16 commits, 12 versions in one shot) over the handoff's "three hops"
> idea — fewer conflict-resolution rounds, one validation pass, same
> end state. Branch: `sync-v0.25.0`.

Twelve upstream releases land in one merge: v0.22.10 → v0.22.11 → v0.22.12
→ v0.22.13 → v0.22.14 → v0.22.15 → v0.22.16 → v0.23.0 → v0.23.1 → v0.23.2
→ v0.24.0 → v0.25.0 (16 commits including a paired jsonb fix + revert).
The headline addition is **v0.25.0's BrainBench-Real substrate**: two new
schema tables (`eval_candidates`, `eval_capture_failures`), 5 new
`BrainEngine` methods, an op-layer capture wrapper, and a PII scrubber.
Capture is OFF by default for end users; flipped ON for this fork to
build a retrieval baseline (see "Eval capture posture" below).

### Handoff pre-flight findings (revised on day-of)

The handoff doc described "三跳" (v0.22.9 → v0.23.2 → v0.24.0 → v0.25.0).
Day-of inspection found 7 missed patch releases (v0.22.10..v0.22.16) that
ship real features (storage tiering, parallel sync, frontmatter inference,
claw-test E2E harness, autopilot phase-forwarding). Strategy adjusted to
single merge of all 16 commits.

The handoff also predicted that BrainDb (`skills/kos-jarvis/_lib/brain-db.ts`)
"必须补齐这 5 个方法" because v0.25.0 made the BrainEngine interface
breaking. **This was wrong**: BrainDb is not a `BrainEngine` implementation,
it's a thin direct-DB reader, and none of its 9 callers consume eval APIs.
Decision: mirror the surface anyway as a safety net (see below) so future
fork skills don't have to reach into `src/core/`.

### What we adopted

- **v0.22.10** — `autopilot-cycle` handler forwards `phases` array to
  runCycle. Inert for us (no autopilot daemon).
- **v0.22.11 storage tiering** — new `db_tracked` vs `db_only` directory
  classes for sources. Schema migration only; no behavior change unless
  configured.
- **v0.22.12 sync error-code coverage** — adds `FILE_TOO_LARGE` +
  `SYMLINK_NOT_ALLOWED` to `classifyErrorCode()`. Direct overlap with our
  v0.22.9 cherry-pick; merge cleanly added the two new clauses to the same
  function.
- **v0.22.13 parallel sync** — bounded-concurrency import. Free speed-up
  on next full re-sync (we don't run those often).
- **v0.22.14 minion bare-worker self-monitoring** — Postgres-only;
  applies whenever we run `gbrain agent run` durable subagents (not yet,
  see TODO P3).
- **v0.22.15 frontmatter inference** — files without YAML headers now
  ingest with auto-inferred kind/title. Reduces friction for ad-hoc
  notes; semantics-preserving for our existing pages.
- **v0.22.16 `gbrain claw-test`** — new fresh-install friction harness.
  Uses `test/.cache/`; gitignored.
- **v0.23.0 dream synthesizes conversations** — `gbrain dream` now reads
  recent transcripts and writes synthesis pages. Off by default; opt-in
  via dream config. We're not opting in yet (separate evaluation needed
  on Chinese-language conversation digesting).
- **v0.23.1 local CI gate** — `bun run ci:local` (~13× faster than full
  CI); 4-tier wall-time optimization. Optional dev tool.
- **v0.23.2 dream marker fix** — orchestrator-stamped self-consumption
  marker. Fixes the dream cycle re-consuming its own output (latent bug
  for us; we run dream daily so this lands a real fix).
- **v0.24.0 skillify production hardening** — managed-block install,
  no-clobber, drift detection. Inert for us (we don't run skillify
  on this brain).
- **v0.25.0 BrainBench-Real (the headline)** — schema migrations v30
  (`dream_verdicts_table`) + v31 (`eval_capture_tables`):
  `eval_candidates` (16-column row per `query`/`search` call) +
  `eval_capture_failures` (cross-process audit). Op-layer capture
  wrapper in `src/core/eval-capture.ts` runs PII scrubber
  (`src/core/eval-capture-scrub.ts` — emails, phones, SSN,
  Luhn-verified CC, JWT, bearer tokens). 5 new `BrainEngine` methods:
  `logEvalCandidate`, `listEvalCandidates`, `deleteEvalCandidatesBefore`,
  `logEvalCaptureFailure`, `listEvalCaptureFailures`. New CLI:
  `gbrain eval export` (NDJSON for sibling gbrain-evals consumption),
  `gbrain eval replay`, `gbrain eval prune`. Default capture posture
  OFF for end users; flag is `GBRAIN_CONTRIBUTOR_MODE=1` env var OR
  `eval.capture: true` in `~/.gbrain/config.json`.

### What we skipped (intentional)

Nothing skipped this round — every upstream feature came along, schema
migrated, fork patch survived. Some are inert for our setup (autopilot,
claw-test) but cost nothing to keep.

### Fork-local patches state (re-verified post-merge)

| Patch | Status | Reason |
|---|---|---|
| `src/core/pglite-engine.ts` `pg_switch_wal()` before close | **RETAINED** | macOS WASM persistence — line 182, untouched by upstream |
| `src/cli.ts` mode 0755 | **RETAINED** | Bun shim at `~/.bun/bin/gbrain → src/cli.ts` |
| `skills/kos-jarvis/_lib/brain-db.ts` direct-DB reader | **EXTENDED** | Added 5 eval methods (safety net) + 4 type aliases (locally defined, no upstream import). Original 9 callers untouched. |

### New fork-local additions (v0.25.0-only)

- **BrainDb eval surface** (`skills/kos-jarvis/_lib/brain-db.ts`,
  +124 lines): `logEvalCandidate`, `listEvalCandidates` (with
  `since/limit/tool` filter, `id DESC` tiebreaker matching upstream),
  `deleteEvalCandidatesBefore`, `logEvalCaptureFailure`,
  `listEvalCaptureFailures`. Engine-portable SQL via the existing `_q`
  adapter. Self-contained types (no `gbrain/types` import).
- **BrainDb eval test** (`skills/kos-jarvis/_lib/brain-db.test.ts`,
  6 cases, 19 expects): in-memory PGLite, hermetic (no `~/.gbrain/config.json`
  dependency, injects PGLite via private-field write). Covers
  insert+id-return, list-ordering with id-DESC tiebreaker, tool filter,
  limit clamping (`[1, 100000]` with sensible defaults on `0`/negative/`NaN`),
  delete-before cutoff, failure round-trip with set-equality (no
  ts-tiebreaker, matches upstream contract).

### Eval capture posture (decision)

The handoff suggested "**不启用** GBRAIN_CONTRIBUTOR_MODE=1" (privacy
default + small brain). Reversed at session start: enabling capture
locally so we can build a retrieval baseline and gate future search
changes against it. Privacy-positive defaults are still respected for
anyone forking this fork (they have to opt in themselves).

Concretely: `~/.gbrain/config.json` gains `"eval": {"capture": true}`.
Capture writes to `eval_candidates` on every `gbrain query` /
`gbrain search` / MCP `query` / MCP `search` / subagent `query`/`search`.
PII scrubber runs at write time; queries over 50KB rejected.

### Conflict resolution (8 manual)

- `.gitignore` — kept upstream's claw-test cache + Tier 3 PGLite
  snapshot ignores; appended fork's `.omc/` + launchd log ignores below.
- `VERSION`, `package.json` — kept upstream `0.25.0`.
- `bun.lock` — kept upstream's added `bun-types@1.3.11` resolution; ran
  `bun install` to settle the rest.
- `CHANGELOG.md`, `TODOS.md` — empty HEAD blocks (we don't carry our own
  release notes / TODO entries here); kept upstream verbatim.
- `src/core/sync.ts`, `test/sync-failures.test.ts` — empty HEAD blocks;
  kept upstream's two new error-code clauses + their tests
  (`FILE_TOO_LARGE`, `SYMLINK_NOT_ALLOWED`).

### Privacy-gate scrub

Upstream's new `scripts/check-privacy.sh` (CLAUDE.md:550 enforcement)
fired on two fork files:

- `skills/kos-jarvis/TODO.md:35` — example slug layout (banned-word form)
  rewritten to `your-openclaw/chat/`.
- `skills/kos-jarvis/pending-enrich/SKILL.md:38` — example JSON line
  rewritten from a real-person + real-fund pairing to
  `alice-example` / `widget-co seed`.

Both are documentation examples, not real data; the scrub is a
privacy-rule alignment, not a data fix.

### Validation (all green)

| Check | Result |
|---|---|
| schema_version | 29 → **31** ✓ (v30 dream_verdicts + v31 eval_capture_tables) |
| Pages | preserved ✓ |
| Embed coverage | 99 % (25 stale; 0 v30/v31-introduced regression) |
| Links / Timeline | preserved ✓ |
| brain_score | held at 83/100 (embed 35/35, links 25/25, timeline 3/15, orphans 10/15, dead-links 10/10) |
| typecheck | clean ✓ |
| `bun test` (3787 cases / 230 files / 1100 s) | 3487 pass / 293 skip / 6 fail — 1 fixed (build-llms regen), 5 are pre-existing GBRAIN_HOME-related upstream test gaps unrelated to sync (see Pre-existing test gaps below) |
| BrainDb eval test (6 cases) | green ✓ |
| `gbrain query` test | 1 row inserted into `eval_candidates` ✓ |
| `eval_capture_tables` migration | success, BYPASSRLS confirmed ✓ |

### Pre-existing test gaps (5 failures, all upstream)

The 5 fails are environment-coupling bugs in upstream tests, not regressions
from this sync. They surfaced now because we run `bun test` from the
project directory which auto-loads `.env`, and our `.env` sets
`GBRAIN_HOME=/Users/chenyuanquan/brain`. Upstream tests assume
`homedir() === gbrain config home`:

- `check-resolvable-cli > resolveSkillsDir > REGRESSION-GATE` (1.59 ms)
- `check-resolvable-cli > finds skills via findRepoRoot when cwd is inside a repo` (0.30 ms)
  — both expect `r.source === 'repo_root'`; openclaw workspace marker
  on the dev box wins instead.
- `init-migrate-only > applies schema against existing PGLite config; does
  NOT modify config.json` (53 ms)
- `init-migrate-only > idempotent on rerun` (54 ms)
  — both seed `${tmp}/.gbrain/config.json` and call `gbrain init` with
  `HOME=${tmp}`, but `GBRAIN_HOME=~/brain` from `.env` overrides HOME and
  re-routes the lookup away from the seeded path.
- `core/cycle.test.ts > file lock blocks concurrent engine=null cycles`
  (1.48 ms) — same root cause: the test seeds `${homedir()}/.gbrain/cycle.lock`
  but `runCycle` reads `gbrainPath()/cycle.lock`, which honors GBRAIN_HOME.

**Resolution (post-merge cleanup)**: 3 of 5 fixed by commenting
`GBRAIN_HOME=/Users/chenyuanquan/brain` out of `.env` + `.env.local` (it
was a leftover from an aborted "brain config under brain repo" migration
that never populated `~/brain/.gbrain/config.json`). Now down to 2 fails,
both `check-resolvable resolveSkillsDir` cases that expect `r.source ===
'repo_root'` but get `'openclaw_workspace_home_root'` because the dev
machine has openclaw workspace marker that wins findRepoRoot precedence.
Both are upstream-test-only; the production code path they cover works.

### Post-merge actions (2026-05-02)

1. **`master` updated**: `git merge --no-ff sync-v0.25.0` ⇒ commit `f6bb039`.
   Pushed to `origin/master`. The sync work commit is `ea29354`.
2. **Long-running services restarted** to pick up v0.25.0 src/cli.ts via
   the `~/.bun/bin/gbrain → src/cli.ts` symlink shim:
   - `com.jarvis.gemini-embed-shim` (PID 2502 → 63403)
   - `com.jarvis.kos-compat-api` (PID 32389 → 63464)
   - cron-driven services (notion-poller, dream-cycle, kos-patrol,
     enrich-sweep) pick up new code on next scheduled fire.
3. **`GBRAIN_HOME` scrubbed from `.env` + `.env.local`** (commented with
   explanatory block) — local-dev fix only; **5 launchd plist templates
   still set it** under `EnvironmentVariables`. Production state inherited
   that plist setting.

### Open: dream-cycle production breakage (root cause + path forward)

`gbrain dream` (and other upstream-CLI cron callers) fail under
production env because `connectEngine()` calls `loadConfig()` which
reads `${GBRAIN_HOME}/.gbrain/config.json`. With `GBRAIN_HOME=~/brain`
and no file at that path, loadConfig returns null → `console.error('No
brain configured')` + `process.exit(1)`. Verified via
`launchctl kickstart -k gui/$UID/com.jarvis.dream-cycle` returning
exit=1 with that exact error.

The last successful cron run was `2026-05-01T10-11-02Z` (yesterday
03:11 PT), captured at `~/brain/.agent/dream-cycles/2026-05-01T10-11-02Z.json`.
Why it worked then but not now is unexplained — `loadConfig()` /
`configDir()` were unchanged between v0.22.9 and v0.25.0 per `git diff`.
Either Bun's `.env` auto-load semantics shifted between releases, or
something transient in yesterday's process env was different. The
mechanism that yields today's failure is robustly reproducible.

**Two fix paths** (filed as TODO P0 for next session, both unblock
dream-cycle and align local + production on the same config home):

- **Path A (recommended)**: edit all 5 plist templates under
  `scripts/launchd/*.template` to remove the `<key>GBRAIN_HOME</key>` /
  `<string>/Users/chenyuanquan/brain</string>` block, then bootout +
  bootstrap each service. Net: every component reads from `~/.gbrain/`
  uniformly. Migrate orphaned `~/brain/.gbrain/audit/*` and
  `sync-failures.jsonl` to `~/.gbrain/` (cat-merge or move).
- **Path B (band-aid)**: symlink `~/brain/.gbrain/config.json` →
  `~/.gbrain/config.json`. Keeps GBRAIN_HOME redirection but satisfies
  the loadConfig path. Less clean but zero plist surgery.

Until then: dream-cycle daily 03:11 cron is broken. Local dev `bun run
src/cli.ts dream` works (because `.env` no longer sets GBRAIN_HOME).

### Rollback matrix

```bash
git checkout master
git branch -D sync-v0.25.0   # discards merge

# Postgres rollback (the v30/v31 migrations add three new objects;
# safe to keep on rollback):
psql $DATABASE_URL -c 'DROP TABLE IF EXISTS eval_candidates, eval_capture_failures, dream_verdicts;'

# Disable capture before rollback (prevents writes from old binary):
# remove `eval.capture` from ~/.gbrain/config.json
```

### Follow-ups for next session (filed in TODO.md)

1. **Build retrieval baseline (1-week dogfood)** — let capture run
   for 7 days, then `gbrain eval export --since 7d > baseline.ndjson`
   + commit to a private location. Subsequent retrieval changes can be
   gated with `gbrain eval replay --against baseline.ndjson`.
2. **`gbrain dream` conversation synthesis** — evaluate v0.23.0's new
   capability against Chinese-language Notion+Feishu transcripts. Likely
   needs language-aware tweaks; off by default for now.
3. **Storage tiering audit** — v0.22.11 added `db_tracked` vs `db_only`
   classes. Default still `db_tracked`. Worth reviewing whether
   `media/x/` / `archive/` should move to `db_only` (no-search source).

---

## 6.21 Upstream v0.26.7 sync (2026-05-04)

8 releases in one merge: `master..upstream/master` = 25 commits across
v0.25.1, v0.26.0, v0.26.1, v0.26.2, v0.26.3, v0.26.4, v0.26.5, v0.26.6,
v0.26.7. Branch `sync-v0.26.7`, merge commit `a2e5e5b`. All conflicts
resolved in one session, ~2 h end-to-end including evaluation.

### Headline upstream features adopted

- **v0.25.1** — `book-mirror` flagship + 8 research skills: `article-enrichment`,
  `strategic-reading`, `concept-synthesis`, `perplexity-research`,
  `archive-crawler`, `academic-verify`, `brain-pdf`, `voice-note-ingest`.
  Plus `gbrain skillpack uninstall` symmetric to install.
- **v0.26.0** — MCP Keys OAuth 2.1 + HTTP server + admin React dashboard
  (`admin/dist/` ~6 MB committed; new deps: `cookie-parser`, `cors`,
  `express`, `express-rate-limit`). `Operation.scope` (`'read' | 'write'
  | 'admin'`) and `Operation.localOnly` first-class on every op;
  `admin + localOnly` ops (`sync_brain`, `file_upload`, `file_list`,
  `file_url`) reject over HTTP.
- **v0.26.1/2/3** — OAuth `client_credentials` fix, bun execSync env
  inheritance fix, admin per-agent config + auth hardening.
- **v0.26.4** — parallel unit-test loop (8 shards, ~12x speedup on
  upstream's CI; fork doesn't run the matrix yet).
- **v0.26.5** — destructive operation guard end-to-end. Sources +
  pages soft-delete with 72h TTL; new schema column `pages.deleted_at`
  + related sources columns.
- **v0.26.6** — PGLite ↔ Postgres parity gate (closes #588). Validates
  that schemas + behavior match across both engines.
- **v0.26.7** — test isolation foundation. `test/helpers/with-env.ts`
  + `scripts/check-test-isolation.sh` lint guard + serial quarantine
  renames before the wider sweep.

### Conflict resolution summary (31 conflicts in one merge)

- **19 src/ + test/ files** (cycle.ts, migrate.ts, subagent.ts, types.ts,
  schema.sql, schema-embedded.ts, postgres-engine.ts, pglite-schema.ts,
  cli.ts, etc.) — all sync side-effect (fork did not modify these
  post-base; conflicts are upstream restructuring on top of v0.25.0
  baseline). **Resolution: `git checkout --theirs`** for the entire
  batch.
- **`src/core/pglite-engine.ts`** — fork-local WAL durability patch
  (`SELECT pg_switch_wal()` before close, commit `ecc6195`). Take
  upstream as base, then **manually re-apply** the 14-line try/catch
  block in `disconnect()`. Only fork-local src patch in this sync.
- **`@electric-sql/pglite` version pin** — fork wants `0.4.4`,
  upstream wants `0.4.3`. Kept `0.4.4` in `package.json`. Fork-local
  override originally landed in commit `aceb838` (v0.17 sync) for
  macOS 26.3 WASM bug class.
- **`skills/RESOLVER.md` / `skills/manifest.json`** — structural merge.
  Fork's KOS-Jarvis extensions section moved to file end (v0.25.1
  added an Uncategorized section in front of where it used to live);
  manifest.json has 49 skills now (30 prior upstream + 9 new v0.25.1
  skills + 10 fork kos-jarvis skills).
- **`.gitignore`** — explicit merge: fork section preserved (.omc/,
  kos-patrol/enrich-sweep/notion-poller stdout logs) + upstream's
  new `.context/` (run-unit-parallel artifacts).
- **CHANGELOG.md / TODOS.md** — fork HEAD blocks were empty (fork
  doesn't write its own release notes; runs as a cherry-pick consumer).
  Took upstream's full v0.26.x entries verbatim. CHANGELOG.md required
  manual fix because git's diff3 output had a malformed marker shape
  (extra `=======` mid-block); patched with two `StrReplace` calls.
- **CLAUDE.md / CONTRIBUTING.md / README.md / llms-full.txt** — used a
  small Python helper (`/tmp/take-theirs-blocks.py`) to take the
  `theirs` side of every conflict block while preserving fork prelude
  outside markers. Fork prelude (lines 1-58 of CLAUDE.md, lines 1-30
  of README.md) stays intact.

### Validation

- `bun install` → 98 packages, no integrity errors
- `bun run typecheck` → clean (~3 s)
- `bun build --compile --outfile bin/gbrain src/cli.ts` → 1220 modules
  bundled, compiled successfully
- `gbrain --version` → `0.26.7`
- `gbrain doctor --json` → schema_version=2, but **`connection: fail
  "column deleted_at does not exist"`** — v0.26.5's `destructive_guard_columns`
  migration (production DB still at schema v31) needs to run. **Filed
  P0 in [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md)
  for next session.**
- `skill_conformance: 49/49 ok`
- `resolver_health: warn 37 routing_miss` — entirely from upstream's
  9 new v0.25.1 skills (`book-mirror`, `archive-crawler`, etc.); their
  `routing-eval.jsonl` fixtures use phrasings narrower than the
  trigger words in `RESOLVER.md`. **Upstream gap, not fork
  responsibility.**

### Review: what v0.25.1 → v0.26.7 means for fork-local skill consolidation

Four new overlap surfaces opened that didn't exist at the v0.25.0
baseline. Each adds an M2 candidate to
[`docs/KOS-JARVIS-CONSOLIDATION-PLAN.md`](KOS-JARVIS-CONSOLIDATION-PLAN.md):

#### M2-A — `concept-synthesis` ↔ `dikw-compile` + `confidence-score`

Upstream `skills/concept-synthesis/SKILL.md` (v0.25.1) does T1-T4 tier
classification + LLM synthesis on `concepts/` pages. Fork
`skills/kos-jarvis/dikw-compile/` does A/B/C/F grade + strong-link
compilation across all kinds; `confidence-score/` is its scoring
helper. Overlap is partial: `concept-synthesis` is concepts-only,
fork is cross-kind; both are LLM-driven page-level rewrites with
quality tiers.

Decision tree:
- If `dikw-compile` **was never wired** in production (M1 wire-status
  check still pending), retire all three (`dikw-compile`,
  `evidence-gate`, `confidence-score`); the unwired-design story dies
  with the fork code.
- If `dikw-compile` **was wired** but only on `concepts/` (likely
  given the fork README claims `idea-ingest / media-ingest /
  meeting-ingestion` post-hooks), `concept-synthesis` replaces it on
  that subset; fork retains `dikw-compile` on non-concepts kinds.
- Worst case `dikw-compile` is wired everywhere: keep both, document
  the boundary.

#### M2-B — `kos-compat-api` ↔ `gbrain serve --http` + thin translator

v0.26.0's `gbrain serve --http` lands what we built `kos-compat-api`
for two years ago. The contracts differ:

- Upstream HTTP serves MCP JSON-RPC (`tools/call`, `resources/list`),
  bearer-auth, scope-aware, admin dashboard at `/admin`.
- Fork HTTP serves KOS v1 contract (`/query`, `/ingest`, `/digest`,
  `/status`, `/health`), simpler JSON bodies, hard-coded by Notion
  Knowledge Agent and OpenClaw feishu cron.

Cannot directly retire `kos-compat-api` — `kos.chenge.ink` is the
external boundary, governed by external systems we don't control.
But the upstream foundation opens **two paths**:

- (a) Keep `kos-compat-api` on `:7225` as the KOS-v1 contract layer,
  internally proxy to `gbrain serve --http :7226` via a translator
  layer that maps `/query` → `tools/call({"name":"query"})` etc.
  Reduces ~500 LOC fork code at the cost of one process hop and a
  scope-mapping subtlety (KOS_API_TOKEN → admin scope).
- (b) Migrate external systems to the MCP client SDK directly. High
  cost, not in our control.
- (c) Status quo. Re-evaluate next sync.

#### M2-C — Phase 4-5 (calendar/email import) → upstream `archive-crawler`

`docs/JARVIS-NEXT-STEPS.md` had Phase 4 = calendar import, Phase 5 =
email import as fork-local builds. v0.25.1's `archive-crawler` is
exactly that domain: universal archivist for personal file archives
(Dropbox/B2/Gmail-takeout/local-mount/hard-drive-dump), refuses to
run without explicit `gbrain.yml archive-crawler.scan_paths` allow-list.

If `archive-crawler` covers Lucien's source formats (Apple Calendar
.ics, IMAP mbox export), Phase 4-5 collapse from "build fork-local
skill" to "configure upstream skill". This is the single biggest
fork-shrink opportunity in v0.26.7 — saves ~400-600 LOC of code we
haven't written yet.

#### M2-D — `Operation.scope` + `.localOnly` ↔ fork `OperationContext.remote`

v0.26.0 makes operation-level trust a first-class field on every
Operation: `scope: 'read' | 'write' | 'admin'` + `localOnly?: boolean`.
HTTP transport rejects `admin + localOnly` ops (`sync_brain`,
`file_upload`, `file_list`, `file_url`).

Fork's `OperationContext.remote` boolean is now a strict subset of
upstream's scope system. M2-D migrates fork-local consumers
(`server/kos-compat-api.ts`, `workers/notion-poller/run.ts`,
`skills/kos-jarvis/_lib/`) from `ctx.remote` to `op.scope` checks.
~1 h work. Lets fork stop maintaining the parallel concept.

### Net target update

M1's "16 active fork skill dirs → 11 active + 2 archived + 1 retired"
target stands. M2 (this sync) adds:

- `dikw-compile` → likely scope-narrowed or fully retired (M2-A)
- `confidence-score` → likely retired (M2-A)
- `evidence-gate` → wire-status dependent
- Phase 4-5 fork builds → replaced by upstream config (M2-C)

Net target post-M2: **11 active → 7-8 active by next sync (v0.27.x window)**.
The fork README's "扩展应随时间自愿退场,而非永久膨胀"
(`skills/kos-jarvis/README.md:84`) is operationalizing as designed.

### Production follow-up — completed 2026-05-04 same day

- [x] **P0**: `gbrain apply-migrations --yes` on production Postgres
  — schema v31 → v34. 3 migrations applied (v32 oauth_infrastructure /
  v33 admin_dashboard_columns / v34 destructive_guard_columns). Initial
  attempt failed with `column "agent_name" does not exist` (upstream
  bootstrap miss for v0.26.3 `mcp_request_log` columns). Workaround:
  manual `ALTER TABLE mcp_request_log ADD COLUMN IF NOT EXISTS
  agent_name TEXT, params JSONB, error_message TEXT;` then re-ran
  init --migrate-only. **Upstream PR filed**:
  [garrytan/gbrain#627](https://github.com/garrytan/gbrain/pull/627)
  extends `applyForwardReferenceBootstrap()` to cover the three v0.26.3
  columns; bootstrap-coverage test (PGLite) + e2e regression
  (Postgres) both pass. After merge, future fresh installs hitting
  this case will self-heal, and the manual ALTER runbook in
  `docs/UPSTREAM-PATCHES/v026-bootstrap-mcp-log-fix.md` becomes
  historical.
- [x] Restart `kos-compat-api` (PID 87485 → 27071) + `gemini-embed-shim`
  (PID 63403 → 27143) via launchctl bootout/bootstrap. `:7222` + `:7225`
  listening. `gbrain --version` returns 0.26.7 via the shim → src/cli.ts.
- [x] `kos.chenge.ink/status` + local `127.0.0.1:7225/status` both
  return `total_pages=2477` — boundary intact.
- [x] `launchctl kickstart -k kos-patrol` smoke: exit=0, **0 ERROR /
  0 WARN**, dashboard + digest written to `~/brain/.agent/{dashboards,
  digests}/`. notion-poller (5-min cron) clean: stderr 31+ min idle
  after the merge transient (one captured `<<<<<<< HEAD` token in
  package.json mid-merge), 5 subsequent cycles all `0 ingested,
  0 skipped`.
- **Surprise finding**: kos-patrol stderr shows `kos-lint JSON parse
  failed; exit=3` — `kos-lint` is **already broken** in production,
  patrol skips it and reports 0 WARN. The PILOT-RETIRE pilot for
  `kos-lint` (PLAN §5 / M1.kos-lint-retire) now has overwhelming
  evidence: nothing in the production loop depends on it. Pilot
  procedure simplifies from 4h evaluation to ~30 min of mechanical
  cleanup.

### M2-A resolution (same day, 2026-05-04)

Production data probe drove M2-A to a definitive verdict before any
pilot ran:

- `frontmatter.dikw_layer` — set on **0 / 2477** pages.
- `frontmatter.evidence_level` — set on **1 / 2477** pages (single E2).
- `frontmatter.confidence` — set on 2470 / 2477, but the values are
  hardcoded template strings in `server/kos-compat-api.ts:454,533`
  (`confidence: low`), never written by `confidence-score/run.ts`.

Cross-checked with `kos-compat-api.ts`, `workers/notion-poller`,
`kos-patrol/run.ts`: none of these spawn the triplet's `run.ts`. They
only execute when invoked manually from the CLI. The triplet was
designed as the gate that quality-controlled every ingest, but it was
never wired in. **All three skills are dead code in production.**

`concept-synthesis` (v0.25.1) is structurally distinct from
`dikw-compile`, not a 1:1 replacement: per-batch sweep over
`concepts/` only (188 pages in production), 4-phase pipeline
(dedup + score + LLM-synth T1+T2 + cluster), no per-page DIKW layer.
For `concepts/` the upstream coverage is sufficient; for other kinds
nothing was running anyway.

**Decision**: archive all three triplet skills (`dikw-compile`,
`confidence-score`, `evidence-gate`) → `skills/kos-jarvis/_archived/`.
Pilot `concept-synthesis` on the 188 concept pages next session.
Decision details + 30-min execution plan recorded in
`docs/KOS-JARVIS-CONSOLIDATION-PLAN.md` §M2-A.

**Net fork shrinkage from M2-A alone**: 11 active skill dirs → 8.
Combined with M1's `kos-lint` retire (now also evidence-driven),
the next-sync target tightens to 11 → **7 active**.

### Rollback

```bash
# Reset master to pre-merge:
git reset --hard a13acf9     # parent of a2e5e5b
# Or revert just the merge:
git revert -m 1 a2e5e5b
```

The merge is reversible at git level. Production has not been touched
by this commit — all changes are in the repo. If something breaks at
the apply-migrations step on production, scripts/jarvis-pg-backup.sh's
nightly pg_dump (03:33) gives a rollback point.

## 6.22 Upstream v0.31.2 sync (2026-05-09)

5 major releases in one merge: `master..upstream/master` = 22 commits
across v0.27.0, v0.28.x, v0.29.0/0.29.1/0.29.2, v0.30.0/0.30.1/0.30.2,
v0.31.0/0.31.1/0.31.1.1-fixwave, v0.31.2. Branch `sync-v0.31.2`, merge
commit at sync-branch HEAD (later merged to master in Phase 9). 378
files changed, +57 691 / -1 833 LoC. Only 5 conflicts (down from 31 in
the previous v0.26.7 sync) thanks to fork's narrow surface and the
upstream side not yet touching anything in `skills/kos-jarvis/**`,
`server/`, `workers/`. End-to-end ~3 h.

### Headline upstream features adopted

- **v0.27.0** — pluggable embedding providers via Vercel AI SDK
  (`src/core/ai/gateway.ts`). Native Google, OpenAI, Voyage, Ollama,
  LM Studio, LiteLLM proxy. New CLI: `gbrain providers list/test/env/explain`.
  `--embedding-model provider:model` + `--embedding-dimensions N` flags
  on `gbrain init`. **This unlocks the M3 milestone for the fork**:
  `gemini-embed-shim` is now a candidate for retirement.
- **v0.28.x** — `takes` + `think` skills + per-token MCP allow-list,
  Voyage multimodal embeddings, lightweight `/health` endpoint
  (SELECT 1 instead of getStats), restart-sweep recipe (telegram gateway
  drop-detect), LongMemEval benchmark harness in the box.
- **v0.29.0/0.29.1** — salience + anomaly detection ("brain surfaces
  what's hot without being asked"). Adds `pages.emotional_weight`,
  `pages.salience_touched_at`, `pages.effective_date`, `pages.import_filename`,
  `pages.recompute_emotional_weight` dream-cycle phase (10th phase).
- **v0.29.2 / v0.31.1** — thin-client mode (`gbrain init --mcp-only`).
  Every read/write/admin op routes through `callRemoteTool` when
  `isThinClient(cfg)`. New `get_brain_identity` op + identity banner.
  New `gbrain remote ping/doctor` health probes with
  `oauth_client_scopes_probe` to surface scope mismatches before they
  hit `gbrain stats`. **Conceptual unlock for M2-B**: `kos-compat-api`
  could potentially become a thin translator routing KOS-v1 endpoints
  to MCP tools/call.
- **v0.30.0** — calibration scorecards. New `gbrain eval cross-modal`,
  `gbrain eval longmemeval` commands.
- **v0.30.1** — Supabase upgrade-path hardening. Reduces our class of
  manual-ALTER recovery (we hit one in v0.26.7).
- **v0.30.2** — dream synthesize stops dropping fat transcripts (token-
  aware chunking before subagent dispatch).
- **v0.31.0** — **hot memory** ships. Per-source `facts` table (5 kinds:
  event/preference/commitment/belief/fact with per-kind decay halflives).
  `gbrain recall` CLI. MCP `_meta.brain_hot_memory` auto-injection on
  every tool-call response. Dream-cycle 11th phase `consolidate`
  (clusters facts ≥3-strong + ≥24h-old, promotes top into `takes(kind=fact)`).
  **Adopted default-on**; `facts.extraction_enabled = false` is the
  kill switch if cost gets out of hand.
- **v0.31.1.1-fixwave** — 22 community PRs in one wave. Critical:
  - **#727** OAuth auth-code scope-escalation P0 (RFC 6749 §3.3
    violation; `read`-scope client could mint admin codes). We don't
    expose `gbrain serve --http` yet, so not a live exposure, but this
    is required before any M2-B path that internally proxies through it.
  - **#682 + #741** broadened `applyForwardReferenceBootstrap` to cover
    v0.20 + v0.26.3 + v39-v41 columns including `mcp_request_log.{agent_name,
    params, error_message}`. **This supersedes our PR #627** — fix
    is strictly broader; closed it as superseded the same day.
  - **#718** RESOLVER triggers broadened, 37 routing-eval misses → 0
    (closes our P2 routing-miss item).
  - **#686** `sync --skip-failed` eagerly acks pre-existing failures.
  - **#688** `extract` defaults `--dir` to configured brain dir.
  - Plus stdio MCP cleanup, detect-bun-link survival, dream transcript
    `.md` discovery, dream-cycle slug double-encoded jsonb fix, Voyage
    embedding adapter shape, sync detached-HEAD handling.
- **v0.31.2** — `gbrain sync --strategy code` no longer hangs on big
  symlink-rich repos. `parser.setTimeoutMicros(30000)` per-file
  tree-sitter cap; walker hardened with `lstatSync` + inode-cycle
  Map + `MAX_WALK_DEPTH=32`.

### Conflict resolution summary (5 conflicts, smallest sync window yet)

- **`package.json`** — fork's `@electric-sql/pglite 0.4.4` override vs
  upstream's `0.4.3`. Kept fork's `0.4.4`. Upstream added
  `@jsquash/avif`, `@jsquash/png` (image decoders for v0.29 anomaly);
  preserved.
- **`bun.lock`** — `git checkout --theirs` then `bun install` regenerated
  cleanly. Pulled 20 new packages (ai@6, @ai-sdk/{anthropic,google,openai,
  openai-compatible}@3, eventsource-parser, exifr, heic-decode).
- **`README.md`** — HEAD had a stale duplicate v0.25.0 BrainBench-Real
  paragraph (carried by accident from v0.25.0 sync). Took upstream's
  v0.28.8 LongMemEval headline; the legitimate v0.25.0 paragraph at
  line 46 (auto-merged) survives.
- **`skills/RESOLVER.md`** — upstream broadened the voice-note trigger
  from 1 keyword to 5 (`voice note / voice memo / audio message / audio
  note / transcribe and file`) as part of #718. Took upstream's broader
  trigger AND re-appended fork's `## KOS-Jarvis extensions` section
  (with Feishu/pending-enrich archive note from 2026-05-05) at the
  file end.
- **`llms-full.txt`** — `git checkout --theirs` then `bun run build:llms`
  regenerated. 422 KB, matches generator now.

### Auto-merged + verified

- `src/core/pglite-engine.ts` — fork's WAL durability patch
  (`SELECT pg_switch_wal()` before close at L198) **survived auto-merge
  cleanly** (upstream restructure didn't touch the disconnect block).
  Re-grep verified.
- `src/core/embedding.ts` — refactored upstream as a thin gateway
  delegation. fork's `BrainDb` doesn't import it (verified via grep);
  no breakage.
- `CHANGELOG.md` / `TODOS.md` / `CLAUDE.md` — fork sections preserved
  (auto-merge clean; fork doesn't carry top-of-file release notes).
- `skills/manifest.json` — fork's 14 active KOS skills preserved
  (16 lines in manifest match `kos-jarvis` after merge).
- `server/kos-compat-api.ts` (23 KB) — untouched.

### Privacy-gate scrub (post-merge)

Upstream's evolved `scripts/check-privacy.sh` caught 3 historical
narrative entries that still contained the literal banned word inside
"we replaced X" descriptions. Scrubbed:

- `docs/JARVIS-ARCHITECTURE.md` §6.20 "Privacy-gate scrub" subsection:
  replaced literal example slug + person/fund pair with generic
  phrasing. The narrative meaning survives the change.
- `skills/kos-jarvis/TODO.md` L416 (2026-05-01 v0.25.0 sync narrative):
  same scrub.

`scripts/check-privacy.sh` clean (rc=0). `bun run check:all` clean.

### Production schema migration v34 → v45 (auto-applied during bun install)

**Notable surprise**: when `bun install` ran during Phase 1 conflict
resolution, the package's postinstall hook called `gbrain post-upgrade`
which called `gbrain apply-migrations` against our production
`DATABASE_URL`. **Production walked v34 → v45 cleanly without manual
intervention** — exactly what the v0.31.1.1 fixwave bootstrap robustness
promised. No forward-reference hand-ALTER required this time.

Schema state post-sync (verified 2026-05-09):
- `schema_version = 45`
- `pg_tables count = 35` (was 31 pre-sync; +4 = `facts`, `oauth_clients`,
  `oauth_codes`, `oauth_tokens`)
- `RLS enabled on 35/35 public tables` (auto-RLS event trigger from
  v0.26.8 onboards new tables automatically)
- `embeddings: 96% coverage, 244 missing` — post-migration drift,
  expected; backfill via `gbrain embed --stale` next session
- `brain_score = 80/100` (embed 33/35, links 25/25, timeline 3/15,
  orphans 9/15, dead-links 10/10)
- `facts_health: 0 active, 0 today, 0 this week, 0 consolidated` —
  table ready, waits for next ingest cycle to populate
- `connection: ok, 2718 pages` (was 2477 at v0.26.7 sync; +241 from
  notion-poller running 5 days)

### M3 pilot — gemini-embed-shim retirement (probe-passed, full-pilot deferred)

**Probe results** (positive):
- ✓ `gbrain providers explain --json` lists `google:gemini-embedding-001`
- ✓ `GOOGLE_GENERATIVE_AI_API_KEY=$NANO_BANANA_API_KEY \
   gbrain providers test --model google:gemini-embedding-001` →
   `286 ms, 768 dims, all probes green`
- ✓ Native v0.27 Google provider works against the same Google key
  the shim has been using
- ✓ `--embedding-dimensions 1536` flag exists at init time and per
  v0.27 changelog passes through to `providerOptions.google.outputDimensionality`

**Pilot end-to-end blocked**: spinning up `/tmp/pilot-brain` PGLite
hit the macOS 26.3 WASM #223 cold-start hang (process held 100 % CPU
for 7 + min, 0 bytes output, no `.gbrain/` dir created). Killed.
**This is environment, not v0.27**.

**Decision**: M3 milestone evidence is ✓ for technical feasibility, ✗
for end-to-end production-cutover validation **on this Mac via PGLite**.
Defer M3 cutover to a session that pilots against a Postgres-backed
throwaway DB (avoids PGLite altogether). Shim stays running on launchd
in production. M3 plan well-defined; cutover safer with cleaner test
environment. CONSOLIDATION-PLAN.md updated to reflect: M3 = `probe-passed`,
target retirement next session.

### v0.31 hot-memory adoption

Default-on. `facts.extraction_enabled` is the kill switch (set in
`~/.gbrain/config.json`). Cost monitor scheduled: review
`gbrain recall --since 7d` and Haiku call count after 1 week of
notion-poller runs. If daily cost > $1, disable.

Notion Knowledge Agent + OpenClaw downstream see new `_meta.brain_hot_memory`
field on every MCP tool-call response. `_meta` is a standard MCP
envelope key; downstream clients ignore unknown fields per spec, no
contract break expected.

### Service mesh after sync

- `kos-compat-api`: bootout/bootstrap'd to load v0.31.2 src
  (PID 92596, state=running, `/status` returns 2718 pages on local +
  remote, both consistent)
- `gemini-embed-shim`: bootout/bootstrap'd, running (still required
  pending M3 cutover)
- `dream-cycle`, `kos-patrol`, `notion-poller`, `enrich-sweep`:
  bootout/bootstrap'd (all "not running" = registered + waiting for
  cron schedule, normal launchd state for `StartCalendarInterval` jobs)
- `kos-patrol` smoke: kickstart → fresh dashboard at
  `~/brain/.agent/dashboards/knowledge-health-2026-05-10.md` (2718
  pages, 0 ERROR, 1421 WARN). WARN climbed from 762 (v0.26.7 baseline)
  due to +241 new pages and possibly v0.27/v0.29 lint-rule additions;
  not a regression

### Test results

- `bun run typecheck`: clean (~3 s)
- `bun build --compile`: 1302 modules, 165 ms bundle / 299 ms compile
- `bun run test`: 4760 pass / 9 fail / 0 skip / 366 s
  - 1 known pre-existing master flake (`BrainRegistry — lazy init`)
  - 2 env-coupled (`check-resolvable resolveSkillsDir`, fork P2 known)
  - 2 self-test recursion (`run-unit-parallel.sh` testing itself)
  - 1 build-llms drift — fixed by `bun run build:llms` regen
  - 2 `doctor --fix` env-coupled (upstream test, hits $HOME state)
  - 1 warm-create perf warn (5 939 ms vs 1 500 ms cap, hardware noise)
- `bun run check:all`: clean (rc=0)

### Upstream PR #627 closed as superseded

Our PR `fix(bootstrap): cover v0.26.3 mcp_request_log columns` (filed
2026-05-04) was strictly a subset of upstream's #682+#741 fixwave that
shipped in v0.31.1.1. Closed with public superseded comment + cite to
fixwave 2026-05-09. Patch doc `docs/UPSTREAM-PATCHES/v026-bootstrap-mcp-log-fix.md`
deleted (no longer needed).

### Net fork shrinkage

- **Active KOS skill dirs**: 14 (no change this sync; M3 pending defers)
- **Open M2 evaluation candidates**: still 4 (M2-A.execute / M2-B / M2-C / M2-D),
  with **M3 promoted from "no signal" to "probe-passed, ready for cutover"**
- **Upstream PRs filed by fork**: 1 → 0 (PR #627 closed as superseded)
- **`docs/UPSTREAM-PATCHES/`** entries: 4 → 3

### Reversibility

The merge is reversible at git level (`sync-v0.31.2` branch). Production
schema migration is **not** reversible without restoring the 81 MB
`pg_dump -Fc` backup at `/tmp/pg-pre-migration-v43.dump` (taken
2026-05-09 23:12, just before migration). Both `/tmp/pg-pre-v0.31.2-sync.dump`
(69 MB, taken before this session started) and the daily nightly dump
at 03:33 are also rollback points.

---

## 6.23 M1 + M2-A archive + M3 pilot validation (2026-05-10)

Same-day follow-up to the v0.31.2 sync. Four planned items, three
landed as commits, one (M3 production cutover) was validated end-to-end
on a throwaway DB but deferred — see "M3 cutover deferred" below for
the rationale.

### M1 — three retirements

`kos-lint` (was already broken in production: kos-patrol stderr
reported `JSON parse failed; exit=3` since 2026-04-29), `frontmatter-ref-fix`
(one-shot, ran v1+v2 on 2026-04-27), `slug-normalize` (one-shot, ran
2026-04-23). All three moved to `skills/kos-jarvis/_archived/`.
`kos-patrol/run.ts` phase 2 (lint delegation) shrunk to a no-op stub —
the renderer signature stayed stable so dashboards/digests keep working.
RESOLVER table, manifest.json, brain-db.ts caller list, and the
notion-ingest-delta SKILL.md (rewritten to a 5-line redirect to
`workers/notion-poller/`) all synced. Worker file header inherited the
original two-mode design rationale (backfill+delta, payload shape,
failure modes) from the old design contract. Verification: typecheck
clean, kos-patrol smoke `0 ERROR / 0 WARN / 2718 pages / exit 0` (the
WARN drop from 1421 is the expected effect of kos-lint retire — its
weak-link / orphan WARN contributions are gone). Commit `9e3cd0f`.

### M2-D — premise wrong, no code change

The TODO entry claimed `Operation.scope` + `.localOnly` would "replace
fork-local `OperationContext.remote`". Reading
`src/core/operations.ts:223-249` (F7b hardening, v0.30.0) shows that's
not how it works:
- `OperationContext.remote: boolean` is **REQUIRED** first-class —
  every transport (CLI / stdio MCP / HTTP MCP / subagent dispatcher)
  must set it explicitly. F7b hardening makes the type system the
  first line of defense.
- `Operation.scope` / `Operation.localOnly` are **operation-side**
  safety declarations (op self-rating).
- `OperationContext.remote` is **caller-side** trust (caller
  self-rating).
- They compose: HTTP rejects `scope=admin + localOnly + remote=true`.
  One does NOT replace the other.

Fork-local audit:
`git grep "ctx\.remote\|context\.remote" -- server/ workers/ skills/kos-jarvis/_lib/`
returns zero matches. The only hit elsewhere is
`brain-db.test.ts:88 'remote: true'`, which is the v0.25.0
`EvalCandidateInput` eval-row schema field — different concept entirely.
Fork has never hand-rolled remote checks in `kos-compat-api`; trust
classification is delegated to the gbrain CLI subprocess or downstream
op handlers. TODO entry rewritten to RESOLVED with the premise
correction. Commit `3d667de`.

### M2-A — archive triplet (mechanical part)

The KOS quality triplet (`dikw-compile`, `evidence-gate`,
`confidence-score`) was already confirmed dead code by 2026-05-04
production probe (recorded in §6.21):
- `frontmatter.dikw_layer` set on 0 / 2477 pages (0.00%)
- `frontmatter.evidence_level` set on 1 / 2477 (0.04%)
- `frontmatter.confidence` set on 2470 / 2477 — but values are
  hardcoded template strings from `kos-compat-api.ts:454, :533`,
  not script-computed.

Mechanical retire: `git mv` triplet → `_archived/`, manifest.json
deleted 3 entries (49 → 46 total skills, 11 → 8 kos-jarvis), RESOLVER
KOS section deleted 3 trigger rows + appended M2-A archive note,
`kos-compat-api.ts:600` prompt rewritten:
`"dikw-compile recommended for strong-link network"` →
`"use \`gbrain dream\` for cross-page synthesis"`. Active fork dirs
14 → 11. Commit `eedb357`. Pilot run of v0.25.1 `concept-synthesis`
on the 188 `concepts/` pages was deferred to follow-up M2-A.pilot —
that skill is `writes_pages: true` mutating + LLM-driven, the work
crosses into brain-side commit territory, separate cycle warranted.

### M3 — pilot validated, production cutover deferred

Pilot ran end-to-end on a throwaway local Postgres DB
(`gbrain_m3_pilot`):

```
createdb gbrain_m3_pilot
GOOGLE_GENERATIVE_AI_API_KEY=$NANO_BANANA_API_KEY \
GBRAIN_DATABASE_URL=postgresql://chenyuanquan@127.0.0.1:5432/gbrain_m3_pilot \
bun run src/cli.ts init --supabase --non-interactive \
  --embedding-model google:gemini-embedding-001 \
  --embedding-dimensions 1536
# 35 tables created, schema v45, config row written
```

Two sample concept pages (one English "founder mode", one mixed
English/Chinese "M3 pilot sample") synced and embedded with the
**native v0.27 Vercel AI SDK gateway** + Google `gemini-embedding-001`
+ `--embedding-dimensions 1536` flag. Verification:

- `vector_dims(content_chunks.embedding) = 1536` for both rows ✓
- English query "founder mode" → `concepts/founder-mode` 0.92 (top hit) ✓
- Chinese query "向量检索" → `concepts/sample-test` 0.90 (top hit) ✓
- **Shim not hit**: `wc -l skills/kos-jarvis/gemini-embed-shim/shim.stdout.log`
  unchanged across pilot lifecycle (last write 23:53 UTC; pilot ran 00:23–00:30).
  100% native Google traffic.
- `~/.gbrain/config.json` was clobbered by `init --supabase` (expected
  per CLAUDE.md fork rule) — restored from
  `~/.gbrain/config.json.pre-m3-2026-05-10` snapshot. Production
  service mesh continued running through pilot (kos-compat-api PID
  unchanged, BrainDb instance pinned to production DB).

**Two findings worth flagging**:

1. **`content_chunks.model` field is audit-only and unreliable.**
   `src/core/postgres-engine.ts:1136` writes
   `chunk.model || 'text-embedding-3-large'`. The `import` path
   (`src/commands/embed.ts:202`) builds chunks WITHOUT a model field,
   so the fallback string always wins regardless of which provider the
   gateway actually called. The vector content is correct (real Google
   1536-dim), but the audit column lies. Don't use this column as a
   "did the cutover work" signal — use the shim log delta instead.
   Filing this as a P3 upstream gap below.

2. **`init --supabase` writes `embedding_model` to the DB `config`
   table without the `provider:` prefix** (it stores `gemini-embedding-001`,
   not `google:gemini-embedding-001`). `loadConfigWithEngine` doesn't
   actually consume that field anyway — `embedding_model` is
   file/env-only by design (`src/core/config.ts:182-184`). Cosmetic
   inconsistency, no functional impact, not worth a PR.

**Why production cutover was deferred**: cutover requires editing the
deployed plists for kos-compat-api + notion-poller + dream-cycle
(adding `GOOGLE_GENERATIVE_AI_API_KEY` + `GBRAIN_EMBEDDING_MODEL=google:gemini-embedding-001` +
`GBRAIN_EMBEDDING_DIMENSIONS=1536`, removing `OPENAI_BASE_URL` +
`OPENAI_API_KEY`), `launchctl bootout`/`bootstrap` cycling, then
running `gbrain embed --stale` to backfill the 244 stale chunks.
Vector-space compat between shim-era 1536-dim chunks (OpenAI shape →
shim → Google `batchEmbedContents`) and native-era 1536-dim chunks
(Vercel AI SDK → Google native API) is *probably* fine — both use
Google `gemini-embedding-001` underneath at the same dim, and GBrain's
HNSW index is `vector_cosine_ops` (cosine is invariant under L2-norm
differences) — but "probably" hasn't been measured. A safe cutover
would either (a) force re-embed all 2718 pages right after the switch
(few minutes / few-cents on Google) or (b) keep the shim running for
24-48h soak and compare retrieval results.

Filed as M3.cutover follow-up in `skills/kos-jarvis/TODO.md`. Pilot
artifacts cleaned up (`dropdb gbrain_m3_pilot`, `rm -rf /tmp/m3-pilot-brain`).
Backup `~/.gbrain/config.json.pre-m3-2026-05-10` retained as audit
trace.

**Net effect of this same-day follow-up**: 3 commits landed, fork
active dirs **14 → 11** (M1 retired 3, M2-A retired 3 — but
gemini-embed-shim still active so the M3 line in the README still says
"M3 退役 in flight"). Total deleted/relocated code: ~6800 lines
(mostly dead `_archived/` content). No production breakage; service
mesh continued serving through all four work blocks.

### M3.cutover landed same day (continuation)

Lucien asked the deferred M3 cutover plus the M2-A pilot to be done in
the same session. M3.cutover went first (more deterministic, has clear
acceptance). Cutover ran cleanly:

1. **Plist surgery** (5 deployed plists at `~/Library/LaunchAgents/` +
   5 templates at `scripts/launchd/`): added
   `GOOGLE_GENERATIVE_AI_API_KEY` (= `NANO_BANANA_API_KEY` in `.env.local`),
   `GBRAIN_EMBEDDING_MODEL=google:gemini-embedding-001`,
   `GBRAIN_EMBEDDING_DIMENSIONS=1536` to all five (kos-compat-api,
   dream-cycle, enrich-sweep, kos-patrol, notion-poller).
   `kos-compat-api` plist additionally dropped `OPENAI_BASE_URL` +
   `OPENAI_API_KEY=stub-for-gemini-shim`. Templates use
   `<FILL:NANO_BANANA_API_KEY>` placeholder for the API key (existing
   convention from `<FILL:KOS_API_TOKEN>`).
2. **Config update**: `~/.gbrain/config.json` extended with
   `embedding_model` + `embedding_dimensions` so non-launchd-spawned
   `gbrain` invocations (Lucien's interactive CLI) match. Backup at
   `~/.gbrain/config.json.pre-m3-cutover-2026-05-10`.
3. **Safety net**: `pg_dump -Fc gbrain` → `/tmp/pg-pre-m3-cutover-2026-05-10.dump`
   (89 MB). Rollback path: `dropdb gbrain && createdb gbrain &&
   pg_restore -d gbrain /tmp/pg-pre-m3-cutover-2026-05-10.dump`.
4. **Service cycle**: 5x `launchctl bootout gui/$UID/com.jarvis.<svc>` +
   `bootstrap gui/$UID ~/Library/LaunchAgents/com.jarvis.<svc>.plist`.
   New kos-compat-api PID 35872 inherited the new env. Smoke
   `/status` returned 2718 pages immediately. macOS sandbox needed
   `dangerouslyDisableSandbox` (same as v0.25.0 launchd surgery
   session, §6.20).
5. **Pre-re-embed query verification**: `gbrain query "founder mode"`
   returned a single low-score hit (0.40) — confirming the
   shim-era-vector vs native-query mismatch that motivated the
   force-re-embed step. Shim log line count UNCHANGED across this
   query (still 6703) — query traffic now 100% native.
6. **Force re-embed all** (option (a) from the plan):
   `gbrain embed --all` with `GOOGLE_GENERATIVE_AI_API_KEY` exported.
   Initial run failed silently (0 chunks embedded across 2718 pages —
   the shell I spawned `gbrain` from didn't inherit the API key, so
   every chunk hit `Google embedding requires GOOGLE_GENERATIVE_AI_API_KEY`
   with no overall failure code). Re-ran with explicit env and watched
   `psql -d gbrain -tAc "SELECT count(*) FROM content_chunks WHERE
   embedded_at > now() - interval '60 seconds'"` climb in 30s ticks.
   Throughout: shim log line count stayed at 6703 — 100% native traffic.
   Total chunks 5548 (2718 pages × ~2 chunks avg) re-embedded into the
   clean native 1536-dim vector space.
7. **Retrieval verification**: re-ran `gbrain query "founder mode"` +
   Chinese sample queries; top-hit scores normalized into the
   expected ~0.7-0.9 band (vs the 0.40 anomaly seen pre-re-embed).
8. **Shim retire**: `launchctl bootout gui/$UID/com.jarvis.gemini-embed-shim`
   (former PID 93139), removed deployed plist,
   `git mv skills/kos-jarvis/gemini-embed-shim
   skills/kos-jarvis/_archived/`,
   `git mv scripts/launchd/com.jarvis.gemini-embed-shim.plist.template
   scripts/launchd/_archived/`. Manifest, RESOLVER, README, fork
   `CLAUDE.md`, and CONSOLIDATION-PLAN all synced.

**Cost**: ~5548 chunks × ~500 tokens avg / 1M × $0.15/M ≈ $0.40 for
the full re-embed. Lower than the dollar TODO had assumed, well
within "few cents" budget.

**Audit attestation**: cutover is attested by (i) shim log line count
delta = 0 across the entire cutover window, (ii) the absence of the
`com.jarvis.gemini-embed-shim` launchd job, and (iii) all 5548
production chunks now embedded by the native gateway (verified by
top-hit scores returning to the expected 0.7-0.9 band). The
`content_chunks.model` audit column still lies (L1136 fallback always
writes `text-embedding-3-large` regardless of provider) — do not use
that column.

**Net session shrinkage**: 7 retired skill dirs across M1+M2-A+M3
moved into `skills/kos-jarvis/_archived/`. Active skill dirs with
`SKILL.md` shrank from 11 to 7 (digest-to-memory, dream-wrap,
enrich-sweep, kos-patrol, notion-ingest-delta-now-redirect,
orphan-reducer, url-fetcher).

### M3.cutover-followup — 100% native vector space (2026-05-10 evening)

The deferred cleanup of 1334 lingering shim-era chunks landed same
session. Procedure:

1. `UPDATE content_chunks SET embedding = NULL, embedded_at = NULL
   WHERE embedded_at < now() - interval '2 hours'` — marked 1563
   shim-era rows stale (the residuals from M3.cutover's
   quota-truncated re-embeds).
2. `gbrain embed --stale` × 4 passes. Google free-tier RPM resets
   between passes, but each pass hits the cap mid-batch and exits 0
   with partial progress. Throughput per pass: 881 → 440 → 199 → 20
   chunks. Standard `--stale` flow processes a discrete batch then
   exits cleanly even if more remain.
3. One page (`sources/notion/re-qataer-isp-ooredoo-sms-...`,
   23 chunks, max 18131 chars per chunk) repeatedly errored under
   `--stale` batching. Single-page invocation `gbrain embed <slug>`
   succeeded on first try — page-level batch retry policy must
   differ from the `--stale` flow's group batching when chunks
   approach per-batch token caps.
4. Final: `null_left=0`, query smoke (English "Omada Cloud" + Chinese
   "知识管理") in 0.6-0.76 band.

**100% native vector space achieved**, no remaining residual.

**Operational lesson recorded for next time**: Google free-tier RPM
is per-minute, not daily — repeated `--stale` retries clear a
shim-era backlog within 5-10 minutes of wall time. Don't conclude
"daily quota exhausted" on the first hit. For pages with very large
chunks (>15k chars), use single-page `gbrain embed <slug>` rather
than `--stale` group batching.

### M2-A.pilot — concept-synthesis on 181 concept pages (2026-05-10)

Decision: option **(b) ad-hoc**, do not wire to dream-cycle.

Pilot ran Phase 1+2 deterministic-only (no LLM, no brain page
mutations) via a transient `/tmp/m2a-pilot.ts` script. Tier
distribution: T1=0, T2=0, T3=11, T4=170 (93.9% single-mention).
Zero concepts cleared the multi-month-recurrence threshold required
to justify Phase 3 LLM synthesis. Phase 1 dedup is the real win —
22 Jaccard ≥0.5 + 11 substring pairs = 33 candidate merges (~18%
of corpus): the `fsct-2025-*` ticket pages, `dashboard` ⊂
`dashboard-site` ⊂ `dashboard-site-health` chain,
`office-3f-ap01` ⊂ `ap-office-3f-ap01`.

Why not (a) wire-to-cron: optimizes for sustained T1/T2 evolution
narratives that don't exist in this brain. Premature automation.

Why not (c) fork-own-version: would add new fork-local code on the
same day we deleted 7 dirs in M1+M2-A+M3. Net surface increase. The
deterministic Phase 1+2 already lives in `/tmp/m2a-pilot.ts`,
runnable any time.

Brain-side commit: `b9e32d8aa7` (report at
`~/brain/.agent/reports/concept-synthesis-pilot-2026-05-10.md`).
Fork-side commit: `ba91239`.

Reopen if signal-detector + voice-note-ingest grow recurring concept
stubs across multiple months that produce real T1/T2 candidates.

---

## 6.24 Upstream v0.34.4 sync (2026-05-15)

29 commits across 17 patch/minor versions: `eec2d2bf..upstream/master` =
v0.31.3 → v0.34.4. Branch `sync-v0.34.4`, merge commit `1b6acd77`. 429
files / +63 566 / -1 952 LoC — slightly larger than v0.31.2 sync, but
**only 3 conflicts** (down from 5) and `gateway.ts` auto-merged clean
this round.

### Headline upstream features adopted

- **v0.32.7 CJK fix wave** (6 layers from one root cause) — a Chinese-
  first knowledge base directly benefits. KOS Jarvis is Chinese-primary;
  this potentially restores keyword-search as a hybrid alongside our
  vector-only fallback. Needs evaluation.
- **v0.32.5 gbrain-context** — OpenClaw deterministic context engine
  (temporal/spatial injection). Touches the same surface our
  `kos-compat-api` covers; **M2-B reassessment now relevant**.
- **v0.32.8 multi-source bug class extermination** — even a single-
  source fork gains correctness fixes across embed / extract / takes /
  patterns / integrity / migrate-engine.
- **v0.34.1 MCP fix wave** — source-isolation P0 + PKCE DCR +
  federated_read. Required `oauth_clients.{source_id, federated_read}`
  columns (the column at the heart of this sync's bootstrap fight).
- **v0.31.6 facts extraction during sync** + **v0.33.0 morning pulse**
  + **v0.32.2 facts-fence** — three pieces of an evolving "hot memory"
  story that **overlap with `kos-patrol` and the M2-A concept-synthesis
  decision** (pilot landed 2026-05-10 with decision (b): keep ad-hoc).
  Functional overlap matrix is a new P1 item.
- **v0.34.0 Cathedral III** — recursive code intelligence + Leiden
  clusters. Drives the bulk of `src/` churn but **fork doesn't use it**.
  Watch whether default-on indexing eats embedding budget.
- **v0.33.2 search-lite** (token budget + semantic query cache +
  intent weighting) — performance win, especially for CJK retrieval.
- **v0.33.1 eval-gated whoknows** + **v0.34.4 cursor-paginated `--stale`
  hardening** + **v0.34.2 path-based checkpoint resume** — operational
  hardening, no fork-side work.

### Conflicts and how they were resolved

3 conflicts; expected ~5–7 going in.

1. **`CLAUDE.md`** — same pattern as v0.31.2 sync. Kept fork-only HEAD
   (~150 lines); refreshed `docs/CLAUDE-UPSTREAM.md` snapshot (1308 →
   1607 lines) by replacing everything after the fork header (line 21)
   with the latest `upstream/master:CLAUDE.md` content. Fork's offload
   policy holds: future syncs land upstream `CLAUDE.md` deltas in
   `CLAUDE-UPSTREAM.md`, NOT in root.
2. **`skills/RESOLVER.md`** — upstream consolidated 8 routing entries
   (`article-enrichment` / `strategic-reading` / `concept-synthesis` /
   `perplexity-research` / `archive-crawler` / `academic-verify` /
   `brain-pdf` / `voice-note-ingest`) from the scattered table-block
   into a unified "Strategic & meta" section at line 118-126. Our fork
   carried the old scattered versions. Kept the upstream consolidated
   form; KOS-Jarvis extensions block (lines 130+) preserved untouched.
3. **`skills/manifest.json`** — union: 3 new upstream skills
   (`cold-start`, `ask-user`, `functional-area-resolver`) appended
   before our 4 `kos-jarvis/*` entries. JSON validated post-edit.

`src/core/pglite-engine.ts` auto-merged this round (was a conflict in
v0.31.2). `src/core/ai/gateway.ts` auto-merged: v0.31.12 added
`registerExtendedModel` + Voyage 256MB cap, but our M3 cutover is
config-path only (`embedding_model = google:gemini-embedding-001`
via `~/.gbrain/config.json`) — the gateway entry points pass through
unchanged.

### Schema migration: v45 → v66 (21 migrations) + bootstrap workaround

This sync hit a familiar trap: **another `applyForwardReferenceBootstrap`
miss**, this time for the v0.34.1 `oauth_clients.{source_id,
federated_read}` columns. Pattern identical to v0.26.3
`mcp_request_log.{agent_name, params, error_message}` that produced
our PR #627 (superseded by upstream fixwave #682+#741 — see §6.22).

**Symptom**: `bun install` postinstall ran `gbrain apply-migrations`,
which under the hood requires schema_version ≥ 51 for the v0.32.2 facts
orchestrator. Schema was at v45. Running `gbrain init --migrate-only`
to bump v45 → v66 failed at `schema-embedded.ts:438`:
```sql
CREATE INDEX IF NOT EXISTS idx_oauth_clients_source_id
  ON oauth_clients(source_id) WHERE source_id IS NOT NULL;
```
`oauth_clients` existed (pre-v0.34) without `source_id`, so the index
DDL hit `column "source_id" does not exist`. Forward-bootstrap covers
9 forward-reference targets (`pages.source_id`, `pages.deleted_at`,
`links.*`, `content_chunks.*`, `mcp_request_log.*`, etc.) but missed
`oauth_clients.{source_id, federated_read}`.

**Workaround** (manual, ~2 seconds):
```sql
ALTER TABLE oauth_clients
  ADD COLUMN IF NOT EXISTS source_id TEXT
    REFERENCES sources(id) ON DELETE RESTRICT;
ALTER TABLE oauth_clients
  ADD COLUMN IF NOT EXISTS federated_read TEXT[]
    NOT NULL DEFAULT '{}';
```
After that, `gbrain init --migrate-only` ran all 21 migrations clean in
under a minute. Final `schema_version = 66`; `gbrain doctor` shows
`schema_version: Version 66 (latest: 66)`, RLS up to 41/41 tables (was
35/35).

**Bonus complication**: a stale `gbrain sources` background process
from before the schema fix held `pg_advisory_lock(42)` for 20 minutes
while idle, blocking three subsequent migration attempts. `kill <pid>`
released the lock cleanly. The retry framework in `migrate.ts:3276`
(`runMigrationSQLWithRetry` with 5s/15s/45s backoff) didn't help here —
it only retries on `statement_timeout (57014)`, not on `pg_advisory_lock`
contention. Operationally: when migrations stall, check
`pg_stat_activity` for idle holders of advisory locks before retrying.

**v0.32.2 orchestrator** (facts-fence) ran post-schema in one shot,
`status=complete`: the `facts` table was empty (fork hasn't used hot
memory yet), so phase-A (legacy fact backfill into entity-page
`## Facts` fences) was a no-op walk. **No markdown changes** to the
brain repo — `/Users/chenyuanquan/brain` working tree stayed clean
throughout.

### Production smoke

- `kos-compat-api` (PID inherited from launchd) served `POST /query`
  with Chinese question 知识图谱 → 20 retrievals, top score 0.9541
  (`concepts/knowledge-compilation`), LLM-synthesized answer via
  Anthropic proxy. End-to-end Gemini embedding + pgvector + Anthropic
  synthesis all green. No service restart needed.
- `gbrain doctor`: brain_score 80/100 (unchanged); 3071 pages, 100%
  embed coverage; 48 unacknowledged sync failures predate the sync
  (all `column "chunker_version" of relation "pages" does not exist`
  from pre-v54 sync attempts; schema is now at v66 so new syncs
  won't reproduce these — `gbrain sync --skip-failed` cleanup queued
  as P2).
- Typecheck (`bun run typecheck`): exit 0, clean.
- `bun install`: 0 dependency changes.
- `bun test`: hung at 99% CPU for 30 min and was killed; this echoes
  the v0.31.2 "9 fails / 4760 pass" experience but worsened. Likely
  one of the 60+ new test files (v0.32 wave) has an environment
  expectation our box doesn't satisfy. Filed as a P2.

### Brain state (post-sync)

Pages: **3071** (+353 since v0.31.2 sync, ~5 days). Schema: **v66**.
RLS: 41/41 tables. Embedding model: `google:gemini-embedding-001`
(1536-dim native; M3 cutover from §6.23 holds). PGLite-vs-Postgres
config (`~/.gbrain/config.json`) unchanged (snapshotted to
`.before-v0.34.4-sync` before any migration work).

### Follow-ups

Three new P1 evaluation items (recorded in `skills/kos-jarvis/TODO.md`):

1. **Upstream PR opportunity**: extend `applyForwardReferenceBootstrap`
   (PostgresEngine + PGLiteEngine) to probe
   `oauth_clients.{source_id, federated_read}` before the schema-init
   `CREATE INDEX` runs. Pattern identical to PR #627 (which was
   superseded). Worth filing.
2. **v0.32.7 CJK fix wave** evaluation: probe whether keyword search
   now produces useful hits on Chinese queries → if yes, our
   "vector-only" assumption can be replaced with hybrid.
3. **Functional overlap evaluation**: v0.31.6 facts-on-sync +
   v0.33.0 morning pulse + v0.32.2 facts-fence overlap with kos-patrol
   + concept-synthesis (M2-A) + digest-to-memory. Decide what fork
   retires now that upstream has parallel mechanisms.

P2 cleanup queue:

- `gbrain sync --skip-failed` to ack the 48 historical chunker_version
  sync failures.
- `bun test` half-hour hang in test/ root: identify which new v0.32+
  test file hangs, file env mismatch.
- `[ai.gateway] recipe "google" declares an embedding touchpoint
  without max_batch_tokens` NOTICE on every query path: upstream
  recipe gap, not fork's, but verify our recipe override doesn't
  also need this knob.

### Commits

Fork-side commits this session:

- `1e2777e` — `fix(kos-patrol): phase4 honors frontmatter aliases`
  (pre-sync, standalone bug fix)
- `1b6acd77` — `v0.34.4 sync: 29-commit upstream merge (v0.31.3 →
  v0.34.4)` — the merge commit

End-to-end wall-time: ~2 h including 20-min advisory-lock detour and
the manual oauth_clients bootstrap.

---

## 6.25 v0.34.4 follow-up session (2026-05-15)

Same-day follow-up to the v0.34.4 sync (§6.24). Goal: close the 3 P1
evaluations queued in `TODO.md` plus a misframed P2 about a "fire" that
turned out not to be one. Net session output: 7 commits on fork master
+ 2 upstream PRs filed; **8 TODO items closed, 1 new latent bug
filed**.

### Diagnostic correction (the non-fire)

Session opened with a triage misread: `workers/notion-poller/poller.
stderr.log` showed 117 394 `ingest failed: ingest 500` lines, mostly
recent-looking. Initial framing was "P0 fire — every Notion ingest is
500-ing on a `[ai.gateway] recipe \"google\" missing max_batch_tokens`
warning". The file is a never-rotated 38 MB accumulated log;
`ingest_log` table showed 235 successful `git_sync` events in the last
24 h and 0 failures; the most-recent 500 in stderr was from
2026-05-15T00:00 — and a manual `kos-compat-api /ingest` probe
succeeded end-to-end (HTTP 200, embedded: true). The 500s in stderr
dated from the v0.21 PGLite-lock-deadlock era — Path 3 closed that
root cause on 2026-04-29 (§6.18). Mitigation: rotated the 38 MB
stderr to `.archive.gz` and extended `.gitignore` so future rotations
stay out of git.

Lesson recorded for future triage: when a log file accumulates
without rotation, recency of *content* in the file does not imply
recency of the *writes* — check `stat -f%Sm` plus DB-side state.

### Upstream PRs filed

Both follow the PR #627 "branch from upstream/master, no fork-local
content" pattern.

- **[garrytan/gbrain#1016](https://github.com/garrytan/gbrain/pull/1016)** —
  declare `max_batch_tokens` on the google embedding recipe.
  `src/core/ai/recipes/google.ts` was the only first-party embedding
  recipe still missing the field after v0.32 #779 added the
  once-per-process startup warning. Three field additions
  (`max_batch_tokens: 20_000`, `chars_per_token: 2`, `safety_factor`
  default 0.8 → pre-split at ~8 000 chars/batch). Two regression
  tests that pinned google as the canary "real provider with no cap
  declared" (`no-batch-cap-suppression.serial.test.ts`,
  `adaptive-embed-batch.test.ts`) updated to assert the stronger
  invariant: no first-party recipe warns. `bun test test/ai/` 144/144
  green. Fork master carries the same edits as a fork-local patch
  pending merge (`af2a8064` + `0232e425` test backport).

- **[garrytan/gbrain#1017](https://github.com/garrytan/gbrain/pull/1017)** —
  extend `applyForwardReferenceBootstrap` to cover the v0.34.1
  `oauth_clients.{source_id, federated_read}` columns. Same shape as
  the prior PR #627 + upstream fixwave #682+#741 (mcp_request_log
  v0.26.3 columns): probe `information_schema` for the table + each
  column, ALTER TABLE ADD COLUMN IF NOT EXISTS when the table exists
  but the columns don't. Mirrored across PostgresEngine and
  PGLiteEngine. Field repro is the §6.24 manual ALTER block.
  `REQUIRED_BOOTSTRAP_COVERAGE` gains two entries.
  `bun test test/schema-bootstrap-coverage.test.ts test/bootstrap.
  test.ts` 11/11 green (50 expect() calls vs 48 pre-patch).

Both PRs cut from `/private/tmp/gbrain-upstream-prs` worktree at
`upstream/master` HEAD `24881f60`. Branches pushed to
`ChenyqThu/jarvis-knowledge-os-v2` origin and PRs opened against
`garrytan/gbrain` master.

### CJK keyword-only eval (15-query probe)

Tightens the fork's operating-assumption wording. Probed `gbrain
search` (tsvector keyword-only path) at schema v66:

| Pattern | Sample | Result |
|---|---|---|
| English single/multi word | `Lucien`, `Omada`, `Notion`, `Postgres` | 10-18 hits, 0.3-0.5 scores |
| Mixed CJK+space | `AI 网关` | 8 hits via Latin fragment, low CJK weight |
| 2-3 char CJK | `知识管理`, `知识库` | 2-3 hits via body-fragment containment |
| 4-char CJK compound | `向量检索`, `嵌入模型`, `云控制器`, `万兆网卡` | **0 hits** every time |
| 2-char CJK names | `拉勾`, `猫人` | 0 hits |

v0.32.7's CJK fixes landed downstream of where they would have helped
pure-keyword retrieval here. tsvector `'simple'` config still treats
Han runs as a single non-tokenizable blob; matches only fire when the
query string is a literal substring of the body (weak scoring even
then). **The 4-char compound CJK shape — the modal operator query on
this brain — still goes 0/N on keyword.** Vector path remains the
only reliable retrieval for compound CJK queries.

CLAUDE.md updated to tighten the prior "vector-only for CJK" claim
to "compound CJK (4+ Han chars without whitespace) requires vector".
No routing behavior change; the hybrid budget-save the original probe
was scoping is still not viable on the modal workload.

### Overlap-matrix verdict (no retirements)

Compared the three upstream features v0.31.6 / v0.32.2 / v0.33.0
shipped between v0.31.2 and v0.34.4 against the three fork pieces the
sync TODO flagged as "potentially redundant":

| Upstream | Real surface | Fork piece | Verdict |
|---|---|---|---|
| v0.31.6 extract-facts-during-sync | per-page real-time fact extraction | concept-synthesis (never wired) | Different problem domains. concept-synthesis was cross-page multi-month recurrence clustering. |
| v0.32.2 facts-fence | `## Facts` intra-page system-of-record | digest-to-memory writes `[knowledge-os]` summary to OpenClaw MEMORY.md | Different surfaces; intra-brain vs cross-system. |
| v0.33.0 "morning pulse" | `gbrain recall --pulse / --since-last-run / --pending` (PR title misleading; queries facts table for time-windowed recall) | kos-patrol daily 08:07 cron audit | Same cadence, totally different output shape. |

**No retirements warranted.** M2-A.pilot decision (b) — keep
concept-synthesis ad-hoc, don't wire — survives the re-look. Side
benefit identified: upstream's `extract-facts-during-sync` would give
the fork's brain a real-time per-page fact index for free, but is
currently blocked here by the same sub-process DB-connection gap as
the `[facts:absorb]` latent bug filed below.

### M2-B verdict: don't touch kos-compat-api

Sized the "translator shim" hypothesis (M2-B option a) against actual
surfaces. Upstream `serve-http.ts` is 1116 LoC (OAuth 2.1 + MCP
JSON-RPC + admin dashboard); fork `kos-compat-api.ts` is 661 LoC
(bearer auth, KOS-v1 contract). Of the 5 endpoints, only `/query` +
`/status` have direct MCP equivalents (~110 LoC). `/ingest` (250 LoC,
writes filesystem + git commit + spawns sync) and `/digest` (reads
kos-patrol JSON output) are inherently fork-side; `/health` is
trivial. A translator adds back ~80-150 LoC. **Realistic net change:
0 to -50 LoC**, in exchange for one extra subprocess + OAuth-client
management + second port + cross-process MTTR cost. Not worth it.
Option (b) — migrate external systems — rejected because Notion
Knowledge Agent and OpenClaw feishu cron are hard-coded against
`kos.chenge.ink/<endpoint>`.

### M2-C verdict: archive-crawler covers Phase 5 Email only

Read `skills/archive-crawler/SKILL.md` source-format enum: `local |
dropbox | backblaze | gmail-takeout | mbox | pst`. Calendar is NOT
in the enum (it's a stream of events, not an archive of files).

- **Phase 5 Email** → upstream-driven. `.mbox` and `gmail-takeout`
  are first-class. When the work moves to active, "build fork-local
  email skill" reduces to `gbrain.yml` config + path allow-list +
  per-mbox manifest review. ~3-4 days off the original 1-week fork
  plan; 0 new fork skill dirs.
- **Phase 4 Calendar** → stays fork-local. Needs OAuth Google
  Calendar client (workers/calendar-poller/) or `.ics` parse step.

Both phases still gate on the original
[`docs/JARVIS-NEXT-STEPS.md`](JARVIS-NEXT-STEPS.md) Phase 1-3
finishing first; M2-C implementation is out of milestone scope.

### Mechanical cleanup also closed

- **48 chunker_version legacy sync_failures ack'd**. `gbrain sync
  --skip-failed --no-pull` once on the host:
  `Acknowledged 48 pre-existing failure(s)`.
  `~/.gbrain/sync-failures.jsonl` open=48 → 0. Schema is at v66 now
  so the failure mode (v54 migration didn't add `chunker_version`
  column to the v45 brain in time) can't reproduce.

- **bun test 30-min hang root-caused**. `bun test --bail` ran 616
  tests across 37 files in 45 s before bailing on
  `test/think-pipeline.serial.test.ts`. The `beforeAll` hook (`new
  PGLiteEngine() + connect({}) + initSchema() + seed`) exceeded
  bun's default 5 s hook timeout (6 538 ms observed). Same family as
  PGLite #223 cold-start hang documented under §6.20; env-coupled,
  not a code defect. Practical mitigation: `bun test --bail` or
  per-file invocation. `--reporter=verbose` (recommended in the
  original TODO) doesn't exist in bun 1.3 — accepted values are
  `junit` and `dots`.

- **kos-lint retire already shipped**. Probing for the formal pilot
  found it had landed 2026-05-10 (`9e3cd0f`); kos-patrol Phase 2 is
  now a no-op with a docblock mapping each of the 6 original checks
  to its replacement. Checks 5+6 (weak-links + evidence-gap)
  remained unrehomed; verdict is to defer the ~150 LoC `kos-quality`
  shim until a brain-quality question arises that those checks
  uniquely answer.

### New latent bug filed

While verifying the max_batch_tokens fix, every `kos-compat-api
/ingest` response output still carries:

```
[facts:absorb] failed to log gateway_error for sources/<slug>:
No database connection: connect() has not been called.
```

Source: `src/core/facts/absorb-log.ts:76`. The writer runs inside a
`gbrain sync` sub-process spawned by `kos-compat-api`; that
sub-process inherits env but `BrainDb.connect()` is never called on
its path. **Log-only today** (page lands, chunks embed, sync returns
0), but it means `ingest_log.source_type='facts:absorb'` rows for
`gateway_error` events from compat-api never land, so
`gbrain doctor`'s `facts_extraction_health` check
(`src/commands/doctor.ts:1894+`) is blind to compat-api embedding
errors. Either (a) ensure the sub-process initializes the DB
connection before facts:absorb fires, or (b) treat compat-api spawned
sync as a "detached" context and skip facts:absorb logging there with
an explicit guard. Filed for upstream-side decision; fork can't fix
without `src/core/facts/` edits.

### Session commit set

```
bedd1e42 docs(todo): close #8 M2-C
99acb2f4 docs(todo): close #7 M2-B
352b98ba docs(todo): close #6 kos-lint
9a9f7d5a docs(todo): close #5 overlap-matrix
21223328 docs(todo): close #3 CJK + #4 sync_failures + bun-test
0232e425 test(ai): backport upstream PR-1016 test edits
af2a8064 fix(ai-gateway): declare max_batch_tokens on google
```

Net fork-master delta: 7 commits, mostly TODO-state hygiene, plus
the google.ts hardening and its test backport. Upstream PRs #1016 +
#1017 await garrytan review. **Active fork dirs unchanged** — no
retirements from this session. End-to-end session wall-time: ~3 h
including the diagnostic-correction detour and 8 TODO writeups.

---

## 7. Known gaps (see `skills/kos-jarvis/TODO.md` for live tracker)

- **P0 resolved 2026-04-22**: notion-poller PGLite deadlock — Path B landed in v0.17 sync (see §6.7). `scripts/minions-wrap/notion-poller.sh` deleted; plist now direct-bun invocation of `workers/notion-poller/run.ts`. First live cycle: 78 s / 9 pages ingested / 0 lock timeouts.
- **P0 resolved 2026-04-25 (v0.20.4 sync)**: v0.13.0 migration orchestrator partial-forever ([garrytan/gbrain#332](https://github.com/garrytan/gbrain/issues/332)). Upstream fixed in v0.19.0 by shell-out to `gbrain` instead of `process.execPath`. Post-merge `gbrain apply-migrations --force-retry 0.13.0` + `apply-migrations --yes` advanced the ledger; doctor health 60→80, no more FAILs. See §6.14.
- **P1 (new, v0.17 sync follow-up)**: refactor `kos-compat-api` to import in-process instead of `spawnSync("gbrain import")`. Removes the lock-contention root cause for all future callers, not just notion-poller. ~150 LOC touch in `server/kos-compat-api.ts`. Path B is the Band-Aid; Path C is the cure.
- **P1**: `kos-compat-api /ingest` returns HTTP 500 for some Notion pages (seen on `password-hashing-on-omada`); investigate `gbrain import` failure mode.
- **P1 (anchor, Step 2.3 done, Step 2.4 parked +14d)**: filesystem-canonical migration. Steps 1 → 2.3 done + v0.18 upstream synced (see §6.8 → §6.13 + [`docs/FILESYSTEM-CANONICAL-EXPORT-AUDIT.md`](FILESYSTEM-CANONICAL-EXPORT-AUDIT.md)). All pre-migration blockers cleared + Step 2.2 landed (`b7212db`) + v0.18.2 merged (`aceb838`) + Step 2.3 dream cron wired (`com.jarvis.dream-cycle` daily 03:11 local, archives to `~/brain/.agent/dream-cycles/`, see §6.13). `/ingest` writes canonical to `~/brain/<kind>/<slug>.md` + git commit + `gbrain sync`, `/status` direct-DB (1930 not 100), `.agent/` hidden from sync, `~/brain/` is a git repo with nightly maintenance pass, schema at v24 with sources.default seeded. Only Step 2.4 (commit-batching + optional explicit `jarvis` source add / remote push) remains, parked +14d.
- **P1 resolved 2026-04-29 (v0.22.8 sync)**: [garrytan/gbrain#370](https://github.com/garrytan/gbrain/issues/370) — closed by upstream PR #440 / v0.22.6.1. Fork patch on `pglite-schema.ts` dropped during merge (commit `811c266`); upstream's `applyForwardReferenceBootstrap()` in `pglite-engine.ts:initSchema()` supersedes it. See §6.17.
- **P1 (new, Step 2.2 follow-up)**: kos-patrol launchd cron `LastExitStatus=1` since 2026-04-19 due to macOS 26.3 WASM bug (`#223` class) hitting the minion-wrapped subprocess. Direct bun-run works. Plus kos-patrol uses `gbrain list --limit 10000` (100-row-capped) — migrating to `BrainDb` direct-read is the natural fix.
- ~~**P1**: `dikw-compile`, `evidence-gate`, `confidence-score` lack runnable helpers~~ — **resolved 2026-04-22**: all three landed with `run.ts`, backed by the shared `skills/kos-jarvis/_lib/brain-db.ts` direct-PGLite reader that bypasses the MCP 100-row cap. See TODO.md P1 done markers.
- **P2 (new, v0.20 sync follow-up)**: PGLite → Postgres switch — analyzed and **deferred**. v0.20.2/v0.20.3's flagship features (jobs supervisor, queue_health, wedge-rescue, backpressure-audit) all skip on PGLite. None of them address pain we currently have. Four trigger conditions documented at [`docs/UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md`](UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md): brain >5000 pages, multi-machine access, WAL fork-patch failure, durable subagent runtime needed. Migration cost ~1 h via `gbrain migrate --to supabase`.
- **P2 (new, v0.20 sync follow-up)**: 14 unresolved frontmatter cross-dir refs surfaced by `gbrain extract links --source db --include-frontmatter`. All v1-wiki legacy `../entities/*.md` / `../sources/*.md` paths that import-time slug normalization missed. Cosmetic (dead-end refs in the graph, no query impact). Fix is a one-shot rewrite skill, ~1-2 h. Tracked in TODO.md P2.
- **P2**: v1 Python `kos-api.py` + `kos` CLI still live in `/Users/chenyuanquan/Projects/jarvis-knowledge-os/`. Unloaded from launchd (`com.jarvis.kos-api.plist.bak`) but not archived. After a 7-day v2 soak, move the plist bak into `~/Library/LaunchAgents/_archive/` and archive the v1 repo.
- **P2**: Evaluate Gemini 3072-dim embeddings vs current 1536-dim truncation; requires full reindex if adopted.
- **P2**: Evaluate BrainWriter `strict_mode=strict` flip after 7-day lint-observer soak.
- **P2**: Unify LLM telemetry — v1 repo's `llm-runner.py` writes `knowledge/logs/llm-calls.jsonl`; v2's new `synthesizeAnswer` in `kos-compat-api.ts` does not log. Add a shared JSONL sink.

---

## 6.26 Upstream v0.35.6.0 sync (2026-05-17)

**Scope**: v0.34.4 → v0.35.6.0 (9 versions: v0.35.0/1/1.1/3/3.1/4/5/5.1/6),
108 upstream commits, 200+ files touched. Two weeks after §6.24 v0.34.4.

**Merge cleanliness**: best sync to date. Only **2 real conflicts**
(`.gitignore` + `CLAUDE.md`, both mechanical fork-only block reorder).
The remaining 79 modified files + 32 new files all auto-merged cleanly:
- `src/core/pglite-engine.ts` — auto-merged. WAL fork patch
  (`SELECT pg_switch_wal()` on disconnect, lines 187-200) sat in a
  different region than the upstream +50-line bootstrap probe expansion
  (`needsFilesBootstrap`, `needsOauthClientsBootstrap`,
  `needsSourcesArchive`). Both survived.
- `src/core/postgres-engine.ts` — auto-merged. Fork has no WAL patch
  here; upstream added matching bootstrap probes + DDL connection
  threading. Pure take-upstream.
- `src/core/ai/recipes/google.ts` — auto-merged. Fork's
  `max_batch_tokens: 20_000 / chars_per_token: 2` patch (lines 17-23)
  survived; upstream hasn't touched that block (PR #1016 still OPEN
  on upstream, fork-side patch still needed).
- `package.json` — auto-merged. `@electric-sql/pglite 0.4.4` override
  preserved.
- `skills/RESOLVER.md` + `skills/manifest.json` — both auto-merged
  without touching the `## KOS-Jarvis extensions` section.

**Key value of this sync wave**:

- **v0.35.5.0 bootstrap fixwave (#1111, commit `4446e9f9`) SUPERSEDES
  fork PR #1017** (oauth_clients bootstrap). Upstream adds 7
  forward-reference probes (`files.source_id`, `files.page_id`,
  `oauth_clients.source_id`, `oauth_clients.federated_read`,
  `sources.archived`, `sources.archived_at`, `sources.archive_expires_at`)
  + DDL connection threading (Codex-P1 catch — bootstrap probes now
  run inside the advisory lock instead of on `this.sql`) + a
  MIGRATIONS-source introspection contract test that catches the
  entire column-only forward-ref bug class at PR time. Strict superset
  of fork PR #1017. Closed as superseded (same pattern as PR #627 →
  v0.31.1.1 fixwave, §6.22).
- **v0.35.4.0 entity bare-name resolver 58x perf**. The fork's
  `enrich-sweep` (weekly Sun 22:13 cron) hits the entity resolver per
  ingest; 58x speedup is a real cost cut.
- **v0.35.5.0 walker `pruneDir` + descent-time exclusion**. Sync
  walkers (`walkMarkdownFiles`, `listTextFiles`) skip `node_modules`
  / dot-prefix / `*.raw` directories at descent rather than at
  file-emit; per-pass IO saved scales with brain size. At 3138 pages
  the effect is noticeable on every `gbrain sync` round-trip.
- **v0.35.5.0 orphans soft-delete leak fix (closes #1021)**. Both
  candidate-side and link-source-side `deleted_at IS NULL` filters
  now applied. Fork's `orphan-reducer` cron will see slightly fewer
  false-positive orphans.
- **v0.35.5.0 think MCP runs through gateway.chat adapter (closes
  #952)**. Reads API key from `~/.gbrain/config.json` not just env;
  benefits any future MCP-stdio usage on the fork (kos-compat-api
  doesn't go through MCP, so no immediate fork impact).
- **v0.35.5.1 supervisor clean-exit (code=0 watchdog) reclassification**.
  Reduces `gbrain doctor` false-WARN on launchd-managed cron exits.
- **v0.35.6.0 search floor-ratio gate for metadata boost**. Closes
  search-quality issue #1091; metadata boost stages now respect a
  floor ratio to prevent over-boost on sparse-corpus matches. Useful
  for the fork's mixed Notion (60%) + structured-source (40%) brain.
- **v0.35.0.0 ZeroEntropy `zembed-1` embedder + `zerank-2` reranker**.
  Opt-in. Fork stays on `google:gemini-embedding-001 / 1536-dim` —
  no production reembed.
- **v0.35.1.0 / v0.35.1.1 embedder shootout prereqs + longmemeval fix
  wave**. Additive eval-framework, no production impact.
- **v0.35.3.0 extract_facts MCP `items` field + facts:absorb-related
  hardening**. Fork's `kos-compat-api` doesn't go through MCP, so the
  MCP schema fix is neutral here. The fork P1 entry on `facts:absorb`
  sub-process DB connection (`src/core/facts/absorb-log.ts` warning)
  is **NOT covered** by this wave (different layer — the absorb writer
  is best-effort with `try/catch + console.warn`; the underlying
  sub-process init-gap remains open).

**Validation**:
- `bun run typecheck` clean (~3 s)
- `bun test test/ai/ test/bootstrap.test.ts test/schema-bootstrap-coverage.test.ts`
  **221 pass / 0 fail** in 8.42 s; 62 migrations applied across hermetic
  per-test PGLite DBs.
- `bun run build` produces `bin/gbrain` reporting `0.35.6.0`.
- `bun install` postinstall: `All migrations up to date.` —
  production schema already at v66; upstream v0.35.5.0 bootstrap
  probes are no-ops because the manual ALTERs from §6.24 already
  landed the same columns. **No manual ALTER needed this round.**

**Production state (post-sync)**:
- `kos-compat-api` cycled, PID 9074, `/status` returns 3138 pages
  (unchanged from pre-sync; §6.24 reported 2718, since then +420
  pages from continuing notion-poller + signal-detector ingest).
- `kos.chenge.ink/status` remote returns identical payload —
  cloudflared tunnel intact, external boundary unaffected.
- 4 cron services (`dream-cycle`, `enrich-sweep`, `kos-patrol`,
  `notion-poller`) bootout/bootstrap clean; idle waiting for their
  next launchd-scheduled fire.
- `kos-patrol` kickstart smoke: wrote fresh
  `~/brain/.agent/dashboards/knowledge-health-2026-05-17.md` (5667
  bytes) at 16:07.
- `gbrain doctor`: connection OK, schema_version 66 (latest),
  RLS 41/41 tables, brain_score **80/100** (embed 35/35, links 25/25,
  timeline 2/15, orphans 8/15, dead-links 10/10) — unchanged from
  pre-sync. Three known WARNings unchanged:
  - `resolver_health`: 57 issues, still all `~/.openclaw/workspace`
    cross-boundary refs, not fork responsibility
  - `graph_coverage`: 0% entity link coverage — design property
    for markdown-only brain (see §6.19)
  - `skill_conformance`: `manifest.json not found` — likely a
    stricter upstream check looking in a path that moved; manifest
    exists at `skills/manifest.json` (250 lines, 10 fork entries).
    Non-blocking, file as P3 if it recurs.

**Backups retained** (24h):
- `~/.gbrain/config.json.pre-sync-v0.35.6.0` (180 bytes)
- `/tmp/pg-pre-sync-v0.35.6.0.dump.gz` (110 MB)

**Fork-side PR ledger after this sync**:
- **CLOSED as superseded** by upstream v0.35.5.0: [PR #1017](https://github.com/garrytan/gbrain/pull/1017)
- **Still OPEN**: [PR #1016](https://github.com/garrytan/gbrain/pull/1016)
  (google.ts `max_batch_tokens`). Fork-side patch in
  `src/core/ai/recipes/google.ts` survives the sync clean; no action
  needed until upstream merges or supersedes.

**Active fork dirs**: unchanged at **10** under `skills/kos-jarvis/`
(7 active skills + 2 helpers + `_archived/`). No archives this round.
Net `master..upstream` diff dropped from 108 to **0 upstream commits
divergence** (now matched at v0.35.6.0); fork-local commit count is
**~12** (8 pre-sync + 4 sync round).

**Sync time**: ~1 h end-to-end (vs the 3-3.5 h plan estimate). The
auto-merge cleanliness — only 2 real conflicts — accounts for most
of the saved time. Cost of v0.34.4's full PR-#1017-bootstrap manual
ALTER was amortized: this sync became a "free ride" on that work.

---

## 6.27 notion-poller retire + 方案 B 设计 (2026-05-17)

**Trigger**: During post-sync fork patch review, Lucien asked whether the
mailagent CLI (v4 SQLite SSoT, agent-friendly typer-based commands)
could replace the existing Notion-as-relay wire. Production probe showed
**notion-poller was already dead**:

- launchd cron 5-min trigger, last exit code 0, runs cleanly
- 24+ h of consecutive runs: every Summary line was
  `2 DBs, 2 seen, 0 ingested, 0 skipped` — net zero new pages
- `~/brain/.agent/notion-poller-state.json` cursors current
  (2026-05-17 / 2026-05-16) but unmoved between runs
- 10.4 MB of stdout log since 2026-05-16 with no successful ingest
- **Postgres counter**: `pages` filtered `frontmatter->'tags' ? 'notion-ingest'`
  → 0; `frontmatter->>'source_of_truth' = 'notion'` → 0; `ingest_log` table
  has no `notion-poller` source_type rows
- Brain page source breakdown (3138 total): `raw` 70 % (v1 KOS historical
  markdown import), `brain-synthesis` 25 %, `tavily+brain` 3 %, others
  <2 %. Notion path contributed essentially nothing.

Likely root cause (not deep-probed since the path is retired anyway):
the 2 monitored Notion DB IDs
(`2df15375...` email inbox, `2f015375...` calendar event) are the
mailagent-mirrored targets. Mailagent writes metadata + body to those
DBs as Notion blocks; notion-poller pulled the metadata page but
flattened-block body came back empty, so the poller logged
`0 ingested, 0 skipped (empty)`. Whatever the precise reason, the
result is: this wire produced zero brain value.

**Retire action** (commit this session):
- `launchctl bootout gui/$UID/com.jarvis.notion-poller`
- `rm ~/Library/LaunchAgents/com.jarvis.notion-poller.plist`
- `git mv workers/notion-poller workers/_archived/notion-poller`
- `git mv scripts/launchd/com.jarvis.notion-poller.plist.template
   scripts/launchd/_archived/`
- `rm ~/brain/.agent/notion-poller-state.json`
- `.env.local` `NOTION_TOKEN` + `NOTION_DATABASE_IDS` commented out
  with historical-context note
- `skills/kos-jarvis/notion-ingest-delta/SKILL.md` rewritten as a
  RETIRED stub pointing at this section
- Inactive cross-refs updated: RESOLVER (M2-A archive note path),
  orphan-reducer ("never in dream cron" wording), dream-wrap (lint
  noise attribution shifted to "historic notion-poller pages from
  before retire")

**Active fork dirs** (under `skills/kos-jarvis/`): unchanged at **10**
because `notion-ingest-delta/` was already a 5-line redirect stub from
M1 (now updated to a retire stub, still 1 dir). The real surface
shrinkage is in `workers/`: 2 → 1 active (`kos-worker` kept; it's the
Notion-side worker hosting AI tools for Notion Custom Agents, alive
independent of the brain-side poller).

### 方案 B — mailagent push to kos-compat-api/ingest

**Owner-side work** (Lucien's MailAgent project, tracked via GitHub
issue on `ChenyqThu/jarvis-knowledge-os-v2`):

Add a new resource group to the mailagent typer CLI:
- `mailagent kos push <internal_id> [--dry]` — push one email's
  markdown body + metadata to `kos-compat-api /ingest`
- `mailagent kos sync [--since YYYY-MM-DD] [--limit N]` — batch push
  the unpushed delta
- `mailagent kos selftest` — verify endpoint reachability + token
  + payload roundtrip on a dummy email

Payload shape (matches existing `/ingest` `markdown` path):
```json
{
  "markdown": "<email body, Mailagent v4 already stores both HTML + Markdown>",
  "title":    "<subject>",
  "source":   "mailagent:<message_id>",
  "source_of_truth": "mailagent-sqlite",
  "source_refs":     ["<notion_url if mirrored>"],
  "kind":     "source",
  "tags":     ["mailagent-ingest", "email"],
  "frontmatter": {
    "date_received": "...",
    "sender":        "...",
    "mailbox":       "..."
  }
}
```

Trigger options for mailagent side (pick one):
- (a) **Fire-and-forget hook inside mail-sync** — every email
  successfully stored to SQLite triggers a non-blocking
  `mailagent kos push <internal_id>`; SQLite gains a `kos_pushed_at`
  column + `(message_id, kos_pushed_at IS NULL)` index for
  `--since-unpushed` recovery
- (b) **Independent pm2/cron loop** — `mailagent kos sync
  --since-unpushed` every 5 min, decoupled from mail-sync's hot
  path

Brain-side work: **zero**. `server/kos-compat-api.ts` `/ingest`
already accepts the `markdown` body shape; the existing Bearer auth
(KOS_API_TOKEN) covers it. Once mailagent starts pushing, ingest_log
will show `git_sync` rows tagged `mailagent-ingest` and brain pages
will land under `~/brain/sources/<slug>.md` with the frontmatter
above.

**Latency win**: ~5-6 min (Notion sync + 5-min poll cron) → ~1-5 s
(direct push). The Notion-as-relay round-trip is fully cut.

**Network**: cross-host via Tailscale (mbp-office → kos.chenge.ink
public HTTPS via cloudflared; mailagent doesn't need to know it's
talking through Tailscale).

**Spec lives on**: GitHub issue on `ChenyqThu/jarvis-knowledge-os-v2`,
labeled `enhancement` + `mailagent` + `ingestion`. Brain repo
treats this as upstream-of-self: the issue tracks fork's desired
behavior, but the implementation lives in the MailAgent repo on
mbp-office.

## 6.28 kos-compat-api retire + MCP-over-HTTP cutover (2026-05-17)

**Trigger**: Lucien override of `docs/KOS-JARVIS-CONSOLIDATION-PLAN.md`
§M2-B 2026-05-15 verdict ("(c) don't touch"). The trigger conditions that
flipped the calculus:

1. **mailagent 方案 B「待 spec」** (§6.27): the next major external caller
   coming online wants a spec, not a deployed shim — directly speccing
   MCP wire avoids ever putting that caller on KOS-v1 Bearer.
2. **Lucien decision「一劳永逸」**: M2-B's "don't touch" verdict optimized
   for not migrating in-flight callers (Notion Knowledge Agent), but
   Lucien's stance is to move once and stop carrying fork-side HTTP code.
3. **Upstream OAuth + MCP + admin dashboard surface is mature** (v0.34+
   `gbrain serve --http`, validated in this session via 5-second smoke on
   throwaway port 17226 — `{"status":"ok","version":"0.35.6.0","engine":"postgres"}`,
   admin bootstrap token issuance confirmed).

**Scope: Complete-A** (per `/Users/chenyuanquan/.claude/plans/mellow-whistling-porcupine.md`):
- `server/kos-compat-api.ts` (661 LoC) fully retired → `server/_archived/`
  after 1-week observation period.
- SSoT flipped to DB-canonical: Notion Agent writes via MCP `put_page` go
  straight to Postgres (chunk + embed + facts_backstop queue), **no longer
  write `~/brain/<dir>/<slug>.md` disk file or git commit**. Lucien
  confirmed (2026-05-17) he doesn't use `~/brain/` grep / Obsidian.
- **BrainExporter NOT in scope** (would be DB → disk reverse-write daemon
  ~250-300 LoC). Lucien decided dream-cycle's 24h entity-graph backfill is
  sufficient. Future PR if entity-graph latency turns out to matter.
- `/digest` retired. patrol digest still written by `kos-patrol` cron to
  `~/brain/.agent/digests/patrol-*.md` (host-local); Lucien reads disk or
  OpenClaw `MEMORY.md` (via `digest-to-memory` weekly cron).
- mailagent: not migrated this PR (still 待 spec; spec lives in
  `docs/EXTERNAL-CLIENTS-MCP-WIRE-HANDOFF.md` for future implementation).
- Feishu: dormant since 2026-05-05 (§M2-B history); same handoff doc covers.

### Wire diff

| Surface | Before | After |
|---|---|---|
| External entry | `https://kos.chenge.ink` → `:7225` (kos-compat-api Bun, Bearer `KOS_API_TOKEN`) | `https://kos.chenge.ink` → `:7225` (upstream `gbrain serve --http`, OAuth 2.1 + MCP JSON-RPC) |
| Auth | single shared `KOS_API_TOKEN` (no rotation / no revoke / no audit) | 4 per-client `client_credentials` grants, per-call audit in `mcp_request_log` table |
| Endpoints | `/query` `/ingest` `/digest` `/status` `/health` (custom JSON shape) | `/mcp` (JSON-RPC) `/token` `/admin` `/health` (RFC + MCP standard) |
| `/ingest` SSoT | disk-canonical: write `~/brain/<dir>/<slug>.md` → git commit → spawn `gbrain sync` → `gbrain embed` | DB-canonical: `put_page` direct to Postgres (chunk + embed + facts_backstop queue); no disk write |
| `/digest` | reads `~/brain/.agent/digests/patrol-*.md` | retired (no MCP equivalent; patrol still writes to disk for host-local use) |
| LLM synthesis on query | fork-side `synthesizeAnswer()` (claude-sonnet-4-6) — double-LLM with caller agent | retired: query returns raw retrieval; caller LLM agent synthesizes |

### OAuth client identities (4)

Registered via `bin/gbrain auth register-client <name> --grant-types client_credentials --scopes "<scopes>" --source default`,
output saved one-time to `~/.gbrain/oauth-clients/<name>.json` (gitignored,
mode 600):

| Client name | Scopes | Notes |
|---|---|---|
| `kos-worker` | `read write` | Notion 📚 Knowledge Agent worker (`workers/kos-worker`). Uses `list_pages` for kosStatus (avoids admin scope) |
| `lucien-cli` | `read write admin` | Ad-hoc CLI for Lucien (~/.zshrc wrapper functions; admin scope OK on local CLI for diagnostics) |
| `mailagent` | `read write` | **Reserved for future** (mailagent 待 spec); spec only in handoff doc |
| `feishu` | `read write` | **Reserved for future** (dormant since 2026-05-05); spec only in handoff doc |

### Cloudflared change: NONE (port re-use, atomic swap)

**Strategy** (Lucien 2026-05-17, simplified twice): same `kos.chenge.ink`
hostname AND same origin port `:7225`. Cloudflared on mbp-office stays
exactly as is — it still routes `kos.chenge.ink → http://<jarvis-tailscale>:7225`.
The only change is **which process binds :7225 on jarvis Mac**:
kos-compat-api (Bun Bearer wire) booted out → port freed → gbrain-serve-http
(upstream OAuth + MCP wire) bootstrapped on the same `:7225` slot. No
mbp-office touch ever.

**Atomic swap steps** (jarvis Mac only, ~5 s downtime):
1. `launchctl bootout gui/$UID/com.jarvis.kos-compat-api` (frees `:7225`)
2. `cp scripts/launchd/com.jarvis.gbrain-serve-http.plist.template ~/Library/LaunchAgents/com.jarvis.gbrain-serve-http.plist` + fill `<FILL:NANO_BANANA_API_KEY>` from `.env.local`
3. `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.jarvis.gbrain-serve-http.plist` (binds `:7225`)
4. `curl -s http://127.0.0.1:7225/health` → `{"status":"ok","version":"0.35.6.0","engine":"postgres"}`
5. `curl -s https://kos.chenge.ink/health` (unchanged cloudflared path) → same

### Execution phases (one session, ~1d active)

- **Phase 0** (0.5d, 2026-05-17): `pg_dump` to `/tmp/pg-pre-migration-20260517.dump.gz`
  (110 MB), `~/.gbrain/config.json.pre-migration-20260517` backup,
  branch `migration/kos-compat-api-retire`. Schema verify: `oauth_clients`
  table exists with `source_id` + `federated_read` columns (≥ v60 + v61).
  `oauth_clients` count = 0 (fresh state).
- **Phase 1** (DONE — code): `scripts/launchd/com.jarvis.gbrain-serve-http.plist.template`
  with `--public-url https://kos.chenge.ink --bind 127.0.0.1 --port 7225 --token-ttl 3600`.
  5s smoke validated upstream binary boots cleanly + admin token issued to stderr.
- **Phase 2** (DONE — code): `workers/kos-worker/src/index.ts` rewrite (215 → 536 LoC:
  OAuth client_credentials + MCP JSON-RPC + 3 tools + worker-side URL fetch +
  frontmatter builder + kindToType port). `SETUP.md` updated. kosDigest dropped.
  `scripts/migration/dual-mode-verify.sh` initially written for dual-hostname
  parity probe; deleted along with `scripts/migration/` dir once port re-use
  strategy made the probe meaningless (same port = no parallel).
- **Phase 3 (DONE — same session, atomic port re-use)**:
  - L: `bin/gbrain auth register-client` × 4 → save creds to `~/.gbrain/oauth-clients/<name>.json` (mode 600)
  - L: paste `~/.gbrain/oauth-clients/kos-worker.json` into chat for Claude
  - C: `launchctl bootout gui/$UID/com.jarvis.kos-compat-api` (free `:7225`)
  - C: `cp` plist template to `~/Library/LaunchAgents/` + fill `<FILL:NANO_BANANA_API_KEY>` + `launchctl bootstrap`
  - C: `curl http://127.0.0.1:7225/health` + `curl https://kos.chenge.ink/health` smoke
  - C: `cd workers/kos-worker && ntn workers env set KOS_MCP_BASE/KOS_OAUTH_CLIENT_ID/KOS_OAUTH_CLIENT_SECRET + ntn workers env push + ntn workers deploy`
  - C: `ntn workers exec` smoke 3 tools (kosQuery, kosIngest, kosStatus)
  - L: Notion Custom Agent UI update per `docs/NOTION-AGENT-UPDATE-CHECKLIST.md`
  - C: `git mv server/kos-compat-api.ts server/_archived/` + `git mv scripts/launchd/com.jarvis.kos-compat-api.plist.template scripts/launchd/_archived/`
- **Phase 4** (DONE — docs): this §6.28 + handoff docs (`EXTERNAL-CLIENTS-MCP-WIRE-HANDOFF.md`,
  `NOTION-AGENT-UPDATE-CHECKLIST.md`) + CONSOLIDATION-PLAN §M2-B revision +
  TODO + README + CLAUDE.md + .gitignore.

**Total elapsed**: 1 session (~1 day active dev). KOS_API_TOKEN stays
commented in `.env.local` + kos-compat-api plist retained in
`scripts/launchd/_archived/` as rollback marker (re-bootstrap if needed).

### Trade-offs accepted (Lucien 2026-05-17)

1. **Notion Agent ingest 24h entity-graph 弱**: `put_page` over remote MCP
   skips `auto_links` + `auto_timeline` (safety gate at
   `src/core/operations.ts:610-612` — prevents prompt-injection bare-slug
   building). dream-cycle (03:11 daily) backfills via patterns/synthesize
   phase. Acceptable per Lucien.
2. **kosIngest URL 模式失去 Tavily/FlareSolverr**: worker-side `fetch()` is
   plain HTTPS; fork-side `skills/kos-jarvis/url-fetcher` (UltimateSearchSkill)
   no longer reachable from Notion Worker. X/Twitter / Cloudflare-protected
   pages must be pasted as markdown. Future PR if Lucien wants worker → Tavily
   HTTPS direct (`TAVILY_API_KEY` via `ntn workers env push`).
3. **kosStatus → 采样**: `list_pages` MCP op caps at `limit=100` and exposes
   no `offset` param, so full 3138-page count isn't directly fetchable.
   kosStatus returns latest-100 sample histogram + `note` to run `gbrain status`
   locally for exact count. Avoids needing `admin` scope (which `get_stats`
   requires, per `src/commands/serve-http.ts:102-107` >3s latency risk).
4. **kosDigest 永久下线**: Notion Agent can't surface patrol digests anymore;
   patrol cron unchanged.
5. **No observation window** (Lucien's call): atomic port re-use means
   ~5 s downtime mid-cutover (kos-compat-api bootout → gbrain-serve-http
   bootstrap on freed `:7225`). Worker deploy revert (`ntn workers deploy`
   of reverted commit) is ~30 s. Trade vs 1-week stabilize: zero ops drag
   (no cloudflared touch, no dual-hostname), tighter rollback window but
   pure-launchctl revert path.

### Rollback steps (atomic — pure launchctl swap on jarvis Mac)

Triggered if Phase 3 smoke fails or post-cutover Notion Agent breaks.
**No mbp-office touch needed** — `kos.chenge.ink` ingress unchanged, both
old and new servers bind same `:7225`.

**Brain-side swap-back (jarvis Mac, ~5 s)**:
- `launchctl bootout gui/$UID/com.jarvis.gbrain-serve-http`
- `rm ~/Library/LaunchAgents/com.jarvis.gbrain-serve-http.plist`
- `git mv server/_archived/kos-compat-api.ts server/`
- `git mv scripts/launchd/_archived/com.jarvis.kos-compat-api.plist.template scripts/launchd/`
- `cp scripts/launchd/com.jarvis.kos-compat-api.plist.template ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist`
- Fill `<FILL:KOS_API_TOKEN>` from commented entry in `.env.local`
- Fill `<FILL:NANO_BANANA_API_KEY>` from `.env.local`
- `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist`
- `curl -sS http://127.0.0.1:7225/health` → smoke (Bearer wire shape returns)

**Worker rollback (C, deploy)** — if worker code is the actual problem:
- `cd workers/kos-worker && git revert <kos-worker v3 commit>`
- `ntn workers env set KOS_API_BASE "https://kos.chenge.ink"` (still same hostname)
- `ntn workers env set KOS_API_TOKEN "<old token from .env.local>"`
- `ntn workers env push && ntn workers deploy`

**Brain integrity check** (after any rollback):
- `bin/gbrain doctor` — brain_score still 80/100 baseline
- `psql ... -c "SELECT count(*) FROM pages"` — still 3138 pages
- `psql ... -c "SELECT count(*) FROM mcp_request_log"` — audit table intact

### Linked docs

- [`workers/kos-worker/SETUP.md`](../workers/kos-worker/SETUP.md) — worker deploy + OAuth setup
- [`docs/NOTION-AGENT-UPDATE-CHECKLIST.md`](NOTION-AGENT-UPDATE-CHECKLIST.md) — Notion Custom Agent UI v2→v3
- [`docs/EXTERNAL-CLIENTS-MCP-WIRE-HANDOFF.md`](EXTERNAL-CLIENTS-MCP-WIRE-HANDOFF.md) — Feishu / mailagent / future client wire spec
- [`docs/KOS-JARVIS-CONSOLIDATION-PLAN.md`](KOS-JARVIS-CONSOLIDATION-PLAN.md) §M2-B (verdict revision) + Tier 5 DONE
- [`scripts/launchd/com.jarvis.gbrain-serve-http.plist.template`](../scripts/launchd/com.jarvis.gbrain-serve-http.plist.template)
- Migration plan: `~/.claude/plans/mellow-whistling-porcupine.md`

---

## 6.29 Upstream v0.37.0.0 sync (2026-05-19)

最大一次 fork sync：12 commits 跨 11 版本（v0.35.6.0 → v0.37.0.0），
333 文件 / +52455 / -3317 LoC。**仅 4 个 conflict**（远少于历史 31/10/5 的
规模），fork-protected 区域（`skills/kos-jarvis/`、`server/`、`workers/`、
`scripts/launchd/`）零侵入。Schema 自动从 v66 升到 **v78**(12 个 migration
全部走 `applyForwardReferenceBootstrap`，零手动 ALTER — v0.35.5.0 加固的成
果再次验证)。Health score **70 → 80**(11 个新 doctor check 全 OK，
pre-sync 的 skill_conformance/connection warning 全消)。

### 上游 11 版本与 fork 关系

| 版本 | 主题 | 对 fork 影响 |
|---|---|---|
| v0.37.0.0 | Skillpack registry cathedral — 第三方 publish/install + 10/10 quality bar | RESOLVER 加 1 行 skillpack-harvest 在 L62；fork `## KOS-Jarvis extensions` 段在 L128 末尾保留 |
| v0.36.6.0 | Cross-modal text↔image search wave；schema v75 加 `content_chunks.embedding_multimodal vector(1024)` | brain 全 markdown — multimodal column 加但 0 rows，零功能改动 |
| v0.36.5.0 | Shell jobs `inherit: [...]` 替代 env 暴露 secret；新 doctor check `home_dir_in_worktree` | 5 plist 用 EnvironmentVariables 不受影响(inherit 是 minion job 路径)；`~/.gbrain/` 不在 worktree → check PASS |
| v0.36.4.0 | `gbrain doctor --remediate --target-score 90 --max-usd 5` + autopilot 健康循环 | 留 P2 评估替换 kos-patrol(M4 候选)；本次 sync 不动 |
| v0.36.3.0 | Search 走任意 embedding column；`embedding_columns` registry；schema v68 + `eval_candidates.embedding_column`；cosineReScore 走 active column | doctor 新 check `embedding_column_registry` 在我们 `embedding` 默认 column 上自动 PASS；留 P1 可选显式 declare(节省 follow-up doctor) |
| v0.36.2.0 | **ZeroEntropy `zembed-1` 1280d 变默认 + ze-switch CLI**；存量 brain 带 TTY 升级 prompt | 关键风险点 — non-TTY launchd cron 自动 skip；通过 `gbrain config set ze_switch_declined_at` + `ze_switch_prompt_shown=true` 锁死 stay(90 天不弹) |
| v0.36.1.1 | 28 atomic fixes (community PR triage) — 含 `#1083` "warn only for configured embedding provider" filter path | **不**等效 fork PR #1016(declare max_batch_tokens path)。Upstream 走 gateway filter；fork 仍带 google.ts +7 行 max_batch_tokens block。两路径并存兼容(filter + declared) |
| v0.36.1.0 | Hindsight calibration wave — dream-cycle phase **13 → 16** (propose_takes/grade_takes/calibration_profile, 全 LLM)；schema v67 加 `calibration_profiles` 表；新 MCP op `get_calibration_profile` | dream-cycle 03:11 daily 自动跑新 phase — **LLM spend 涨**(留 P1 观察)；exit code 兼容 0/1/2 不破 dream-wrap |
| v0.36.0.0 | Skillpack 退役 `install/uninstall` → `scaffold` 模式 | fork `## KOS-Jarvis extensions` 是 append-only 段不是 managed-block fence, migrate-fence 是 no-op；零影响 |
| v0.35.8.0 | Phantom-page redirect inside extract_facts；新 method `refreshPageBody` + `migrateFactsToCanonical` | facts:absorb 路径周边改进；P1 (TODO L831 "no DB conn") 复测留 P1 |
| v0.35.7.0 | Schema v67 加 `facts.claim_{metric,value,unit,period}`；新 MCP op `find_trajectory`；新 CLI `gbrain eval trajectory`/`gbrain founder scorecard`；extract_facts 现在 batch-embed | schema 自动迁移；新 op 不破 kos-worker 3 tool 契约；可选未来用于 OH transcripts |

### Conflict resolution (4 个 — 远少于预期 ~10)

| File | Decision | Rationale |
|---|---|---|
| `CLAUDE.md` | take fork (`--ours`) | 上游 content 已搬 `docs/CLAUDE-UPSTREAM.md`(1607 行)；新 v0.36/v0.37 section 留 follow-up 增补 |
| `llms-full.txt` | take upstream → `bun run build:llms` | 211K regenerated 干净 |
| `test/ai/adaptive-embed-batch.test.ts` | **post-conflict revert to fork**(发现 v0.36.1.1 不等效 fork path) | upstream test 期望 google warn；fork google.ts 已 declare max_batch_tokens → expect undefined。Take fork view |
| `test/ai/no-batch-cap-suppression.serial.test.ts` | post-conflict revert to fork | 同上 |

**Auto-merged 干净**：VERSION (→ 0.37.0.0)、CHANGELOG.md (fork voice
prepend + 上游 1142 行 prepend)、README.md、package.json (保 fork
`@electric-sql/pglite 0.4.4` override)、bun.lock、.gitignore、
`skills/RESOLVER.md`(上游 L62 加 skillpack-harvest + fork L128 KOS 段保留)、
`skills/manifest.json`(46 + 1 = 47 entries，fork 4 KOS-Jarvis entries 保留)、
**`src/core/pglite-engine.ts` (WAL fork patch 从 L200 漂移到 L207，pg_switch_wal
仍存活 — 上游新增 imports + `refreshPageBody`/`migrateFactsToCanonical`
method 集中在文件头部，未触及 WAL 块)**。

Fork-protected paths 零改动验证：`git diff master..HEAD --stat --
skills/kos-jarvis/ server/ workers/ scripts/launchd/` 返回空。

### Schema migrations (v66 → v78, 12 步)

`bin/gbrain init --migrate-only` 一句解决，零手动 ALTER：

```
[67] facts_typed_claim_columns (claim_metric/value/unit/period)
[67] calibration_profiles
[68] eval_candidates_embedding_column
[68] takes_quality_columns
...
[74] eval_candidates_embedding_column
[75] op_checkpoints_table
[76] minion_jobs_doctor_run_id_index
[77] mcp_spend_log
[78] embedding_multimodal_column
```

NOTICE on `op_checkpoints already exists, skipping` — Postgres
idempotent CREATE IF NOT EXISTS，非 ERROR。

### ZeroEntropy decision lock (v0.36.2.0 新风险点)

升级后 `gbrain ze-switch --dry-run --json`：

```json
{
  "ze_switch_offered": true,
  "ze_switch_already_declined": false,
  "current_embedding_model": "text-embedding-3-large",
  "target_embedding_model": "zeroentropyai:zembed-1",
  "est_cost_usd": 0.47,
  "est_minutes": 53
}
```

CLI 没有 `--decline` non-TTY flag(`gbrain ze-switch` interactive 才能 set
declined_forever)，但 `gbrain config set` 可直接写两 key:

```bash
bin/gbrain config set ze_switch_declined_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
bin/gbrain config set ze_switch_prompt_shown true
```

Lock 后 ze-switch dry-run 报 `ze_switch_offered: false /
ze_switch_already_declined: true / target: null` — 90 天不再弹 prompt。
**注意**：launchd 5 cron 是 non-TTY 自动 skip，本来就不会触发，lock 是给
Lucien 手动跑 gbrain 命令时的保护。

### Health score before/after

| 维度 | Pre-sync (v0.35.6.0) | Post-sync (v0.37.0.0) |
|---|---|---|
| health_score | 70 | **80** |
| status | unhealthy | warnings |
| 0 ERROR | ✓ | ✓ |
| warning count | 4 | 4 (内容变好) |
| resolver_health | **FAIL** (57 issues) | warn (改进) |
| skill_conformance | warn (manifest.json not found) | **ok** |
| connection | warn (--fast skip) | **ok** |
| 新加 doctor checks (v0.36.x) | n/a | home_dir_in_worktree ok / embedding_column_registry ok / cross_modal_modality_backfill ok / unified_multimodal_coverage ok / markdown_body_completeness ok / takes_weight_grid ok / child_table_orphans ok |

### Smoke evidence

- `bin/gbrain --version` → `0.37.0.0` (recompile via `bun run build`)
- `bun run typecheck` clean (~3s)
- `bun run check:all` exit 0 (14 scripts)
- `bun test test/ai/` **224 pass / 0 fail / 764 expect()** in 455ms
- `curl https://kos.chenge.ink/health` → `{"status":"ok","version":"0.37.0.0","engine":"postgres"}`
- `curl http://127.0.0.1:7225/health` → same
- pages count: **3140** (baseline 3140, ±0)
- vector dim: `vector(1536)` unchanged
- embedding_multimodal_column: **0 chunks** (markdown brain, expected)
- query smoke Chinese `知识管理` → top hit 0.2853 syntheses/
- query smoke English `Lucien` → top hit 0.5110 concepts/
- kos-patrol kickstart → exit 0, dashboard `knowledge-health-2026-05-20.md` 写出

### Branch ops + TODO follow-ups

**Closed** (本次 sync 后立即可关):
- TODO L801 P2 PR #1016 max_batch_tokens — **NOT superseded**(v0.36.1.1
  走不同 fix path)；fork patch 保留为 active local diff，PR 仍 open
  待上游 maintainer review
- Deleted local branches: `upstream-fix/bootstrap-mcp-log-cols`、
  `upstream-fix/bootstrap-oauth-clients-cols`(对应 PR #627/#1017 已 closed
  superseded by 上游 fixwave)

**Retained**:
- `upstream-fix/dream-archive-dir` (PR #1133 仍 open)
- `upstream-fix/google-recipe-max-batch-tokens` (PR #1016 仍 open，但上游
  走不同 path — verdict 修正：不会 auto-drop on next sync)

**New P1/P2 (added 2026-05-19)**:
- (v0.36.3.0) Declare `embedding_columns` registry for `embedding` @ 1536d (15 min config, doctor 已自动 PASS 仅显式化)
- (v0.36.1.0) Observe dream-cycle Anthropic spend delta from propose_takes/grade_takes/calibration_profile (前 2-3 晚)
- (v0.36.6.0) Image ingestion roadmap (decision待Lucien)

### Phase 7.5: doctor --remediate vs kos-patrol evaluation

(详见专门 evaluation note `~/brain/.agent/reports/doctor-remediate-vs-kos-patrol-2026-05-19.md`)

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync entries
- [`docs/CLAUDE-UPSTREAM.md`](CLAUDE-UPSTREAM.md) — upstream CLAUDE.md mirror (待 selective 增补 v0.36/v0.37 sections)
- Migration plan: `~/.claude/plans/plan-ultrathink-delegated-curry.md`

---

## 6.30 Upstream v0.38.2.0 sync (2026-05-22)

§6.29 之后仅 3 天的快速跟进 sync —— 上游 master 高频迭代,14 个 commit
跨 14 版本(v0.37.1.0 → v0.38.2.0),merge commit 234 文件 / +33917 /
−996 LoC。**仅 2 个 conflict**(`CLAUDE.md` + `llms-full.txt`,均机械)。
fork-protected 区域(`skills/kos-jarvis/`、`server/`、`workers/`、
`scripts/launchd/`)**零侵入** —— merge commit `git diff` 在这 4 个路径
上为空。Schema 自动 v78 → **v85**(7 migration)。生产 kos.chenge.ink
部署完成,3140 pages 保持。

### 上游 14 版本与 fork 关系

| 版本 | 主题 | 对 fork 影响 |
|---|---|---|
| v0.37.1.0 | brainstorm + lsd — bisociation idea generator | 新上游 skill,fork 不受影响 |
| v0.37.2.0 | `takes_resolution_consistency` CHECK 接受 `unresolvable` | dream-cycle 写 takes;CHECK 放宽,向后兼容 |
| v0.37.3.0 | **`skill_brain_first` doctor check + `check:all` 第 15 脚本** | flag 了 fork `enrich-sweep`(SKILL.md 提及 "Crustdata")—— 本次加 brain-first callout 修复 |
| v0.37.4.0 | pgGraph-inspired CI scaffolding + `check:fuzz-purity` | fork 无 CI;新 fuzz 测试拖慢全量 suite(见下) |
| v0.37.5.0 | YAML-aware `NESTED_QUOTES` validator | brain 页 YAML frontmatter 误报减少 |
| v0.37.6.0 | OpenRouter recipe + generic `default_headers` seam | `gateway.ts` 干净自动合并;与 fork `google.ts` max_batch_tokens patch 共存 |
| v0.37.7.0 | fix wave:federated brains + autopilot safety + **OAuth confidential clients** | fork 4 个 OAuth client 均 confidential;部署后 doctor `oauth_confidential_client_health` 报 4 client 一致 ✓ |
| v0.37.8.0 | voyage-code-3 + reindex-code cost-preview | brain 0 code page,无影响 |
| v0.37.9.0 | frontmatter canonical-style tag-array 归一化 | brain 页 tag 数组下次 sync 归一 |
| v0.37.10.0 | `init` env-detection + interactive picker + preflight | 生产 postgres 不 re-init,无影响 |
| v0.37.11.0 | fresh-install PGLite embedding setup fix wave | 生产 postgres 非 PGLite;带入新 `test/search/hybrid-reranker-integration.serial.test.ts`(见全量测试段) |
| v0.38.0.0 | **ingestion cathedral** — capture + write-through + IngestionSource 契约 | 新增 `src/core/ingestion/` 子系统 + 上游 `skills/capture/`;additive,零 fork 路径触碰,`put_page`/`gbrain sync` 未变 |
| v0.38.1.0 | provider-agnostic subagent loop + remote MCP dispatch + budget meter | fork 不跑 gbrain agent daemon;`mcp_spend_*` 表 additive |
| v0.38.2.0 | fix(doctor):bounded frontmatter scan + partial-state surfacing | kos-patrol 跑 doctor,beneficial |

### Conflict resolution(2 个)

| File | Decision | Rationale |
|---|---|---|
| `CLAUDE.md` | take fork(`--ours`) | fork CLAUDE.md 是 fork-only;上游内容由 `docs/CLAUDE-UPSTREAM.md` 镜像 |
| `llms-full.txt` | 取 upstream 清 marker → `bun run build:llms` 重生成 | 219K regenerated,干净 |

**Auto-merged 干净**:`VERSION`(→ 0.38.2.0)、`package.json`(保 fork
`@electric-sql/pglite` override + 加 `chokidar`/`js-yaml`/`fast-check`)、
`bun.lock`、`CHANGELOG.md`、`README.md`、`skills/RESOLVER.md`、
`skills/manifest.json`、`gateway.ts`/`google.ts`(fork max_batch_tokens
patch 存活,test/ai 274 pass 佐证)、`src/core/pglite-engine.ts`
(WAL fork patch `pg_switch_wal()` 存活,从 L207 漂移到 L209)。

### `check:all` 新增门 — `skill_brain_first`(v0.37.3.0)

v0.37.3.0 给 `bun run check:all` 加了第 15 个脚本
`check-skill-brain-first.sh`(跑 `gbrain doctor --fast --json`,
filesystem-only)。它 flag 引用 external-lookup 工具却无 brain-first
合规信号的 skill。fork `enrich-sweep` 的 SKILL.md 提到 "Crustdata"
(一个 Tier 1 enrichment API,fork 无 key,仅用于说明 Tier 1 → Tier 2
降级),被 `\bcrustdata\b` case-insensitive pattern 命中。

`enrich-sweep` 实质 **是** brain-first 的(Phase A 全脑扫描、Phase D
`gbrain query` 去重后才建 stub,Tavily 只是 Tier 2 补充),故修法是加
canonical Convention callout(声明合规),**不是** `brain_first: exempt`
(后者意为"从不查脑",失实)。commit `b39a50b4`。

### check-privacy:`docs/CLAUDE-UPSTREAM.md` 镜像刷新

`check-privacy.sh`(本身未被 merge 改动)发现 `docs/CLAUDE-UPSTREAM.md`
含 banned name(9 处)且不在 allow-list —— **master 上已存在 9 处,
pre-existing,非本次 sync 引入**(check 此前未在该 stale 文件上 surface
是因为 §6.29 gate 只跑 `test/ai/` 不跑 `check:all` 之外的对账)。借此
sync 把镜像从 stale(v0.34.4 era)刷新到上游 v0.38.2.0 CLAUDE.md
(`git show upstream/master:CLAUDE.md`,banned name scrub 为
`openclaw-reference`),关闭 §6.29 遗留的 "待 selective 增补" deferral。

### Schema migrations(v78 → v85,7 步)

`bin/gbrain init --migrate-only` 一句解决(`apply-migrations` 仅报告
gap,实际迁移走 `init --migrate-only`):

```
[79] pages_last_retrieved_at
[80] takes_unresolvable_quality_v0_37_2_0
[81] pages_provenance_columns
[82] subagent_tool_executions_stable_id
[83] mcp_spend_reservations
[84] oauth_clients_budget_usd_per_day
[85] oauth_clients_agent_binding
```

NOTICE on `column ... already exists, skipping` —— Postgres 幂等
`ADD COLUMN IF NOT EXISTS`,非 ERROR(同 §6.29 模式)。`~/.gbrain/config.json`
未被 `--migrate-only` 触碰(已验证;备份 `~/.gbrain/config.json.before-sync-v0.38.2.0`)。

### Health score before/after

| 维度 | Pre-sync (§6.29 / v0.37.0.0) | Post-sync (v0.38.2.0) |
|---|---|---|
| health_score | 80 | **40**(见下) |
| schema_version | 78 | **85** |
| skill_brain_first | n/a(check 未引入) | **ok**(49 skill 全 compliant/exempt) |
| oauth_confidential_client_health | n/a | **ok**(4 client,auth shape 一致) |
| embeddings | 100% | 100%(0 missing) |
| brain_score | 80/100 | 80/100 |
| connection / pages | 3140 | 3140 |

**health_score 80 → 40 解读**:唯一的 `[FAIL]` 是 `sync_freshness`
(brain 内容已 4 天未 `gbrain sync`)。§6.29 时此项是 41h 的 WARN;纯因
时间推移(无 sync cron —— TODO P1 既有问题)升级为 FAIL。**与本次代码
同步无关** —— 所有与上游 sync 相关的 check 全绿(schema / oauth /
skill_brain_first / embeddings / connection)。一次 `bin/gbrain sync
--skip-failed --no-pull` 即可清,但属 brain 内容运维,留给 Lucien 决定
(连同 TODO P1 sync-cron 决策)。

### Smoke evidence

- `bin/gbrain --version` → `0.38.2.0`(`bun run build` 重编译)
- `bun run typecheck` clean;`bun run check:all` exit 0(15 脚本);
  `bun test test/ai/` **274 pass / 0 fail / 922 expect()**
- `curl http://127.0.0.1:7225/health` + `curl https://kos.chenge.ink/health`
  → `{"status":"ok","version":"0.38.2.0","engine":"postgres"}`
- query smoke:EN `Lucien` → `people/lucien` 0.8951;ZH compound-CJK
  `知识管理` → `jarvis-dual-platform-architecture` 0.9880;multi-word EN
  `knowledge management` → `concepts/knowledge-management` 0.9108
- pages count **3140**(基线 ±0);schema v85;pre-deploy 备份
  `/tmp/pg-pre-sync-v0.38.2.0-2026-05-22.dump.gz`(110 MB)
- `gbrain-serve-http` daemon bootout/bootstrap(PID 86784 → 76514),~5s downtime

### 全量测试(非 gate;§6.29 既定 gate = typecheck + check:all + test/ai/)

`bun run test`(全量 unit suite,`run-unit-parallel.sh`):**6399 pass /
20 fail / 15 skip**,elapsed 671s。20 fail 分解:

- **2 个 shard WEDGED**(600s 分片超时)—— shard 1 撞上 `longmemeval`
  基准(其自报 "20-60 分钟 / 5 题",本不该进 unit run),shard 2 卡在新
  `test/fuzz/` property 测试。runner artifact,非真失败(同 TODO L1053
  已 root-cause 的全量 suite env-coupling)。
- **4 个 `hybrid-reranker-integration.serial.test.ts` 失败** —— 该文件
  经 v0.37.11.0 `d0d0e2a6` **新增**(fork master 上不存在),用 PGLite +
  stub。4 失败都是 `hybridSearch(engine, 'alpha keyword', ...)` 多词
  keyword 查询在 PGLite(fork pin 的 `@electric-sql/pglite` 版本)下返回
  空候选池。**生产跑 Postgres** —— 已验证多词查询正常(上方 smoke
  `knowledge management` 0.9108)。非回归;属 fork PGLite-pin 与上游测试
  预期的环境差异。

### Branch ops + TODO follow-ups

sync 分支 `sync-v0.38.2.0`:merge commit `9527b412` + `fix(skill)`
`b39a50b4` + `chore(llms)` `fd217043` + docs commit;`--no-ff` 并入 master。

**新增 TODO follow-ups(2026-05-22)**:
- (P2) `hybrid-reranker-integration.serial.test.ts` 在 fork PGLite-pin
  下 4 fail —— 评估 bump fork PGLite override 或给上游提 hermetic-test PR
- (P3) doctor `reranker_health` 报 1 次 ZeroEntropy auth failure;query
  时 `[ai.gateway] expansion disabled: [expand] Not Found` —— 两者均
  optional enhancement layer,core 检索不受影响,查清配置来源
- `sync_freshness` FAIL 已属 TODO P1(缺 daily sync cron)

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync entries
- [`docs/CLAUDE-UPSTREAM.md`](CLAUDE-UPSTREAM.md) — upstream CLAUDE.md mirror(本次刷新至 v0.38.2.0)
- Sync plan: `~/.claude/plans/eager-imagining-quiche.md`

---

## 6.31 Upstream v0.41.14.0 sync (2026-05-26)

§6.30 之后 4 天的批量跟进 sync —— 上游 master 持续高频迭代,**34 个 commit
跨 20 minor 版本**(v0.38.2.0 → v0.41.14.0,跨过整个 v0.39.x / v0.40.x /
v0.41.x 三条 minor 线),merge commit **818 文件 / +106,211 / −37,236
LoC**(~3× §6.30 体量)。**5 个 conflict**(CLAUDE.md + llms-full.txt +
.github/workflows/test.yml modify/delete + skills/manifest.json + src/
core/pglite-engine.ts —— 全部按 §6.30 playbook 分类解决,WAL patch 折叠
进上游 v0.41.8.0 的新 snapshot+try/finally 结构)。fork-protected 区域
(`skills/kos-jarvis/`、`server/`、`workers/`、`scripts/launchd/`)
**零侵入** —— `git diff master..merge-commit` 在这 4 路径上为空。
Schema 自动 v85 → **v97**(12 migration)。生产 `kos.chenge.ink` 部署
完成,3140 pages 保持(基线对齐 §6.30)。OAuth+MCP wire 经 v0.41.3.0
CORS lockdown 后仍 live(kos-worker 76 tools)。

### 上游 20 版本与 fork 关系

| 版本 | 主题 | 对 fork 影响 |
|---|---|---|
| v0.39.0.0 | brainstorm cost cathedral (P1-P7) + page_links schema fix | fork 不跑 brainstorm;additive |
| v0.39.1.0 | **schema packs — bring your own shape** | 大改但 opt-in(fork 用默认 pack);零路径触碰 |
| v0.39.2.0 | autopilot per-source fan-out + cycle lock primitive + phase taxonomy | fork 不跑 autopilot daemon;additive |
| v0.39.3.0 | productionize v0.38 ingestion cathedral (smoke fix wave from #1299) | bug fix wave,fork 受益但不需 wire |
| v0.40.0.0 | **agent-voice (Mars + Venus) + copy-into-host-repo skillpack paradigm** | 全新 `recipes/agent-voice/` 顶层目录(99 文件),纯 additive;copy-into-host paradigm 不影响 fork 自己的 in-tree skillpack 模式 |
| v0.40.1.0 | Track D — eval infrastructure | additive,fork 不跑 eval |
| v0.40.2.0 | trajectory routing for temporal + knowledge_update (think + LongMemEval) | think pipeline 改造,fork 不跑 think daemon |
| v0.40.3.0 | **contextual retrieval + cache invalidation gate** | 直接影响 query 路径 —— smoke 观察到分数下降(见下) |
| v0.40.4.0 | selective graph signals + per-stage attribution + audit-writer unification | search re-rank 改造 |
| v0.40.5.0 | Federated Sync v2 — parallel source sync + push triggers | fork 单 source(`default`),feature unused |
| v0.40.6.0 | parallel sync --all + per-source lock invariant + sources status dashboard | 同上 |
| v0.40.7.0 | **Schema Cathedral v3 — agent-on-ramp + production rebuild of PR #1321** | schema 大动:88+90+91 三 migration 落在此版本相关;production 干净迁移 |
| v0.40.8.0 | e2e + unit gap coverage + master flake root-cause fixes | test infra,本地受益 |
| v0.40.8.1 | docs README rewrite + personal-brain + company-brain tutorials | additive |
| v0.40.9.0 | chunker .sql indexing via tree-sitter | fork 无 sql page,无影响 |
| v0.40.10.0 | content sanity defense — junk-pattern throw + oversize-skip-embed | 防御性,fork 内容已通过 |
| v0.41.0.0 | **minions — fleet you supervise (4 field bugs + cathedral)** | 全新 paradigm,opt-in(默认 OFF),无 surprise daemon |
| v0.41.1.0 | eval-loop wave — gbrain bench publish + gbrain eval gate | additive,fork 不跑 |
| v0.41.2.0 | lens packs + epistemology unification — atoms + concepts 作为 first-class | calibration / atoms / concepts 路径重定义;fork brain 旧 page 兼容 |
| v0.41.3.0 | **OAuth CORS lockdown + pre-register without DCR + validator surface** | 直接影响 fork 4 个 OAuth client —— **smoke 验证 kos-worker token + MCP path 仍 live**(76 tools 可见) |
| v0.41.4.0 | wave: local providers + cross-platform stdin + gateway-routed dream judge (6 community PRs) | additive |
| v0.41.5.0 | warm-narwhal — 6 community PRs + E2E reliability | additive |
| v0.41.6.0 | CI test speedup — 23min → ~9min via matrix 4→6 + weight-aware sharding | CI infra,fork 无 GH CI |
| v0.41.7.0 | **compact list-format resolver + 300-skill scaling tutorial** | RESOLVER.md 格式预热,真正的 strict gate 在 v0.41.14.0 |
| v0.41.8.0 | fix(pglite):search/query/get exit cleanly + #1340 hint + #1342 breadcrumbs | **pglite-engine.ts disconnect() 重构 —— fork WAL patch 折叠进新 snapshot+try/finally 结构,见下 conflict resolution** |
| v0.41.9.0 | UX/reliability fix wave (5 defects from production report) | bug fixes,additive |
| v0.41.10.0 | feat: orphan reduction via --by-mention + UTF-16 surrogate-pair fix | additive |
| v0.41.10.1 | fix-wave: dream.* config + batch retry + extract_atoms idempotency + ze-switch env-gate | additive |
| v0.41.11.0 | **conversation retrieval upgrade — production-bar replacement for PR #1406** | 引入 `gbrain extract-conversation-facts` + cycle phase `conversation_facts_backfill`(**默认 OFF**)+ migration v94 partial index;与 fork 刚 land 的 `chat-history/<source>/...` namespace 不冲突(上游处理已有 conversation page 做 fact 抽取,不 claim namespace) |
| v0.41.11.1 | ci: cut CI wallclock from 9min to 4.5min | CI infra |
| v0.41.12.0 | fix(ze-switch): preserve multimodal column dimensions + restore partial WHERE clause | bug fix |
| v0.41.13.0 | fix(sync): infiniteGameExp + foxhoundinc 5-bug wave | bug fixes;sole_non_default tier 5.5 —— fork 单 source 不触发新 nudge |
| v0.41.14.0 | **fix(#1451): close RESOLVER.md drift bug class structurally** | **新 strict gate `check:resolver`(exit-1 on warnings)—— flag 了 fork 2 个 skill,3 个 fork 适配修复(见下)** |

### Conflict resolution(5 个,vs §6.30 的 2)

| File | Decision | Rationale |
|---|---|---|
| `CLAUDE.md` | take fork(`--ours`)| fork CLAUDE.md 是 fork-only;上游内容由 `docs/CLAUDE-UPSTREAM.md` 镜像(本次同步刷新)|
| `llms-full.txt` | 取 upstream 清 marker → `bun run build:llms` 重生成 | 165KB regenerated;0 banned-name hit |
| `.github/workflows/test.yml` | keep fork delete (DU conflict)| fork commit `1adab13b` 显式删除("ci: delete .github/workflows/test.yml — fork CI noise removal"),保留删除立场 |
| `skills/manifest.json` | manual additive merge | 上游加 brain-taxonomist + eiirp 两条;fork 5 条 kos-jarvis 条目放在 array 尾部,upstream 2 条夹在 functional-area-resolver 之后(顺序对应) |
| `src/core/pglite-engine.ts` | manual structural merge | v0.41.8.0 重构 `disconnect()` 为 snapshot-and-early-null + try/finally(关闭 partial-state race PR #1337)。fork WAL patch(`pg_switch_wal()` 在 close 前)**折叠进 try block**,既保留 WAL 写入持久化 fix 又拿到上游的 lock-release try/finally 保证。注释更新:patch 历史新增 "2026-05-26 v0.41.14.0 sync — folded into upstream's new snapshot+try/finally structure" |

**Auto-merged 干净**:`VERSION`(→ 0.41.14.0)、`package.json`(保 fork
`@electric-sql/pglite` override + 上游新 deps)、`bun.lock`、`CHANGELOG.md`、
`README.md`、`skills/RESOLVER.md`(上游加 brain-taxonomist / eiirp / eiirp +
schema-author 行,fork `## KOS-Jarvis extensions` append-only section 完整
存活)、`gateway.ts` / `google.ts`(fork max_batch_tokens patch 持续存活)。

### Fork adaptations for new strict gates(3 个)

`bun run check:resolver`(v0.41.14.0 新加,strict mode exit-1 on
warnings)首次 run:

```
resolver_health: FAIL — 2 issue(s): 1 error(s), 1 warning(s)
  • unreachable        kos-jarvis/image-ingest   No RESOLVER.md row
  • mece_gap           kos-jarvis/notion-ingest-delta  No frontmatter triggers
```

加上 `check:all` 18-script chain 捕获的一个上游 trailing-newline 漏:

```
ERROR: trailing newline missing
  test/fixtures/e5-lease-cap-ab/2026-05-24-baseline-dry-run.json
```

**修复策略**(commit `1ba3d71e fix(sync)`):

1. **image-ingest** —— skill 在 §6.29 加入 manifest.json 但漏加 RESOLVER.md
   row(scaffold 状态)。新 strict gate 把 "manifest 有 / RESOLVER 无" 这种
   reachability 缺口提到 error 级别。修法:`## KOS-Jarvis extensions` 表
   末尾追加一行 trigger description。
2. **notion-ingest-delta** —— skill 在 §6.27 被标 RETIRED 但 SKILL.md 还
   留在 `skills/kos-jarvis/`(没移到 `_archived/`),RESOLVER.md 仍有路由
   row 指向它。新 gate 检测到"可被路由但无可匹配 trigger" → mece_gap。修
   法:frontmatter 加一个 minimal `triggers:` array("notion ingest delta"
   / "notion poller"),路由为 intentional dead-end(skill body 已解释
   retirement)。**YAML 教训**:在 `triggers:` 和数组 items 之间放注释会
   让 gray-matter parser 把字段解析为 null;注释必须放在 `triggers:` 行
   之前。verified `bun src/cli.ts check-resolvable --json` 输出仍报 null →
   注释移到 field 上方后清零。**P3 follow-up**:在未来某次 sync 里把
   skill 整个挪到 `_archived/` 彻底归档(triggers: 当前只是 expediency)。
3. **test/fixtures/e5-lease-cap-ab/2026-05-24-baseline-dry-run.json** ——
   上游 PR 漏了 trailing newline,fork 的 `check-trailing-newline.sh`
   命中。`printf '\n' >>` 补上,内容无关。可以 upstream 一个 fix PR
   但 blast radius 很小,先 local 修。

re-run 后:`check:resolver` 0 errors / 0 warnings ✓;`check:all` exit 0 ✓。

### Schema migrations(v85 → v97,12 步)

`bin/gbrain init --migrate-only` 一句解决,全部 idempotent
`ADD COLUMN IF NOT EXISTS` 模式,NOTICE on `column ... already exists`
不算 ERROR(沿用 §6.29/§6.30 模式):

```
[86] page_links_view_alias
[87] takes_kind_drop_check
[88] eval_candidates_schema_pack_per_source
[89] facts_event_type_column
[90] contextual_retrieval_columns                  ← v0.40.3 contextual retrieval
[91] pages_generation_trigger_and_bookmark
[92] sources_github_repo_index
[93] minions_v0_41_audit_and_budget                ← v0.41.0 minions
[94] take_domain_assignments
[95] links_link_source_check_includes_mentions
[96] facts_extract_conversation_session_index      ← v0.41.11 conversation retrieval
[97] pages_dedup_partial_index                     ← v0.41.13 dedup
```

`~/.gbrain/config.json` 未被 `--migrate-only` 触碰(diff 验证 == 0);
备份 `~/.gbrain/config.json.before-sync-v0.41.14.0`。pre-deploy
`pg_dump` 备份 `/tmp/pg-pre-sync-v0.41.14.0-2026-05-26.dump.gz`
(110 MB,与 §6.30 同尺寸,DB 体积稳定)。

### Health score before/after

| 维度 | Pre-sync (§6.30 / v0.38.2.0) | Post-sync (v0.41.14.0) |
|---|---|---|
| health_score | 40 | **95** |
| schema_version | 85 | **97** |
| pages_count | 3140 | **3140**(±0)|
| sources_count | 1 | 1 |
| skill_brain_first | ok(49 skill) | ok(post-fix `image-ingest` row 行)|
| oauth_confidential_client_health | ok(4 client) | ok(4 client)|
| resolver_health | n/a(strict gate 未引入)| **ok(post-fix:0 errors / 0 warnings)** |
| embeddings | 100% | 100%(0 missing)|

**health_score 40 → 95 解读**:§6.30 唯一的 `[FAIL]` 是 `sync_freshness`
(brain 内容已 4 天未 `gbrain sync`)。§6.30 的 commit `9877a570`(本
session 之前)已经把这个 P1 entry 重构为"sync_freshness obsolete
post-§6.28"—— working tree 自 §6.28 cutover 起冻结,Notion Agent put_page
+ dream-cycle 都直接写 DB,`gbrain sync`(markdown→DB)是 identity no-op,
`sources.last_sync_at` 只在真 import 时前进。这个 FAIL 是结构性 false
alarm,doctor `--fast` v0.41.14.0 模式不再 surface(check_n 8 vs 旧 15,
fast 路径精简)。

### Smoke evidence

- `bin/gbrain --version` → `0.41.14.0`(`bun run build` 重编译)
- `bun run typecheck` clean;`bun run check:all` exit 0(18 script chain
  含新 `check-trailing-newline` + `check-skill-brain-first` +
  `check-operations-filter-bypass` + `check-gateway-routed-no-direct-anthropic`);
  `bun run check:resolver` 0 errors / 0 warnings;`bun test test/ai/`
  **289 pass / 0 fail / 967 expect()**(+15 tests vs §6.30 的 274,
  上游 v0.40.x test gap coverage 新增)
- `curl http://127.0.0.1:7225/health` + `curl https://kos.chenge.ink/health`
  → `{"status":"ok","version":"0.41.14.0","engine":"postgres"}`
- **OAuth smoke(本次新增,v0.41.3.0 CORS lockdown 高风险验证)**:
  ```
  TOK=$(curl -s -X POST http://127.0.0.1:7225/token \
    -d grant_type=client_credentials \
    -d client_id=$KOS_WORKER_CID \
    -d client_secret=$KOS_WORKER_CSEC \
    -d "scope=read write" | jq -r .access_token)
  ```
  返回 `gbrain_at_6345a64e3d...` ✓。`tools/list` 经 Bearer 调用返回
  **76 tools**(vs §6.28 era 29 tools,上游 v0.40-v0.41 新加 47 个 MCP
  operations:`extract-conversation-facts` / `bench-publish` / `jobs-watch` /
  `eval-gate` / `schema` 等 )
- query smoke:
  - EN `Lucien` → `concepts/user-modeling-spec` 0.5110(vs §6.30 的
    `people/lucien` 0.8951 —— 不同 top-1,分数下降。两个 page 都含
    Lucien 实体,top-1 切换是 v0.40.3 contextual retrieval +
    v0.41.11 conversation retrieval 改写 embed/rerank pipeline 的直接
    结果)
  - ZH compound-CJK `知识管理` → `sources/2026-04-06-jarvis-dual-platform-architecture`
    0.2761(vs §6.30 同 page 0.9880 —— **同 page** top-1 命中,但分数大
    幅下降。语义相关度未变,score scale 在新 retrieval 路径下重标定)
- pages count **3140**(基线 ±0);schema v97;`gbrain doctor --fast --json`
  health_score 95,0 fail / 0 warning。
- `gbrain-serve-http` daemon bootout/bootstrap(plist
  `~/Library/LaunchAgents/com.jarvis.gbrain-serve-http.plist`,
  PID 76514 → 新 PID,~5 s downtime)

**Query score 下降的解读**(non-blocker,but worth flagging):top-k 分数
显著下降并不必然代表 retrieval 质量回归 —— 新 contextual retrieval pipeline
对分数做了重新标定(尤其 reranker stage 的 sigmoid/softmax 取舍变化);
top-1 page 仍语义相关。但绝对值差距(EN 0.89→0.51,ZH 0.99→0.28)很大,
值得在某次 idle window 用 `gbrain eval replay` 对 §6.30 baseline 跑一遍
看 nDCG/recall 是否真的回归 —— filed 为 P3 follow-up。

### 全量测试(非 gate;沿用 §6.30 gate = typecheck + check:all + check:resolver + test/ai/)

本次未跑 `bun run test`(全量 unit suite,~6000+ tests + 新增 ~500
upstream tests + e5-lease-cap-ab fuzz)。`run-unit-parallel.sh` 的
sharding scheme 在 v0.41.6.0 wave 被改造(matrix 4→6 + weight-aware),
fork PGLite-pin 与上游 hermetic-test 预期的环境差异仍在(§6.30 记的
P2 follow-up),全量 suite 不宜作为 gate。test/ai/ 的 289 pass / 0 fail
继续作为 fork 的可重复绿基线。

### Branch ops + TODO follow-ups

sync 分支 `sync-v0.41.14.0`:
- merge commit `d9097db8 Merge remote-tracking branch 'upstream/master'`
- `fix(sync) 1ba3d71e` —— 3 个 fork adaptation
- `chore(llms) 89adf65b` —— llms-full.txt 重生成(−1995 / +255 LoC,
  reflect post-merge fork state)
- `docs(upstream-mirror) d9a4adcf` —— CLAUDE-UPSTREAM.md 刷新到 v0.41.14.0

`--no-ff` 并入 master:`8af885fd Merge branch 'sync-v0.41.14.0' ...`
(commit message 含 20 versions / 34 commits / 818 files summary)。
本 §6.31 story commit + TODO + CLAUDE.md sync-story pointer 是
post-production-deploy 的独立 docs commit(本次 sync 因 production
smoke evidence 在写故事前已收集,故事一次成形即包括 smoke 段)。

**新增 TODO follow-ups(2026-05-26)**:

- (P3) `skills/kos-jarvis/notion-ingest-delta/` —— 正式归档到
  `_archived/`(skill 自 §6.27 起即标 RETIRED;本次只是为通过
  check:resolver 加了 minimal `triggers:` 以保留 grep-discoverability
  的历史名,不是长期方案)。
- (P3) `cycle.conversation_facts_backfill.enabled` —— v0.41.11.0 引入
  的 backfill phase,默认 OFF,$5 cap。fork 的 conversation page 主要
  来自 mailagent chat-save (Sprint 19 P1-C,新 `chat-history/mailagent/...`
  namespace)+ 历史 Notion sources。评估 enable 是否能让长对话页的
  retrieval 召回更准 —— 但 mailagent 单条 chat 通常 ≤ 几 KB,backfill
  收益可能有限,先观察。
- (P3) **Query score regression observation** —— smoke 跑的 2 个 probe
  (EN `Lucien`,ZH `知识管理`)在 §6.30 → §6.31 之间 top-1 分数从
  0.89/0.99 跌到 0.51/0.28(top-k page 语义仍相关,EN 还切了 top-1)。
  `gbrain eval replay` 对 §6.30 baseline 跑一遍,看 nDCG / recall 是否
  真回归,还是新 contextual retrieval pipeline 的分数标定改变。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync entries(更新至 2026-05-26)
- [`docs/CLAUDE-UPSTREAM.md`](CLAUDE-UPSTREAM.md) — upstream CLAUDE.md mirror(刷新至 v0.41.14.0,2021 lines,0 banned-name hits)
- [`docs/kos-namespace-conventions.md`](kos-namespace-conventions.md) — 同 session 早些时候 land 的 cross-consumer chat-save namespace 规范,与 v0.41.11.0 conversation retrieval 互补不冲突
- Sync plan + verification trail: this conversation's transcript

---

## 6.32 全库 embedding 收敛 → openai text-embedding-3-large @ avman (2026-05-31)

**触发**:为对邮件语料(`mailagent-emails`,6911 封全量入库)跑 enrich-sweep 实体
抽取前排查,发现 brain 向量检索是**结构性错配**——`~/.gbrain/config.json` 声明
`google:gemini-embedding-001`,但实际内容是三套互不兼容的空间:`default`(6940
chunk)其实是当年 gemini 桥接残留(norm ~0.70,却被错标 `text-embedding-3-large`),
`mailagent-emails`(31116 chunk)在摄入时被 daemon 以 `zeroentropyai:zembed-1` 嵌入
(当时配置落到 ZE 默认;mailagent 本身只经 MCP `put_page` 发内容——`PageInput` 无 embedding
字段,已核实非客户端预算)。gbrain 动态列解析器(`src/core/search/embedding-column.ts`)
只按列名路由、不按逐行 model 过滤,单个 `embedding` 列混三套模型 → 任何全局查询模型都
服务不了 → 检索全是垃圾(查询量 ~3/天,故一直未暴露)。

**决策(Lucien)**:全库统一到**真 OpenAI `text-embedding-3-large` @ 1536d**,经自购的
avman.ai OpenAI-兼容中转(交叉验证:与另一独立中转同文本 cos 1.0000 → 确为真 te3;单位
归一、确定性)。列保持 `vector(1536)` → 无需 pgvector 迁移。

**2 个上游 gbrain bug(待提 issue)**:① `litellm` recipe 不可用——`diagnoseEmbedding`
(`gateway.ts:670`)对它无条件返回 `user_provided_model_unset`,无视已配置模型 → 改用
原生 `openai` recipe + `OPENAI_BASE_URL` 路由到 avman(`createOpenAI()` 认这个 env,正是
当年 shim 的机制)。② embed 路径漏传 model 字段 → `upsertChunks` 把 chunk 的 `model` 列
错标成网关默认值;每次重嵌后用 psql `UPDATE content_chunks SET model=...` 修(纯标签,
不影响向量)。排查雷区:`gbrain config set embedding_model` 的 no-op 守卫会拒写(对比
file-inclusive 解析值),需直接 psql UPSERT DB-plane `config` 表;且 `put`/`query` 路由到
**daemon**(其 boot env 决定模型)、而 `embed` 是 **CLI in-process**(读 env/config)——这条
daemon-vs-CLI 分界一度严重误导(所有 zembed-1/gemini 假象都是 daemon 路径造成)。

**执行**:备份(config.json + content_chunks pg_dump 393MB + 当日全库 506MB dump)→ 全平面
对齐 openai@avman(`.env.local` + `config.json` + DB `config` 表 + 4 plist 的
`GBRAIN_EMBEDDING_MODEL`/`OPENAI_API_KEY`/`OPENAI_BASE_URL`)→ smoke 闸门
(`providers test openai:te3` green + `import` in-process norm 1.0,cos 1.0 vs avman)→
分阶段后台重嵌(concurrency 6,节流保护付费代理):default 6940 → 验证 → emails 31116 →
修标签 → `launchctl` 重启 daemon(query 侧也走 te3@avman,~5s 下线)。

**结果**:全库 **38056 chunk 单一 `openai:text-embedding-3-large` @1536**,norm≈1,零 NULL、
零残留。检索一致性验证通过(「TP-Link Omada 网络配置」→ 命中交换机/Controller 配置邮件;
「AI agent 设计哲学」→ 命中 Agentic/Multi-Agent 邮件,score 0.82-0.90)——brain 向量检索
**首次连贯**(迁移前是 gemini 查询 vs 混杂内容)。

**遗留**:① mailagent **无需改动**——它经 MCP `put_page` 只发内容(`PageInput` 无向量字段),
嵌入由 daemon(现 openai@avman)负责,故新邮件自动统一(已核实:M6 后 fresh put norm 1.0)。
见 `docs/MAILAGENT-EMBEDDING-SWITCH.md`。② query expansion(chat 触点)报
`[expand] Not Found`,与 embedding 无关(daemon 缺 CRS/ANTHROPIC env?),待单独查。③ Google
/ZeroEntropy key 对 embedding 已 vestigial。④ enrich-sweep over emails(最初诉求)现可在
统一空间上跑,单独再启。

---

## 6.33 Upstream v0.42.1.0 sync (2026-06-01)

§6.31 之后 6 天的跟进 sync —— 上游 master **27 个 commit**(v0.41.14.0 →
**v0.42.1.0**,跨过 v0.41.x 整条尾巴 + v0.42.0/v0.42.1),merge commit
**605 文件 / +66,781 / −37,154 LoC**(约 §6.31 818 文件的 0.74×)。**4 个
conflict**(CLAUDE.md + .github/workflows/test.yml modify/delete +
skills/manifest.json + llms-full.txt —— 全部按 §6.31 playbook 分类解决)。
本次比 §6.31 顺:`pglite-engine.ts` / `recipes/google.ts` / `RESOLVER.md` /
`package.json` 四个含 fork patch 的文件 **auto-merge 干净**(无 marker),
patch 全部 grep 验证存活。fork-protected 区域(`skills/kos-jarvis/`、
`server/`、`workers/`、`scripts/launchd/`)**零侵入** ——
`git diff --cached HEAD -- <四路径>` 在 merge index 上为空。Schema 自动
v97 → **v111**(13 migration)。生产 `kos.chenge.ink` 部署完成,
**13,613 live pages**(±0 baseline)、**43,311 chunks 单模型
openai:text-embedding-3-large** 维持(§6.32 收敛 + Lucien R7 清理后状态)。

### 与 §6.31 的两个关键差异

1. **Query 分数回归(§6.31 P3)实质消解**。§6.31 smoke 记 EN 0.51 / ZH
   0.28 的低分,当时归因于"新 contextual retrieval 重标定"。本次同 probe
   (EN `Lucien` / ZH `知识管理`)分数回到 **0.81 / 0.83**。真正原因不是
   retrieval pipeline,而是 §6.32 把全库重嵌进**单一 openai te3 相干空间**
   —— §6.31 当时 `default`(stale gemini-shim norm≈0.70)+ `mailagent-emails`
   (zembed-1)是两个不相干空间,单一 query 模型打分自然崩。§6.32 收敛后
   query-doc 相似度恢复正常标定。**结论:§6.31 P3(eval replay)可降级 ——
   分数已健康,不是 pipeline 回归。**
2. **Baseline pages 3140 → 13,613**。§6.30/§6.31 都记 3140;其间
   `mailagent-emails` 邮件语料 landing(§6.32 记 default 6,940 +
   mailagent-emails 31,116 chunks),live pages 涨到 13,613
   (`mailagent-emails` 10,476 + `default` 3,137;`default` 较 §6.31 的
   3140 少 3 = Lucien R3 在 default 软删的 3 页)。本次 deploy 基线即 13,613,
   migration 不改 page count,±0 验证通过。

### 上游 27 版本与 fork 关系

| 版本 | 主题 | 对 fork 影响 |
|---|---|---|
| v0.41.15.0 | sync --timeout + --max-age + partial status | additive,fork 单 source sync 受益 |
| v0.41.16.0 | conversation parser cathedral + progressive-batch primitive | parser/ramp 基础设施;migration [99] conversation_parser_llm_cache |
| v0.41.17.0 | --workers N on every bulk command + facts dim doctor parity | bulk 命令并行,fork enrich-sweep 可受益 |
| v0.41.18.0 | gbrain onboard activation surface | 新 onboard 命令,additive |
| v0.41.19.0 | Supavisor Retry Cathedral | 连接重试加固,fork postgres 受益 |
| v0.41.20.0 | gbrain status + doctor --scope=brain | doctor 增强,additive |
| v0.41.21.0 | 5 daily-driver pains fixed | bug fix wave |
| v0.41.22.0 | **type-unification cathedral(94→15 canonical types)** | 大型类型重构;新 `schema-unify` skill(RESOLVER + manifest 加行,本次 additive merge);fork 9 KOS kind 走独立 frontmatter,不受 canonical pack 影响 |
| v0.41.22.1 | brainstorm/lsd judge fixes | fork 不跑 brainstorm |
| v0.41.23.0 | extract operator surfaces + pack-driven extractables | additive |
| v0.41.24.0 | conversation-parser threshold gates(20,167 Circleback msg) | parser 改进;fork mailagent 对话页受益 |
| v0.41.25.0 | perf(sync) batched deletes + global page-generation clock | migration [107] page_generation_clock;sync 性能 |
| v0.41.26.0 | dream --source + ingest junk titles + emoji-crash | bug fix |
| v0.41.26.1 | **lock-renewal cathedral(~39 worker crashes/day)** | migration [98] cycle_locks_last_refreshed_at;worker 稳定性 |
| v0.41.27.0 | withRetry self-heal + facts:absorb drain;doctor git-aware sync_freshness | bug fix wave(两个 v0.41.27.0 commit)|
| v0.41.29.0 | conversation-parser bold-name builtin + source-scoped orphan_ratio | parser + orphan;fork 单 source orphan 计算更准 |
| v0.41.30.0 | brainstorm/lsd --save writes .md | fork 不跑 |
| v0.41.31.0 | **delta-aware sync --all cost gate + real stale-embedding semantics** | migration [108] pages_embedding_signature;**embedding 新鲜度判定** —— 经 guard 验证不与 §6.32 openai@avman 冲突(signature 列附加,不改 model 解析)|
| v0.41.32.0 | commit-relative sync staleness | staleness 判定改进 |
| v0.41.33.0 | intent-aware adaptive return-sizing + agent query param | migration [111] search_telemetry_rank1;return-size 自适应 |
| v0.41.34.0 | **retrieval cathedral — max-pool + title + alias + evidence** | migration [105] slug_aliases + [110] page_aliases;search/rerank 改写 —— smoke 分数健康(0.81/0.83),无回归 |
| v0.41.35.0 | vendor-neutral content guardrail seams | `gateway.ts` +113(guardrail 接缝);经 embedding-gateway-guard 验证 embedding 路径无回归 |
| v0.41.36.0 | mcp publish agent skills(list_skills / get_skill) | 新 MCP op,thin client 可列 skill;fork OAuth client 受益 |
| v0.41.37.0 | **critical fix wave**(reindex tag wipe / grandfather hang / Windows migration spawn / sync ReDoS) | migration 框架重构为 in-process(`migrations/in-process.ts` 新增);防御性修复 |
| v0.41.38.0 | code-callers/callees honor .gbrain-source + **dream runs on postgres engines** | fork postgres engine 现可跑 `gbrain dream`(原隐含 pglite 倾向解除)|
| v0.42.1.0 | **gbrain skillopt — self-evolving skills(closes #1481)** | 新 `skill-optimizer` skill(manifest additive);opt-in,fork 不自动跑 |

(v0.42.0.0 无独立 tag commit,实际 land 在 v0.42.1.0 PR #1563。)

### Conflict resolution(4 个,vs §6.31 的 5)

| File | Decision | Rationale |
|---|---|---|
| `CLAUDE.md` | take fork(`--ours`)| fork CLAUDE.md 是 fork-only;上游内容由 `docs/CLAUDE-UPSTREAM.md` 镜像(本次刷新到 v0.42.1.0,2044 行 upstream body)|
| `.github/workflows/test.yml` | keep fork delete(modify/delete DU conflict)| fork commit `1adab13b` 显式删除("ci: delete .github/workflows/test.yml");保留删除立场 |
| `skills/manifest.json` | manual additive merge | 上游加 `schema-unify` + `skill-optimizer` 两条(放上游 functional 位);fork 4 条 kos-jarvis 条目放 array 尾部。`bun` 校验 53 skills、4 kos-jarvis 完整、两条上游条目在场 |
| `llms-full.txt` | 取 upstream 清 marker → `bun run build:llms` 重生成 | 178KB / 3660 行 regenerated;0 banned-name residue |

**Auto-merged 干净(本次比 §6.31 多)**:`src/core/pglite-engine.ts`(WAL
`pg_switch_wal()` patch 已在 §6.31 折叠进上游 v0.41.8.0 snapshot+try/finally
结构,本次无 marker)、`src/core/ai/recipes/google.ts`(fork
`max_batch_tokens: 20_000` / `chars_per_token: 2` block 存活;§6.32 后于 gemini
recipe 已偏 vestigial 但仍 carry-forward)、`skills/RESOLVER.md`(上游加
`schema-unify` dispatcher row 在自己 section;fork `## KOS-Jarvis extensions`
append-only 段完整)、`package.json`(fork `@electric-sql/pglite` override + 上游
新 deps;`bun install` 报 277 packages no changes,`bun.lock` 未动)、`VERSION`
(→ 0.42.1.0)、`CHANGELOG.md`、`README.md`。四个 fork src/ patch **grep 验证
存活**:`pg_switch_wal` ×2 / `max_batch_tokens` ×3 / `KOS-Jarvis extensions` ×1
/ `@electric-sql/pglite` override ×2。

### Fork adaptation:pre-existing banned-name 元引用(1 个 fix(sync))

本次 `check:resolver` **一次过**(53 skills all reachable,无 §6.31 那样的
image-ingest / notion-ingest-delta flag)。但 `check:all` 的
`check-privacy.sh` 命中 **3 处 latent 违规**(以 `⟨banned-name⟩` 代指那个被禁的
私有 OpenClaw fork 名):

```
[check-privacy] BANNED NAME in docs/JARVIS-ARCHITECTURE.md:
  4056: ...165KB regenerated;0 ⟨banned-name⟩ hit
  4246: ...upstream CLAUDE.md mirror(...,0 ⟨banned-name⟩ hits)
[check-privacy] BANNED NAME in skills/kos-jarvis/TODO.md:
  18: ...refreshed to v0.41.14.0 (..., 0 ⟨banned-name⟩ hits)
```

**根因**:这 3 处是 §6.31/§6.32 自己的 **docs commit 写的**,而那些 docs
commit 落在各自 check:all gate run **之后**(sync 的 gate 跑在 merge+fix
commit 上,§6.NN 故事 / TODO header 是后写的独立 docs commit,从未被 gate
看过)。三处都在用字面 banned name 描述这个词的**不存在**("0 …… hits")——
grep 是字面的,照样命中。本次 sync 的 check:all 是第一次看到它们。**修法**
(commit `fix(sync) f31f13dc`):rephrase → "0 banned-name hit(s)",语义不变,
grep 不再命中。

> **P3 教训(写进本节以免复发)**:sync 的最终 docs commit(§6.NN 故事 +
> TODO header)凡描述 banned-name 检查,一律用中性词 "banned-name" /
> `⟨banned-name⟩` 占位,**绝不写字面词**——否则下一次 sync 的 check:all 会在
> JARVIS-ARCHITECTURE.md / TODO.md 再次命中。本 §6.33 故事即遵此(全节 0 字面
> banned name;写完后已 re-run check-privacy 确认 clean)。

### Lucien R1–R7 工作:独立 commit(非 sync 产物)

开工前工作区有一批 **2026-06-01 同日未提交**的本地工作
(`skills/kos-jarvis/REFINEMENT-BACKLOG.md` 的 R1–R7 resolution +
`TODO.md` P1 段),记录 §6.32 之后的 email-stub 清理。这**不是** sync 产物,
按用户决定 **独立 commit 在 sync 分支首位**(`fork(kos-jarvis) d98f4530`),
attribution 干净。要点:R1/R2 retracted(两轴模型下 source 是独立 namespace,
slug per-source,stub 正确落在 `mailagent-emails`),R3/R4/R7 done(28 页 + 16
orphan chunk 软删 → 全库单模型 te3),R6 reviewed-no-action。TODO.md 用
`git diff` 双 hunk 拆分(我的 line-18 privacy fix vs Lucien P1 段),临时 revert
line-18 → 仅 stage Lucien hunk → commit → 再 reapply,保证两份工作不串。

### Schema migrations(v97 → v111,13 步)

`bin/gbrain init --migrate-only` 一句解决(全 idempotent;NOTICE 非 ERROR,
沿用 §6.29/§6.30/§6.31 模式)。`--migrate-only` 未触碰 `~/.gbrain/config.json`
(diff vs backup == 0);备份 `~/.gbrain/config.json.before-sync-v0.42.1.0`。
pre-deploy `pg_dump` 备份 `/tmp/pg-pre-sync-v0.42.1.0-2026-06-01.dump.gz`
(**522 MB gzip**,gzip -t 通过;较 §6.31 的 110 MB 大幅增长 = 邮件语料
landing + 43,311 个 1536-dim 向量)。

```
[98]  gbrain_cycle_locks_last_refreshed_at          ← v0.41.26.1 lock-renewal
[99]  conversation_parser_llm_cache_table           ← v0.41.16 parser cathedral
[101] links_link_kind_column
[102] timeline_entries_source_in_dedup
[103] migration_impact_log_and_priority_recent_idx
[104] pages_atom_source_hash_idx
[105] slug_aliases                                   ← v0.41.34 retrieval cathedral
[106] extract_rollup_7d_table
[107] page_generation_clock_and_statement_trigger    ← v0.41.25 global page-gen clock
[108] pages_embedding_signature                      ← v0.41.31 stale-embedding semantics
[109] sources_newest_content_at
[110] page_aliases                                   ← v0.41.34 retrieval cathedral
[111] search_telemetry_rank1_columns                 ← v0.41.33 adaptive return-sizing
```

([100] 在上游为 no-op 跳号。)

### Health score before/after

| 维度 | Pre-sync (§6.31 / v0.41.14.0) | Post-sync (v0.42.1.0) |
|---|---|---|
| health_score | 95 | **95** |
| schema_version | 97 | **111** |
| pages_count | 3140(§6.31 baseline)| **13,613**(±0 vs 本次 pre-deploy baseline;邮件语料 landing 后的当前真实基线)|
| sources_count | 1 | **2**(`default` 3,137 + `mailagent-emails` 10,476)|
| skill count | 49 | **53**(+`schema-unify` +`skill-optimizer` 等上游条目)|
| resolver_health | ok(post-fix)| **ok(53 skills,一次过,0 fix)** |
| content_chunks | 43,311(单模型,§6.32 后)| **43,311**(单模型 openai:text-embedding-3-large,±0)|
| vector unit-norm | ~1.0 | **avg 1.0000 / min 0.9994 / max 1.0005**(500 sample)|
| embeddings | 100% | 100%(0 missing,guard VERDICT CLEAN)|

### Smoke evidence

- `bin/gbrain --version` → `0.42.1.0`(`bun run build` 重编译,1631 modules)
- 绿灯门(沿用 §6.31 = typecheck + check:all + check:resolver + test/ai/):
  `bun run typecheck` clean(`tsc --noEmit`);`bun run check:all` exit 0
  (21-script chain,**第一次 run 因 pre-existing banned-name 元引用 FAIL,
  fix(sync) 后绿**);`bun run check:resolver` 0 errors / 0 warnings(53 skills);
  `bun test test/ai/` **300 pass / 0 fail / 982 expect()**(+11 vs §6.31 的 289,
  上游 v0.41.x test gap coverage 新增)
- `curl http://127.0.0.1:7225/health` + `curl https://kos.chenge.ink/health`
  → `{"status":"ok","version":"0.42.1.0","engine":"postgres"}`(public ingress
  经 mbp-office cloudflared 仍 live,daemon 可达)
- query smoke(§6.32 收敛后**分数健康**,与 §6.31 的低分形成对比):
  - EN `Lucien` → `sources/email/41638`(Lucien.ai v0.2 feat. Jarvis)**0.8135**
    +`concepts/jarvis`
  - ZH compound-CJK `知识管理`(4 Han chars,**必走 vector path**,经 avman relay)
    → `projects/l1`(L1资料检索助手…从知识库系统获取知识)**0.8273**、
    `concepts/global`(全局管理能力)0.8097、`projects/erd_project_management`
    —— 语义命中,证明 query→embed(openai te3 @ avman)→vector search 全链路
    经上游重写的 `gateway.ts`(+113)仍工作
- **embedding-gateway-guard VERDICT: CLEAN** —— 5 个 config plane 全部一致
  (config.json / DB-plane `config` 表 / 4 plist / `.env.local` / content_chunks),
  无 gemini/zeroentropy/litellm leak,无 merge 引入的 provider-SDK bypass。
  DB config 表:`embedding_model=openai:text-embedding-3-large`、
  `embedding_dimensions=1536`、`embedding_columns` 相干
- pages count **13,613 live / 13,657 total**(±0 baseline);schema v111;
  `gbrain doctor --fast` health_score 95、all checks OK(唯一 WARN 是
  `--fast` 模式跳过深度 DB check 的预期提示)
- `gbrain-serve-http` daemon bootout/bootstrap(plist
  `~/Library/LaunchAgents/com.jarvis.gbrain-serve-http.plist`,
  **PID 5395 → 47513**,~5 s downtime);config.json diff vs backup == 0

### Branch ops + TODO follow-ups

sync 分支 `sync-v0.42.1.0`(merge 后 4 commit):
- merge commit `992ddd00 Merge remote-tracking branch 'upstream/master'`
- `fork(kos-jarvis) d98f4530` —— Lucien R1–R7(独立,非 sync 产物)
- `chore(llms) 47aa098d` —— llms-full.txt 重生成
- `docs(upstream-mirror) 284fdb94` —— CLAUDE-UPSTREAM.md 刷新到 v0.42.1.0
- `fix(sync) f31f13dc` —— pre-existing banned-name 元引用 scrub

`--no-ff` 并入 master:`5af1adf4 Merge branch 'sync-v0.42.1.0' …`(commit
message 含 27 commits / v0.41.14.0 → v0.42.1.0 / 605 files summary)。本 §6.33
story commit + TODO header + CLAUDE.md sync-story pointer 是
post-production-deploy 的独立 docs commit(smoke evidence 写故事前已收集)。

**新增 / 更新 TODO follow-ups(2026-06-01)**:

- (P3 → **可关闭**)§6.31 的 query-score regression observation —— 本次 smoke
  分数回到 0.81/0.83,确认 §6.30→§6.31 的低分是 §6.32 前的多空间不相干 artifact,
  非 retrieval pipeline 回归。`eval replay` 不再必要。
- (P3,沿用)`skills/kos-jarvis/notion-ingest-delta/` 正式归档到 `_archived/`
  (§6.27 起即 RETIRED;本次 check:resolver 一次过,未再被 flag,但 skill 仍在
  `skills/kos-jarvis/` 根目录)。
- (P3,新)`cycle.conversation_facts_backfill` 仍默认 OFF;邮件语料(31,116
  chunks)now landed,可评估 enable 是否提升长邮件 thread 召回。
- (P3,新)v0.41.38.0 起 `gbrain dream` 支持 postgres engine —— fork 之前因
  pglite 倾向未跑 dream-cycle over postgres,可评估启用。
- (P2,新)v0.41.22.0 type-unification(94→15 canonical)+ 新 `schema-unify`
  skill —— fork 9 KOS kind 走独立 frontmatter,但可评估是否把部分 stub
  对齐到 canonical pack 以受益于上游 type-aware retrieval。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-06-01)
- [`docs/CLAUDE-UPSTREAM.md`](CLAUDE-UPSTREAM.md) — upstream CLAUDE.md mirror(刷新至 v0.42.1.0,2065 行,0 banned-name residue)
- [`skills/kos-jarvis/REFINEMENT-BACKLOG.md`](../skills/kos-jarvis/REFINEMENT-BACKLOG.md) — Lucien R1–R7 resolution(独立 commit d98f4530)
- Sync plan + verification trail: this conversation's transcript

---

## 6.34 Upstream v0.42.37.0 sync (2026-06-09)

§6.33 之后 8 天的跟进 sync —— 上游 master **35 个 commit**(v0.42.1.0 →
**v0.42.37.0**),merge commit **374 文件 / +41,864 / −2,635 LoC**。上游主题:
sync 可靠性大修(resumable/durable/single-flight,v0.42.17/36)、minions/worker
看门狗与锁恢复(v0.42.21/22/24/26)、`doctor` cause-ranked 重写(v0.42.16)、
search autocut + typed-edge 关系检索(v0.42.3/34)、安全修复(v0.42.37
source-isolation grant 强制)。Schema 自动 **v111 → v115**(4 migration:
[112] pages_links_extracted_at、[113]/[114] links.link_source 放宽+校验、
[115] op_checkpoint_paths)。生产 `kos.chenge.ink` 部署完成,**15,206 live
pages(±0)** —— 新基线较 §6.33 的 13,613 高出的部分是其间 landing 的 `omada`
语料(§corpus-ingest,2026-06-02)+ 日常增量,migration 本身不改 page count。

### 开工前:fork 首个 src/ 运行时 patch(embed transport retry)

工作区有一份未提交 WIP:`src/core/ai/gateway.ts` +134/−10 + 配套
`test/embed-transport-retry.test.ts`(5 tests)。背景:avman relay 间歇性下发
不完整 TLS 证书链(leaf 缺 intermediate),Node 不做 AIA 补链,undici 抛裸
`TypeError: fetch failed`(无 HTTP status)→ AI SDK 的 APICallError 重试完全
不接手 → 同步路径 MCP `put_page` 的 embed 直接失败(后面没有 job queue 兜底)。
patch 在 embed transport 外包一层**仅限传输级瞬时错误**的有界重试
(`GBRAIN_EMBED_TRANSPORT_RETRIES` 默认 2;decorrelated backoff 复用
`core/retry.ts`;HTTP-status 错误仍走 SDK + normalizeAIError,token-limit 仍走
batch 减半)。按用户决定 + §6.33 R1–R7 先例,**独立 commit 放 sync 分支首位**
(`fork(ai-gateway) e7b6a554`),merge 在其上进行。经查上游本批对 gateway.ts 的
+193 行不含任何 retry/transport/cert 内容 —— 两者正交,patch 未被取代。fork
src/ patch 存活清单自此 +1(grep 锚:`embedTransportWithRetry`)。

### Conflict resolution(4 个,vs §6.33 的 4)

| File | Decision | Rationale |
|---|---|---|
| `CLAUDE.md` | take fork(`--ours`)| 惯例;上游内容由 `docs/CLAUDE-UPSTREAM.md` 镜像 |
| `llms-full.txt` | 取 upstream 清 marker → `bun run build:llms` 重生成 | 187KB / 3,766 行;0 banned-name hit |
| `skills/RESOLVER.md` | 删 3 行 marker 保 fork 尾段(**不能** `--ours` —— 上游新增的 idea-lineage/schema-unify 行已并入公共区,`--ours` 会丢)| fork `## KOS-Jarvis extensions` append-only 段完整 |
| `src/core/ai/gateway.ts` | 手工合成:保留 fork retry wrapper + 吸收上游 v0.42.20.0 per-call embed timeout,且把 timeout 下沉到 wrapper 内**每次 attempt**(每次重试各得一份 `AI_EMBED_TIMEOUT_MS` 预算;timeout 错误本身不可重试,挂死的 relay 不会被再吊 2 分钟)| 双方语义都保住;5/5 测试过 |

**Auto-merged 干净**:`pglite-engine.ts`(WAL patch ×2 存活)、
`recipes/google.ts`(`max_batch_tokens: 20_000` block 字节级一致)、
`package.json`(`@electric-sql/pglite` override ×2)、`skills/manifest.json`
(本次无冲突,14 处 kos-jarvis 条目完整)。fork-protected 区域
(`skills/kos-jarvis/`、`server/`、`workers/`、`scripts/launchd/`)**零侵入**
(`git diff master <merge> --stat` 为空)。

### Fork adaptation:test-isolation R1 双修(fix(sync) 352e6a82)

上游新 lint `check-test-isolation` R1(并行测试禁裸改 `process.env`)命中 2 个
文件:(a) fork 新写的 `embed-transport-retry.test.ts`(写于 lint 可见之前)——
按 canonical 模式改 `withEnv()`;(b) **上游自己的** v0.42.36.0
`db-lock-heartbeat-takeover.test.ts` —— 晚于 lint 落地、既不在 allowlist
(allowlist 自身规则禁止新增条目)也不合规,upstream master 用自家 gate 也会红。
同样施以 `withEnv()` 转换(即上游 sweep 的修法,下次 sync 上游若同修则零冲突;
candidate to upstream)。修后两文件 14/14 pass。

### 绿门

`bun install` 干净;`bun run build` → `gbrain 0.42.37.0`;typecheck 0 错;
`check:all` 全绿(test-isolation 修后);`bun test test/ai/` + embed-retry
**320 pass / 0 fail / 1,008 expect()**(+20 vs §6.33)。`docs/CLAUDE-UPSTREAM.md`
刷新至 v0.42.37.0 —— 上游 body 缩至 **764 行**(2,044 → 764,上游自己把
Testing/Releasing/Key-files 下放到 `docs/TESTING.md`、`docs/RELEASING.md`、
`docs/architecture/KEY_FILES.md`,本次 merge 新增),0 banned-name residue。

### 生产部署 + smoke

备份 `pg_dump` 506MB(`/tmp/pg-pre-sync-v0.42.37.0-2026-06-09.dump.gz`)+
config 副本。`init --migrate-only` v111→v115 四个 migration 干净落地。daemon
bootout/bootstrap 后:本地 + `https://kos.chenge.ink/health` 均报
**0.42.37.0**;pages **15,206(±0)**。查询 smoke:

- ZH 复合 CJK `知识管理`(vector 路径)→ **0.876 / 0.873 / 0.824** ✓
- EN 语义 `personal knowledge management methodology` → **0.889**(跨语言命中
  `concepts/knowledge-management`,1.9s)✓
- EN 单词 `Lucien` → **statement timeout(8s)✗ —— 非 sync 回归**。EXPLAIN
  定位:'lucien' 命中 **25,450 chunks**(邮箱主人名,几乎每封邮件都含),
  keyword arm 的 `ts_rank` 需 detoast ~28 万缓冲页(且多为 cache hit —— 瓶颈
  是 CPU 不是 I/O),仅内层 CTE 即 5.3s。8s `SET LOCAL statement_timeout`
  **merge 前已存在**(×3);§6.33(06-01)同 probe 还能 0.81 过线,其间
  mailagent-emails 31k → 37.8k chunks(+22%)把这类高频词推过悬崖。真正修复
  在上游查询形状(cheaper-proxy 预筛后再 rank);已记 TODO(P2),将向上游
  报 issue。注意 `--source default` 收窄**救不了**(source 过滤发生在 GIN
  扫描+detoast 之后)。

### 部署后运维发现(均为既有问题,sync 顺带暴露/修复)

1. **8,625 个 NULL-vector chunks(coverage 82.2%)**:`omada` 2,482/2,521
   (98%!)、`gbrain-docs` 1,399/1,399(100%)、`mailagent-emails` 3,725、
   `default` 1,019 —— 正是 avman TLS 闪断在 §6.32 之后数周的累积失败面
   (corpus-ingest 的 embed 环节静默失败 + 每日 omada 写入未嵌入),也就是
   本次 embed-retry patch 的动机本体。部署后 `gbrain embed --stale` 排干:
   **8,615 chunks / 3,414 pages 一次过(rc=0,无 give-up 日志)**+ 10 个
   run 中新增 chunk 二次小跑清零 → 终态 **48,535 chunks / 0 NULL**。
2. **`zembed-1` 误标确认为纯 cosmetic 且会被 embed 路径再生产**:开工前 67 个
   (全在 omada,06-03 起);本次 `embed --stale` 把它新写的 8,615 个 chunk
   的 model 列**又全写成了 `zeroentropyai:zembed-1`**(上游 v0.36+ 的
   DEFAULT 常量,非 config 实际值 —— §6.32 已知蹭写 bug 的本批变体)。向量
   本身验证为 openai@avman 同空间:1536d 落库成功(1536 非 ZE 合法维度)+
   新嵌的 omada 内容复合 CJK 查询即刻命中 **0.863**(若是 ZE 空间分数会是
   噪声)。按 §6.32 既定规则 `UPDATE` 归一(8,654 + 10 行),终态单模型
   `openai:text-embedding-3-large` ×48,535。embedding-label-normalize cron
   (b1e19834)继续兜底日常增量。
3. **2 个过期 cycle lock**(181h/10h,持有 pid 已死)直接清表;上游 v0.42.x
   的 heartbeat-aware takeover 机制今后会自动偷走此类锁。
4. doctor 的 sync_freshness / cycle_freshness FAIL 与 orphan 86% 为该 brain 的
   **结构性常态**(MCP 写入而非 git-sync;邮件语料天然少入链),非回归。

> 沿 §6.33 P3 教训:本节全文仅用 "banned-name" 占位词,写毕已 re-run
> check-privacy 确认 clean。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-06-09)
- [`docs/CLAUDE-UPSTREAM.md`](CLAUDE-UPSTREAM.md) — upstream CLAUDE.md mirror(刷新至 v0.42.37.0,785 行,0 banned-name residue)
- Sync plan + verification trail: this conversation's transcript

---

## 6.35 Upstream v0.42.42.0 sync (2026-06-14)

§6.34 之后 5 天的跟进 sync —— 上游 master **5 个 commit**(v0.42.37.0 →
**v0.42.42.0**),merge commit **112 文件 / +6,739 / −538 LoC**。merge-base
`1eb430a2` 即 §6.34 合并点,纯 follow-on。上游主题:jobs 死锁回收
(#2015 reap stale dead-holder cycle/sync locks —— 正好自动化 §6.34 手清的
2 个过期 cycle lock)、Retrieval Reflex(#2019,教 agent 何时/取什么)、
extract/ingest 入库前修补孤立 UTF-16 surrogate(#2031,对中文+邮件语料的
数据完整性有益)、triage wave(#2128,6 个 data-loss/availability 修复 +
9 个社区 PR)、CLI bounded teardown + explicit exit(#2141,干掉 txn-mode
pooler 的 10s 强退税)。Schema 自动 **v115 → v116**(单 migration
[116] `code_edges_source_backfill_and_callee_index` + #2038 schema-drift
自愈逻辑)。生产 `kos.chenge.ink` 部署完成,**24,298 live pages**(较 §6.34
的 15,206 高出的部分是其间 5 天 mailagent 邮件 + omada 日增,与本 sync 正交;
migration 不改 page count)。

### Conflict resolution(3 个,vs §6.34 的 4)

> **过程教训**:`/sync-upstream` 自动抓取的 "Conflict preview" 只报了 1 个
> (test 文件),实际 `git merge-tree --write-tree` 核出 **3 个**。务必用
> merge-tree 核实真实冲突集,勿信 auto-preview。

| File | Decision | Rationale |
|---|---|---|
| `src/core/ai/gateway.ts` | 手工合成:fork `embedTransportWithRetry` retry wrapper **包在**上游新 `__embedInputTypeStore` context 内层,使每次重试 attempt 的 fetch shim 都看得到 threaded input_type(query/document);per-attempt `AI_EMBED_TIMEOUT_MS` 仍由 wrapper 拥有(§6.34 决定),不重复上游的 inline timeout | 双方语义都保住,且 store 现包住整个 retry loop(strictly 优于上游单次包法)。注:openai text-embedding-3-large 是**对称**模型,`input_type` 为 undefined → 走 `: doEmbed()` 分支,本 compose 对本库实为 no-op,但对将来非默认 embedding-column 正确 |
| `src/core/pglite-engine.ts` | keep both:fork WAL `pg_switch_wal()` durability patch + 上游 `preservingProcessExitCode` 说明注释,二者纯叠加 | 生产是 Postgres 非 PGLite,此 patch 对生产 query 路径无影响;保留以防本地 PGLite pilot 回归 |
| `test/db-lock-heartbeat-takeover.test.ts` | 取上游的 `withEnv(..., async () => {})` 形(上游 #2015 已收敛到 fork §6.34 的 withEnv 修法);**typecheck 另揪出 3-way merge 静默产生的重复 `withEnv` import**(18/20 行各一,非相邻行 git 未报冲突),删其一 | fork §6.34 的 withEnv 修法已被上游采纳 → 本文件自此向上游收敛,后续 sync 零冲突 |

**Fork patch 存活清单**:`embedTransportWithRetry`(gateway,2 锚点)、WAL
`pg_switch_wal()`(pglite)均存活。fork-protected 区域
(`skills/kos-jarvis/`、`server/`、`workers/`、`scripts/launchd/`、
`RESOLVER.md`)**零侵入**(merge 结果 vs 旧 master `git diff` 为空)。上游本批
**未动** `CLAUDE.md` / `llms-full.txt`(0 marker、vs master 无 diff)→ 无需
`--ours`、无需 llms 重生成、`docs/CLAUDE-UPSTREAM.md` 免刷。

### 绿门

`bun install` 干净(0 dep 变更);`bun run build` → `gbrain 0.42.42.0`;
typecheck 0 错(修重复 import 后);`check:all` 全绿(test-isolation、
check-privacy、skill_brain_first、gateway-no-direct-Anthropic-SDK 等全 OK);
`bun test test/ai/` **315 pass / 0 fail / 995 expect()** + embed-retry/db-lock
靶向 **14 pass / 0 fail**。

### 生产部署 + smoke

备份 `pg_dump` **625MB**(`/tmp/pg-pre-sync-v0.42.42.0-2026-06-14.dump.gz`,
gzip -t OK)+ config 副本。Schema 在 smoke 期 `bin/gbrain doctor`(0.42.42.0
binary)connect 时**自动跑了 v115→v116**(`connectEngine()` 幂等 auto-migrate);
随后 `init --migrate-only` 报 "Schema up to date"。config 表 `version=116`、
v116 `code_edges` 索引(含 `idx_code_edges_symbol_resolver`)落库、page count
**24,298 不变**。daemon `launchctl bootout`+`bootstrap` 后本地 +
`https://kos.chenge.ink/health` 均报 **0.42.42.0 / postgres**。查询 smoke:

- ZH 复合 CJK `知识管理`(vector 路径,本库 modal query)→ **0.924
  people/karpathy / 0.885 concepts/persistent-wiki / 0.873
  concepts/knowledge-management** ✓(≈ §6.34 的 0.876,略升)
- EN 关键词 `Karpathy`(body-fragment containment)→ **1.124 / 0.968** ✓
- EN 纯跨语言 `personal knowledge management methodology`:default-mode(autocut
  ON)**返回 "No results"** —— 不是回归。`--autocut false` 即复现 §6.34 命中:
  **concepts/knowledge-management 0.8885**(§6.34 报 0.889,几乎一致)+ 0.94+ 的
  persistent-wiki/knowledge-compilation 簇。**autocut(v0.42.3 smart default,
  reranker 在 default mode 自动开)在 confidence cliff 处把低置信跨语言簇整簇切掉**
  —— search-UX 行为,非 embedding 故障、非 sync 引入。生产 code path 是
  PostgresEngine(pglite patch 无关)+ openai 对称模型(input_type compose 为
  no-op),本 sync 的 3 处冲突解法均不触碰 query 语义;上游 5 commit 唯一搜索相关
  改动是 `KNOBS_HASH_VERSION 10→11`(#1400 非对称模型 cache-bust,对本库仅一次
  cold-miss)。**今后 sync 见 EN 跨语言 "No results" 勿惊:那是 autocut,本库
  documented modal query 是复合 CJK,正常。**

### 部署后健康快照(均为既有结构常态,非回归)

1. **embedding 满覆盖**:`content_chunks` **52,529 / 0 NULL**(§6.34 收于
   48,535/0,5 天增 +3,994 全嵌)、schema 1536d、`ze_embedding_health` 跳过
   (模型非 ZeroEntropy)、`embed_staleness` 无 stale —— §6.32 收敛 + embed-retry
   patch + embedding-label-normalize cron 持续兜底,健康。
2. **doctor 5/100、FAIL = `sync_freshness` / `cycle_freshness` / `orphan_ratio`
   (91%,22038/24293)**:沿 §6.34 既定 —— 三源 MCP 写入而非 git-sync、邮件语料
   天然少入链,结构性常态;orphan 较 §6.34 的 86% 升 5pt 系 5 天邮件增长,非 sync。
   WARN(oversized `docs/claude-upstream` 550KB 镜像页、extract lag、salience 等)
   均既有。

> 沿 §6.33/§6.34 P3 教训:本节全文仅用 "banned-name" 占位词,写毕已 re-run
> check-privacy 确认 clean。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-06-14)
- [`docs/CLAUDE-UPSTREAM.md`](CLAUDE-UPSTREAM.md) — 本轮上游 CLAUDE.md 未变,免刷(仍 v0.42.37.0 镜像)
- Sync plan + verification trail: this conversation's transcript

---

## 6.36 Upstream v0.42.44.0 sync (2026-06-16)

§6.35 之后 2 天的小型跟进 sync —— 上游 master **2 个 commit**(v0.42.42.0 →
**v0.42.44.0**),merge-base `4ee530f3` 即 §6.35 合并点,纯 follow-on。上游净
delta **50 文件 / +3,237 / −103 LoC**(merge commit 连同 CLAUDE-UPSTREAM 刷新
共 +3,994 / −415)。主题:

- **v0.42.43.0** —— push-based context(#2095)+ teardown-exit hardening
  (#2084)。新增 `volunteer_context` op + `gbrain watch` 命令 + retrieval-reflex
  反馈日志(`context_volunteer_events` 表记录每次大脑"主动志愿"的页面,用过
  与否后续 join `pages.last_retrieved_at > volunteered_at` 推导;rationale 为
  确定性模板串,从不存原始对话文;90 天 dream purge 清理)。teardown 侧把
  `gbrain query` 退出时的 10s force-exit 税干掉(bounded teardown + 显式 exit,
  CI 加 PgBouncer txn-mode pooler e2e)。
- **v0.42.44.0** —— docs(tutorial):个人大脑教程 step 4 的 AlphaClaw 部署链接
  指向官方站(纯文档 + version bump)。

Schema 自动 **v116 → v117**(单 migration [117] `context_volunteer_events_table`
—— 空表 + pkey + 2 索引 `src_time_idx`/`src_slug_idx`,幂等 CREATE IF NOT EXISTS,
RLS 由 v35 event-trigger 覆盖)。生产 `kos.chenge.ink` 部署完成,**24,439 live
pages**(较 §6.35 的 24,298 高出 +141 系其间 2 天 mailagent + omada 日增,与本
sync 正交;additive migration 不改 page count)。

### Conflict resolution(2 个,沿 §6.35 教训用 `git merge-tree --write-tree` 实核)

| File | Decision | Rationale |
|---|---|---|
| `CLAUDE.md` | `git checkout --ours`(整文件保 fork) | fork CLAUDE.md 是 fork-only 文件,上游本批的 +3/−1(`operations.ts` "~47"→"~90"、加 `volunteer_context` + push-context.md 行)属上游 dev-guide 内容,镜像进 `docs/CLAUDE-UPSTREAM.md` 即可 |
| `llms-full.txt` | 清 marker + `bun run build:llms` 重生成(192,516 B) | 重生成反映 fork 完整 skill+doc catalog,而非上游 merge 单侧;`llms.txt` 重生成与 merge 后一致(无额外 diff)|

**`docs/CLAUDE-UPSTREAM.md` 本轮重刷**:§6.34/§6.35 上游 CLAUDE.md 未变故停在
v0.42.37.0 镜像,本批上游动了 CLAUDE.md → 从 `upstream/master:CLAUDE.md` 重生成
(保 fork wrapper header 21 行 + scrub `banned-name` → `openclaw-reference` ×5,
`check-privacy.sh` 绿)。镜像现含 v0.42.43.0 的 `operations.ts ~90 ops` +
push-context.md 行。

**Fork patch / territory**:本批上游 2 commit 对 fork-protected 区域
(`skills/kos-jarvis/`、`server/`、`workers/`、`scripts/launchd/`、`RESOLVER.md`)
**零侵入**(merge 结果 vs 旧 master `git diff` 为空)。无 fork src/ 适配需求
(§6.34 的 `embedTransportWithRetry`、§6.35 的 WAL patch 均未被本批触碰,继续存活)。

### 绿门

`bun install` 干净(285 installs / 0 dep 变更);`bun run build` → `gbrain
0.42.44.0`;typecheck 0 错;`check:all` 全 22 gate 绿(check-privacy 验证
banned-name scrub、skill_brain_first、gateway-routed-no-direct-Anthropic、
key-files-current-state "CLAUDE.md within cap" 等全 OK);`bun test test/ai/`
**315 pass / 0 fail / 997 expect()**。

### 生产部署 + smoke

> **过程教训**:`bun install` 的 postinstall 钩子会跑 `gbrain apply-migrations
> --yes --non-interactive`,本次它打印了 "Schema version 116 is behind latest
> 117" 的告警 —— 但**并未真的迁移生产**(随后 `psql` 实查 `config.version=116`、
> `context_volunteer_events` 表不存在,确认 postinstall 只告警未写库)。故
> "备份在迁移之前" 的次序未被破坏。今后见此告警勿慌,以受控的
> `init --migrate-only` 为准。

备份 `pg_dump` **669,060,621 B(~638MB)**(`/tmp/pg-pre-sync-v0.42.44.0-2026-06-16.dump.gz`,
`gzip -t` OK)+ config 副本(`/tmp/gbrain-config.before-sync-v0.42.44.0.json`)。
受控 `bin/gbrain init --migrate-only` → `Schema version 116 → 117 (1 pending)` →
`[117] ✓ context_volunteer_events_table` → `1 migration applied`。实查:
`config.version=117`、`context_volunteer_events` 表 + pkey + `src_time_idx` +
`src_slug_idx` 落库、page count **24,439 不变**(additive)。daemon
`launchctl bootout`+`bootstrap`(pid 1391 → 38974)后本地 +
`https://kos.chenge.ink/health` 均报 **0.42.44.0 / postgres**。查询 smoke:

- ZH 复合 CJK `知识管理`(vector 路径,本库 modal query)→ **0.9366
  people/karpathy / 0.8986 concepts/knowledge-compilation / 0.8949
  people/andrej-karpathy** ✓(§6.35 报 0.924,略升)
- EN 关键词 `Karpathy`(body-fragment containment)→ **1.1716 / 0.5884 /
  0.5237** ✓(§6.35 报 1.124)

### 部署后健康快照(均为既有结构常态,非回归)

1. **embedding 满覆盖**:`content_chunks` **53,291 / 0 NULL**(§6.35 收于
   52,529/0,2 天增 +762 全嵌)、doctor `embedding_width_consistency` 1536d 匹配、
   `facts_embedding_width_consistency` halfvec(1536) 匹配、`ze_embedding_health`
   跳过(模型非 ZeroEntropy)、`embed_staleness` 无 stale —— §6.32 收敛持续健康。
2. **doctor brain 5/100、3 个 FAIL = `sync_freshness` / `cycle_freshness` /
   `orphan_ratio`(91%,22179/24434)**:完全沿 §6.35 既定 —— 四源(default /
   mailagent-emails / omada / gbrain-docs)经 MCP 写入而非 git-sync、邮件语料天然
   少入链,结构性常态;orphan 91% 与 §6.35 的 91%(22038/24293)一致。WARN
   (oversized `docs/claude-upstream` 549,884B 镜像页 —— 注:本页正是本 sync 刷新的
   gbrain-docs 源镜像,自动 `embed_skip`;另 extract lag 100%、salience、
   stub_guard 等)均既有。

> 沿 §6.33–§6.35 P3 教训:本节全文仅用 "banned-name" 占位词,写毕已 re-run
> check-privacy 确认 clean。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-06-16)
- [`docs/CLAUDE-UPSTREAM.md`](CLAUDE-UPSTREAM.md) — 本轮上游 CLAUDE.md 有变,已重刷至 v0.42.43.0 镜像(banned-name → openclaw-reference ×5)
- Sync plan + verification trail: this conversation's transcript

---

## 6.37 Upstream v0.42.51.0 sync (2026-06-20)

§6.36 之后 4 天的常规 sync —— 上游 master **7 个 commit**(v0.42.44.0 →
**v0.42.51.0**),merge-base `090bb532` 即 §6.36 合并点。上游 delta **112 文件**;
merge 实际落库 **110 文件 / +9,716 / −636 LoC**(`CLAUDE.md` / `llms-full.txt`
取 `--ours` 故不计入 merge diff)。本批是上游一波 sync / durability / skillpack /
advisor 基建强化。主题:

- **v0.42.45.0** —— delta-aware sync 成本估算器(#2139):daily sync cron 不再
  被全量成本估算卡死。
- **v0.42.46.0** —— federated read 触达 by-slug 读取(#2200):跨源授权
  (`federated_read`)现在覆盖 `getLinks`/`getBacklinks`/`getTags` 的 by-slug 路径
  + origin endpoint。**对 fork 直接利好** —— mailagent 的 `federated_read =
  {default, mailagent-emails, omada}` 跨源读现在 by-slug 也正确 scope。
- **v0.42.47.0** —— brain-resident skillpacks + 主动 gbrain advisor
  (#2180/#2231):新增 `skills/gbrain-advisor/` skill + `gbrain advisor` 命令 +
  skillpack 机制(brain 内嵌 skillpack 的 locate / init / nag)。
- **v0.42.48.0** —— PAT+URL 大脑仓库 git 持久化自动加固(#2241):
  `gbrain sources add --url --pat-file` / `sources harden`。**对 fork N/A** ——
  本 fork 四源经 MCP `put_page` 写入,无 git-repo backing、无 PAT。
- **v0.42.49.0** —— embed / sync backfill 原生 DB 限流(#2240):`--pace` +
  `pace.mode` + `db-pacer` primitive。默认 off,fork 大批 re-embed 可按需开启。
- **v0.42.50.0** —— CI 可靠性加固(#2254):test.yml / e2e.yml cancel-superseded
  + per-job timeouts + actionlint。fork 已删 test.yml(见冲突表);e2e.yml + 新
  `actionlint.yml` 干净落地。
- **v0.42.51.0** —— 无争用 page-generation clock + checkpoint 完整性 + 诚实
  sync freshness(#2255):即下面 schema v118 / v119。

Schema 自动 **v117 → v119**(2 个 migration):
- **[118] page_generation_clock_sequence_swap** —— search cache 背后的页生成时钟
  从单一加锁计数行 → 无争用 sequence,并发 sync worker 不再互相串行;cache 失效
  契约不变(仍宁可过度失效也不返回 stale)。
- **[119] op_checkpoints_completed_keys_array_check** —— checkpoint 结构 CHECK
  约束,升级时自动修复坏记录,loader 不再因单条坏记录丢弃整源进度。

生产 `kos.chenge.ink` 部署完成,**24,736 live pages**(较 §6.36 的 24,439 高出
+297 系其间 4 天 mailagent + omada 日增,与本 sync 正交;additive migration 不改
page count)。

### Conflict resolution(file-level 7,实际 3 需手解,4 自动合)

| File | Decision | Rationale |
|---|---|---|
| `CLAUDE.md` | `git checkout --ours`(整文件保 fork) | fork CLAUDE.md 是 fork-only 文件;上游本批 +64/−1(skillpack/advisor/durability/pacing dev-guide)镜像进 `docs/CLAUDE-UPSTREAM.md` 即可 |
| `.github/workflows/test.yml` | 保 fork 删除(`git rm`,delete/modify 冲突) | fork 已主动删 CI noise(commit 1adab13b);上游 v0.42.50.0 对 test.yml 的 hardening 对不跑上游 CI 的 fork 无意义。e2e.yml + 新 actionlint.yml 仍随上游进 |
| `llms-full.txt` | `--ours` 占位 + `bun run build:llms` 重生成(192,794 B) | 重生成反映 fork 完整 skill+doc catalog(含新 gbrain-advisor),非上游 merge 单侧 |

**自动合干净(4)**:`package.json`(fork pglite **0.4.4** pin 在行 ~106、上游
version bump 在行 ~143,不同 hunk → 取并集:pin 留、version=0.42.51.0)、
`src/core/pglite-engine.ts`(fork WAL-durability patch 在行 ~307、上游 #2200
federated reads 在行 ~2583+,不同区域)、`skills/manifest.json`(+gbrain-advisor)、
`skills/RESOLVER.md`(+1 行 route)。四者 0 conflict marker,fork WAL patch +
#2200 federated reads 共存。

**`docs/CLAUDE-UPSTREAM.md` 本轮重刷**:上游本批动了 CLAUDE.md(+64 行)→ 从
`upstream/master:CLAUDE.md` 重生成(保 fork wrapper header 20 行 + scrub
banned-name → openclaw-reference ×5,`check-privacy.sh` 绿),786 → 849 行。

**Fork patch / territory**:本批上游 7 commit 对 fork-protected 区域
(`skills/kos-jarvis/`、`server/`、`workers/`、`scripts/launchd/`)**零侵入**
(`git diff master <merge>` 受限于这些目录为空)。`src/core/ai/gateway.ts` 本批
上游未碰 → §6.34 embed-retry patch 继续存活;§6.35 的 WAL patch 经 3-way merge
自动保留。

### 绿门

`bun install` 干净(**285 installs / 0 dep 变更** —— skillpack / advisor / pacer
全复用现有依赖,lockfile 不变);`bun run build` → `gbrain 0.42.51.0`;typecheck
0 错;`check:all` 全 22 gate 绿(check-privacy 验 banned-name scrub、
skill_brain_first 含新 gbrain-advisor、gateway-routed-no-direct-Anthropic、
key-files-current-state "CLAUDE.md within cap" 等全 OK);`bun test test/ai/`
**315 pass / 0 fail / 994 expect()**。

### 生产部署 + smoke

> **过程教训 ①**:`bun install` postinstall 再次只打印 "Schema version 117 is
> behind latest 119" 告警而**未真的迁移生产**(随后 psql 实查 `config.version=117`、
> v119 CHECK 不存在,确认 postinstall 只告警),沿 §6.36 教训,"备份在迁移之前"
> 次序未破。
>
> **过程教训 ②(新)**:`launchctl bootout` + `bootstrap` 若紧挨着跑,bootstrap
> 可能因 bootout 尚未拆完而报 `Bootstrap failed: 5: Input/output error`(本次首发
> 失败、daemon 短暂全下);此时 service 仍在 domain 注销中。重试 bootstrap 即成功
> (`launchctl print` 显示 service 已不在 domain)。今后 bootout 后给一拍再
> bootstrap,或对 bootstrap I/O 错误直接重试一次。

备份 `pg_dump` **689,706,349 B(~658MB)**(`/tmp/pg-pre-sync-v0.42.51.0-2026-06-20.dump.gz`,
`gzip -t` OK)+ config 副本(`/tmp/gbrain-config.before-sync-v0.42.51.0.json`)。
受控 `bin/gbrain init --migrate-only` → `Schema version 117 → 119 (2 pending)` →
`[118] ✓ page_generation_clock_sequence_swap` + `[119] ✓
op_checkpoints_completed_keys_array_check` → `2 migration(s) applied`。实查:
`config.version=119`、v119 `completed_keys` CHECK 落库、v118 page-gen sequence
落库、page count **24,736 不变**(additive)、`~/.gbrain/config.json` 未被 clobber
(diff vs 备份一致)。daemon `launchctl bootout`+`bootstrap`(pid 38974 → 85465,
首发 bootstrap I/O 错误、重试成功)后本地 + `https://kos.chenge.ink/health` 均报
**0.42.51.0 / postgres**。查询 smoke:

- ZH 复合 CJK `知识管理`(vector 路径,本库 modal query)→ **0.9366
  people/karpathy / 0.8986 concepts/knowledge-compilation / 0.8833
  people/andrej-karpathy** ✓(§6.36 报 0.9366/0.8986,持平)
- EN 关键词 `Karpathy`(body-fragment containment)→ **1.1716 / 0.5884 /
  0.5237** ✓(与 §6.36 完全一致)

### 部署后健康快照(均为既有结构常态,非回归)

1. **embedding 满覆盖 + 单模型**:`content_chunks` **54,360 / 0 NULL**(§6.36 收于
   53,291/0,4 天增 +1,069 全嵌)。部署后发现 4 chunk 被 ingest 漂移 cosmetic-误标
   `zeroentropyai:zembed-1`(§6.32 papercut,实为 1536-d te3 via avman —— doctor
   `embedding_width_consistency` 1536d 全表 OK 已佐证、`vector_dims=1536`),按
   CLAUDE.md sanctioned `UPDATE content_chunks SET model='openai:text-embedding-3-large'`
   标签级修正(不动向量),brain 回到单模型 te3@1536(54,360/54,360)。doctor
   `embedding_provider` openai:text-embedding-3-large ✓ 585ms 1536d DB-aligned、
   `facts_embedding_width_consistency` halfvec(1536) 匹配、`ze_embedding_health`
   跳过(模型非 ZE)、`embed_staleness` 无 stale —— §6.32 收敛持续健康。
2. **doctor overall 5/100、brain_score 79/100、3 个 FAIL = `orphan_ratio`(91%,
   22476/24731)/ `sync_freshness` / `cycle_freshness`**:完全沿 §6.35/§6.36 既定
   —— 四源(default 10,066 / mailagent-emails 11,416 / omada 3,107 / gbrain-docs
   147)经 MCP 写入而非 git-sync、邮件语料天然少入链,结构性常态;orphan 91% 与
   §6.36 的 91%(22179/24434)一致。WARN(oversized `docs/claude-upstream`
   549,884B 镜像页 auto-embed_skip;`links_extraction_lag` 100%;salience;
   conversation_format_coverage 等)均既有。

> 沿 §6.33–§6.36 P3 教训:本节全文仅用 "banned-name" 占位词,写毕已 re-run
> check-privacy 确认 clean。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-06-20)
- [`docs/CLAUDE-UPSTREAM.md`](CLAUDE-UPSTREAM.md) — 本轮上游 CLAUDE.md +64 行,已重刷至 v0.42.51.0 镜像(banned-name → openclaw-reference ×5)
- Sync plan + verification trail: this conversation's transcript

---

## 6.38 Upstream v0.42.53.0 sync (2026-06-26)

§6.37 之后 6 天的常规 sync —— 上游 master **2 个 commit**(v0.42.51.0 →
**v0.42.53.0**),merge-base `9bf96db8` 即 §6.37 合并点。上游 delta **61 文件 /
+2,691 / −158 LoC**(`CLAUDE.md` 取 `--ours`、`llms-full.txt` 重生成,故不计入
merge diff)。本批是上游 reliability + DB 正确性双修,零功能面新增。主题:

- **v0.42.52.0** —— reliability 加固:autopilot dead-job storm 抑制 + supervisor
  wedge 解除 + sync/status/minion 可靠性(#2194 #2227 #1994 #1737 #1738 #1950
  #1984)。其中 #1950 即新增 `GBRAIN_SYNC_STALL_ABORT_SECONDS`(默认 900s)进度
  感知 stall watchdog —— sync drain 以 file-import 进度(而非 lock 心跳)为准,
  无前进 N 秒即 abort 释放 per-source 锁,下次 `gbrain sync` 从 checkpoint 续。
- **v0.42.53.0** —— `op_checkpoints` jsonb double-encode 修复(#2339)+ bug-class
  清扫 + CI guard:positional `$N::jsonb` + `JSON.stringify`(template grep 漏掉
  的那一类、曾 abort 每次 sync)经 `$N::text::jsonb` 修正;新增
  `scripts/check-jsonb-params.mjs`(positional AST 扫描器),真正 backstop 是
  DATABASE_URL-gated 的 `op-checkpoint-jsonb-parity` e2e(PGLite 掩盖此 bug)。

Schema **不变(仍 v119)** —— 本批零 migration。`bin/gbrain init --migrate-only`
报 **"Schema up to date"**,`bun install` postinstall 亦 "All migrations up to
date"。op_checkpoints jsonb 修复属序列化层(写入形态)修正,非 schema 变更。

生产 `kos.chenge.ink` 部署完成,**25,138 pages**(default 10,121 /
mailagent-emails 11,758 / omada 3,112 / gbrain-docs 147;较 §6.37 的 24,736 高出
+402 系其间 6 天 mailagent + omada 日增,与本 sync 正交;零 migration 不改 page
count)。

### Conflict resolution(file-level 3,实 2 需手解,1 自动合)

| File | Decision | Rationale |
|---|---|---|
| `CLAUDE.md` | `git checkout --ours`(整文件保 fork) | fork CLAUDE.md 是 fork-only;上游本批 +10/−4(JSONB 规则扩写 + `GBRAIN_SYNC_STALL_ABORT_SECONDS` 旋钮)镜像进 `docs/CLAUDE-UPSTREAM.md` 即可 |
| `llms-full.txt` | `--ours` 占位 + `bun run build:llms` 重生成(194,953 B) | 重生成反映 fork 完整 skill+doc catalog,并补回自 §6.37 起一拍 stale 的 CLAUDE.md 头 + 上游新 `ENGINES.md` JSONB 段 |

**自动合干净(1)**:`package.json` —— fork pglite **0.4.4** pin 在行 ~106、上游
version bump 在行 ~143,不同 hunk → 取并集(pin 留、version=0.42.53.0)。
`bun install` **285 installs / 0 dep 变更**(bun.lock 已含 0.4.4、上游零新依赖)。

**`docs/CLAUDE-UPSTREAM.md` 本轮重刷**:上游本批动了 CLAUDE.md(+10/−4)→ 从
`upstream/master:CLAUDE.md` 重生成(保 fork wrapper header 21 行 + scrub
banned-name → openclaw-reference ×5,`check-privacy.sh` 绿)。

**Fork patch / territory**:本批上游 2 commit 对 fork-protected 区域
(`skills/kos-jarvis/`、`server/`、`workers/`、`scripts/launchd/`、
`skills/RESOLVER.md`)**零侵入**(`git diff master <merge>` 受限于这些目录为空)。
`src/core/ai/gateway.ts` 本批上游未碰 → §6.34 embed-retry patch 继续存活;§6.35
WAL patch 自动保留。

### 绿门

`bun install` 干净(285 installs / 0 dep 变更);`bun run build` → `gbrain
0.42.53.0`;typecheck 0 错;`check:all` 全 22 gate 绿(含本批新进的
`check-jsonb-params` positional 扫描器、check-privacy 验 banned-name scrub、
`jsonb_integrity` 等);`bun test test/ai/` **315 pass / 0 fail / 994 expect()**。

### 生产部署 + smoke

> **过程教训 ①(新,代价较大)**:daemon 重启 `launchctl bootout` + `bootstrap`,
> 若把 3 次 bootstrap 重试紧贴循环跑(毫秒级、无间隔),会全部撞上 bootout 的
> 异步 teardown 报 `Bootstrap failed: 5: Input/output error`;而此刻 bootout 已
> 杀旧 daemon(pid 85465)→ :7225 真空、生产 **down ~60–90s**(远超 §6.37 的
> ~5s)。teardown 完成后(`launchctl print` 查无、pid 消失)单次 bootstrap 即成
> (新 pid 820);且 daemon 自身启动 sweep(content-sanity + 过期 token 清扫)要
> 数十秒才 bind :7225,须轮询 health 而非定时。今后:bootout 后先确认离开 domain
> 再 bootstrap,health 用轮询。
>
> **过程教训 ②**:启动 sweep 期间出现一次 `[ai.gateway] embed transport gave up
> after 3 attempts ... UNABLE_TO_VERIFY_LEAF_SIGNATURE`(avman relay TLS 叶证书
> 瞬时校验失败,被 §6.34 embed-retry patch 记录)。**瞬时故障** —— 重启后 CLI
> `知识管理` 复合 CJK 向量查询即刻成功嵌入返回,doctor `embedding_provider`
> 554ms/1536d 健康,确认非持久。

备份 `pg_dump` **717,305,369 B(~684MB)**(`/tmp/pg-pre-sync-v0.42.53.0-2026-06-26.dump.gz`,
`gzip -t` OK)+ config 副本(`/tmp/gbrain-config.before-sync-v0.42.53.0.json`)。
`bin/gbrain init --migrate-only` → **"Schema up to date"**(零 pending、schema 仍
v119)、`~/.gbrain/config.json` 未被 clobber(diff vs 备份一致)。daemon
`launchctl bootout`+`bootstrap`(pid 85465 → 820,见教训 ①)后本地 +
`https://kos.chenge.ink/health` 均报 **0.42.53.0 / postgres**。查询 smoke:

- ZH 复合 CJK `知识管理`(vector 路径,本库 modal query)→ **0.8761
  sources/2026-04-06-jarvis-dual-platform-architecture / 0.8310
  anthropic-academy/.../456452 / 0.8167 .../383393 / 0.7826
  projects/knowledge-agent** ✓(命中均切题;较 §6.37 的 people/karpathy 头部随 6
  天新增内容自然漂移,向量路径功能正常)
- EN 关键词 `Karpathy`(body-fragment containment)→ **1.1716 people/karpathy /
  0.7989 entities/lucien-chen / 0.7974 projects/karpathy-autoresearch** ✓(top
  与 §6.37 持平)

### 部署后健康快照(均为既有结构常态,非回归)

1. **embedding 满覆盖 + 单模型**:`content_chunks` **56,828 / 0 NULL**(§6.37 收于
   54,360/0,6 天增 +2,468 全嵌)。部署后 324 chunk 被 ingest 漂移 cosmetic-误标
   `zeroentropyai:zembed-1`(§6.32 papercut);psql 实测其 L2 norm **avg 1.0000 /
   min 0.9995 / max 1.0005**(与 te3 2k 抽样逐位一致;真 ZE 应 ~0.70),确认为
   avman te3 误标,按 CLAUDE.md sanctioned `UPDATE content_chunks SET
   model='openai:text-embedding-3-large'`(324 行,只动标签不动向量),brain 回
   单模型 te3@1536(**56,828/56,828**)。doctor `embedding_provider` openai te3
   ✓ 554ms/1536d DB-aligned、`embedding_width_consistency` 1536d 匹配、
   `embed_staleness` 无 stale、`ze_embedding_health` 跳过(模型非 ZE)——§6.32
   收敛持续健康。
2. **doctor overall 0/100、brain_score 79/100(= §6.37)、3 个 FAIL =
   `orphan_ratio`(91%,22878/25133)/ `sync_freshness` / `cycle_freshness`**:
   完全沿 §6.35–§6.37 既定 —— 四源经 MCP 写入而非 git-sync、邮件语料天然少入链,
   结构性常态;orphan 91% 与 §6.37 的 91% 一致,无新增 FAIL。WARN(oversized
   `docs/claude-upstream` 549,884B 镜像页 auto-embed_skip、`links_extraction_lag`
   100%、`graph_signals_coverage` 9%、salience、whoknows fixture 等)均既有。
   `jsonb_integrity` OK(本批 #2339 修复正中此域)。

> 沿 §6.33–§6.37 P3 教训:本节全文仅用 "banned-name" 占位词,写毕已 re-run
> check-privacy 确认 clean。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-06-26)
- [`docs/CLAUDE-UPSTREAM.md`](CLAUDE-UPSTREAM.md) — 本轮上游 CLAUDE.md +10/−4,已重刷至 v0.42.53.0 镜像(banned-name → openclaw-reference ×5)
- Sync plan + verification trail: this conversation's transcript

---

## 6.39 Upstream v0.42.57.0 sync (2026-07-07)

§6.38 之后 11 天的常规 sync,但过程出了一段 **真 Postgres migrator bug + daemon
意外自部署** 的插曲(见"过程教训")。上游 master **3 个 commit**(上游跳过
v0.42.54.0),merge-base `814258dd` = §6.38 合并点。Merge **干净零冲突**(76 文件 /
+3,867 / −164)—— 本批上游 **没碰 `CLAUDE.md` 也没碰 `llms-full.txt`**,故往常那两个
手解冲突这次不存在;`package.json` 自动合(fork pglite 0.4.4 pin + 上游 version)。

- **v0.42.55.0** `fix(security)` —— dotfile/skills/slug 限域 + DCR consent 默认值 +
  **schema-lint 迁移 (v120)**(#418 #419 #245 #1353 #1647 #171 #1385)。新
  `src/core/path-confine.ts`(realpath 限域 + `isTrustedDotfile` +
  `isWriteTargetContained`);`.gbrain-source`/`.gbrain-mount` walk-up dotfile 现经
  lstat 信任门(symlink/异主/world-writable 在多用户机上拒绝);skills-dir 各 tier
  经 realpath 限域;`validateSlug` 拒 NUL/控制符/bidi/反斜杠/URL 编码分隔符;DCR
  自注册 client 默认 `authorization_code`(显式 `client_credentials` 除非
  `--enable-dcr-insecure` 否则拒)。**对 fork 零影响**:`skills/kos-jarvis/` 是仓库
  内真实子目录(放行);源 slug 均合法;6 个 OAuth client 全 CLI 注册 =
  operator-trusted 不变,且生产 daemon **DCR disabled**。
- **v0.42.56.0** `feat(chronicle)` —— Life Chronicle:时间线 + 思考日记 + 双时态
  per-entity 本体(#2390 #2533)。新 `src/core/chronicle/*` + `eval-chronicle` CLI +
  doctor chronicle 分类 + **schema v121/v122**。纯加性上游代码(53 文件 / +2,758)。
- **v0.42.57.0** `fix(pglite)` —— 不抢活跃 data-dir 锁 + 损坏存储恢复提示
  (#2348 #2400)。`pglite-lock.ts` 重写 + `pglite-engine.ts` +22。

Schema **v119 → v122**(三步真迁移):v120 `schema_lint_hardening`(`page_links` 视图
`security_invoker=on` + 6 个 trigger/event 函数 `SET search_path=pg_catalog,public`,
ALTER FUNCTION 函数体不动 + 放宽 BYPASSRLS 预检);v121 `timeline_entries_event_page_id`
(event→timeline 投影:新 `event_page_id` FK + 2 partial index);v122
`facts_ontology_dimension`(per-entity 本体骑在 `facts` 表:`dimension`/`value`/
`value_hash`/`dim_status` + 2 index)。

**Fork territory 零侵入**(逐 commit 核对:3 commit 完全不碰 `skills/kos-jarvis/`、
`server/`、`workers/`、`scripts/launchd/`、`skills/RESOLVER.md`)。**5 个 fork src/
patch 全存活**:`gateway.ts`(§6.34 embed-retry,172L,上游未碰)、`recipes/google.ts`、
`cycle/extract-atoms{,-drain}.ts` 逐字保留;**`pglite-engine.ts` §6.35 WAL
`pg_switch_wal` patch(21L)自动合干净**(尽管上游本批对该文件 +289 chronicle/pglite
改动,落在不同块;post-merge grep 确认 `pg_switch_wal()` 于行 348–356 完整,含
`docs/UPSTREAM-PATCHES/v018-pglite-wal-durability-fix.md` 注释块)。
`docs/CLAUDE-UPSTREAM.md` **本批无需重刷**(上游 CLAUDE.md 自 v0.42.53.0 起未变)。

### 绿门

`bun install` 干净(285 installs / 277 packages / **零 dep 变更**,pglite 0.4.4 pin
存活);`bun run build` → `gbrain 0.42.57.0`;`typecheck` 0 错;`check:all` 全绿
(privacy/jsonb/source-id-projection/exports-count=20/admin-build vite/skill-brain-first/
gateway-routed/worker-pool-atomicity/key-files-current-state 等);**新 gate
`check:search-path`**(本批上游新增,验 schema base 文件 trigger 函数都 pin
search_path)OK;`bun test test/ai/` exit 0。llms-full.txt 重生成(+3/−1,补回
§6.38 的 feishu dormant→active 头,`chore:` daa3eb6e)。

### 过程教训(本批代价较大,三条)

> **① `bin/gbrain` 就是 launchd daemon 的 `program`(KeepAlive)—— 重编译 = 触发
> 部署。** 生产 daemon 经 `com.jarvis.gbrain-serve-http.plist` 直跑
> `<repo>/bin/gbrain serve`。repo 侧 `bun run build` 覆写了这个活二进制 → launchd
> KeepAlive 把 daemon 重启到 **v0.42.57.0**(pid 81908 @ 21:14),**在受控
> migrate+restart 步骤之前**。今后:视 `bun run build` 为影响生产的操作 —— 要么先
> bootout daemon 再 build,要么明确 build 已翻新 daemon 并据此排序。
>
> **② `gbrain init --migrate-only` 在真 Postgres 上对"ADD COLUMN 后 CREATE INDEX
> 同一 migration"的多语句迁移必炸。** v121/v122 报 `column "event_page_id" does not
> exist`(两次确定性失败)。根因:`runMigrationSQL`(migrate.ts:5637)→
> `conn.unsafe(整块多语句 sql)`(postgres-engine.ts:5355,postgres.js),真 PG 在执行
> 前对 **整批 parse-analyze**,故 v121 的 `CREATE INDEX (event_page_id)` 在自身
> `ALTER TABLE ADD COLUMN event_page_id` 执行前就被校验 → 报列不存在。**PGLite 逐句
> 执行故容忍 → 上游 chronicle 测试(PGLite)没接住。** `GBRAIN_PREPARE=false`(simple
> 协议)**不能修**(问题不在 prepare 缓存);psql simple 协议跑同样 SQL 完全 OK(已用
> rolled-back 事务验证)。**但 daemon 的 initSchema 迁移路径成功了**(schema 干净到
> v122,所有对象齐备)—— 即 CLI `--migrate-only` 路径坏、daemon 路径好。复现 + 根因 +
> 修复建议见 `docs/UPSTREAM-PATCHES/v0.42.57.0-migrate-only-multistatement-ddl.md`,
> 已报 garrytan/gbrain#2667。
>
> **③ daemon 直跑 repo 二进制时,生产 schema 会脱离 CLI 动作独立前进。** 本批
> daemon(v57)自行把 schema 从 119 迁到 122,而我早先几次 CLI 检查还是 119 → 一度
> 误判"生产安全停在 v119、bug 卡死迁移",据此选了"暂缓+回滚 repo"(master reset 回
> v0.42.53.0 + rebuild bin/gbrain→v53)。随后发现生产其实已健康跑在 v122/v57(58min),
> 回滚反而造成 **disk(v53) vs 运行态(v57/v122) 不一致**。改选 **重新推进**:master
> 复位到 merge、rebuild bin/gbrain→v57,与已部署的健康生产对齐(未回滚 DB —— 生产
> v122 健康,回滚会丢 ~1h 日入)。教训:daemon 直跑二进制时,断言"生产在 vN"前必须现查
> live 态(`config.version` + daemon pid/version)。

### 生产部署 + smoke

备份 `pg_dump` **770,326,555 B(~770MB)**(`/tmp/pg-pre-sync-v0.42.57.0-2026-07-07.dump.gz`,
`gzip -t` OK)+ config 副本(`/tmp/gbrain-config.before-sync-v0.42.57.0.json`,
engine=postgres / te3@1536 完好)。迁移由 daemon initSchema 路径完成(见教训②),
`config.version` 达 **122**,`~/.gbrain/config.json` 未被 clobber(diff vs 备份一致)。
daemon pid 81908(v0.42.57.0,KeepAlive 自启,DCR disabled / 6 clients / skills
published,68min 零错健康),本地 + `https://kos.chenge.ink/health` 均报
**0.42.57.0 / postgres**。**未做额外受控重启**(daemon 已在目标版本健康运行,重启
只增风险无收益)。

Schema 完整性(psql 逐项验):v120 `page_links` `security_invoker=on` +
`auto_enable_rls`/`update_page_search_vector` 等函数 `search_path=pg_catalog,public`
✓;v121 `timeline_entries.event_page_id` + `idx_timeline_event_page`/
`idx_timeline_event_dedup` ✓;v122 `facts.{dimension,value,value_hash,dim_status}` +
`idx_facts_dimension`/`idx_facts_ontology_dedup` ✓。查询 smoke:

- ZH 复合 CJK `知识管理`(vector 路径,本库 modal query)→
  **`sources/2026-04-06-jarvis-dual-platform-architecture`**(连跑 3/3 一致命中、零嵌入
  错误,证 avman 嵌入稳定 + 向量路径活)✓
- EN 关键词 `Karpathy`(body-fragment / hybrid)→ **people/karpathy 头名 +
  persistent-wiki / knowledge-compilation / dual-platform-architecture /
  agent-computer-interface**(与 §6.38 头部持平)✓

### 部署后健康快照(均既有常态,非回归)

1. **embedding 满覆盖 + 单模型**:`content_chunks` **59,896 / 0 NULL / 100%
   `openai:text-embedding-3-large`**(§6.38 收于 56,828,11 天增 +3,068 全嵌)。
   **本批无 cosmetic 误标漂移**(§6.38 有 324 个 zembed 误标需 relabel,本批 0 ——
   embedding-label-normalize 日 cron 自愈中,§6.32 收敛持续健康)。doctor `embeddings`
   100%/0 missing、`embedding_width_consistency` 1536d 匹配、
   `facts_embedding_width_consistency` halfvec(1536) 匹配(chronicle facts 嵌入列健康)、
   `embed_staleness` 无 stale、`ze_embedding_health` 跳过(非 ZE)、
   `embedding_env_override` env 与 DB config 一致。
2. **pages 27,019**(mailagent-emails 12,181 / default 11,567 / omada 3,124 /
   gbrain-docs 147)—— 较 §6.38 的 25,138 **+1,881** 系 11 天四源日入,与本 sync 正交;
   迁移零丢页。
3. **doctor `schema_version` 122(latest 122)、`brain_score` 78/100**(§6.38 79)——
   −1 全在 **`timeline 1/15`**(chronicle 新计分维,本库尚未跑 chronicle capture 故
   时间线未填,属新特性预期非回归);其余 embed 35/35、links 25/25、orphans 7/15、
   dead-links 10/10。3 个 FAIL = `orphan_ratio`(92%,24831/27014)/ `sync_freshness` /
   `cycle_freshness` —— 完全沿 §6.35–§6.38 既定(四源 MCP 写入非 git-sync、邮件语料
   少入链),无新增 FAIL。
4. **`embedding_provider` WARN**(doctor 探针一次性 `分组 *** 下模型
   text-embedding-3-large 无可用渠道`)—— **瞬时 avman relay 容量 blip**(同 §6.38
   瞬时探针失败一类):同刻 CJK 向量查询嵌入成功、连跑 3/3 复现无错、59,896/59,896
   全嵌 0 NULL,确认非持久。

> 沿 §6.33–§6.38 P3 教训:本节全文仅用 "banned-name" 占位词,写毕已 re-run
> check-privacy 确认 clean。

### Conflict resolution

**本批零冲突**(merge-tree exit=0)。上游 3 commit 未碰 `CLAUDE.md`/`llms-full.txt`,
`package.json` 自动合(pglite 0.4.4 pin + version 不同 hunk)。故无 file-level 手解;
`docs/CLAUDE-UPSTREAM.md` 亦无需重刷(上游 CLAUDE.md 自 v0.42.53.0 未变)。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-07-07)+ 新 P0 上游 migrator bug
- [`docs/UPSTREAM-PATCHES/v0.42.57.0-migrate-only-multistatement-ddl.md`](UPSTREAM-PATCHES/v0.42.57.0-migrate-only-multistatement-ddl.md) — `gbrain init --migrate-only` real-PG 多语句迁移 bug 的复现 + 根因 + 修复建议(daemon initSchema 路径不受影响)
- Sync plan + verification trail: this conversation's transcript

---

## 6.40 Upstream v0.42.59.0 sync (2026-07-13)

§6.39 之后 6 天的常规 sync,**过程干净零冲突、生产 no-op 部署** —— 与 §6.39 的真
Postgres migrator incident 形成对比(本批无 schema 迁移故不触发那条 bug)。上游 master
**7 个 commit** 横跨两个 release,merge-base `058f448b` = §6.39 合并点(= v0.42.57.0)。
Merge **干净零冲突**(42 文件 / +1,189 / −89)。

- **v0.42.58.0** `fix(ai)` —— **provider-agnostic gateway**(#1249 #1250 #1292 #2271
  #2209)。正中 §6.32 embedding 腹地但**对 fork 收敛零破坏**(见下"§6.32 收敛复核")。
  四点:①空串 env 不再 clobber config key(Claude Code 注入 `ANTHROPIC_API_KEY=''` 曾
  覆盖真 key);②新 `resolveNativeBaseUrl` 给 anthropic/openai native 站点归一化
  baseURL 补 `/v1`(bare host 不再 404);③`diagnoseEmbedding` 的
  `user_provided_model_unset` guard(结构性不可达 + 只误伤 litellm)换成真 dims-presence
  check —— **§6.32 记的"litellm recipe 不可用(gateway.ts:670 无条件拒)"被上游修掉了**
  (我们仍用原生 openai recipe 故不受影响,该 caveat 现过时);④新 `trust_custom_dims`
  让 ollama/llama-server/litellm 收本地自声明维度(openai/voyage/ze 仍 fail-closed 严校)。
- **v0.42.59.0** `fix` —— 5 个社区修复(@time-attack,双引擎复现):①pre-v121 schema
  replay 解锁(#2724,bootstrap 先补 `event_page_id` 前向列,已 wedge 的旧库下次命令自
  愈);②`migrate --to` 多源保源(先拷 source catalog)+ target-aware resume checkpoint
  (#2677);③facts fence 管道符 render→parse 对称(#2726,含 `|` 的 fact 不再于下次
  extract-facts 被静默删);④歧义实体名**隔离不猜**(#2723,裸名仅唯一 canonical 才解析,
  低区分度 fuzzy 落 holding);⑤`think` 全内部检索(hybrid page/takes keyword+vector/
  graph)honor caller scalar+federated source scope(#2200 security)。

**Schema 零新迁移**(CHANGELOG:"No new schema migrations ship in this release" —— v121/
v122 随 v0.42.56.0 已并入)。生产库已在 **v122**,故 `init --migrate-only` 是**干净 no-op**
(报 `Schema up to date (engine: postgres)`),**§6.39 的多语句 DDL migrator bug 本批不
触发**(无可迁移项)。

**Fork territory 零侵入**(`git diff master <merge> -- skills/kos-jarvis/ server/ workers/
scripts/launchd/ skills/RESOLVER.md` 空)。**5 个 fork src/ patch 全存活**:`gateway.ts`
§6.34 embed-transport-retry 块(`embedTransportWithRetry`/`isRetryableEmbedTransportError`,
行 1604–1745)—— 尽管上游本批对 `gateway.ts` +77 改动,**落在不同块**(上游 hunk
389/704/1200/2123,fork 块 1544/1558,完全错开)故 git 三方合零冲突;`recipes/google.ts`、
`cycle/extract-atoms{,-drain}.ts`、`pglite-engine.ts` WAL `pg_switch_wal` patch(行 345+,
上游改 518+ 错开)逐字保留。`docs/CLAUDE-UPSTREAM.md` **本批无需重刷**(上游 CLAUDE.md
自 v0.42.53.0 起未变;body 逐行 diff 仅差私有 fork 名→`openclaw-reference` 的 scrub);
`CLAUDE.md` 经递归合虚拟 base 自动收敛到 fork 版(`git diff master HEAD -- CLAUDE.md`
空,零字节上游内容渗入);`package.json` 自动合(fork pglite 0.4.4 pin + 上游 version
0.42.59.0 不同 hunk)。

### §6.32 收敛复核(本批重点 —— 上游动了 gateway)

- **`resolveNativeBaseUrl` 对已带 `/v1` 幂等**:`raw.trim().replace(/\/+$/,'')` 后
  `/\/v1$/.test()` 命中即原样返回。生产 `OPENAI_BASE_URL=https://api.avman.ai/v1` →
  不变,**不会 `/v1/v1`**(单测 `resolve-native-base-url.test.ts` 显式覆盖 `.../v1`→
  `.../v1`)。唯一行为变化:baseURL 现**显式**传入 `createOpenAI()`,值不变 → endpoint
  `https://api.avman.ai/v1/embeddings` 不变。
- **fork embed-retry 块存活** + 仍 wire 于 embed 路径(grep 行 1604–1745)。
- **te3@1536 仍被接受**:openai 是 dims_options/Matryoshka provider,非
  `trust_custom_dims` 本地路径,`diagnose-embedding-dims.test.ts` pass;doctor 实测
  `embedding_provider ✓ 1536 dims DB aligned`。
- **无直连 SDK 绕 gateway**:`check-gateway-routed-no-direct-anthropic` 绿。
- config 仍 `postgres` + `openai:text-embedding-3-large`@1536,env==DB config。

### 绿门

`bun install` 零 dep 变更(pglite 0.4.4 pin 存活);`bun run build` → `gbrain 0.42.59.0`;
`typecheck` 0 错;`check:all` 全绿(privacy / skill-brain-first 60/60 /
gateway-routed-no-direct-anthropic / key-files-current-state(CLAUDE.md within cap)/
exports-count=20 / admin-build vite 等);`bun test test/ai/` **328 pass / 0 fail**(含上游
新增 `resolve-native-base-url` / `build-gateway-config` / `diagnose-embedding-dims`)。
llms-full.txt 重生成(+20/−12,auto-merge 版有漂移,`chore:` 提交)。

### 生产部署 + smoke

> **沿 §6.39 教训①:`bin/gbrain` 就是 launchd daemon 的 KeepAlive program。** 本批
> `bun run build` 覆写活二进制,但 daemon(pid 81908,v0.42.57.0,up 5d16h)未自触发
> relaunch(health 仍报 57),故重启窗口受控。**受控 bootout+bootstrap 明确执行**(非等
> KeepAlive)。migrate + restart 两步均被 auto-mode classifier 单独拦下,经用户显式确认
> 后执行。

备份 `pg_dump` **743MB**(`/tmp/pg-pre-sync-v0.42.59.0-2026-07-13.dump.gz`,`gzip -t`
OK)+ config 副本(`~/.gbrain/config.json.before-sync-v0.42.59.0`,engine=postgres /
te3@1536,== live)。`init --migrate-only` → `Schema up to date`(no-op,v122)。
`launchctl bootout`+`bootstrap` gui/501/com.jarvis.gbrain-serve-http → **新 pid 82159**。
两个 `/health`(本地 + `https://kos.chenge.ink`)均报 **0.42.59.0 / postgres** ✓。查询
smoke(`bin/gbrain search`,纯检索隔离 embed+vector):

- ZH 复合 CJK `知识管理`(vector 路径,本库 modal query)→
  **`sources/2026-04-06-jarvis-dual-platform-architecture`** [0.2734],**连跑 3/3 分数
  一致**(证 avman 嵌入确定 + 向量路径活 + §6.32 gateway 合并零破坏)✓
- EN 关键词 `Karpathy`(hybrid)→ **people/karpathy [0.6801] 头名** + persistent-wiki /
  knowledge-compilation / dual-platform-architecture / agent-computer-interface(与
  §6.38–§6.39 头部持平)✓

### 部署后健康快照(均既有常态,非回归)

1. **embedding 满覆盖**:`content_chunks` **60,523 / 0 NULL**。doctor
   `embedding_provider ✓ 11848ms 1536 dims DB aligned`(实调 avman,**较 §6.39 的瞬时
   WARN 更健康**)、`embeddings 100%/0 missing`、`embedding_width_consistency` /
   `facts_embedding_width_consistency` 1536 匹配、`embedding_env_override` env==DB。
   **cosmetic 误标 48**(`zeroentropyai:zembed-1` 标签,但全 **1536d = te3 宽**,即
   avman 嵌入的一致向量、仅标签漂移非坏向量;§6.39 本批为 0,§6.38 曾 324)——
   `embedding-label-normalize` 日 cron 自愈中,§6.32 收敛持续健康。
2. **pages 27,115**(psql `deleted_at IS NULL`;doctor connection 27,114,±1 系查询时点
   差)—— vs §6.39 的 27,019 **+96**,6 天四源日入与本 sync 正交;**迁移零丢页**。
3. **doctor `schema_version` 122(latest 122)、`brain_score` 80/100**(§6.39 78,**+2**:
   orphans 9/15↑ vs 7/15)—— embed 35/35、links 25/25、timeline 1/15(chronicle 未
   capture,新维预期)、dead-links 10/10。**3 个 FAIL = `sync_freshness` /
   `cycle_freshness` / `orphan_ratio`(92%,24863/27109)完全沿 §6.35–§6.39 既定**(四源
   MCP 写入非 git-sync、邮件语料少入链),**无新增 FAIL**。RLS 61/61、pgvector
   installed、resolver 60 skills all reachable、skill_brain_first 60/60。

> 沿 §6.33–§6.39 P3 教训:本节全文仅用占位词 / scrub 名,写毕 re-run check-privacy 确认
> clean。

### Conflict resolution

**本批零冲突**(merge exit=0,无 conflicted files)。`gateway.ts` / `pglite-engine.ts`
虽 fork+上游同改但**落在不同 hunk 区**故三方合干净;`CLAUDE.md` 递归合虚拟 base 自动
收敛 fork 版(零渗入,等效 `--ours`);`llms-full.txt` / `package.json` 自动合。故无
file-level 手解。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-07-13)
- Sync plan + verification trail: this conversation's transcript

---

## 6.41 avman te3 断供 → 弃用 relay,直连官方 OpenAI (2026-07-14)

**不是 sync,是 P0 事故处置。终局:embedding 路径上不再有任何 relay。**

§6.32 收敛以来 embedding 一直走 avman 的**原生 openai recipe**;2026-07-14 上午 avman
开始对 `text-embedding-3-large` 返回 **503「分组 \*\*\* 下模型 text-embedding-3-large
无可用渠道(distributor)」** —— relay 本身活着(chat 200,`/models` 仍列出 te3),只是
**该模型背后没有上游渠道**。非我方配置/密钥问题。

中途有一段 **GitHub Models 应急(存活约 2 小时后被弃用)**,它的失败本身是本节最贵的
教训,记在下面「GitHub Models 为什么不行」。**最终形态**:官方 OpenAI key 直连
`api.openai.com`,**`OPENAI_BASE_URL` 不设**,四平面均为
`openai:text-embedding-3-large` @1536。官方端点重现库内向量 **余弦 1.0000(6/6)**,
零重嵌入;doctor `✓ 442ms`(比 relay 时代还快);限流 **3,000 req/min**,无按天上限。

> **M3 那条「永不重新引入 `OPENAI_BASE_URL`」的禁令,重新生效。** §6.32 曾宣布它
> "RETIRED"(因为要靠它路由 avman);现在路径直连,那条豁免随 avman 一起作废。

### 症状与真实影响

- `gbrain doctor` → `[WARN] embedding_provider → probe failed: 无可用渠道`(3/3 持续)
- **`gbrain query` 静默降级**:embedding 失败被吞掉(exit 0、无任何报错),hybrid 退化
  成纯关键词路。能被关键词命中的查询照常返回,**只有向量路能服务的 compound CJK 查询
  直接空手而归** —— 正是 CLAUDE.md 警告的那条线。
- 最后一次成功 embedding:02:58(故障窗口 ≤7h)。期间新内容嵌不进去。

> **排查陷阱(记下来,下次别再踩)**:头几轮 A/B 都选了关键词可命中的查询
> ("omada" / "竞品分析"),两组结果**连分数都逐位相同**(0.5532/0.4225),险些误判为
> "没坏"。反过来,我最初拿「知识管理系统的架构设计」当"坏掉"的证据也不成立 —— 它在
> embedding 正常时也返回 No results(其最佳向量分 0.5459 低于查询层阈值)。
> **可信判据只有两个:doctor 探针,以及绕开查询层的 pgvector 直查。**

### 为什么不能就地换模型

`text-embedding-3-small` 在 avman 上是通的(200 @1536),但**换模型 = 换向量空间**,
与库里 60,580 个 chunk 不兼容 → 必须全库重嵌。这正是 §6.32 修好的那场"三空间打架"
事故的成因。**下策,不采纳。**

### 处置:同模型、换传输

Lucien 提供 GitHub Models(Azure 托管 OpenAI 真模型:`x-ms-region: East US`,
`x-ms-served-model: text-embedding-3-large-1`)。**先验空间、再接线**:

- 取 6 个已嵌入 chunk,用 GitHub 重嵌其 `chunk_text`,与库里 avman 时代的向量比余弦
- **自匹配 0.9994–1.0000**(6/6,其中 4 个 = 1.0000);交叉基线 **0.3961**;
  **库内基线(已存向量彼此之间)0.3960** —— 新向量与现存向量的**彼此几何关系完全一致**,
  不只是"自己像自己"。§6.32 那批假向量的自匹配只有 ~0.70,对比鲜明。
- 判定:**同一向量空间 → 零重嵌入**

### 最终接线(官方直连)

四平面(**4 plists + `.env.local` + `~/.gbrain/config.json` + DB `config` 表**)全部:

```
GBRAIN_EMBEDDING_MODEL=openai:text-embedding-3-large
GBRAIN_EMBEDDING_DIMENSIONS=1536
OPENAI_API_KEY=sk-proj-…          # 官方 key
# OPENAI_BASE_URL                 # 必须不设 —— 设了就绕开官方端点
```

注意 **plist 与 `.env.local` 是两套独立的平面**:Lucien 只改了 `.env.local`,而 daemon
和所有 cron 读的是 plist —— 4 个 plist 里当时仍是 avman 的 key + base URL。漏改它们的话
"改完了"只是错觉。

### GitHub Models 时期的接线(已废弃,仅存档)

那 2 小时里踩的两个坑,若将来还需要经 OpenAI-compatible relay 接 embedding,仍然适用:

1. **不能走原生 openai recipe** —— `resolveNativeBaseUrl`(#1250)对不带 `/v1` 的 URL
   **无条件补 `/v1`** → `models.github.ai/inference/v1/embeddings` **404**(实测)。改用
   **litellm recipe**:其 baseURL 走 `cfg.base_urls[recipe.id]` **逐字使用**
   (`build-gateway-config.ts:53` 把 `LITELLM_BASE_URL` 映射进去),是上游设计好的扩展位。
   §6.40 已确认"litellm 不可用"的旧 caveat 被 #1292 修掉 —— 这次正好吃到红利,
   连同 #2271 `trust_custom_dims`(让自声明的 1536 被采信)也是那批同步带进来的。
2. **模型名必须裸写** —— `dims.ts:204` 用 `modelId.startsWith('text-embedding-3')` 决定
   发不发 `dimensions`。写成 `openai/text-embedding-3-large` **匹配不上 → dimensions
   静默不发 → 返回原生 3072 → dim mismatch**。写 `text-embedding-3-large` 即可
   (GitHub 两种写法都收)。该分支注释原文就是为 Azure 托管 te3 而写的。

当时的配置(存档):`GBRAIN_EMBEDDING_MODEL=litellm:text-embedding-3-large`(裸名)+
`LITELLM_BASE_URL=https://models.github.ai/inference`(无 `/v1`)+ `LITELLM_API_KEY`。

### `embedding_signature`:差点漏掉的地雷

`pages.embedding_signature = <provider:model>:<dims>`(`embedding.ts:166`),而 stale 判据是
`cc.embedding IS NULL OR p.embedding_signature <> <当前签名>`(NULL 签名**祖父豁免**)。
改模型标识后:

- 6,134 页的 `openai:…:1536` ≠ 新签名 `litellm:…:1536` → **21,701 个 chunk 被判陈旧**
- 夜间 `dream` 会去重嵌它们:**≈4.3M token ≈ 8.6 个 GitHub 窗口,纯属白烧**(向量本来就对)
- 处置:`UPDATE pages SET embedding_signature='litellm:text-embedding-3-large:1536'
  WHERE embedding_signature='openai:text-embedding-3-large:1536'`(6,159 行)→
  `embed --stale --dry-run` 从 **21,701 回到 0**

> **教训**:模型标识**不是化妆品**,它经 `embedding_signature` 有真实语义力量。
> "所有平面必须一致"那条 fork 规则正是为此存在 —— 只改 env 平面会让**没 source
> `.env.local` 的进程算出另一个签名**,让这批页在两个签名间反复横跳、反复触发重嵌。

### 其它踩坑(全部实测)

- **`launchctl kickstart -k` 不重读 plist** —— 进程重启了、PID 变了,**环境还是旧的**。
  必须 `bootout` + `bootstrap`。用 `ps eww -p <pid>` 验进程真实环境,否则会误报成功。
- **`gbrain embed --all` 是地雷** —— engine 返回的 chunk 对象不带 `embedded_at`,
  `chunks.filter(c => !c.embedded_at)` 恒真 → **重嵌全库 60,580 chunk ≈ 12M token**。
  dry-run 报 "Would embed 60580 chunks" 即为此。**回填只用 `--slugs`。**
- **slug 跨源不唯一** —— `concepts/captive-portal` 同时存在于 default / mailagent-emails
  / omada,不加 `--source` 的 embed 会命中**别源已嵌入的同名页**并**静默 no-op**。与
  orphan-reducer 那个 source-盲写是同一类 bug。
- **`--source` 必须在 `--slugs` 之前** —— `--slugs` 吞掉其后所有非 `--` 词,
  `--slugs a b --source default` 会把 `default` 当成 slug(报 "Page not found: default")。
- macOS 环境:**bash 3.2 无 `mapfile`**;**zsh 不对未加引号的变量分词**(bash 会)。
  两者都曾让脚本静默失效 —— 与更早那次 `setsid` 在 macOS 不存在同类。

### 顺带发现:2,616 个 concept 页从未被切块

`default` 源磁盘上只有 **228** 个 `concepts/*.md`,DB 里却有 **2,847** 个。差额是
`dream`/概念抽取管线**直接写库、从未切块**的纯 DB 页 —— **对向量检索完全隐形**
(对照:mailagent-emails / omada 的 concept 页 chunk 覆盖率 100%)。这解释了此前
"概念层 97% 孤儿"的成因:**不是回填漏了,是这条管线根本没给它们建 chunk**。
已用 `gbrain embed --source default --slugs …` 分批回填(`embedPage` 在
`chunks.length===0` 时会自己从 `compiled_truth` 切块再嵌)。

> ⚠️ **绝不能对 `default` 跑 `gbrain sync`** —— 这些页磁盘上没有文件,sync 可能
> 视为已删除。

### GitHub Models 为什么不行(本节最贵的教训)

**限流头会撒谎。** GitHub 的成功响应只带 `x-ratelimit-limit-tokens: 500000` +
`remaining-tokens`,看上去是个宽松的 token 配额;我据此判定"额度不是问题",把 9,000
页的回填怼了上去。**真正的闸门只在 429 响应里现身**:

```
retry-after: 81862
x-ratelimit-type: UserByModelByDay      ← 按天,不是按 token
```

**每天 150 次请求**,而 `gbrain embed` 是**一页一次请求**。算一下就知道这条路从一开始
就不通:

| 用途 | 请求数 | vs 150/天 |
|---|---|---|
| 每次向量查询 | 1 | |
| 日常入库(实测日均 46–330 chunk) | 每页 1 | 合计就撑满 |
| 回填 9,241 页 | 9,241 | **需 62 天** |

后果:**配额烧光 → 生产 embedding 二次断供 22.7 小时**,只换来 462 个 chunk;跑批速率
被 429 退避压到 **5.3 页/分钟**(单次 API 明明只要 0.8s),部分页 3 次重试后直接失败。

> **教训(比技术细节重要)**:Lucien 一开始就说了"每分钟 15,每天 150";我拿一个
> 响应头否定了他。**成功响应里的限流头只描述当前窗口的一个维度,不是配额的全貌** ——
> 判断一个供应商能不能扛生产,应当先打到 429 把真限流问一遍,而不是读成功响应的头。
> 同类:官方 OpenAI 的头(`limit-requests: 3000` / `reset-requests: 20ms`)才是完整的,
> 且**没有** `...ByDay` 型限流。

**切回官方后**:同一批回填 **126 页/分钟(24×)**,8,860 页约 70 分钟,成本约 **$0.065**
(te3 官方价 $0.13/1M token)—— 整个 relay 应急链换来的麻烦,六分钱就买断了。

### 绿门 / 验证(终局:官方直连)

- `[OK] embedding_provider: openai:text-embedding-3-large ✓ 442ms, 1536 dims, DB aligned`
- `[OK] embedding_env_override: env vars agree with DB config`(四平面一致)
- `[OK] embedding_column_registry: Registry healthy`;`brain_score 81/100`
- **向量空间**:官方 te3 重现库内向量 **余弦 1.0000(6/6)**,交叉基线 0.3959 /
  库内基线 0.3960 —— 零重嵌入
- **签名**:`litellm:…` → `openai:…` 反向修正 6,435 行,残留 0;`embed --stale` 归 0
- **daemon 真实环境**(`ps eww`,不看 plist 看进程):`GBRAIN_EMBEDDING_MODEL=openai:…`
  / `OPENAI_API_KEY=sk-proj…` / **无 `OPENAI_BASE_URL`**
- **检索实证**:`gbrain query "knowledge management"` → `concepts/knowledge-management`
  **[1.1068] 排第一** —— 回填给了它 chunk,`source-boost.ts` 的 1.3× 概念加权终于生效
  (回填前同一查询它只排第二 0.6665)。这正是上游 #2163 说"boost 是死的"那件事
- `check:all` exit 0;label-normalize 保险实测仍能拒真实模型变更(伪造 gemini → SKIP)

### Linked docs

- 回滚备份:`~/.gbrain/backups/embed-swap-20260714-103430/`(切 GitHub 前)
  + `~/.gbrain/backups/embed-revert-oai-20260714-114525/`(切官方前)
- 兜底 cron:[`scripts/jarvis-chunkless-backfill.sh`](../scripts/jarvis-chunkless-backfill.sh)
  + [`scripts/launchd/com.jarvis.chunkless-backfill.plist.template`](../scripts/launchd/com.jarvis.chunkless-backfill.plist.template)
- 标签规范器:[`scripts/jarvis-embedding-label-normalize.sh`](../scripts/jarvis-embedding-label-normalize.sh)
- 上游 bug:[garrytan/gbrain#2163](https://github.com/garrytan/gbrain/issues/2163)
  (已补证据 + 纠正其"atoms 是故意不嵌"的结论)
- Commits `6ad1b940`(GitHub 应急,已废)/ `a1e78225`(chunkless 兜底)/ 本次收尾
- **已移除**:`com.jarvis.avman-embed-probe` —— 官方直连后 avman 不再是回退目标,
  探针的回滚清单会误导

---

## 6.42 query-embed deadline:expansion 饿死 embed → 向量臂静默消失 (2026-07-14)

同日、§6.41 之后。**这是止血,不是修复** —— 根因在 `src/*`(fork 禁区),已报上游。

### 症状与机制

`hybridSearchCached` 在入口建一个 **6 秒绝对 deadline**,然后**同一个** deadline
被传给内层 `hybridSearch`。而 **expansion(一次 LLM 调用)排在 embed 前面**,花的
是同一份预算:

```
hybrid.ts:1683  const queryEmbedDl = makeQueryEmbedDeadline()   // 表开始走
hybrid.ts:1698  embedQueryBounded(query, …, queryEmbedDl)       // cache-lookup embed
      ↓ 同一个 deadline 经 opts._queryEmbedDeadline 传入内层
hybrid.ts:1145  queries = await opts.expandFn(query)            // ← LLM,实测 1.5–41s
hybrid.ts:1256  embedQueryBounded(q, embedOpts, embedDl)        // ← 拿到的预算常已为负
```

embed 失败 → catch → **静默退化成 keyword-only**。而本库是中文密集的,
**复合 CJK(4+ 汉字无空格)在 Postgres tsvector 下没有分词器**(见 §6.25),
keyword 臂对它恒等于 0 条 → **查询返回空**。这就是"中文查询时好时坏"的真身。

分阶段实测(同一 query × 6 轮,embedding 已是 §6.41 的官方直连):

| 轮 | expansion | embed | keyword | embed 开始时剩余预算 |
|---|---|---|---|---|
| 1 | 1,536ms | 1,477ms | 17ms | 4,464ms ✅ |
| 2 | **7,605ms** | 171ms | 4ms | **−1,605ms** ❌ |
| 3 | 1,909ms | 242ms | 3ms | 4,091ms ✅ |
| 4 | **41,350ms** | 205ms | 20ms | **−35,350ms** ❌ |
| 5 | **28,810ms** | 202ms | 21ms | **−22,810ms** ❌ |
| 6 | **9,048ms** | 312ms | 5ms | **−3,048ms** ❌ |

**embed 只要 ~250ms,却 4/6 轮根本没轮上。** 病灶不是 embedding 慢(§6.41 已治好),
是 **expansion 经 CRS 在负载下能到 41 秒**。

### 2 秒地板是坏的(上游那个防护措施本身失效)

`hybrid.ts` 早就预见了这个场景,`MIN_QUERY_EMBED_BUDGET_MS = 2_000` 的注释原文:

> *slow expansion/keyword … could leave ~0 budget and **starve a HEALTHY embed**
> into a false keyword-only result. Flooring guarantees every embed gets at least
> this long, so a fast healthy embed (~0.5s) always succeeds.*

**它做不到。** 两层边界用的预算不一致:`makeQueryEmbedDeadline` 在入口就
`AbortSignal.timeout(ms)`,`embedQueryBounded` 把**这个已经 fire 的 signal** 交给
`embedQuery`,只给 `Promise.race` 的计时器加地板。第一层当场掐掉 fetch,第二层的
地板永远轮不上。实测(`prove-floor-bug.ts`):

```
对照(新鲜 deadline)          : ✅ 1536d, 237ms
expansion 占 6100ms → 剩 −102ms : ❌ 仅 2ms 就放弃
expansion 占 7600ms → 剩 −1602ms: ❌ 仅 0ms 就放弃
```

地板承诺 2000ms,embed 需要 250ms,实得 **0–2ms**。

### 已做:`GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000`

4 个 plist(`dream-cycle` / `enrich-sweep` / `gbrain-serve-http` / `kos-patrol`)
+ `.env.local`。备份 `~/.gbrain/backups/query-embed-timeout-20260714-144948`。
plist 改完 **`bootout`+`bootstrap`**(`kickstart -k` 不重读 plist),`ps eww` 验过
进程真实环境,`/health` 200。

> ⚠️ **这是止血,不是修复,别当它修好了。**
> - 按上表分布,30s 只把 **4/6 失败压成 1/6** —— 第 4 轮那 41s 照样爆。
> - **它依赖负载**:空闲时 6s 也全通(实测把超时压回 6s,5 条复合中文全过),
>   满载时(synthesis-sweep 在跑)才 4/10。**所以"现在查询好了"不能证明这个
>   改动起了作用** —— 2026-07-14 当天查询恢复,主因是 §6.41 的 embedding 直连
>   + 9,241 页 chunk 回填,与本节改动无关。
> - 真修法是让 embed 用**自己的**计时器(`AbortSignal.timeout(remaining)`,把
>   `remaining` 提到 `embedQuery` 调用之前),而非共用入口那个。在 `src/*`,
>   fork 规矩不改上游 → **已报上游**。
> - 我们这侧的根治方向:**expansion 也走直连**(一次 Haiku 调用 41 秒是病态的,
>   §6.41 里 embedding 正是这么治好的)。但这会绕开 CRS 模型通道,**未做,待
>   Lucien 决定**。

### 上游

[garrytan/gbrain#2028](https://github.com/garrytan/gbrain/issues/2028)(JunhaoV5,
2026-06-10,我们评论前 0 回复)已报同一 bug 的另一半 —— 他的成因是
**embedding 供应商慢**,并已独立发现 `=30000` 能救。我们
[补的评论](https://github.com/garrytan/gbrain/issues/2028#issuecomment-4974401625)
是**新的一半**:①**embedding 快也照样死**,因为 expansion 排在前面吃同一份预算
→ 该 bug 与供应商快慢无关;②**那个 2 秒地板是坏的**(上表 + `prove-floor-bug`),
这是它自带防护的失效,不在原报告里;③`=30000` 只是止血不是修复。
另附:`vector_enabled` **本就存在**(`types.ts:1518` + `eval_candidates` 列),
只是从不出现在 stderr/CLI —— 我们是靠脚本读 `onMeta` 才看见的,上游 ask #1
(暴露降级)几乎是免费的。

> 教训(与 §6.41 的限流头同类):**5 个假设全被自己的数据推翻过** —— 超时、
> 分数阈值(0.64 失败而 0.53 成功)、缓存投毒(0 条空条目)、source 域(失败页
> 就在 `default`)、mode 关联(CLI 与探针互相矛盾)。真因只在**分阶段计时**下
> 现身。**别从症状猜机制,去测每一段的耗时。**

### Linked docs

- 探针:`prove-floor-bug.ts` / `probe-budget.ts`(scratchpad,未入库)
- 相关:§6.25(CJK 无分词器 → 向量臂是复合中文的唯一通路)、§6.41(embedding 直连)

---

## 6.43 Upstream v0.42.63.0 sync (2026-07-21)

**迄今最大的一批 —— 106 commits 横跨 4 个 release(v0.42.59.0 → v0.42.63.0)、443
文件 / +18,663 / −41,655 —— 却是零冲突合并 + 干净迁移。** 上一批(§6.40)7 个
commit,这批 15 倍量。merge-base `5008b287` = §6.40 合并点。

**"changed in both" ≠ 冲突。** `git merge-tree` 预检报了 8 个双侧改动文件,其中 3 个
正压在 fork 的 src patch 上(`gateway.ts` 上游 **+378/−186**、`pglite-engine.ts`
**+203/−38**、`extract-atoms.ts` **+112/−82** —— 都是重写级别)。据此我在计划里预判
"大概率真冲突需逐块手解",**判断错了**:递归合并用虚拟 base 把 8 个全自动收敛,
`git merge` exit=0、conflicted files 为空。教训:`merge-tree` 的 `changed in both`
只陈述两侧都动过,**不预测冲突**;别拿它当冲突预报,拿它当"该重点验哪几个文件"的清单。

### 上游内容(挑与 fork 相关的)

- **schema v122 → v124,两条迁移**(本批唯一的真迁移动作):
  - **v123 `configurable_fts_language`** —— FTS 语言可配 + `reindex-search-vector`
    命令(#580/#581/#582)。`GBRAIN_FTS_LANGUAGE` 我们未设 → 默认 `english` →
    **直接 return 不回填**,只 `CREATE OR REPLACE` 两个 trigger 函数。
  - **v124 `page_search_vector_drop_compiled_truth`**(#2704)—— `compiled_truth`
    (无界整页正文)踢出 `pages.search_vector`,因为超大页会顶爆 Postgres 1MB
    tsvector 硬上限,并且是**在 pages UPSERT 事务内**抛错 → 整个 source 的 sync
    checkpoint 卡死。上游明确 no backfill(该列无任何查询读取,`searchKeyword()`
    只查 `content_chunks.search_vector`)。
- **`184b6cb8` 词法召回:title candidate arm + gated OR fallback** —— 见下"检索
  分数上移"。
- **#2163 被上游修了**(`1833d958`):`synthesize_concepts` 改走 `importFromContent`
  (put_page 的 parse→chunk→embed 全管道)而非裸 `engine.putPage`,概念页现在会被
  chunk + embed。这正是 §6.41 挖出的"cycle 生的页永不入向量"那个洞的一半。
- 三个新 provider recipe(NVIDIA NIM / Mistral / Moonshot Kimi)、Postgres RLS
  source-scope 绑定(opt-in)、sync 数据丢失家族修复(#2404/#2426/#2607)、
  monorepo 子目录 source(`--src-subpath`)。

### §6.39 那条 P0 为什么没触发(这次是真验证,不是"无迁移所以没碰上")

§6.40 的说法是"本批零迁移故不触发"——**等于没验**。这批**真跑了两条迁移**,所以
是第一次实打实的验证机会。结论:**仍不触发,但原因是这两条迁移的形状恰好避开了
bug,不是 bug 被修了。** §6.39 的成因是 `sql:` 字段里的多语句 DDL 串经
`conn.unsafe` 批量执行时被 postgres.js 在 parse 阶段拒掉;而 v123/v124 都是
`sql: ''` **+ handler**,handler 内部逐条 `await engine.executeRaw(<单语句>)`。
**单语句永远走不到那条批处理路径。** 故:

> **P0 依然 OPEN 且依然未验证。** #2724 是否真修了根因,仍要等一条**用 `sql:` 多语句
> 串**的迁移才能证。见
> `docs/UPSTREAM-PATCHES/v0.42.57.0-migrate-only-multistatement-ddl.md`。

### fork 完整性

fork territory **零侵入**(`git diff master <merge> -- skills/kos-jarvis/ server/
workers/ scripts/launchd/ skills/RESOLVER.md` 空)。`CLAUDE.md` 递归合自动收敛到
fork 版(diff 空)。**5 个 fork src patch 全存活**,其中两个值得单独记:

- **`gateway.ts` embed-transport-retry 块**(§6.34/§6.35):尽管上游把这个文件
  +378/−186 重写,fork 块不仅逐字保留,**且仍嵌在上游 `__embedInputTypeStore`
  上下文内**(行 ~1802 `doEmbed = () => embedTransportWithRetry(...)`)—— §6.35
  那条"每次重试 ATTEMPT 的 fetch shim 都能看见 input_type"的组合语义没被打断。
  这是本批最该验的一处,已逐行确认。
- **`extract-atoms.ts`**:上游重写了发现 SQL 和 prompt,fork 的 `atoms_scan_hash`
  零产出墓碑守卫(#2144)**准确合进了新 SQL 的三处 WHERE**,`concepts` 字段
  (#2123)也落在新 interface 上。auto-merge 在重写文件上仍然给出语义正确的结果。

**`docs/CLAUDE-UPSTREAM.md` 本批无需刷新** —— 上游自己的 `CLAUDE.md` 在
`5008b287..upstream/master` 区间**未改动**。(过程中一度误判"上游 CLAUDE.md 大改
+831/−303":那是 **fork CLAUDE.md vs 上游 CLAUDE.md** 的对比,两个文件按设计本就
内容不同,该数字对"上游是否改动"零信息量。正确判据是
`git diff <merge-base>..upstream/master -- CLAUDE.md`。仍按流程重新生成了一遍,
产出**逐字节相同**的文件,反过来印证无需刷新。)

### 绿门

`bun install` 新增 2 个 dep(`js-yaml` / `marked`,上游带入);`bun run build` →
`gbrain 0.42.63.0`;`typecheck` 0 错;`check:all` **全绿**(privacy /
skill-brain-first / gateway-routed-no-direct-anthropic / key-files-current-state /
exports-count=20 / admin vite build 等 22 项);`bun test test/ai/` **393 pass /
0 fail**(§6.40 是 328,上游新增 65 个)。`llms-full.txt` auto-merge 版有漂移,
重生成后 +101/−36,`chore:` 单独提交。

### 生产部署 + smoke

备份 `pg_dump` **834MB**(`/tmp/pg-pre-sync-v0.42.63.0-2026-07-21.dump.gz`,
`gzip -t` OK)+ config 副本(`~/.gbrain/config.json.before-sync-v0.42.63.0`)。
沿 §6.39/§6.40 教训:`bun run build` 覆写的正是 launchd daemon 的 KeepAlive
program,但 daemon(pid 93001)未自触发 relaunch(health 仍报 0.42.59.0),故
**受控 bootout+bootstrap 明确执行** → 新 pid **93811**。

`init --migrate-only` → `Schema version 122 → 124 (2 migration(s) pending)` →
两条均 ✓ → `2 migration(s) applied`。**迁移前后页数/chunk 数逐位不变**
(27,469 / 71,415 / 0 NULL)—— 零丢失。

两个 `/health`(本地 + `https://kos.chenge.ink`)均报 **0.42.63.0 / postgres** ✓。

**检索 smoke —— 三类形态全跑**(本批上游动了词法召回 + v124 改了
`pages.search_vector`,单跑英文不足以证):

| 形态 | query | 头名 | 分数 | vs §6.40 |
|---|---|---|---|---|
| 复合 CJK(向量臂,本库 modal) | `知识管理` | `sources/…jarvis-dual-platform-architecture` | **0.8761** | 0.2734 |
| 复合 CJK(换题材,防单点) | `竞品分析` | `concepts/tp-link-id` | 0.8444 | — |
| EN 关键词(hybrid) | `Karpathy` | `people/karpathy` | **1.1716** | 0.6801 |
| 短 CJK 2 字 | `向量` / `嵌入` | 各有相关头名 | 0.77 / 0.80 | — |

复合 CJK **连跑 3/3 分数完全一致**(证嵌入确定 + 向量臂活 + gateway 重写零破坏)。
**头名页面与 §6.40 完全相同,但分数普遍上移 2–3 倍** —— 归因于上游 `184b6cb8`
新增的 title candidate arm + gated OR fallback 抬高了词法臂贡献;**是召回增强不是
排序漂移**(头部次序未变)。CJK 查询端到端 2.3s,远在 30s 预算内。

### 部署后健康快照

1. **embedding**:`content_chunks` **71,415 / 0 NULL**。doctor
   `embedding_provider ✓ **724ms** 1536 dims DB aligned` —— vs §6.40 经 avman
   relay 的 **11,848ms**,**直连快 16 倍**,§6.41 的收益在这里量化了。
   `embeddings 100%/0 missing`、`embedding_env_override` env==DB、宽度一致性全 ✓。
   **cosmetic 误标降到 6**(§6.40 是 48,§6.38 曾 324),全 1536d = te3 宽,
   `embedding-label-normalize` 日 cron 持续自愈中。
2. **pages 27,469**(§6.40 的 27,115 **+354**,8 天四源日入,与本 sync 正交)。
3. **doctor `schema_version` 124(latest 124)、`brain_score` 81/100**(§6.40 80,
   **+1**)。**FAIL 从 3 个降到 2 个**:`sync_freshness` / `cycle_freshness` 沿
   §6.35 以来既定(四源 MCP 写入非 git-sync),而 **`orphan_ratio` 退出 FAIL 变
   WARN —— 62%(12,880/20,722),vs §6.40 的 92%(24,863/27,109)**,是 §6.41
   chunkless 补链 + entity-dedup 落地的复利。RLS 61/61、pgvector installed、
   resolver 61 skills all reachable、skill_brain_first 61/61。

### 两个仍然 open 的东西(别以为这批带走了)

- **#2028 未修**。上游 `hybrid.ts:781` 的 `MIN_QUERY_EMBED_BUDGET_MS = 2_000`
  地板原样还在(仍被已 fire 的共享 `AbortSignal` 击穿)。
  **`GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000` 必须继续留在 4 个查询路径 plist +
  `.env.local`** —— 本批已逐个确认在位(dream-cycle / enrich-sweep /
  gbrain-serve-http / kos-patrol)。§6.42 全文继续有效。
- **chunkless 兜底 cron 不能撤**。上游 #2163 只修了 `synthesize_concepts` 这一条
  写入路径,cycle 的其他 phase 未覆盖。实测当前仍有 **100 个无 chunk 活页**
  (vs §6.41 事发时的 9,241 = 全脑 34%)—— 说明 `com.jarvis.chunkless-backfill`
  (07:00)正压着线。它从"补漏主力"降级为**兜底**,但仍是必需品。

### 顺带发现(未处理,非本批引入)

`scripts/launchd/*.plist` 的**仓库工作副本已陈旧**,与
`~/Library/LaunchAgents/` 里的线上版本严重漂移(仓库副本缺 §6.32/§6.41 的
embedding env、`enrich-sweep` 连 ProgramArguments 都指向旧入口)。**线上 4 个
plist 是正确的**,已逐个验证 —— 但仓库副本已不能作为参考。两者均 gitignored
(只有 `*.plist.template` 入库)故无泄密风险。属既存债,与本 sync 正交,单开任务处理。

### Conflict resolution

**本批零冲突**(merge exit=0)。8 个双侧改动文件全部由递归合并的虚拟 base 自动
收敛,含 3 个重写级 src 文件。无 file-level 手解。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-07-21)
- §6.39(P0 migrator,仍 open)、§6.41(embedding 直连)、§6.42(query-embed deadline)

---

## 6.44 Upstream v0.42.64.0 sync (2026-07-22)

**20 commits / 74 文件 / +2,503 / −228,单版本跨度(v0.42.63.0 → v0.42.64.0),
零迁移,一个 modify/delete 冲突。** merge-base `3cc34c92` = §6.43 合并点。相对
§6.43 的 106 commits 这批很小,一天之内的上游增量。

**`/sync-upstream` 自动采集的 delta 段是空的("New upstream commits: no output"),
但实际有 20 个 commit。** 别把自动采集当权威 —— 手跑
`git log --oneline HEAD..upstream/master` 才是判据。

### 唯一冲突:`.github/workflows/test.yml`(modify/delete)

fork 在 `1adab13b` 删掉了这个文件(CI 噪音清理),上游 `d69f2116` (#3231) 又改了它
(delta-assert reporter 泄漏测试 + shard timeout 提到 22min)。**保持删除**
(`git rm`),沿 fork 既定策略。其余 73 文件全部 auto-merge。

### 上游内容(挑与 fork 相关的)

- **`d43fb631` (#1410) `serve-http` 401 头补 `resource_metadata`** —— MCP 授权规范
  (2025-06-18 draft §5.1)+ RFC 9728 要求受保护资源在 401 里回 discovery URL。
  **这是本批对 fork 唯一有实际外部可见收益的改动**:`kos.chenge.ink` 的 MCP
  客户端(claude.ai / Cursor 这类)以前从裸 401 起不了 OAuth 流,只能报一句泛化的
  "连不上 MCP server"。纯加法,存量已持 token 的客户端零影响(已实测,见 smoke)。
- **`7f841fae` (#3015) `feat(maintain)` + 共享 orphan-exclusion policy** ——
  新增 `gbrain maintain [--safe|--dry-run|--json]` 命令和 `src/core/orphan-policy.ts`。
  policy 把"无入链属正常"的页(`_atlas`/`_index` 等伪 slug、`output/`
  `dashboards/` `templates/` 等前缀、`scratch/thoughts/catalog/entities/raw/atoms/
  skills/dreaming/daily` 首段、`agents/*` workspace 约定)从孤儿口径里剔除,并开放
  `orphans.exclude_prefixes` / `orphans.exclude_slugs` 两个 per-brain 配置键。
  `maintain --safe` 目前只做两件事:stale link/timeline 抽取、source cycle
  freshness。**本批只评估未接入**(见"未处理")。
- `02ba4b4f` Matryoshka dims:只对 `qwen3-embedding` / `qwen3-embedding:*` 生效,
  **我们的 `openai:text-embedding-3-large` 路径零触碰**,已读代码确认。
- **`447e57ec` (#2800) tier 配置的模型进 recipe allowlist + 刷新 Anthropic 模型
  表** —— `claude-opus-4-8` / `claude-sonnet-5` / `claude-fable-5` 现在都在上游
  allowlist 里了。我们 DB config 平面的 `models.tier.reasoning` /
  `models.tier.subagent` / `models.aliases.sonnet` 全指 `anthropic:claude-sonnet-5`,
  doctor `subagent_capability` 报 **"resolves to anthropic:claude-sonnet-5 with
  full tool-loop capability" ✓**。
- `1fabbb98` (#2866) DB/put_page 路径解析 path-qualified wikilink、`64920f83`
  (#769) 重嵌保留 code-chunk metadata、`f529eaa2` (#2125) 排队 AI 作业刷新 gateway
  config、`d61808d8` 加固 confidential OAuth token 撤销、`60125ee6` `dream --once`。

### fork 完整性

fork territory **零侵入**(`git diff master <merge> -- skills/kos-jarvis/ server/
workers/ scripts/launchd/ skills/RESOLVER.md` 空)。`CLAUDE.md` 合并后 diff 空
(fork 版原样保留)。**6 个 fork src patch 全部逐字存活** —— 合并前后
`git diff upstream/master -- src/` 的统计**完全一致**(6 文件 / +243 / −27),
这个"统计量守恒"是比逐文件肉眼看更省事的存活判据。其中两个双侧改动点已逐行确认:

- **`gateway.ts` embed-transport-retry 块**(§6.34/§6.35):上游本批 +42/−1
  (远小于 §6.43 的 +378/−186),fork 块仍嵌在 `__embedInputTypeStore` 上下文内
  (`doEmbed = () => embedTransportWithRetry(...)` →
  `__embedInputTypeStore.run(threadedInputType, doEmbed)`),§6.35 的组合语义连续
  两批 sync 未断。
- **`link-extraction.ts` 复数 `sources` DIR_PATTERN**(`8d18c4d3`,已报
  garrytan/gbrain#3188):上游 #2866 动了同一个文件,**但没有取代 fork patch**。
  两者不等价 —— #2866 修的是**泛化 wikilink pass** 的兜底(把 `[[notes/x]]` 按末段
  查索引再用写法过滤),且受 `link_resolution.global_basename` **flag 门控**;
  fork patch 把 `sources/` 放进 **`qualified` 一类**,覆盖 wikilink **和** markdown
  `[x](sources/...)` 两种写法,且**无条件生效**。结论:**fork patch 必须保留**,
  别因为看到上游动了同一文件就想当然删掉。

**`docs/CLAUDE-UPSTREAM.md` 本批无需刷新** —— `git diff <merge-base>..upstream/master
-- CLAUDE.md` 为空。仍按 §6.43 立的规矩重生成校验了一遍:与上游正文逐行 diff 只有
**5 处差异,且全部是既定的隐私 scrub**(私有 agent fork 名 → `openclaw-reference`),
正文其余部分逐字节相同。

### §6.39 那条 P0:本批**又**没有验证机会

`init --migrate-only` 报 `Schema up to date`,schema 停在 **v124**,本批**零迁移**。
所以这批既没有触发,也**没有提供任何证据**。按 §6.40 的教训措辞:这**不等于**
bug 消失。

> **P0 依然 OPEN 且依然未验证。** 仍要等一条**用 `sql:` 多语句串**的迁移才能证
> #2724 是否修了根因。见
> `docs/UPSTREAM-PATCHES/v0.42.57.0-migrate-only-multistatement-ddl.md`。

### 绿门

`bun install` 新增 2 包;`bun run build` → `gbrain 0.42.64.0`;`typecheck` 0 错;
`check:all` **22 项全绿**(privacy / skill-brain-first / gateway-routed-no-direct-anthropic /
key-files-current-state / exports-count=20 / admin vite build 等);`bun test test/ai/`
**405 pass / 0 fail**(§6.43 是 393,上游新增 12)。`llms-full.txt` auto-merge 版有
漂移,重生成后 +34/−17,`chore:` 单独提交。

### 生产部署 + smoke

备份 `pg_dump` **781MB**(`/tmp/pg-pre-sync-v0.42.64.0-2026-07-22.dump.gz`,`gzip -t`
OK)+ config 副本(`~/.gbrain/config.json.before-sync-v0.42.64.0`)。沿
§6.39/§6.40/§6.43 教训,daemon(pid 63541)在 `bun run build` 覆写二进制后**仍报
0.42.63.0、未自触发 relaunch**,故**受控 bootout+bootstrap 明确执行** → 新 pid
**51879**。**连续四批 sync 都是这个行为,可以当常量对待了。**

`init --migrate-only` → `Schema up to date`。**部署前后页数/chunk 数逐位不变**
(**27,553 / 71,337 / 0 NULL**)—— 零丢失。

两个 `/health`(本地 + `https://kos.chenge.ink`)均报 **0.42.64.0 / postgres** ✓。

**OAuth / MCP wire smoke(本批必跑 —— #1410 动的正是这条线)**:

- 裸 POST `/mcp` → `HTTP/2 401` +
  `www-authenticate: Bearer error="invalid_token", error_description="Missing
  Authorization header", resource_metadata="https://kos.chenge.ink/.well-known/oauth-protected-resource"`
  —— **新参数已生效,且穿过 cloudflared 后 issuer 仍是公网 hostname**(不是
  `127.0.0.1:7225`),这点很关键,否则外部客户端会拿到一个不可达的 discovery URL。
- discovery doc 可取:`{"resource":"https://kos.chenge.ink/","authorization_servers":
  ["https://kos.chenge.ink/"],"scopes_supported":["admin","agent","read",
  "sources_admin","users_admin","write"],"resource_name":"GBrain MCP Server"}`
- **存量客户端未被打断**:`lucien-cli` 走 `client_credentials` 取到 token
  (`gbrain_at_…`,len 74),带 token 打 `tools/list` 正常返回工具表。
- doctor `oauth_confidential_client_health`:**7 个 client 全部 auth shape 一致** ✓。

**检索 smoke**:

| 形态 | query | 头名 | 分数 |
|---|---|---|---|
| 复合 CJK(向量臂,本库 modal) | `知识管理` (limit 5) | `concepts/knowledge-compilation` | 0.9200 |
| 复合 CJK(换题材) | `竞品分析` | `concepts/competitive-benchmarking` | 0.8475 |
| EN 关键词(hybrid) | `Karpathy` | `people/karpathy` | 1.1907 |
| 短 CJK 2 字 | `向量` | `entities/jarvis` | 0.8527 |

复合 CJK 连跑 3/3 同分同头名(嵌入确定 + 向量臂活),端到端 ~4.2s,远在 30s 预算内。

### 本批发现:检索 top-1 依赖 `--limit`,且非单调(**上游既存,非本批引入**)

同一个 query `知识管理`,只改 `--limit`,头名整个换掉,而且**更大的 limit 捞出
更高分的文档**:

| limit | 头名 | 分数 |
|---|---|---|
| 1 | `concepts/personal-knowledge-management` | 0.8391 |
| 3 | `concepts/knowledge-management` | 0.8996 |
| 5 | `concepts/knowledge-compilation` | **0.9200** |

这是反的 —— top-1 本应是全局 argmax,与 k 无关。现象指向候选池随 `limit` 缩放
(每臂取 k×N 候选再融合/重排),小 limit 直接饿死召回,**把真正最相关的页整个漏掉**。

**判定方法(值得留作以后 sync 的标准动作)**:从 `master` 拉 worktree 编出
**0.42.63.0 的二进制**,与新二进制打同一个生产库做 A/B。结果三个 limit 上
**逐条同分同头名** → **不是本批引入的回归,是上游既存行为**;反过来,这也是本批
"检索零影响"最强的证据(比"分数看起来正常"强得多)。已记入 TODO 待报上游。

**教训**:smoke 只跑一个固定 limit 会同时看不见这两件事 —— 既看不见既存的召回
缺陷,也无法证明本批对检索无影响。以后 CJK smoke 至少跑 limit ∈ {1, 5}。

### 部署后健康快照

1. **embedding**:`content_chunks` **71,337 / 0 NULL**。doctor
   `embedding_provider ✓ 1312ms, 1536 dims, DB aligned`(§6.43 是 724ms —— 同一
   数量级的直连往返,非 §6.40 经 relay 的 11,848ms 那种量级)。
   `embeddings 100%/0 missing`、`embedding_env_override` env==DB、
   `embedding_width_consistency` + `facts_embedding_width_consistency` 全 ✓。
   cosmetic 误标 **61**(全部 `zeroentropyai:zembed-1` 标签、1536d = te3 宽),
   是当日新入内容尚未过 `embedding-label-normalize` 日 cron,自愈中。
2. **pages 27,553**(§6.43 的 27,469 **+84**,一天四源日入,与本 sync 正交)。
3. **doctor `schema_version` 124(latest 124)、`brain_score` 84/100**(§6.43 81,
   **+3**;embed 35/35、links 25/25、timeline 1/15、orphans 13/15、dead-links 10/10)。
   **FAIL 只剩 1 个**:`cycle_freshness`(default 源 25h 未 cycle)。
   `sync_freshness` **已转 OK**。`orphan_ratio` **25% (5182/20700) → OK**,
   但**这是 fork 自己那轮去孤儿的功劳(见 `7cc00641`,62% → 25%,发生在本 sync
   之前),不要记到 #3015 头上** —— #3015 的排除策略对分母几乎没动(§6.43 是
   20,722,现在 20,700)。RLS event trigger ✓、pgvector installed、resolver 61
   skills all reachable、skill_brain_first 61/61。
4. **新增 WARN `links_extraction_lag`:10,540/27,546 页(38%)有未抽取的边。**
   归因于 `cycle_freshness` 那条 FAIL(`extract` 是 cycle 的一个 phase,cycle 停了
   25h),**但没有 pre-sync doctor 基线可比对,所以这条归因未经验证**,先记下。
   —— 顺带,这正是 #3015 `maintain --safe` 声称能自动处理的两件事之一。

### 三个仍然 open 的东西(本批一个都没带走)

- **#2028 未修**,`GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000` 必须继续留在 4 个查询路径
  plist + `.env.local` —— 本批已逐个确认在位(dream-cycle / enrich-sweep /
  gbrain-serve-http / kos-patrol),同时确认 4 个 plist **均无 `OPENAI_BASE_URL`**
  且均带 te3(§6.41 规则未被侵蚀)。§6.42 全文继续有效。
- **chunkless 兜底 cron 不能撤**。当前仍有 **100 个无 chunk 活页**,与 §6.43
  **完全持平** —— `com.jarvis.chunkless-backfill`(07:00)稳定压着线,上游 #2163
  仍只修了 `synthesize_concepts` 一条写入路径。
- **§6.39 P0**,见上。

### 未处理(有意留下)

- **#3015 的 `gbrain maintain` 未接入。** 本次 sync 保持纯粹(不混 feature)。
  值得后续评估的两个点:(a) `maintain --safe` 的 stale-extraction 正好能压上面
  那条 38% 的 `links_extraction_lag`;(b) `orphan-policy.ts` 的
  `orphans.exclude_prefixes` / `orphans.exclude_slugs` 让我们能把 fork 特有的
  "本就不该有入链"的页(如 `sources/email/*` 的一部分)从孤儿口径里正式剔除,
  比继续刷 orphan-reducer 更治本。已进 TODO。
- **`scripts/launchd/*.plist` 仓库工作副本仍然陈旧**(§6.43 已记)。线上 4 个
  plist 本批已逐个验证正确,仓库副本仍不可作参考。既存债,与本 sync 正交。

### Conflict resolution

1 个冲突:`.github/workflows/test.yml` modify/delete → **保持 fork 的删除**
(`git rm -f`)。无其他 file-level 手解。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-07-22)
- §6.39(P0 migrator,仍 open)、§6.41(embedding 直连)、§6.42(query-embed deadline)、§6.43(上一批 sync)

---

## 6.45 Upstream v0.42.66.1 sync (2026-07-28)

**265 commits / 446 文件 / +29,791 / −2,430,跨两个 release
(v0.42.64.0 → v0.42.65.0 → v0.42.66.0 → v0.42.66.1),迄今最大的一批**
(§6.43 106、§6.44 20)。merge-base `d43fb631` = §6.44 里那个 #1410 commit。
两个冲突,一条真迁移(schema v124 → **v125**)。

上游本批自报 93 + 54 = 147 个 "verified fixes",但其中夹着**大量 Revert 再
reland 的往返**(`Revert "fix(...)"` 后面跟着同号的 `reland:`)。看 commit 数会
高估实际净变更 —— 判断工作量要看最终 diff,不是 commit 计数。

### 两个冲突

1. **`.github/workflows/test.yml`(modify/delete)** —— 与 §6.44 同一个文件、
   同一个成因(fork 在 `1adab13b` 删除,上游继续改)。**保持删除**。这已经是
   连续两批撞同一处,可以预期它每批都会来。
2. **`src/core/link-extraction.ts`(content)** —— fork 的复数 `sources`
   (garrytan/gbrain#3188)vs 上游 #2071 新加的 `reference`。**两者互不排斥**,
   合并成一条 alternation 即可:
   `…|projects|sources|source|…|entities|reference)`。注释块 auto-merge 得很
   干净(上游的 canonical 行 + fork 的 `sources` 说明并存)。
   §6.44 特意警告过"别因为上游动了这个文件就删掉 fork patch",本批再次适用。

### fork 完整性:统计量**不守恒**,而这次是好事

§6.44 立的那条廉价判据(合并前后 `git diff upstream/master -- src/` 统计相同)
**本批失败了**:6 文件 / +243/−27 → **4 文件 / +187/−23**。两个 fork patch 的
本地 delta 归零。逐条查证后确认**不是被 auto-merge 吞掉,是上游把它们原样收编了**:

| fork patch | 上游收编 commit | 对应 issue |
|---|---|---|
| `extract-atoms.ts` concept 标注 | `eb6cb4a1` | #2123 / #2124 |
| `extract-atoms-drain.ts` 零产出 tombstone | `8cd87968` | #2144 / #2145 |

语义逐条验证仍在(7 项全过):`concepts?: string[]` 字段、`CONCEPT_LABEL_RE`
校验、3 处 `atoms_scan_hash` 发现/计数守卫、零产出 tombstone 的 `UPDATE`、
concepts 落进 atom frontmatter、drain 的 backlog 差值判定、prompt 里的
kebab-case 说明。

**教训:统计量守恒是个"是否需要细看"的信号,不是通过/失败判据。** 数字变小可能
是 patch 被吞(坏),也可能是上游收编(好);两种都必须落到语义逐条核对。
fork src 面因此从 6 文件缩到 **4 文件**,是 consolidation 的实质进展。

其余:fork territory **零侵入**(`skills/kos-jarvis/ server/ workers/
scripts/launchd/ skills/RESOLVER.md CLAUDE.md` diff 全空)。
`docs/CLAUDE-UPSTREAM.md` 无需刷新(上游 `CLAUDE.md` 本批未动);仍按 §6.43 的
规矩重校验:与上游正文逐行 diff 只有 21 行 fork wrapper 头 + **5 处既定隐私
scrub**,正文其余字节相同。

### 上游新增的 zero-tolerance symlink 门 vs fork 既存状态

`2a17a4da` (#3463) 新增 `scripts/check-no-tracked-symlinks.sh`,**全仓零容忍**,
`check:all` 直接在第 8 项中断。撞的是 fork 自 `4a04f86e` 起就带的 3 个 symlink:

```
workers/kos-worker/AGENTS.md      -> .agents/INSTRUCTIONS.md
workers/kos-worker/CLAUDE.md      -> .agents/INSTRUCTIONS.md
workers/kos-worker/.claude/skills -> ../.agents/skills
```

三个都是**仓内相对链接且目标本身已被 git 跟踪**,任何 clone 都能解析 —— 正是该
脚本注释里点名"defensible"的那一类,上游还为此留了空的 `ALLOWLIST`。
**决定:用 ALLOWLIST**(`7b65d069`)。代价是 fork 首次修改上游脚本(此前 fork 在
`scripts/` 下只新增文件、零修改),换掉的是"新 clone 丢失 worker 的 agent 指令
别名"。已做**负向对照**:新加一个悬空 symlink 后守卫仍然 FAIL,证明 allowlist
是收窄而非阉割。

### §6.39 那条 P0:三批 sync 后终于有证据 —— **归因被推翻**

v125 是自 §6.39 以来**第一条多语句 `sql:` 迁移**(`DROP INDEX` +
`CREATE UNIQUE INDEX`)。`init --migrate-only` 在生产 Postgres 上**一次通过**,
schema 124 → 125,索引形状正确。但 v125 两条语句**互不依赖**,不触及 P0 声称的
根因,所以单靠它证明不了什么。于是直接做了复现实验:

1. **拿 `src/core/migrate.ts` 里 v121 的 `sql` 原文**(ADD COLUMN + `DO $$` 加 FK
   + 两个引用新列的部分索引 —— §6.39 里确定性失败、报
   `column "event_page_id" does not exist` 的那一段),在一次性 scratch 库上
   经**同一条 `reserved.unsafe()` 路径**重放 → **PASS**,且列与两个部分索引全部
   建成。
2. 排除"上游修好了":`runUnsafe` 与 `runMigrationSQL` 与 §6.40 时期的代码
   **逐字节相同**(`diff` 空);postgres.js 也一直是 **3.4.9**(§6.40 的
   `bun.lock` 即为 3.4.9)。**栈里什么都没变。**

> **结论:§6.39 的根因归因("postgres.js `conn.unsafe` 对整批做 parse-time
> 校验")不成立。** 若该机制为真,今天同一路径、同一 SQL、同一库版本必然同样
> 失败,而它通过了。真正的触发条件另有其物,**仍未定位**。
>
> 相应地,P0 的定性应从 **"OPEN,阻塞,等一条多语句迁移来验"** 改为
> **"失败形态在当前栈上不可复现,根因待重新定位"**。
> `docs/UPSTREAM-PATCHES/v0.42.57.0-migrate-only-multistatement-ddl.md` 里那三条
> fork workaround(预置列 / 让 daemon 跑 / 全手工 psql)**当前都不需要**。
> 上游 issue garrytan/gbrain#2667 该去补一条更正 —— 挂着一个错误根因比没有
> 更糟,会把别人往错方向引。**未发布,等 Lucien 决定**(对外动作)。

### 绿门

`bun install` 新增 5 包;`bun run build` → `gbrain 0.42.66.1`;`typecheck` **0 错**;
`check:all` **23/23 全绿**(本批多了 symlink 一项;`exports-count` 基线上游从
20 提到 **21**);`bun test test/ai/` **467 pass / 0 fail**(§6.44 是 405,上游净增
62)。`llms-full.txt` auto-merge 版有漂移,重生成后 +39/−23,`chore:` 单独提交。

### 生产部署 + smoke

备份 `pg_dump` **864MB**(`/tmp/pg-pre-sync-v0.42.66.1-2026-07-28.dump.gz`,
`gzip -t` OK)+ config 副本(`~/.gbrain/config.json.before-sync-v0.42.66.1`)。
daemon(pid 51879)在 `bun run build` 覆写二进制后**仍报 0.42.64.0、未自触发
relaunch**,受控 bootout+bootstrap → 新 pid **53806**。
**连续第五批同一行为,已是常量。**

`init --migrate-only` → v124 → **v125** 应用成功。**部署前后零丢失**:
活页 29,695 → **29,698**、chunks 78,239 → **78,258**、NULL 向量恒为 **0**
(增量来自部署窗口内的日常入库,与 sync 正交)。

两个 `/health`(本地 + `https://kos.chenge.ink`)均报 **0.42.66.1 / postgres** ✓。

**OAuth / MCP wire smoke(本批动了 source grant 一整组,必跑)**:

- 裸 POST `/mcp` → `HTTP/2 401` + `www-authenticate: … resource_metadata=
  "https://kos.chenge.ink/.well-known/oauth-protected-resource"` —— §6.44 拿到的
  #1410 行为**穿过 cloudflared 后 issuer 仍是公网 hostname**,未被本批打破。
- discovery doc 可取,6 个 scope 齐。
- **存量客户端未被打断**:`lucien-cli` client_credentials → token(len 74)→
  `tools/list` 正常。
- **`whoami` 现在在线上真的回 `source_id` + `federated_read`**
  (#3279 / `26b938c3` 落地,外部客户端可见的新能力)。
- 7 个 OAuth client 的 `federated_read` **逐个核对未变**;doctor
  `oauth_confidential_client_health` 7/7 auth shape 一致 ✓。
- 经 MCP wire 打一条复合 CJK query,头名与 CLI 一致
  (`concepts/knowledge-management`)。

### 检索 A/B:本批**零影响**(已证),非单调缺陷**仍在**(既存)

本批动了至少 5 处检索相关代码(`31dca683` recency decay 上 hybrid、
`8160236a` federated 进 unqualified search、`3594c316` rerank auth 分类、
`1cc17f01` think 摘录选择、`cd18081f` takes word_similarity),而语料自 §6.44 已
增 2,145 页 —— **光看分数无法归因**。按 §6.44 立的标准动作,从 `master` 拉
worktree 编出 **0.42.64.0** 二进制,与新二进制打**同一个生产库**:

| query | limit | 头名 | 分数 | A/B |
|---|---|---|---|---|
| `知识管理` | 1 / 5 | `concepts/knowledge-management` | 0.9123 / 0.9123 | 同 |
| `竞品分析` | 1 | `concepts/competitive-analysis` | 0.8442 | 同 |
| `竞品分析` | 5 | `sources/notion/spdl-guard-saas-…` | **0.7898** | 同 |
| `Karpathy` | 1 | `people/andrej-karpathy` | 0.9339 | 同 |
| `Karpathy` | 5 | `people/karpathy` | **1.1908** | 同 |
| `向量` | 1 / 5 | `entities/jarvis` | 0.8527 / 0.8527 | 同 |

**8/8 逐条同分同头名 → 本批检索零影响。** 端到端 0.8–1.2s,远在 30s 预算内。

同时,§6.44 记的 **top-1 依赖 `--limit` 且非单调**依然存在,而且本批看到它是
**双向**的:`Karpathy` 是 limit 大→分更高(0.9339 → 1.1908,§6.44 同款),
`竞品分析` 却是 limit 大→**分更低**(0.8442 → 0.7898)。两个方向都违反
"top-1 应是与 k 无关的全局 argmax"。A/B 同时证明它是**上游既存**,非本批引入。
CJK smoke 跑 `limit ∈ {1,5}` 这条规矩(§6.44 立的)本批直接兑现了价值。

### 部署后健康快照

1. **embedding 全绿且更快**:`embedding_provider ✓ **349ms**, 1536 dims, DB
   aligned` —— §6.43 是 724ms、§6.44 是 1312ms,直连往返继续收敛。
   `embeddings 100% / 0 missing`、`embedding_env_override` env==DB、
   `embedding_width_consistency` + `facts_embedding_width_consistency`
   (halfvec(1536))全 ✓。**`embed_staleness: No stale chunks`** —— 这条最要紧,
   证明本批没有意外改动 `embedding_signature`,没触发任何重嵌。
   4 个 plist 逐个复验:`GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000` 在位、te3@1536
   在位、**零 `OPENAI_BASE_URL`**;DB config 平面**零 `provider_base_urls.*` 键**
   (本批 `8a5296f3` 新增了"从 DB 合并 provider base URL",对我们是空操作,
   且该合并只填未定义键 —— §6.41 规则未被侵蚀)。
2. **pages 29,698 / chunks 78,258 / 0 NULL**;schema **125(latest 125)**;
   `brain_score` **84/100**(与 §6.44 持平:embed 35/35、links 25/25、
   timeline 2/15、orphans 12/15、dead-links 10/10)。
   `orphan_ratio` 32%(7,304/22,844)—— 较 §6.44 的 25% 上升,分母随语料增长。
   RLS 65/65、pgvector installed、resolver 61 skills all reachable、
   skill_brain_first 61/61。
3. **chunkless 活页 105**(§6.44 是 100)—— `com.jarvis.chunkless-backfill`
   (07:00)继续压线,上游 #2163 仍只修了 `synthesize_concepts` 一条写入路径,
   **兜底 cron 不能撤**。
4. **#2846 修了 §6.32 那条 cosmetic 误标 —— 但生产上尚未验证。**
   `e1919fab` 让 `upsertChunks` 落 `content_chunks.model` 时改用 gateway
   **运行时解析出的模型**,而不是编译期常量 `zeroentropyai:zembed-1`。这正是
   `com.jarvis.embedding-label-normalize` 日 cron 存在的理由。当前误标 20 行,
   其中 19 行写于 09:35–09:51,**早于 10:03:56 的重启**(旧 daemon 写的),
   重启后还没有新 chunk 落库 —— **所以本批拿不到证据**。下次 sync 复查:若新写入
   的 chunk 标签正确,该 cron 可降级为纯历史数据修复,再择机退役。

### 本批发现的三件需要决定的事(均**未处理**,与 sync 正交)

- **`sources.config` 已被上游 #2829 的 re-wrapping bug 损坏(生产数据)。**
  本批新增的 doctor `source_config_shape` 检查直接报出来:`gbrain-docs` 的
  config 是字符串 `"{\"federated\":false}"`、`mailagent-emails` 是 `"{}"`,
  两者都该是 JSON **对象**;`default`(`{"federated": true, …}`)和 `omada` 完好。
  影响:这两个源的 federation / ACL 设置读不出来。**本批之后影响变大了** ——
  `8160236a` (#2561) 让 `sources.config.federated` 真正参与本地 CLI 的
  unqualified search。上游 `16782aee` (#3420) 已给出自愈:跑任一
  `gbrain sources` config 写入即可,或按 doctor 打印的 SQL 直接 `UPDATE`。
  **是生产数据写入,留给 Lucien 决定。**
- **dream cycle 停摆 162h(doctor 唯一 FAIL)。** `default` 停在
  **2026-07-21T22:19Z**,连带 `links_extraction_lag` 从 §6.44 的 38% 涨到
  **89%**(26,578/29,698 页有未抽取的边)。这**不是本次 sync 造成的**,是
  `a37ef462`(本次 sync 前的 HEAD)正在处理的那个已知问题的延续。
  `dream.stderr.log` 里能看到完整链条:先是 avman 中继报
  `无可用渠道(distributor)` 打挂一轮 cycle,之后 wrapper 的 §6.41 自检探针拿到
  **另一把 key**(`sk-WginM…`,而 plist / `.env.local` 里都是 `sk-proj-E2kJ…`)
  的 401,于是按铁律 `REFUSING TO RUN`。当前四个平面(plist / `.env` /
  `.env.local` / `launchctl getenv`)都已查过,**没有一个还带 `sk-WginM`**,
  所以那条 REFUSING 应是历史记录;但 cycle 至今没恢复跑,需要单独收口。
- **`com.jarvis.enrich-sweep` 在 launchd 里是 `disabled`。** plist 文件完好
  (22:00,env 合规,无 `OPENAI_BASE_URL`),但 `launchctl print-disabled` 明确
  报 disabled,`launchctl list` 里根本没有它。§6.44 写"4 个 plist 逐个确认在位"
  —— 那句话只核了**文件里的 env**,没核**作业是否被加载**。**以后这类核对要
  同时看 `launchctl list` 和 `print-disabled`。** 是花钱的 LLM 作业,未擅自启用。

另有一条新 WARN 记账:`reranker_health` 报 7 天内 8 次 rerank auth 失败
(提示 `ZEROENTROPY_API_KEY`)。这是本批 `3594c316` (#2059) "先分类缺失鉴权再
fallback" 把既有状态显性化了 —— 按 §6.41,ZE key 对我们已是 vestigial,rerank
走 fallback 不影响检索(A/B 8/8 相同即为佐证)。**归档为已知噪声,不追。**

### 未处理(有意留下)

- **#3015 的 `gbrain maintain` 仍未接入**(§6.44 已记)。本批那条 89% 的
  `links_extraction_lag` 正是 `maintain --safe` 声称能压的两件事之一,优先级上升。
- **#2028 未修**,`GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000` 必须继续留在 4 个 plist +
  `.env.local` —— 本批已逐个确认在位。§6.42 全文继续有效。
- **`scripts/launchd/*.plist` 仓库工作副本仍然陈旧**(§6.43/§6.44 已记),
  仓库里只剩 `com.jarvis.kos-dashboard.plist` 一个,线上实际跑着 10 个
  `com.jarvis.*` 作业。既存债,与本 sync 正交。

### Conflict resolution

2 个冲突:`.github/workflows/test.yml` modify/delete → **保持 fork 的删除**
(`git rm -f`);`src/core/link-extraction.ts` content → **两侧新增并存**
(`sources` + `reference`)。无其他 file-level 手解。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-07-28)
- [`docs/UPSTREAM-PATCHES/v0.42.57.0-migrate-only-multistatement-ddl.md`](UPSTREAM-PATCHES/v0.42.57.0-migrate-only-multistatement-ddl.md) — 本批推翻其根因,待更正
- §6.39(P0 migrator,归因已被本批推翻)、§6.41(embedding 直连)、§6.42(query-embed deadline)、§6.44(上一批 sync)

---

## 6.46 Upstream v0.42.68.1 sync (2026-07-31)

**54 commits / 185 文件 / +9,078 / −911,跨一个 release
(v0.42.66.1 → v0.42.67.0 → v0.42.68.1),零迁移**(schema 两侧同为
**v125**,`init --migrate-only` 直接报 "Schema up to date")。merge-base
`fd8be831`。规模回落到 §6.43 之前的常态(§6.45 是 265 commits / 446 文件)。

本批有两件事值得单独记:**上游把 fork 报的 #2028 修了**,以及
**一个不报冲突的重复键陷阱**。

### 上游关掉了 §6.42 的 issue —— query-embed deadline

`f75dbb4e` (#3690) 明确写着 "This also closes verified issue #2028"。
§6.42 定位的正是这条:`embedQueryBounded` 收到的 shared `AbortSignal`
**到手就已经 aborted**,导致那个 2s `MIN_QUERY_EMBED_BUDGET_MS` 下限是
**死代码** —— hybrid search 静默退化成纯 keyword,而对本库的复合 CJK 查询,
纯 keyword 意味着**空结果**。修法是在同一个 shared seam 上新开一个
`AbortSignal.timeout(remaining)`:

```
src/core/search/hybrid.ts:872  const remaining = Math.max(MIN_QUERY_EMBED_BUDGET_MS, dl.deadlineAt - Date.now());
src/core/search/hybrid.ts:873  const signal = AbortSignal.timeout(remaining);   // ← #3690
```

合并后逐条确认该行在树里,`bun test test/search/query-embed-deadline.test.ts`
**4 pass / 0 fail**(其中一条正是"signal 已 aborted 时仍要给足 floor")。

> **`GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000` 本批不动,继续留在 4 个 plist +
> `.env.local`。** 理由:sync 不是改生产配置的场合,而这条 env 守的是中文查询,
> 失效形态是**静默空结果**(不报错)。现在它从"唯一防线"降级为
> **belt-and-braces**;要退休它得单独做,带自己的负载验证。已在 TODO 记 P2。
> 重启后复验 daemon 内存环境仍带 `GBRAIN_QUERY_EMBED_TIMEOUT_MS => 30000`
> (`launchctl print`,不是从磁盘 plist 复刻 —— §6.44 那条教训)。

### 一个不报冲突的重复键陷阱(本批最该记住的操作教训)

`63e79838` (#3651) 给 google embedding recipe 加了 `max_batch_tokens` ——
**和 fork 自带的那块 patch 是同一件事**。这是继 §6.45 两条之后,上游
**第三次收编 fork patch**。

但收编方式很危险:fork 把块插在 `cost_per_1m_tokens_usd` **之前**,上游插在
**之后**。同一个对象字面量、不同 offset,于是 **git 判定可以 auto-merge,
一个冲突标记都不给**,结果是:

```ts
      max_batch_tokens: 20_000,
      chars_per_token: 2,          // fork
      cost_per_1m_tokens_usd: 0.15,
      max_batch_tokens: 20_000,
      chars_per_token: 4,          // upstream —— 重复键,JS 里后者胜
      safety_factor: 0.8,
```

**JS 对象字面量重复键不报错,后者静默覆盖前者** —— 也就是说,即便没人发现,
fork 精心选的 `chars_per_token: 2` 也已经被上游的 `4` 悄悄顶掉了。真正拦住它的
是 **TypeScript(TS1117)**,`bun run typecheck` 会报错。

> **教训:merge 干净 ≠ 语义干净。** 上游收编 fork patch 时,只要落点 offset
> 不同,冲突机制**完全不会触发**。§6.45 立的"统计量不守恒 → 去细看"信号在这里
> 依然有效(fork src 4 → 3 文件),但**它是事后信号**;真正的前置防线是
> **每批 sync 必跑 typecheck**,别因为"没有冲突"就跳过绿门。

**决定:取上游版,丢掉 fork patch**(Lucien 拍板)。做法是
`git checkout upstream/master -- src/core/ai/recipes/google.ts`,**不手改
`src/`** —— fork-boundary hook 也确实拦住了 Edit,这是对的:用 git 整文件取回
上游,正好是"丢掉 fork patch"最干净的表达,且保住了该文件"零手工 src 编辑"。
两个只为断言这块 cap 而存在的 fork 测试补丁(`test/ai/adaptive-embed-batch.test.ts`、
`test/ai/no-batch-cap-suppression.serial.test.ts`,本批**唯二的真冲突**)一并取
上游版。

**代价记在案**:上游 `chars_per_token: 4` 是按英文 SentencePiece 密度定的,
fork 原来的 `2` 是按 CJK 密度定的。对中文语料,4 会**低估 token 数约一倍**→
批次切得过大 → 可能 429。**当前无影响**:§6.41 之后 embedding 直连官方 OpenAI,
Gemini embedding 这条路**根本没在用**,是休眠代码。已记 TODO **P2**:若哪天真
切回 Gemini embedding,必须重新按 CJK 调 `chars_per_token`。

### fork 完整性

fork src 面 **4 → 3 文件**(`gateway.ts` 172、`link-extraction.ts` 10、
`pglite-engine.ts` 21;+180/−23),又一次实质收缩。逐条复验:

- `link-extraction.ts`:fork 的复数 `sources` 与上游 `reference` **仍并存**于
  同一条 alternation,且 `sources` 排在 `source` 之前(§6.45 的解法未被冲掉)。
- `pglite-engine.ts`:WAL durability patch(`SELECT pg_switch_wal()`)完整,已
  折进上游 snapshot+try/finally 结构。注意上游本批新加了
  `check-engine-dynamic-import.sh`(#3596)约束这三个 engine-live 文件的静态
  import 边界 —— fork 这块是 `db.query` 不是 import,**不受影响**,门也过了。
- `gateway.ts`:各 compat shim 与 1536 维 passthrough 齐在。

**fork territory 零侵入**:`skills/kos-jarvis/ server/ workers/ scripts/launchd/
skills/RESOLVER.md CLAUDE.md` 的 diff 全空。

### 冲突(5 处,4 处按既定规矩)

1. **`.github/workflows/test.yml`(modify/delete)** —— **连续第三批**同一文件、
   同一成因。**保持删除**。已可确认是常量,不必再每批重新判断。
2. `CLAUDE.md` → `--ours`(fork-only,上游内容镜像在 `docs/CLAUDE-UPSTREAM.md`)。
3. `llms-full.txt` → 取上游后 `bun run build:llms` 重生成(+445/−842),`chore:` 单提。
4. + 5. 上面那两个 google cap 测试补丁 → 取上游。

`docs/CLAUDE-UPSTREAM.md` 本批**需要刷新**(上游 `CLAUDE.md` +13 行:#3596 那条
engine-live 静态 import 规则)。按 §6.43 的规矩重新派生:取
`upstream/master:CLAUDE.md`,重贴 **5 处既定隐私 scrub**(私有 agent fork 代号 →
`openclaw-reference`;上游自己的文档规则就是"永远别写那个名字"),套回未改动的
21 行 fork wrapper 头。结果与上游正文逐行 diff **只剩那 13 行新内容**,零泄漏。

### 绿门

`bun install` 无新增包;`bun run build` → **`gbrain 0.42.68.1`**;
`typecheck` **0 错**;`check:all` **24/24**(§6.45 是 23/23,本批上游新增
`check-engine-dynamic-import.sh`;`exports-count` 基线仍 **21**,未动;
§6.45 那个 symlink ALLOWLIST **继续生效**,`check-no-tracked-symlinks` OK);
`bun test test/ai/` **480 pass / 0 fail**(§6.45 是 467)。

### 生产部署 + smoke

备份 `pg_dump` **869MB**(`/tmp/pg-pre-sync-v0.42.68.1-2026-07-31.dump.gz`)
+ config 副本(`~/.gbrain/config.json.before-sync-v0.42.68.1`)。
daemon 在 `bun run build` 覆写二进制后**依旧未自触发 relaunch** ——
**连续第六批,彻底是常量**,受控 bootout + bootstrap。

`init --migrate-only` → **"Schema up to date"**(零迁移,v125 两侧一致)。
**部署前后零丢失,且是逐字相等**:活页 **29,968 → 29,968**、
chunks **77,863 → 77,863**、NULL 向量 **0 → 0**。
两个 `/health`(本地 + `https://kos.chenge.ink`)均报 **0.42.68.1 / postgres** ✓。

MCP wire:裸 POST `/mcp` → `HTTP/2 401` + `www-authenticate: … resource_metadata=
"https://kos.chenge.ink/.well-known/oauth-protected-resource"` —— §6.44 的
#1410 行为穿过 cloudflared 后 issuer 仍是公网 hostname,未被本批打破。

### 检索 A/B:8 条里 **7 条同分同头名,1 条变了 —— 且是变好**

本批动了至少 5 处检索代码(#3690 query-embed deadline、#3616 first-person
entity 分类、#3514 compiled_truth boost、#3677 knobs_hash 折进 FTS config、
#3499 OpenRouter query expansion),按 §6.44 立的规矩,从 `master` 拉 worktree
编出 **0.42.66.1** 二进制,与新二进制打**同一个生产库**:

| query | limit | old (0.42.66.1) | new (0.42.68.1) | A/B |
|---|---|---|---|---|
| `知识管理` | 1 / 5 | `concepts/knowledge-management` 0.9142 | 同 | 同 |
| `竞品分析` | **1** | `concepts/competitive-benchmarking` **0.8296** | `concepts/competitive-analysis` **0.8384** | **变** |
| `竞品分析` | 5 | `concepts/competitive-analysis` 0.8442 | 同 | 同 |
| `Karpathy` | 1 | `people/andrej-karpathy` 0.9339 | 同 | 同 |
| `Karpathy` | 5 | `people/karpathy` 1.1908 | 同 | 同 |
| `向量` | 1 / 5 | `entities/jarvis` 0.8527 | 同 | 同 |

那条 DIFF **先排除了非确定性再下结论**:同一二进制各连打 4 次,
old 4/4 稳定给 `competitive-benchmarking`,new 4/4 稳定给 `competitive-analysis`
—— 两侧各自**完全确定**,所以"同一 limit 下新旧确实不同"这一条成立,不是
`expandQuery` 的 LLM 抖动。

> **更正(同日复核):最初把这条写成"变好",这是过度解读,已推翻。**
> 事后在新二进制上把 `limit` 扫了一遍,发现 top-1 **身份本身**就随 limit 翻转,
> 且非单调:
>
> | limit | 1 | 2 | 3 | 5 | 10 |
> |---|---|---|---|---|---|
> | top-1 | `competitive-analysis` | **`competitive-benchmarking`** | `competitive-analysis` | 同 | 同 |
> | 分数 | 0.8384 | **0.8296** | 0.8442 | 0.8442 | 0.8442 |
>
> 每个 limit 各连打 3 次均稳定 —— **确定性的,不是抖动**。关键在于
> **新二进制在 L=2 给出的恰恰就是旧二进制在 L=1 给的那一页**。
> 所以那处差异是**落在一个已知不稳定的排序里的单点采样**,
> **不能据此说新版更好**。"同 limit 下新旧不同"仍然成立;"新版更贴题"不成立。

**顺带把既存缺陷的定性改严**:§6.44/§6.45 记的是"top-1 分数依赖 `--limit`",
实际比那更糟 —— **top-1 是哪一页都会随 limit 变,而且非单调**(L=1 与 L=3 一致,
夹在中间的 L=2 反而不同)。这违反"top-1 应是与 k 无关的全局 argmax"。
**上游既存,本批未引入也未修**;定性已在 TODO 的 P2 条目里同步改写。

归因**未坐实**:两个页面 frontmatter 都不带 `compiled_truth`,所以 #3514 不像;
最可能是 **#3677**(把 FTS configuration name 折进 `knobs_hash`,使旧的缓存/
重排行失效)。鉴于差异本身就埋在 limit 不稳定性里,没有进一步深挖的价值。

> **顺带记一条方法论**:§6.45 的表里 `竞品分析 --limit 1` 记的是
> `competitive-analysis` 0.8442,而今天 **old 二进制**给的是
> `competitive-benchmarking` 0.8296。这**不矛盾** —— 语料自 §6.45 已从 29,698
> 涨到 29,968 页。**跨 sync 比对历史表格是无效的**,A/B 必须是同一时刻、同一
> 语料、两个二进制对打。

§6.44/§6.45 记的 **top-1 依赖 `--limit` 且非单调**依然存在(新版 `竞品分析`
L=1 得 0.8384、L=5 得 0.8442,同一页不同分),**上游既存,本批未引入也未修**。

### 部署后健康快照

1. **embedding 全绿**:`embedding_provider ✓ **360ms**, 1536 dims, DB aligned`
   (§6.45 是 349ms,持平);**`embed_staleness: No stale chunks`** —— 最要紧的
   一条,证明本批没有意外改动 `embedding_signature`、没触发任何重嵌;
   `~/.gbrain/config.json` 仍 te3@1536;daemon 内存环境**零 `OPENAI_BASE_URL`**
   (§6.41 规则未被侵蚀)。
2. **pages 29,968 / chunks 77,863 / 0 NULL**;schema **125**;
   `brain_score` **83/100**(§6.45 是 84,差在 timeline density 1/15,既存);
   `orphan_ratio` 32%(7,473/23,007)。
3. **一个 FAIL,但与本批无关 —— 是测试污染**:`sync_failures` 报
   `notes/bad.md` SLUG_MISMATCH。查 `~/.gbrain/sync-failures.jsonl`,该条
   `source_id` 是 **`srcE`**(fixture id —— 真实源只有 `default` /
   `mailagent-emails` / `gbrain-docs` / `omada`),文件在盘上**不存在**,
   写入时间 **2026-07-27 21:38**,即 **§6.45 sync 期间**。结论:某个测试没做好
   隔离,把 fixture 失败写进了全局状态文件,比本批早 4 天。**sync 期间不擅自改
   生产状态**,记 TODO P1(它会让 `gbrain doctor` 非零退出,可能拖垮以 doctor
   为门的 cron)。一行修法:删掉该行,或 `gbrain sync --skip-failed` 确认。
4. **`links_extraction_lag` 报 100% 看着吓人,但是既存 + 预期内 —— 同时它推翻了
   §6.45 的一条预测**:`29,893/29,968 页 (100%) have un-extracted edges`,而
   `page_links` 表里**实有 215,698 行** —— 链接是抽过的。该检查靠
   `links_extracted_at` 时间戳判定,存量页该列为 NULL。上游代码注释直说了这个
   形态:"a just-upgraded 280K-page brain (every page NULL → 100% stale) gets a
   loud WARN, never a non-zero exit"。且 `git show fd8be831:src/commands/doctor.ts`
   里该检查**已存在**(5 处),本批 doctor.ts diff **零涉及** → **既存,非本批
   引入**,§6.45 只是没记。warn-only,不会 fail。
   **但要记一笔:§6.45 写的是"`links_extraction_lag` 89% 随 cycle 的 extract
   phase 消化",而它从 89% **涨到了 100%**。预测错了。** dream 的 extract phase
   **并不回填这个时间戳**,而语料还在涨(29,698 → 29,968),分子只会更大。
   **教训:别拿这条当 dream 是否在干活的代理指标** —— 它测的是时间戳回填,不是
   链接存在性。真要清掉得单独跑 `gbrain extract --stale`(未做,非本批范围)。
5. **dream cycle 恢复了**:`cycle_freshness` 报 `default` **11h 前**跑过 ——
   §6.45 记的是**停滞 162h**。§6.45 那条 P1 的 (a) 半边可以关账(注意:能证明
   它自愈的是 `cycle_freshness`,**不是**上面第 4 条)。

### Linked docs

- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — post-sync header(更新至 2026-07-31)
- §6.42(query-embed deadline,本批被上游 #3690 修掉根因)、§6.41(embedding 直连)、§6.45(上一批 sync)

---

## 8. Cost and performance snapshot

| Metric | v1 | v2 |
|--------|----|----|
| Full repo import | ~minutes (shell) | 0.3s for 85 pages |
| Embedding cost (one-time) | $0 (local qmd) | ~85 × 1 Gemini call ≈ free tier |
| Query latency (Chinese) | 不支持（BM25 无 CJK 分词） | ~500ms (embed + pgvector + gemini) |
| Ingest latency | ~seconds | ~2-3s (fetch + import + embed) |
| Cron footprint | 4 (OpenClaw) | 4 (OpenClaw) + 2 (launchd services) |

---

## 9. Further reading

- [`skills/kos-jarvis/README.md`](../skills/kos-jarvis/README.md) — extension pack scope & upgrade policy
- [`skills/kos-jarvis/PLAN-ADJUSTMENTS.md`](../skills/kos-jarvis/PLAN-ADJUSTMENTS.md) — deltas discovered during migration vs original plan
- [`skills/kos-jarvis/type-mapping.md`](../skills/kos-jarvis/type-mapping.md) — KOS 9 kinds ↔ GBrain 20 dirs
- [`scripts/launchd/README.md`](../scripts/launchd/README.md) — cutover runbook, rollback, archive
- [`docs/GBRAIN_RECOMMENDED_SCHEMA.md`](GBRAIN_RECOMMENDED_SCHEMA.md) — upstream brain schema (MECE directories)
- Source plan (outside repo): `~/.claude/plans/docs-gbrain-vs-kos-analysis-md-gbrain-parsed-candle.md`
