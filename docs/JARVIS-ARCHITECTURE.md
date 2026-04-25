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
   kos-compat-api (v2) 7220      6 cron jobs
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
             │  com.jarvis.kos-compat-api     │ ← port 7220
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
             │  com.jarvis.kos-deep-lint      │ ← cron-driven KOS lint
             │  com.jarvis.enrich-sweep       │ ← cron-driven entity enrichment
             │  com.jarvis.notion-poller      │ ← 5-min direct bun invocation (Path B)
             └────────────────────────────────┘
                              │
                              ▼
             PGLite database at ~/.gbrain/brain.pglite
             (~1800 pages, ~3300 chunks, pgvector HNSW index)
```

### Port map

| Port | Service | Auth | Exposed |
|------|---------|------|---------|
| 7220 | kos-compat-api | Bearer token (`KOS_API_TOKEN`) | Yes (via kos.chenge.ink + Notion Worker) |
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
| Minions shell job — all 4 crons | Migrated | `notion-poller`, `kos-patrol`, `enrich-sweep`, `kos-deep-lint` now run via `gbrain jobs submit shell --follow` wrappers at `scripts/minions-wrap/*.sh`. PGLite constraint: `--follow` inline, no daemon. Retry, timeout, unified `gbrain jobs list` visibility. |
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
- **Port cutover**: v2 bun `kos-compat-api` now owns :7220 (production, serves `kos.chenge.ink` through the cloudflared token tunnel). v1 Python `kos-api.py` is unloaded (`.plist.bak` retained for 30-s rollback).
- **Poller cutover**: `notion-poller` now posts to :7220 (v2). Notion content and v1 wiki content both live in `~/.gbrain/brain.pglite`. Total 100 pages as of 2026-04-20.
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
| `/status` endpoint via prod port 7220 | total_pages=1858 (was 100-capped), full KOS 9-kind + confidence breakdown |
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
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:7220/status   # 1988p / 9 kinds
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

## 7. Known gaps (see `skills/kos-jarvis/TODO.md` for live tracker)

- **P0 resolved 2026-04-22**: notion-poller PGLite deadlock — Path B landed in v0.17 sync (see §6.7). `scripts/minions-wrap/notion-poller.sh` deleted; plist now direct-bun invocation of `workers/notion-poller/run.ts`. First live cycle: 78 s / 9 pages ingested / 0 lock timeouts.
- **P0 resolved 2026-04-25 (v0.20.4 sync)**: v0.13.0 migration orchestrator partial-forever ([garrytan/gbrain#332](https://github.com/garrytan/gbrain/issues/332)). Upstream fixed in v0.19.0 by shell-out to `gbrain` instead of `process.execPath`. Post-merge `gbrain apply-migrations --force-retry 0.13.0` + `apply-migrations --yes` advanced the ledger; doctor health 60→80, no more FAILs. See §6.14.
- **P1 (new, v0.17 sync follow-up)**: refactor `kos-compat-api` to import in-process instead of `spawnSync("gbrain import")`. Removes the lock-contention root cause for all future callers, not just notion-poller. ~150 LOC touch in `server/kos-compat-api.ts`. Path B is the Band-Aid; Path C is the cure.
- **P1**: `kos-compat-api /ingest` returns HTTP 500 for some Notion pages (seen on `password-hashing-on-omada`); investigate `gbrain import` failure mode.
- **P1 (anchor, Step 2.3 done, Step 2.4 parked +14d)**: filesystem-canonical migration. Steps 1 → 2.3 done + v0.18 upstream synced (see §6.8 → §6.13 + [`docs/FILESYSTEM-CANONICAL-EXPORT-AUDIT.md`](FILESYSTEM-CANONICAL-EXPORT-AUDIT.md)). All pre-migration blockers cleared + Step 2.2 landed (`b7212db`) + v0.18.2 merged (`aceb838`) + Step 2.3 dream cron wired (`com.jarvis.dream-cycle` daily 03:11 local, archives to `~/brain/.agent/dream-cycles/`, see §6.13). `/ingest` writes canonical to `~/brain/<kind>/<slug>.md` + git commit + `gbrain sync`, `/status` direct-DB (1930 not 100), `.agent/` hidden from sync, `~/brain/` is a git repo with nightly maintenance pass, schema at v24 with sources.default seeded. Only Step 2.4 (commit-batching + optional explicit `jarvis` source add / remote push) remains, parked +14d.
- **P1 (open, awaiting upstream)**: [garrytan/gbrain#370](https://github.com/garrytan/gbrain/issues/370) — PGLite v16→v24 upgrade blocker (single-line bug in `pglite-schema.ts`). Fork carries a 1-line local patch (`docs/UPSTREAM-PATCHES/v018-pglite-upgrade-fix.md`); remove when upstream merges the fix. See §6.12.
- **P1 (new, Step 2.2 follow-up)**: kos-patrol launchd cron `LastExitStatus=1` since 2026-04-19 due to macOS 26.3 WASM bug (`#223` class) hitting the minion-wrapped subprocess. Direct bun-run works. Plus kos-patrol uses `gbrain list --limit 10000` (100-row-capped) — migrating to `BrainDb` direct-read is the natural fix.
- ~~**P1**: `dikw-compile`, `evidence-gate`, `confidence-score` lack runnable helpers~~ — **resolved 2026-04-22**: all three landed with `run.ts`, backed by the shared `skills/kos-jarvis/_lib/brain-db.ts` direct-PGLite reader that bypasses the MCP 100-row cap. See TODO.md P1 done markers.
- **P2 (new, v0.20 sync follow-up)**: PGLite → Postgres switch — analyzed and **deferred**. v0.20.2/v0.20.3's flagship features (jobs supervisor, queue_health, wedge-rescue, backpressure-audit) all skip on PGLite. None of them address pain we currently have. Four trigger conditions documented at [`docs/UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md`](UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md): brain >5000 pages, multi-machine access, WAL fork-patch failure, durable subagent runtime needed. Migration cost ~1 h via `gbrain migrate --to supabase`.
- **P2 (new, v0.20 sync follow-up)**: 14 unresolved frontmatter cross-dir refs surfaced by `gbrain extract links --source db --include-frontmatter`. All v1-wiki legacy `../entities/*.md` / `../sources/*.md` paths that import-time slug normalization missed. Cosmetic (dead-end refs in the graph, no query impact). Fix is a one-shot rewrite skill, ~1-2 h. Tracked in TODO.md P2.
- **P2**: v1 Python `kos-api.py` + `kos` CLI still live in `/Users/chenyuanquan/Projects/jarvis-knowledge-os/`. Unloaded from launchd (`com.jarvis.kos-api.plist.bak`) but not archived. After a 7-day v2 soak, move the plist bak into `~/Library/LaunchAgents/_archive/` and archive the v1 repo.
- **P2**: Evaluate Gemini 3072-dim embeddings vs current 1536-dim truncation; requires full reindex if adopted.
- **P2**: Evaluate BrainWriter `strict_mode=strict` flip after 7-day lint-observer soak.
- **P2**: Unify LLM telemetry — v1 repo's `llm-runner.py` writes `knowledge/logs/llm-calls.jsonl`; v2's new `synthesizeAnswer` in `kos-compat-api.ts` does not log. Add a shared JSONL sink.

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
