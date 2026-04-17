# Jarvis Knowledge OS v2 — Architecture & Runbook

> 2026-04-17 | Lucien × Jarvis
> Fork: [`ChenyqThu/jarvis-knowledge-os-v2`](https://github.com/ChenyqThu/jarvis-knowledge-os-v2)
> Upstream: [`garrytan/gbrain`](https://github.com/garrytan/gbrain) v0.10.1
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
   85 compiled pages             3-agent topology
   kos-compat-api 7220           6 cron jobs
   gemini-embed-shim 7222        feishu skill (HTTP to kos.chenge.ink)
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
             (85 pages, 92 chunks, pgvector HNSW index)
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

## 7. Known gaps (see `skills/kos-jarvis/TODO.md` for live tracker)

- **P0**: `kos-patrol/run.ts` not implemented — OpenClaw cron f0709db6 uses
  `/digest+/status` stopgap.
- **P1**: `kos-lint` path resolver reports ~112 false-positive dead links
  from legacy KOS v1 relative link syntax.
- **P1**: `dikw-compile`, `evidence-gate`, `confidence-score` lack runnable
  helpers — agent-driven only.
- **P2**: `notionToBrain` sync not yet in kos-worker repo (design done).
- **P2**: `kos-compat-api /ingest` accepts `url` only; should also accept
  `markdown` payload for the notion-ingest-delta path.

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
