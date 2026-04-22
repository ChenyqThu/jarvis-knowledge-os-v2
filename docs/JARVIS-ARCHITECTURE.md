# Jarvis Knowledge OS v2 — Architecture & Runbook

> 2026-04-17 | Lucien × Jarvis (last sync: 2026-04-22 → upstream v0.15.1)
> Fork: [`ChenyqThu/jarvis-knowledge-os-v2`](https://github.com/ChenyqThu/jarvis-knowledge-os-v2)
> Upstream: [`garrytan/gbrain`](https://github.com/garrytan/gbrain) v0.15.1 (override: `@electric-sql/pglite` pinned to 0.4.4 instead of upstream's 0.4.3; see §6.6)
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
             │  com.jarvis.kos-deep-lint      │ ← still lints v1 archive
             │     (7-day observation)        │   (scheduled to retire)
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
| `dikw-compile` | Post-ingest strong-link enforcement (`supplements`/`contrasts`/`implements`/`extends`), 2-5 links/page budget, A/B/C/F grading | Not yet (TODO P1) |
| `evidence-gate` | Block claims below threshold (decision E3+, synthesis E2+, concept E2+, ...) | Not yet (TODO P1) |
| `confidence-score` | Auto-score high/medium/low per page; compile-grade per ingest | Not yet (TODO P1) |
| `kos-lint` | Six-check lint (frontmatter / duplicate id / dead links / orphans / weak links / evidence gaps) | ✅ `run.ts` |
| `kos-patrol` | Daily sweep → dashboard + MEMORY-format digest | ⚠️ SKILL.md only (P0 TODO) |
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
TOKEN=$(grep KOS_API_TOKEN ~/Library/LaunchAgents/com.jarvis.kos-api.plist \
  | sed -n 's/.*<string>\(.*\)<\/string>.*/\1/p' | head -1)

curl -s -H "Authorization: Bearer $TOKEN" https://kos.chenge.ink/status | jq .
# expect: total_pages >= 85, engine = "gbrain (pglite)"

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

## 7. Known gaps (see `skills/kos-jarvis/TODO.md` for live tracker)

- **P0**: `scripts/minions-wrap/notion-poller.sh` deadlocks on PGLite lock (see §6.6). Architectural call pending; `com.jarvis.notion-poller` launchd job stays `Disabled=1` until resolved. Notion ingest only runs on manual `/ingest` until then.
- **P0**: v0.13.0 migration orchestrator partial-forever under bun-runtime install. Filed as [garrytan/gbrain#332](https://github.com/garrytan/gbrain/issues/332). `gbrain doctor` permanently reports `MINIONS HALF-INSTALLED`; cosmetic, no runtime impact. Watch upstream.
- **P1**: `kos-compat-api /ingest` returns HTTP 500 for some Notion pages (seen on `password-hashing-on-omada`); investigate `gbrain import` failure mode.
- **P1**: `dikw-compile`, `evidence-gate`, `confidence-score` lack runnable
  helpers — agent-driven only. Observed in the post-cutover query regression — questions about these skills return "not in retrieval" because there's no page describing them in the v2 brain (only SKILL.md files).
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
