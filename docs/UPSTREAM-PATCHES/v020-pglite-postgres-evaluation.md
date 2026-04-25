# PGLite → Postgres switch evaluation (v0.20.4 sync)

> 2026-04-25 | Jarvis KOS v2 fork | analysis decision: **defer indefinitely**

## Why this document exists

The v0.18.2 → v0.20.4 upstream sync (commit `8665afb`) brought in three
flagship reliability features ... `gbrain jobs supervisor` (v0.20.2),
`queue_health` doctor check + wedge-rescue wall-clock sweep (v0.20.3),
and the `backpressure-audit` JSONL trail (v0.20.3). All three skip on
PGLite. Plus v0.16's durable agent runtime (`gbrain agent run` +
`subagent_aggregator` + rate-leases) needs a multi-process worker pool
that PGLite's single-writer lock cannot serve.

Reasonable question: do we switch the production engine from PGLite to
managed Postgres (Supabase) so we can adopt these features?

This doc captures the decision and the trigger conditions for revisiting.

## Current state (2026-04-25 baseline)

| Dimension | Value |
|---|---|
| Engine | PGLite 0.4.4 (WASM-embedded Postgres 17.5) |
| dataDir size | 416 MB (`~/.gbrain/brain.pglite/`) |
| Pages | 1988 |
| Chunks | 3750 (100% embedded via Gemini shim) |
| Links | 8666 (frontmatter-derived + auto-link) |
| Timeline entries | 11020 |
| Orphans | 711 (down from 1815 over 4 weekly sweeps) |
| Brain score | 86/100 (embed 35/35, links 25/25, timeline 3/15, orphans 13/15, dead 10/10) |
| Doctor health | 80/100 (after #332 closure) |
| Median query latency | <100 ms (local SSD, no network) |
| Concurrent writers needed | 1 (kos-compat-api) + 4 cron jobs serialized via launchd |

## Side-by-side

| Concern | PGLite (now) | Postgres (Supabase) |
|---|---|---|
| Data size at 2k pages | 416 MB on disk | ~500 MB on Supabase free tier (limit) |
| Query latency | <100 ms (local) | ~80-150 ms (network + RTT) |
| Write concurrency | Single-writer lock | Connection-pooled, multi-worker |
| `gbrain jobs supervisor` | Skipped (PGLite no daemon mode) | Available |
| `queue_health` doctor | Skipped (no multi-process queue) | Available |
| `wedge-rescue` wall-clock sweep | Skipped | Available |
| `backpressure-audit` JSONL | N/A (maxWaiting useless single-writer) | Active |
| `gbrain agent run` durable runtime | Limited to `--follow` inline mode | Full daemon mode |
| WAL durability | Fork patch (`pg_switch_wal()` before close) | Native WAL with PITR |
| Backups | Manual (cp -R dataDir) | Automatic 7-day PITR |
| Network dependency | None (offline OK) | Required (cloudflared/internet) |
| Operational cost | $0 | $0 free tier → $25/mo @ >500 MB |
| Migration tool | n/a | `gbrain migrate --to supabase` (upstream) |
| Migration time on 2k pages | n/a | ~20 min (chunks + embeddings re-embed unnecessary, IDs preserved) |
| Plist reconfig effort | n/a | 4 launchd plists, ~30 min |

## Pain match

The v0.20 features all address pain we don't have:

- **Jobs supervisor**: solves "the worker daemon dies and nobody notices for hours."
  We don't run a worker daemon. Path B retired the Minion shell-wrap layer for
  notion-poller. The 4 cron jobs (notion-poller, dream-cycle, kos-patrol,
  enrich-sweep) are launchd timers that exit after work completes ... no
  long-running queue worker to nanny.

- **`queue_health`**: surfaces stalled-forever and per-name pile-up. We have no
  queue. Even `kos-deep-lint` runs synchronously to completion.

- **Wedge-rescue / wall-clock sweep**: the failure mode is "worker holds row
  lock for 90 minutes, neither stall detection nor timeout sweep can evict."
  We don't have a multi-row queue at risk.

- **Backpressure-audit / `maxWaiting`**: prevents N submitters piling up behind
  the same job key. We have at most one submitter per cron job (cardinality 1).

PGLite-side pain we _do_ have, and how it's handled today:

| Pain | Mitigation |
|---|---|
| Single-writer lock contention | Path B (notion-poller direct bun-run, no minion wrapper) |
| WAL durability bug on macOS 26.3 | Fork patch `pg_switch_wal()` before `db.close()` (see `v018-pglite-wal-durability-fix.md`) |
| 100-row `gbrain list` cap | `BrainDb` direct-PGLite reader in 4 kos-jarvis skills (kos-patrol, dikw-compile, evidence-gate, confidence-score) |
| WASM `Aborted()` in nested subprocess | Path B retired all minion-wrapped crons; current launchd calls bun directly |
| dataDir size growth | 416 MB at 2k pages, ~210 KB/page; comfortable runway to 5k pages = ~1 GB |

## When to revisit (any one of these)

1. **Brain crosses 5000 pages**. PGLite query latency will start to show on
   pgvector + tsvector hybrid scans. WASM heap is 4 GB max; 5k pages with
   3072-dim embeddings (if we ever flip from truncated 1536) ate measurable
   percentage in a synthetic test. Revisit at p50 query >200 ms or p99 >500 ms.

2. **Multi-machine access becomes real**. Today everything runs on Lucien's
   MacBook. If kos-compat-api needs to live on a server while editing
   continues from a laptop ... or if a second OpenClaw instance comes
   online ... single-writer is no longer tractable.

3. **WAL fork patch fails silently**. The patch is held together by a single
   `SELECT pg_switch_wal()` call. If macOS WASM behavior shifts in 26.4 / 27.x
   and we lose writes again, switching to managed Postgres is the
   not-our-problem-anymore exit ramp.

4. **Multi-worker durable runtime needed for an actual product feature**. Like
   "subagent jobs that run for 20 minutes against Anthropic's API in the
   background while I do other things on the laptop." That's a v0.16 use case
   we don't have today, but a future direction.

## Estimated migration cost

If/when triggered:

```bash
# 1. Provision Supabase project, get connection string
# 2. Update ~/.gbrain/config.json with DATABASE_URL
# 3. Run upstream-provided migration tool
gbrain migrate --to supabase   # ~20 min for 2k pages
# 4. Reconfigure 4 launchd plists with DATABASE_URL env var
# 5. launchctl bootout / bootstrap each
# 6. Smoke test kos.chenge.ink
# 7. Keep PGLite dataDir as cold backup for ≥7 days before deletion
```

**Total estimated work: ~1 hour** including verification.

The fork patches at `pglite-schema.ts` and `pglite-engine.ts` become dead
code post-migration but don't need removing ... they only fire on PGLite
engine selection. The Gemini embed shim (`OPENAI_BASE_URL` redirect)
keeps working unchanged.

## Decision

**Defer indefinitely.** Reassess at any of the four trigger conditions.
Until then, keep PGLite + the WAL fork patch + Path B for any new cron
work. No engine churn for hypothetical features we don't use.

Filed against TODO.md P2 [`PGLite → Postgres switch evaluation`].

## See also

- [`v018-pglite-upgrade-fix.md`](v018-pglite-upgrade-fix.md) — fork-local patch for upstream #370
- [`v018-pglite-wal-durability-fix.md`](v018-pglite-wal-durability-fix.md) — fork-local WAL patch
- [`docs/JARVIS-ARCHITECTURE.md §6.14`](../JARVIS-ARCHITECTURE.md) — v0.20.4 sync runbook
