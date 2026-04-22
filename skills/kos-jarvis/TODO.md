# kos-jarvis — Outstanding Work

> Live tracker for v2 fork. Items are ordered by blocking severity. Each
> has a concrete acceptance criterion. Cross-linked with commits when done.

## P0 — blocking full autonomy

### [x] v1 wiki migration into v2 PGLite brain — 2026-04-20
85 pages imported via `gbrain import` in 25.4 s (91 chunks, 0 errors).
Port swap complete: v2 bun `kos-compat-api` now owns :7220 (production);
v1 Python `kos-api.py` unloaded (plist bak retained). `kos.chenge.ink`
tunnel verified end-to-end through 5 Chinese queries with LLM synthesis
via new `synthesizeAnswer()` in `server/kos-compat-api.ts`.

### ~~[ ] v1 wiki migration into v2 PGLite brain~~
**Why**: Production `kos.chenge.ink` is still served by v1 Python
`kos-api.py` on :7220 because v2 PGLite has only Notion-sourced pages (no
wiki). Cutting the tunnel over today would strand 85 wiki pages and break
Notion Knowledge Agent + feishu-bridge queries.

**What**:
1. `gbrain import /Users/chenyuanquan/Projects/jarvis-knowledge-os/knowledge/wiki/`
   into `~/.gbrain/brain.pglite`
2. Verify Chinese retrieval 5/5 with regression prompts
3. Swap `com.jarvis.kos-api.plist` (v1 python :7220) with
   `com.jarvis.kos-compat-api.plist` (v2 bun :7220) — requires repointing
   kos-compat-api from staging :7221 back to :7220 and unloading v1
4. Confirm `kos.chenge.ink /query` hits v2 code path

**Acceptance**: `kos.chenge.ink` query returns v2-synthesized answer with
citation paths that resolve inside PGLite; notion-poller's own ingest
continues to land without port changes.

### [x] Notion poller frontmatter `id: ">-"` bug — 2026-04-20
Two-layer fix: `server/kos-compat-api.ts` now single-quotes the id field
on emission (`id: '${kind}-${slug}'`); `skills/kos-jarvis/kos-lint/run.ts`
`parseFrontmatter` now handles YAML block-scalar forms (`>`, `>-`, `|`,
`|-`). kos-lint drops from 1 ERROR (22 slugs listed) to 0 ERROR / 0 WARN
on 41 pages. 22 pre-fix Notion pages still carry the ugly frontmatter on
disk; will re-ingest on the next Notion edit cycle or via a bulk delete +
backfill.

### ~~[ ] Notion poller frontmatter `id: ">-"` bug~~
**Why**: All 22+ Notion-sourced pages in v2 brain have malformed YAML
`id: ">-"` (block-scalar indicator instead of a string). `kos-lint --check 2`
fires on every run with one giant "duplicate id" error listing all affected
slugs.

**What**: fix `workers/notion-poller/run.ts` frontmatter serialization —
likely an unescaped multi-line value or missing quotes on the id field.
Re-emit affected pages after fix.

### [ ] upstream v0.13.0 orchestrator bug — `doctor` stuck on "partial" — 2026-04-22
Filed as [garrytan/gbrain#332](https://github.com/garrytan/gbrain/issues/332).
`src/commands/migrations/v0_13_0.ts:44` uses `process.execPath` for the
gbrain binary — works on compiled-binary installs, but on our bun-runtime
symlink install (`~/.bun/bin/gbrain -> src/cli.ts`) it resolves to `bun`,
so the migration's `frontmatter_backfill` phase tries to run `bun extract`
instead of `gbrain extract`, fails with "Script not found", and silently
runs `bun init` as a side effect (pollutes package.json with `private:true`
+ typescript peerDep, creates `.cursor/rules/`).

**Workaround applied today**: manually ran `gbrain extract links --source db
--include-frontmatter` (170 frontmatter links extracted), reverted package.json
+ deleted `.cursor/`. Migration ledger still says `partial`, so `gbrain doctor`
will permanently warn `MINIONS HALF-INSTALLED (partial migration: 0.13.0)`
until upstream fixes it or we patch locally.

**Cost of leaving broken**: cosmetic. Doctor health_score drops; actual data
is correct (frontmatter-link graph is wired). Don't patch `src/*` locally
per fork policy (CLAUDE.md) unless upstream stalls.

### [ ] kos-compat-api `/ingest` HTTP 500 on some Notion pages
Seen on `password-hashing-on-omada`. Error body truncated in shell-job
stderr_tail. Reproduce with `curl ... /ingest` using the offending payload
and read `gbrain import` error path.

### [ ] notion-poller minion wrapper deadlocks on PGLite lock — 2026-04-22
**Why**: `scripts/minions-wrap/notion-poller.sh` calls
`gbrain jobs submit shell --follow` to queue + inline-execute the Notion
delta sync. The inner shell command runs `workers/notion-poller/run.ts`,
which HTTP-POSTs `/ingest` to `kos-compat-api` (:7220), which in turn
`spawnSync("gbrain import", ...)` — a subprocess that wants the PGLite
lock. But the outer `gbrain jobs submit --follow` process still holds
that lock. Result: every ingest inside a poll cycle times out after 30s,
the whole job hangs, and launchd gets stuck on a lease it won't release
until the 10-minute job timeout hits. Triggered today during the v0.15.1
sync; had to kill PID 22471 by hand to unwedge the CLI.

**What** (pick one, not yet decided):
1. **Drop `--follow`** from `scripts/minions-wrap/*.sh` and run a
   `gbrain jobs work --queue notion,kos-patrol,enrich,lint` worker as
   its own launchd service that starts before any poller. But PGLite's
   single-writer lock means the worker itself becomes a serialization
   point — any CLI `gbrain list` / `/ingest` / `/query` spawn blocks
   while a job is active.
2. **Retire minion wrappers for any job that calls back into
   kos-compat-api or gbrain CLI.** Keep them for leaf work only
   (e.g. `kos-deep-lint`, `kos-patrol` that only `gbrain list` + write
   markdown). Put `notion-poller` back as a direct launchd job (pre-
   minions-wrap design), since retry / timeout / audit can also be
   solved at the poller level.
3. **Refactor kos-compat-api to stop spawning `gbrain` subprocesses**
   and run the import in-process. Removes the lock-contention root
   cause across the board. Bigger refactor; unblocks future async work.

**Acceptance**: `launchctl load com.jarvis.notion-poller` can run on a
5-min cron for 24 h with zero wedged jobs; `gbrain stats` and `/query`
stay responsive throughout; no manual kill required.

**Cost of leaving broken**: `com.jarvis.notion-poller` stays unloaded
(currently `Disabled=1`). Notion pages only land via manual
`/ingest` call or explicit poller run. Feishu / Notion Knowledge Agent /
kos.chenge.ink `/query` path is unaffected.

### [x] kos-patrol/run.ts (TypeScript helper) — 2026-04-17
Landed as part of the Phase 2+3 wave. Runs six-phase protocol (inventory,
lint delegation, staleness, gap detection, dashboard, digest). First-pass
output on 86-page brain: 116 ERROR (legacy v1 path-resolver, see P1 below),
0 stale (no decision/protocol/project page is yet >180d), 20 entity gaps
(fodder for enrich-sweep). Writes to `~/brain/agent/dashboards/` and
`~/brain/agent/digests/`. Exit codes: 0 clean, 1 lint ERROR, 2 WARN-only.

### ~~[ ] kos-patrol/run.ts (TypeScript helper)~~
**Why**: `skills/kos-jarvis/kos-patrol/SKILL.md` is markdown-only. OpenClaw
feishu cron `f0709db6 知识库每日巡检` currently uses a stopgap pointing at
`GET /digest?since=1 + /status` which gives inventory but not lint/staleness/
gap detection.

**What**: Port the five phases from SKILL.md into runnable TypeScript at
`skills/kos-jarvis/kos-patrol/run.ts`:
1. inventory via `gbrain list --limit 10000`
2. invoke `kos-lint/run.ts` programmatically for 6-check
3. staleness scan (kind ∈ {decision, protocol, project} + updated > 180d)
4. gap detection (entity mentions ≥ 3 without page)
5. write dashboard to `~/brain/agent/dashboards/knowledge-health-<date>.md`
6. write digest block to `~/brain/agent/digests/patrol-<date>.md` (the
   `[knowledge-os]` format that `digest-to-memory/run.ts` picks up weekly)

**Acceptance**: running `bun run skills/kos-jarvis/kos-patrol/run.ts` on
current 85-page brain produces both files, exits 0/1/2 by severity, and
`digest-to-memory/run.ts --dry` picks up the fresh digest.

**Timing**: within 7-day observation window so cron payload can swap before
v1 archive.

---

## P1 — quality improvements

### [ ] kos-lint path resolver for KOS v1 legacy links
`kos-lint` currently reports 112 "dead links" after full import, mostly
because v1 wrote relative markdown links like `../sources/foo.md` and the
resolver strips path to slug `foo` instead of checking `sources/foo`.

**What**: normalize target to try both flat slug AND dir-prefixed slug before
declaring dead. Should drop noise from ~112 to ~10-20 actual-dead.

### [ ] dikw-compile/run.ts (actually runnable)
SKILL.md is thorough, but no bun helper exists. Without it, dikw-compile
is agent-driven only. Adding run.ts unlocks cron-based re-compile sweeps.

### [ ] evidence-gate/run.ts
Ditto. Single-page evaluator for agent or CLI use.

### [ ] confidence-score/run.ts
Ditto.

---

## P2 — ecosystem wiring

### [ ] Evaluate 3072-dim Gemini embeddings vs current 1536-dim
`skills/kos-jarvis/gemini-embed-shim/` truncates Gemini's native 3072-dim
output to 1536 (OpenAI SDK default for text-embedding-3-large). Gemini's
native dim is 3072; truncation loses signal. Worth measuring retrieval
gain on the 39-page brain before committing to a full reindex.
**What**: A/B run identical retrieval queries at 1536 vs 3072. If win
>5 % precision@5, reindex + update pgvector index.

### [ ] Evaluate BrainWriter `strict_mode=strict` flip
Upstream policy requires 7-day observational soak before flipping strict.
`writer.lint_on_put_page=true` as of 2026-04-20. Review
`~/.gbrain/validator-lint.jsonl` after 2026-04-27; if zero false positives
on KOS pages, flip.


### [ ] notionToBrain sync in kos-worker (src/index.ts)
`skills/kos-jarvis/notion-ingest-delta/SKILL.md` describes the contract.
Actual @notionhq/workers `backfill + delta` sync pair still needs to be
added to the kos-worker repo (lives in v1 repo at `workers/kos-worker/`,
not this fork). Delta schedule 5m.

**Prereq**: kos-compat-api's `/ingest` needs to accept a `markdown` payload
in addition to `url` (currently only URL fetch path). Extend endpoint to
take `{markdown, slug, source, notion_id}`.

### [x] upstream kos-compat-api to accept `markdown` field — 2026-04-20
`handleIngest` now accepts both `url` and `markdown` payloads
(`server/kos-compat-api.ts`). Verified via Notion poller end-to-end:
38 pages ingested through the `{markdown, title, source, notion_id, kind}`
path after pointing the poller at staging :7221.

### [x] enrich-sweep on existing 85 pages (primary G1 payoff) — scaffolded 2026-04-17
`skills/kos-jarvis/enrich-sweep/` landed with SKILL.md, run.ts, lib/*.ts,
and report.template.md. Scaffolding dry-ran cleanly on 86 pages
(pre-flight OK, report writes, no NER in dry mode). Awaiting Lucien to:
1. Export `ANTHROPIC_API_KEY` and `TAVILY_API_KEY` in shell
2. Run `bun run skills/kos-jarvis/enrich-sweep/run.ts --plan` for
   Haiku-driven candidate review
3. Approve Tier distribution; run without flag for live stub creation
No Crustdata — Tier 1 candidates auto-degrade to Tier 2 (logged in report
as `wants-tier1`).

### [ ] pending-enrich queue consumer (v1.1 of enrich-sweep) — P1
enrich-sweep v1 scans the brain only. Add a `--queue` flag that also
drains `~/brain/agent/pending-enrich.jsonl` before Phase B dedupe so
Feishu-only mentions can create stubs even when not yet written into a
source page. Producer (Feishu signal-detector plugin) is live as of
2026-04-17 per OpenClaw Jarvis acceptance report — queue is already
writing, consumer just needs to land.

### [ ] Phase 2 Feishu signal-detector wiring (OpenClaw side)
Not a v2-repo task — executed by Lucien in `~/.openclaw/workspace/` per
[`docs/FEISHU-SIGNAL-DETECTOR-SETUP.md`](../../docs/FEISHU-SIGNAL-DETECTOR-SETUP.md).
Expected outcome: within a week of enabling, ≥ 5 Feishu-only candidates
appear in the enrich-sweep report.

### [ ] Crustdata / Proxycurl / PDL integration (deferred)
Tier 1 structured-people enrichment is blocked on a paid API key. Lucien
can trigger this later by exporting `CRUSTDATA_API_KEY` and adding a
`lib/crustdata.ts` alongside `lib/tavily.ts`. Until then, enrich-sweep
flags high-mention candidates as `wants-tier1` in the report.

### [ ] Stage 4 finalize: archive v1 repo
After 7 days of stable v2:
1. Push v1-frozen tag
2. `mv ~/Library/LaunchAgents/com.jarvis.kos-api.plist ~/Library/LaunchAgents/_archive/`
3. Evaluate whether to replace `com.jarvis.kos-deep-lint` with a v2 equivalent
4. Archive v1 repo on GitHub (Settings → Archive)

---

## Done (reference)

- [x] 2026-04-20: **Upstream v0.14.0 sync** — merged 9 upstream releases
  (v0.10.1 → v0.14.0). Tests 1762 unit + 138 E2E green. Merge commit
  `0c0ceec`; rollback tag `pre-sync-v0.14`. 10 kos-jarvis skills
  registered in manifest.json (orphan_trigger test fixed). All 4 crons
  migrated to Minions shell-job wrappers at `scripts/minions-wrap/*.sh`.
  BrainWriter `writer.lint_on_put_page=true` enabled (observational).
  kos-lint check #3 (dead internal links) retired — BrainWriter's
  `linkValidator` covers. kos-compat-api moved to staging :7221; v1
  Python kos-api remains on :7220 (prod). Notion poller re-pointed at
  :7221 after `gbrain init` recreated an empty PGLite at
  `~/.gbrain/brain.pglite` (config.json had been corrupted by test DB URL).
- [x] Week 1: fork + v1-frozen tag + 5-page smoke
- [x] Week 2: 5 skill SKILL.md files + kos-lint run.ts
- [x] Week 3: kos-compat-api + digest-to-memory + notion-ingest-delta
  doc + feishu-bridge doc + gemini-embed-shim + RESOLVER extension
- [x] Week 4: 85 pages imported + 92 chunks embedded via Gemini +
  Chinese regression 5/5 + launchd cutover + auto-embed in /ingest
- [x] OpenClaw feishu-bridge migration (by OpenClaw agent, reviewed)
