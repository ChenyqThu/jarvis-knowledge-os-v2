# kos-jarvis — Outstanding Work (ARCHIVED 2026-04-27 evening)

> 🏁 **ARCHIVED**. The v1-wiki legacy backlog driving most of this
> file's P0/P1/P2 entries closed during the 2026-04-27 evening Tier 1
> sweep + frontmatter-ref-fix v2 + 4 orphan-reducer rounds. Don't pick
> up work directly from this file.
>
> **NEXT SESSION ENTRY POINT**: [`docs/SESSION-HANDOFF-2026-04-27-evening-sweep-complete.md`](../../docs/SESSION-HANDOFF-2026-04-27-evening-sweep-complete.md)
> ... that file has current run-state, what to re-survey, day-zero checks,
> and instructions to build a fresh TODO from current pain points
> (not by editing this archived one).
>
> Below is preserved for archeology. It captures the v1-wiki migration
> story, fork patch genealogy, and the long P1 thread of filesystem-
> canonical work that landed across §6.5-§6.16. Useful when debugging
> "why did we do X this way" — read top-down to follow chronology.
>
> **Closed in this evening's session** (see
> [`docs/JARVIS-ARCHITECTURE.md §6.15-§6.16`](../../docs/JARVIS-ARCHITECTURE.md#615-tier-1-maintenance-sweep--orphan-reducer--frontmatter-ref-fix-2026-04-27-evening)):
>
> - 4 lint ERRORs → 0
> - Frontmatter long-tail dangling refs 70 → 0 (19 legitimate
>   `raw_path:` entries left, those are correct)
> - Orphans 814 → 732 across 4 orphan-reducer rounds, $1.354 Haiku
> - frontmatter-ref-fix v1 + v2 shipped (v2 added fuzzy resolve +
>   external/dead delete)
>
> **Calendar checkpoints owned by future sessions**:
> - 2026-05-04 — v1 archive (move `com.jarvis.kos-api.plist.bak` to `_archive/`)
> - 2026-05-07 — Step 2.4 commit-batching review
> - 2026-05-25 — 3072-dim Gemini embedding re-eval
> - Trigger-based — PGLite → Postgres switch (4 trigger conditions
>   named in `v020-pglite-postgres-evaluation.md`)

---

# Archived content below

> Original file from before the close. Live tracker semantics no longer apply.
> Items ordered by blocking severity at time of writing. Each has an
> acceptance criterion. Cross-linked with commits when done.
>
> **Previous session handoff** (now superseded): [`docs/SESSION-HANDOFF-2026-04-27-post-v0.20-sync.md`](../../docs/SESSION-HANDOFF-2026-04-27-post-v0.20-sync.md)

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

### [x] upstream v0.13.0 orchestrator bug — `doctor` stuck on "partial" — closed 2026-04-25 (v0.20 sync)

Upstream fixed #332 in v0.19.0 by replacing `process.execPath` with a
shell-out to `gbrain` on PATH. The v0.20.4 sync (commit `8665afb`)
brought the fix in. Then `gbrain apply-migrations --force-retry 0.13.0`
+ `gbrain apply-migrations --yes` walked the orchestrator through:

- `frontmatter_backfill` ran `gbrain extract links --source db
  --include-frontmatter` against all 1988 pages (14 unresolved
  cross-dir refs logged ... see new P2 below). Created 3 net new
  links (the 8522 pre-existing ones came from earlier manual runs).
- Ledger entry for v0.13.0 advanced to `complete`.
- `gbrain doctor` `minions_migration` check: FAIL → OK.
  Health score 60/100 → 80/100.

The old `[ ]` entry kept above the `## Done` line for archeology,
since the v0.17 sync notes referenced it.

**Filed**: [garrytan/gbrain#332](https://github.com/garrytan/gbrain/issues/332).
**Resolution**: upstream v0.19.0.

### [x] kos-compat-api `/ingest` HTTP 500 on some Notion pages — fixed transitively 2026-04-24

**Root cause (post-mortem)**: all 500 errors in
`workers/notion-poller/poller.stdout.log` came from
`"output": "GBrain: Timed out waiting for PGLite lock..."` stderr_tails,
clustered on 2026-04-19 / 2026-04-20 when notion-poller was wrapped
in a Minions shell job. The outer `gbrain jobs submit shell --follow`
held the PGLite write lock while the inner `gbrain import` subprocess
also tried to acquire it → 30-second timeout → 500 bubbled to notion-poller.

**Already fixed by** (in order):
1. **Path B migration (2026-04-22)**: dropped the Minions wrap for
   notion-poller — plist now calls `bun run workers/notion-poller/run.ts`
   directly. See `[x] notion-poller minion wrapper deadlocks on PGLite
   lock` above.
2. **WAL-durability fix (2026-04-23)**: the `password-hashing-on-omada`
   payload that previously failed is now reliably persisted because
   `pg_switch_wal()` advances the durable LSN before `db.close()`.

**Validation 2026-04-24**: replayed the exact notion-id
`34815375830d81bca79fd5b5474832b3` payload via
`POST /ingest` → `status=200 time=1.4s, imported=true`. Page 1953
of the brain lands cleanly. Also tested: Chinese titles, single-quote
injection in title, notion-shaped payload with tags/notion_id. All
200 OK.

Cleanup commit in ~/brain drops the 5 `sources/probe-*` probe files
used for diagnosis.

### [x] PGLite writes not persisting on handle close — fixed 2026-04-23
**Resolution** (commit follows this TODO): fork-local patch to
`src/core/pglite-engine.ts:disconnect()` + `skills/kos-jarvis/_lib/brain-db.ts:close()`.
Issue `SELECT pg_switch_wal()` before `db.close()`. Forces WAL segment
rotation → advances the durable LSN past outstanding inserts → reopen
recovery replays WAL up to the real head instead of a stale durable
position. Patch rationale + reproducer + validation in
`docs/UPSTREAM-PATCHES/v018-pglite-wal-durability-fix.md`. Post-patch
validation: orphan-reducer `--apply --limit 5 --no-commit` now lands
11/11 edges (ids 399-409) and `gbrain link` via CLI also persists
(Links 409 → 410).

**Symptom** (before the fix): inserts land in-process (`SELECT MAX(id)`
reflects them immediately) but a fresh `PGlite.create({dataDir})` on
the same path returns the pre-insert max_id. All `gbrain link` /
`gbrain tag` / any CLI write returned `{"status":"ok"}` exit 0 and
silently no-op'd on disk. Diagnostic signal: manual `CHECKPOINT`
before `db.close()` errored with `xlog flush request 0/5DADA990 is
not satisfied --- flushed only to 0/5DA8C080` — durable LSN stalled
behind the in-memory WAL position.

**Repro** (minimal):
```ts
import { PGlite } from "@electric-sql/pglite";
const db = await PGlite.create({ dataDir: "~/.gbrain/brain.pglite" });
const before = (await db.query("SELECT MAX(id)::int AS n FROM links")).rows[0].n;
await db.query(`INSERT INTO links (from_page_id, to_page_id, link_type, context, link_source)
  VALUES (2942, 3045, 'probe', 'probe', 'manual')`);
const after = (await db.query("SELECT MAX(id)::int AS n FROM links")).rows[0].n;
await db.close();
const db2 = await PGlite.create({ dataDir: "~/.gbrain/brain.pglite" });
const fresh = (await db2.query("SELECT MAX(id)::int AS n FROM links")).rows[0].n;
// before=395, after=396, fresh=395   ← FRESH should be 396.
```

**What's NOT the cause**:
- kos-compat-api concurrency (also repros with it stopped via `launchctl bootout`)
- `file://` URL prefix vs bare `dataDir` (both fail)
- My BrainDb wrapper (bypassed with raw PGlite import, still fails)
- pgvector / pg_trgm extension load (same with or without)

**What IS likely** (not verified): macOS 26.3 PGLite WASM persistence bug,
related to [garrytan/gbrain#223](https://github.com/garrytan/gbrain/issues/223)
which covers init-time failure on the same OS. The brain.pglite directory
mtime advances on write (WAL is being written), so PGLite hits fsync ok
but the checkpoint on close isn't landing the WAL into base/ — on reopen
the WAL replay starts from the last checkpoint which is pre-write.

**Data point**: the FIRST orphan-reducer `--apply` run (10 rows, ids
386–395) DID persist across reopens. Everything since (5+ `gbrain link`
probes + 2 more orphan-reducer runs) has silently lost the writes. So
persistence works *sometimes* — possibly on process-forked bun invocations
with different PGLite snapshot boundaries.

**Impact**:
- `orphan-reducer --apply` can't reliably land edges → stuck at dry-run
- Any CLI write path (`gbrain link`, `gbrain tag`, `gbrain put_page` via
  shell-out) is at risk
- kos-compat-api `/ingest` has been observed to successfully persist
  notion pages (pages count 1930 → 1952 over a day), so SOMETHING about
  its code path works. Worth comparing its PGlite usage with direct CLI.

**Next moves**:
1. File upstream with the minimal repro above (check against fresh gbrain
   install on non-macOS-26.3 first to rule out OS-specific)
2. Compare kos-compat-api's successful write path vs `gbrain link` —
   both use upstream engine, so the difference might be handle lifecycle
   (kos-compat-api process is long-lived and accumulates writes; CLI
   subprocess short-lived)
3. Try pglite bump (current 0.4.4 via fork pin) — see if a newer version
   closes properly
4. Fallback: migrate to Postgres engine (`gbrain migrate --to supabase`)

**Not start-from-scratch**: orphan-reducer's dry-run path is fully usable
today for manual classification-quality review + Haiku-prompt tuning,
even while apply is blocked.

### [x] notion-poller minion wrapper deadlocks on PGLite lock — 2026-04-22 (v0.17 sync)
Resolved via **Path B**: retired the Minions layer for notion-poller
only. `scripts/minions-wrap/notion-poller.sh` deleted;
`com.jarvis.notion-poller.plist` now calls `bun run
workers/notion-poller/run.ts` directly (no outer `gbrain jobs submit
--follow` holding the PGLite lock). Bun auto-loads `.env.local` from
`WorkingDirectory`. First live cycle 2026-04-22 15:45: 78 seconds,
9 Notion pages ingested, 0 "Timed out waiting for PGLite lock"
errors. Rollback plist at `~/Library/LaunchAgents/com.jarvis.notion-
poller.plist.pre-pathB-<ts>`.

**Leaf-only minion wrappers retained**: `kos-patrol`, `enrich-sweep`,
`kos-deep-lint` never HTTP-post into `kos-compat-api`, so they don't
have the outer+inner-lock pattern. Kept as-is.

**Path C still pending (tracked as P1 in arch §7)**: refactor
`kos-compat-api` to import in-process instead of `spawnSync("gbrain
import")`. Removes lock contention root cause for ALL callers, not
just notion-poller. ~150 LOC in `server/kos-compat-api.ts`. Not urgent
while Path B holds.

### ~~[ ] notion-poller minion wrapper deadlocks on PGLite lock~~

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

### [~] Filesystem-canonical migration — KOS v2 → .md-as-source-of-truth — 2026-04-22

**Steps 1 → 2.3 + 3.0 complete (2026-04-22 / 23 / 24). Core filesystem-canonical track done (disk↔DB 1:1, 1951/1951 pages). Only Step 2.4 (commit-batching + optional remote, +14d) remains.** Full report in
[`docs/FILESYSTEM-CANONICAL-EXPORT-AUDIT.md`](../../docs/FILESYSTEM-CANONICAL-EXPORT-AUDIT.md);
Step 2 design at [`docs/STEP-2-BRAIN-DIR-DESIGN.md`](../../docs/STEP-2-BRAIN-DIR-DESIGN.md);
Step 2.2 execution story at `docs/JARVIS-ARCHITECTURE.md §6.11`;
Step 2.3 execution story at `docs/JARVIS-ARCHITECTURE.md §6.13`.

- **Step 1 (2026-04-22)**: export dry-run audit. Verdict GO. KOS frontmatter
  preserved 100% in export; 0 raw_data sidecars means filesystem IS canonical.
- **Step 1.5 (2026-04-23)**: slug normalization. 7 root-level stray pages
  renamed (`ai-jarvis` → `concepts/ai-jarvis`; 6 URL-slug sources →
  `sources/<slug>`). 1 intra-brain md-link rewired. Total pages 1829 →
  1829 (0 drift). 15/15 verify assertions pass. Skill at
  `skills/kos-jarvis/slug-normalize/`. Report at
  `~/brain/agent/reports/slug-normalize-2026-04-23.md`.
- **Step 1.6 (2026-04-23)**: markdown round-trip sanity. `serializeMarkdown
  → parseMarkdown` on all 1829 pages, compared 10 KOS-critical frontmatter
  fields. **1829/1829 clean, 0 diffs.** `kind:` (and other KOS-specific
  keys) pass through upstream parse as pass-through JSONB. The 27% type/kind
  drift is safe to preserve.
- **Step 2.1 (2026-04-23)**: brain-dir design locked. 5 decisions pinned in
  [`docs/STEP-2-BRAIN-DIR-DESIGN.md`](../../docs/STEP-2-BRAIN-DIR-DESIGN.md):
  (1) `~/brain/` + `agent/`→`.agent/` rename, (2) sync fidelity covered by
  Step 1.6 + 30-min throwaway-dir smoke for Step 2.2 preflight, (3)
  notion-poller keeps HTTP-POST to `/ingest`; `/ingest` internal rewrite
  to file + `gbrain sync` handles the lock problem, (4) kos-patrol outputs
  migrate via path-constant rewrite, (5) git deferred to +14-day checkpoint.
  "100-pages mystery" resolved: `/status` shells `gbrain list --limit 10000`
  which silently caps at 100 upstream — not a filesystem mirror. DB truly
  has 1829 pages. `JARVIS-ARCHITECTURE.md §6` note at line 164 corrected.
- **Step 2.2 (2026-04-23 evening, commit `b7212db`)**: `/ingest`
  filesystem-canonical flip + `.agent/` rename + `/status` direct-DB
  executed. 6 files touched, +146/-58 lines. End-to-end verified:
  preflight smoke 10/10 fidelity clean, `mv agent .agent`, raw/web
  upgraded to KOS-source, `git init ~/brain` + seed commit (Decision 5
  revised — sync requires git, not deferrable), `gbrain sync --repo`
  registered, `/status` returns 1858 with full 9-kind breakdown,
  `/ingest` POST writes `~/brain/sources/*.md` + git commit + sync +1
  DB row + frontmatter 100% preserved, `/digest` serves from new
  `.agent/digests/` path, notion-poller clean on new path. Rolling
  backup: `~/.gbrain/brain.pglite.pre-step2.2-1776965283` (292MB).
- **v0.18 sync preflight (2026-04-23, commit `79331b7`)**: upstream
  v0.18.0/v0.18.1/v0.18.2 (PR #356) all fail the PGLite v16→v24
  migration path on our brain — `column "source_id" does not exist`
  thrown by engine methods before v21 adds the column. Fork policy
  forbids `src/*` patches. Sync deferred; Step 2.2 ran on v0.17
  baseline instead (clean upgrade path when upstream fixes).
- **`id: >-` pseudo-blocker withdrawn**: DB probe showed all 1829 pages
  store `frontmatter.id` as plain strings. The 262 `id: >-` appearances in
  export files come from `matter.stringify` / js-yaml auto-folding long
  strings. Deterministic, no churn, not data damage. See audit §5.4.
- **Lint shim plan withdrawn (2026-04-22)**: `placeholder-date` rule only
  matches literal `YYYY-MM-DD`, not `[E3]`. CLI wrap wouldn't intercept
  dream's inline lint invocation anyway. See audit §5.2.

**Remaining work for this track** (post-Step-2.2 micro-steps):

- **Step 2.3 (2026-04-23 late-night, branch master, untracked at this checkpoint)** — `gbrain dream` cron wired and first cycle observed.
  Wrapper at `skills/kos-jarvis/dream-wrap/run.ts` (resolves brain dir
  from `sync.repo_path`, defensive JSON extraction for stdout-noise
  resilience, atomic `latest.json` symlink swap, exit code translation:
  clean/ok/partial/skipped→0, failed→1, wrapper errors→2). Plist at
  `scripts/launchd/com.jarvis.dream-cycle.plist.template` schedules
  daily 03:11 local (off the :00 mark; `RunAtLoad=false`). 6 smoke
  cycles ran clean (lint-only ×2, dry-run ×2, real ×2) — idempotent
  (pages 1930→1930, chunks 3626→3626 unchanged across re-runs).
  Status `partial` is normal here: lint warns (144 issues, all from
  notion-poller frontmatter omitting `title:` / `type:` — KOS uses
  `kind:`) and orphans warns (1803/1930, v1-wiki migration legacy).
  Both filed below as P1 follow-ups. Rolling backup
  `~/.gbrain/brain.pglite.pre-step2.3-1776987292` (304 MB).
  Service shows `-  0  com.jarvis.dream-cycle` healthy in launchctl
  list. Story in `docs/JARVIS-ARCHITECTURE.md §6.13`.
- **Step 2.3 follow-ups** (P1, surfaced by first dream cycle 2026-04-23):
  1. **[x] notion-poller frontmatter — `title:` + `type:` omission** — fixed 2026-04-23
     Fix landed at the frontmatter builder — `server/kos-compat-api.ts`,
     not `workers/notion-poller/run.ts` (the poller posts markdown to
     `/ingest`; kos-compat-api wraps in frontmatter before writing to
     disk). Added `KIND_TO_TYPE` map (KOS kind → gbrain PageType per
     `skills/kos-jarvis/type-mapping.md`), `yamlQuoteSingle` helper
     (safely quotes titles with Chinese punctuation / colons / `'`),
     `deriveTitle` (first `# heading`, else slug). Both frontmatter
     builders (markdown-payload path + URL-fetch path) now emit
     `type: ${kindToType(kind)}` and `title: ${yamlQuoteSingle(title)}`.
     One-shot backfill of 95 existing `~/brain/sources/notion/*.md`
     files (95/95 changed, 0 skipped) + `gbrain sync --force` to
     reconcile DB. Verified: `gbrain lint ~/brain/sources/notion`
     went 190 → 0 warns; `gbrain dream --dry-run --phase lint`
     reports "Brain is healthy."
  2. **v1-wiki orphan backlog**: 1803/1930 pages have zero inbound
     wikilinks. Pre-existing — v1 wiki imported flat without graph
     edges. enrich-sweep + idea-ingest gradually fix this; track as
     a multi-week soak metric, not a 1-shot fix.
  3. **[x] Upstream `gbrain dream --dry-run --json` stdout pollution** —
     filed 2026-04-24 as
     [garrytan/gbrain#394](https://github.com/garrytan/gbrain/issues/394).
     Embed phase prints `[dry-run] Would embed N chunks across M pages`
     to stdout BEFORE the JSON CycleReport (first `{` at byte 49).
     Our `dream-wrap/run.ts` is defensively slicing, so no production
     impact. Draft + record at
     `docs/UPSTREAM-ISSUES/gbrain-dream-json-stdout-pollution.md`.
     Remove the defensive slice when upstream merges.
- **Step 3.0 / P1-A (2026-04-24, branch master, commits `8262df2`..`011d145`)** — bulk-export of 1840 PGLite-only pages → `~/brain/` filesystem-canonical.
  Closes the v1-wiki gap Step 2.2 left on the floor: before today, disk
  had 110 .md (notion + orphan-reducer sentinels only) and DB had
  1968 pages (1858-row delta). 6-phase runbook executed in one session
  (~2 h including the surprise dedup):
  - **Phase 0 (preflight)**: bootout notion-poller, rolling PGLite backup
    (`~/.gbrain/brain.pglite.pre-step3.0-1777022275`, 366 MB), dry-run
    `gbrain export --dir /tmp/export-v1` surfaced the planned
    `sources/sources/` double-prefix landmine.
  - **Phase 1 (slug cleanup, unplanned twist)**: 17 bad `sources/sources/notion/<id>`
    slugs turned out to be **duplicates** of well-slugged `sources/notion/<id>`
    twins (same Notion UUID, same `id:` frontmatter), differing ONLY in
    `title:` — BAD had slug-derived fallback (`Fastrak 33415...`), GOOD
    had real Notion title (`✅ FasTrak 账户注册完成`, CJK / emoji
    preserved). 17/17 always pointed the same way, so the "merge BAD.title
    → GOOD, then DELETE BAD" strategy collapsed to plain DELETE × 17
    (audit log `~/.gbrain/audit/p1a-phase1-bad-slug-delete-1777022797.jsonl`,
    canary verified). Pages 1968 → 1951 · chunks 3721 → 3680.
    `sources/sources/` dir vanished from re-export (`/tmp/export-v2`).
  - **Phase 2 (dry merge)**: NEW 1840 · MATCH 0 · DIFF 111 · DISK-ONLY 0.
    All 111 DIFF cases are **frontmatter YAML-serialization drift** only
    (field order, inline vs block lists, single-quoted scalars for
    `notion:xxx`); body was byte-identical across every pair. Plan's
    "prefer disk" policy applied cleanly — disk retains the original
    kos-compat-api emit format, which is what future notion-poller
    ingests keep producing. Report written to
    `docs/plans/P1-A-merge-categorization.md`.
  - **Phase 3 (rsync + sync)**: `rsync -av --ignore-existing /tmp/export-v2/
    ~/brain/` transferred 1840 files (14.5 MB), kept 111 existing. Pre-commit
    `gbrain sync --repo ~/brain` returned `up_to_date` (expected — sync
    is git-diff-driven and HEAD hadn't moved yet).
  - **Phase 4 (commits + bulk sync)**: 12 commits on `~/brain main`
    (`8262df2` canary timelines/ + 10 per-domain bulk + `011d145`
    .agent/ patrol-state cleanup). Canary proved sync-after-commit is
    **content-hash idempotent**: +1 added, 0 modified, **1 chunks
    created** (old chunk replaced, not duplicated), **"all 1 chunks
    already embedded"** — cache hit, zero API cost. Full bulk sync
    `8262df2e..011d1457` ran in **19 s**: `+1839 added, ~0 modified,
    -0 deleted, 3404 chunks created, 1 pages embedded` (really the
    canary from earlier; rest rode the cache). Links 939 → **8272
    (+7333)**, Timeline 5443 → **10881 (+5438)**. Embedded coverage
    stayed 100 % (3680/3680).
  - **Phase 5 (verify)**: orphans **1630 → 791 (-51 %)** · brain_score
    **65 → 87 (+22)** (links 12/25 → **25/25** maxed out, orphans 4/15
    → **13/15**, embed/dead-links steady at max). `gbrain dream
    --dry-run --json` → **sync phase 0/0/0** (disk ↔ DB aligned, plan's
    gate criterion), no `failed` phase. 10-sample spot-check passed;
    1951/1951 files have frontmatter. notion-poller bootstrapped back
    (all 9 launchd jarvis services healthy).
  - **Unblocks downstream**: orphan-reducer markdown dual-write now
    works on the remaining ~790 orphans (previously 95 % fell through
    as `markdown_reason: "no_file"`). Enrich-sweep Tier-1 edits can
    touch disk across the whole brain. Karpathy grep-wiki / git-log
    inspection covers 1951 pages instead of 110. Every notion-poller
    ingest now lands next to its 1840 bulk-exported siblings without
    path collision (verified by spot-check, next poll cycle will
    close the loop).
  - **Cost**: $0 LLM (pure data movement; embedding cache hit 3680/3680).
    ~9 MB git tree add in 12 commits. Plan doc
    `docs/plans/P1-A-bulk-export-filesystem-canonical.md` + handoff
    `docs/SESSION-HANDOFF-P1A-FILESYSTEM-CANONICAL.md` capture the
    execution trace; keep the handoff for one more week of archive
    reference, then clean up if unused.
- **Step 2.4** — (+14-day checkpoint) commit-batching wrapper + optional
  remote. Git is already initialized (landed with Step 2.2; Decision 5's
  "+14d defer" was revised mid-session — sync requires git). After 14
  days of error-free dream cycles, decide:
  (a) Optional: `gh repo create jarvis-brain --private` + extend
  dream-wrap to `git push` at cycle end, and
  (b) Commit-batching: replace per-ingest commits (currently ~5-9/poll)
  with end-of-dream-cycle amalgamation to reduce git-log noise.
  Scope: ~1-2 h depending on (a) (b) choice.

**Why**: Currently `kos-compat-api /ingest` writes **directly** to PGLite
(no .md landed on disk) because the Notion poller HTTP-POSTs payloads
and `spawnSync gbrain import` imports them straight into the DB. Brain
score sits at 56/100 and `gbrain dream` (v0.17's flagship 6-phase
nightly cycle) can't run because it expects a filesystem brain dir as
source of truth. We also lose git history of knowledge changes and the
Karpathy LLM-wiki self-maintenance pattern that upstream optimizes for.

**What**:
1. **Export DB → `/Users/chenyuanquan/brain/` markdown tree**. 1779 pages
   laid out per gbrain 20-dir MECE (`people/`, `companies/`, `concepts/`,
   `projects/`, `decisions/`, `sources/notion/`, `sources/feishu/`, ...).
   Each .md carries the KOS frontmatter (id, kind, owners, created,
   updated, confidence, evidence_summary, source_refs, ...) + body.
2. **Swap write path**. `server/kos-compat-api.ts` `/ingest` handler
   changes from `spawnSync gbrain import <stdin>` to:
   - Write `<brain>/sources/<source>/<slug>.md` (with frontmatter)
   - Invoke `gbrain sync <brain>` (or incremental `gbrain import <file>`)
   Same for `workers/notion-poller/run.ts`: drop HTTP POST, go
   file-write → sync directly.
3. **Configure brain dir** in gbrain config (likely via `gbrain init
   --pglite --path <brain>` or a dedicated config key; verify at
   implementation time). Makes `gbrain dream --dir` resolve without
   `--dir` flag.
4. **Git-track** `/Users/chenyuanquan/brain/` as its own repo (private).
   Every ingest = commit. Every dream cycle = commit. Knowledge VCS.
5. **Enable dream cron**. After lint/backlinks audit on KOS frontmatter
   (may false-positive on `kind`, `evidence_summary` if upstream lint
   doesn't know those keys — gate accordingly).
6. **Retain `kos-compat-api`** for the HTTP boundary (`kos.chenge.ink`
   still needs Bearer-token auth and the existing `/query /ingest
   /digest /status` contract for Notion Knowledge Agent + OpenClaw
   feishu). Just change its implementation.

**Benefits**:
- `gbrain dream` works natively → lint + backlinks + sync + extract +
  embed + orphans as one nightly verb.
- Brain becomes inspectable via plain filesystem tools (grep, find, git
  log, any text editor).
- Karpathy LLM-wiki model: markdown files ARE the wiki.
- Inherits upstream improvements automatically (dream enhancements,
  lint rules, backlinks algorithms).
- Compute-cheap: sync is incremental (hash-diff per file).

**Size**: ~1 week of focused work. Not one session. Needs its own
plan doc + dry-run export first.

**Supersedes**: Path C (kos-compat-api in-process import) — that was
the Band-Aid for the lock-contention problem. Filesystem-canonical is
the architectural cure that also fixes dream, orphans, and knowledge
VCS in the same move.

**Status 2026-04-24**: Steps 1 → 2.3 + 3.0 shipped (disk ↔ DB 1:1 at 1951 pages). Only Step 2.4 (commit-batching + optional remote, +14-day checkpoint at 2026-05-07) remains.

### [x] v0.18 upstream sync — synced 2026-04-23 with fork-local patch (commit `aceb838`)
Filed upstream as [garrytan/gbrain#370](https://github.com/garrytan/gbrain/issues/370).
1-line local patch on `src/core/pglite-schema.ts` (idx_pages_source_id
moved into v21 migration only — see `docs/UPSTREAM-PATCHES/v018-pglite-upgrade-fix.md`).
Production DB migrated 16→24, 1860 pages → sources.default, zero data
loss. Remove the fork patch when upstream merges #370.

### ~~[ ] v0.18 upstream sync blocker — PGLite v16→v24 upgrade fails on `source_id` — 2026-04-23~~
Preflight smoke (this evening) built `upstream/feat/migration-hardening`
(= v0.18.2, PR #356 open) and ran `apply-migrations --yes` against a
copy of `~/.gbrain/brain.pglite.pre-slug-normalize-1776921434` in an
isolated `$HOME`. **Production DB was not touched.**

**Smoke result**:
- `gbrain stats` reads fine (1829 pages)
- `gbrain apply-migrations --yes` → orchestrator reports v0.18.0 `status=failed`
- `gbrain init --migrate-only` (direct) → throws `column "source_id" does not exist`
- `gbrain sources list` post-smoke → `relation "sources" does not exist`
- `doctor.schema_version` → **stays at v16, target v24, zero advance**
- Data integrity intact (no DDL partial-state on disk)

**Root cause**: `src/core/pglite-engine.ts` (v0.18.2) references
`pages.source_id` at lines 132/140/226/256/395/759 across
`addLink[sBatch]` + `addTimelineEntr[ies]Batch` + page-fetch paths.
The v0.13.0 orchestrator calls `gbrain extract links --source db`
which hits one of those engine methods before v21 has added the
column. Fresh installs don't trip it (schema starts at v24);
v16→v24 upgrades do. Upstream tested PGLite against fresh installs
only — our upgrade path is the untested lane.

**v0.18.2 fixes a different set of v0.18.0 issues** (Supabase 57014
timeouts, v21→v23 FK integrity window, `doctor --locks`). The
`source_id does not exist` upgrade blocker is **not** addressed.

**Preserved smoke artifacts** (keep until upstream exchange closes):
- `/tmp/gbrain-upstream-peek/` — v0.18.2 build + `@electric-sql/pglite@0.4.4`
- `/tmp/gbrain-smoke-v018-1776964434/` — 285 MB throwaway copy + isolated `.gbrain/`
- `/tmp/smoke-env` — path reminder

**Action**:
1. File upstream issue after Step 2.2 ships (repro is 5 commands).
   Link to `docs/SESSION-HANDOFF-STEP-2.2.md §0` for full trace.
2. Wait for upstream fix OR fork-local cherry-pick opportunity.
3. When unblocked, retry sync → Step 2.2 rewrite uses
   `gbrain sources add jarvis --path ~/brain` instead of
   `sync.repo_path` config key (cosmetic upgrade, non-breaking).

**Cost of delay**: zero. v0.17's `gbrain dream` is all we need for
Step 2.3; multi-source is a future nice-to-have, not a Step 2
dependency.

### [x] kos-patrol cron exit-1 under minion shell-wrap — fixed 2026-04-23

**Resolution**:
1. Migrated `kos-patrol/run.ts` phase 1 from `gbrain list` shell-out
   (+ per-slug `gbrain get`) to in-process `BrainDb.listAllPages()` —
   single SQL query returns all 1953 pages with frontmatter, N+1
   collapses to 1. Legacy `listAll`/`loadPage`/`gbrain(args)` helpers
   and the unused `ListRow` type removed.
2. Redeployed `scripts/launchd/com.jarvis.kos-patrol.plist` to
   `~/Library/LaunchAgents/` — the deployed copy still pointed at
   `scripts/minions-wrap/kos-patrol.sh`. Now launchd runs
   `/Users/chenyuanquan/.bun/bin/bun run skills/kos-jarvis/kos-patrol/run.ts`
   directly, eliminating the nested shell-job subprocess entirely.
   Backup of old plist kept at
   `~/Library/LaunchAgents/com.jarvis.kos-patrol.plist.pre-p1c-<ts>`.
3. `com.jarvis.kos-patrol.plist.template` updated in lockstep (same
   shape as deployed).

Post-fix cron run: `state=not running, last exit code=1` — exit=1 is
the SKILL.md-documented "ERROR from lint" path (21 kos-lint errors +
1845 warns across the 1953 pages), no WASM crash in stderr. Dashboard
at `~/brain/.agent/dashboards/knowledge-health-2026-04-24.md` has the
full 1953-page inventory (breakdown: source=1081, concept=181,
project=210, person=375, company=85, decision=6, ...).

The leaf-only `scripts/minions-wrap/kos-patrol.sh` file is retained
as a rollback option but no longer referenced by any plist. Safe to
delete in a future cleanup pass.

**New follow-up discovered** (tracked separately as P2 below): phase 4
gap detection is noisy — it flags email-template headings like "From
Name", "Has Attachments", "Action Required" as entity gaps because
684 notion-ingested pages all contain those column headers. Needs a
stoplist or better entity heuristic.

---

**Original context** (retained for archaeology):

Discovered during Step 2.2 opportunistic probe. Two distinct issues
stacking:

**1. macOS 26.3 WASM bug in subprocess context**

`com.jarvis.kos-patrol.plist` invokes `scripts/minions-wrap/kos-patrol.sh`
→ `gbrain jobs submit shell --follow`. The shell-job subprocess spawns
a fresh bun invocation of `kos-patrol/run.ts`, which then shells
`gbrain list --limit 10000`. Inside that nested subprocess, PGLite
0.4.4 still hits `Aborted(). Build with -sASSERTIONS for more info.`
— the same `#223` class that motivated our 0.4.4 pin. Our override
doesn't survive the subprocess depth.

Evidence: `patrol.stderr.log` shows the WASM Aborted + "Job #113 dead:
exit 1" stack since 2026-04-19. `kos-patrol.stdout.log` last clean
run: 2026-04-18 / 1668-page inventory.

**2. 100-row `gbrain list` cap (same bug we fixed in /status)**

Even when kos-patrol runs manually via `bun run ...run.ts` (bypasses
issue #1 and succeeds), phase 1 (Inventory) shells
`gbrain list --limit 10000` which silently caps at 100. Patrol reports
"100 pages; kinds: source=97, concept=2, project=1" on a 1858-page
brain — wrong numbers feed into dashboards + digests.

**Fix**: migrate kos-patrol phase 1 from `gbrain list` shell-out to
direct-DB via `skills/kos-jarvis/_lib/brain-db.ts` (same pattern as
`/status` + existing `dikw-compile/run.ts`, `evidence-gate/run.ts`).
This also removes the subprocess-WASM exposure since BrainDb opens
PGLite 0.4.4 in the kos-patrol process itself, not a grandchild.

**Scope**: ~30 LOC in `run.ts:listAll()`. 1-2 h with tests.

**Workaround until fix**: Direct `bun run skills/kos-jarvis/kos-patrol/run.ts`
still writes a digest (though with wrong inventory count). Cron is
silent; patrol-2026-04-23.md landed at `.agent/digests/` via manual
invocation this session.

### [~] orphan reducer — --apply unblocked post-WAL patch, awaiting scale-out runs — 2026-04-23
**Status as of 2026-04-23** (updated after WAL durability fix landed):
- ✓ Skill `skills/kos-jarvis/orphan-reducer/` delivered (SKILL.md + run.ts
  + lib/{candidates, haiku-classifier, writer, report}.ts)
- ✓ BrainDb extended with `listOrphans` / `findSimilar` (pgvector `<=>` +
  vector + pg_trgm extensions) / `addLink` / `countLinks`
- ✓ Dry-run path works end-to-end: `--limit 2 --dry-run` in 8s,
  Haiku 4.5 classification quality eyeballs-pass on 2× samples
  (anthropic → barry-zhang/claude-code/building-effective-agents =
  "implements", anker → gdpr = "supplements" 0.85 conf), ~$0.006/run
- ✓ 10 real edges landed from the first `--apply` smoke (ids 386–395)
  deorphaning 5 pages (anker/anthropic/aruba/atlassian/ats-technology)
- ✓ **Apply unblocked** 2026-04-23 after the P0 WAL-durability fix
  landed. Second `--apply --limit 5 --no-commit` smoke: 11/11 edges
  persisted (Links 398 → 409). Upstream `gbrain link` subprocess also
  persists (Links 409 → 410). Orphans count dropped 1815 → 1814 in
  real time.
- ✓ **First real sweeps 2026-04-24** (three runs across the session):
  - `--apply --limit 20`: 41 edges / $0.065 / 1815 → 1797 orphans.
  - `--apply --limit 100` #1: 244 edges / $0.337 / 1797 → 1705 orphans.
  - `--apply --limit 100` #2: 243 edges / $0.331 / 1705 → 1630 orphans.
  Running total: **528 edges** / **$0.73** / **-185 orphans (1815 → 1630)**.
  Links 410 → 938 (+528). brain_score 56 → 65 (links 5→12/25,
  orphans 2→4/15). Markdown writes stay near-zero until P1-A bulk
  export lands — 95% of candidates are DB-only v1-wiki imports with
  no .md on disk to append sentinel blocks to. Cost ~3× original
  envelope estimate (candidate compiled_truth longer than projected),
  still comfortably within budget.

**Plan**: iterate `--apply --limit 100` runs roughly weekly (or opportunistically
when orphan count drifts). Rough projection: 1705 orphans remaining /
~90 actually deorphaned per run = ~19 more runs to zero, but diminishing
returns kick in once we hit deeply disconnected v1-wiki islands.
Realistic target: <800 orphans within a month of weekly runs; <500
is the brain_score sweet spot (orphans component at ~10/15). Cost
envelope: ~$6-7 to cover the full reduction pass.

**Design decisions made during build** (documented in plan
`~/.claude/plans/toasty-dancing-quasar.md`):
- `link_type='related'`, relation carried in `context` field
- DB + markdown双写, but candidate-page markdown only gets updated if
  `~/brain/<slug>.md` exists (today: ~95/1952 candidates; sidecar
  records `markdown_reason: "no_file"` for future filesystem-mirror
  backfill)
- Phase separation: BrainDb open during Phase A (classify), closed
  during Phase B (write) — to avoid contention with concurrent
  PGLite handles

**Runbook** (usable today):
```bash
bun run skills/kos-jarvis/orphan-reducer/run.ts --limit N --dry-run
# report + JSON sidecar land at ~/brain/.agent/reports/orphan-reducer-<ISO>.md
```

Kept as `[~]` (partial) rather than `[ ]` because infrastructure landed;
only the apply path is gated on the upstream bug.

### [x] kos-lint path resolver for KOS v1 legacy links — 2026-04-22
`kos-lint` currently reports 112 "dead links" after full import, mostly
because v1 wrote relative markdown links like `../sources/foo.md` and the
resolver strips path to slug `foo` instead of checking `sources/foo`.

**What**: normalize target to try both flat slug AND dir-prefixed slug before
declaring dead. Should drop noise from ~112 to ~10-20 actual-dead.

**Done 2026-04-22 session** — see commit log; `run.ts` landed, direct PGLite reader in `skills/kos-jarvis/_lib/brain-db.ts`.

### [x] dikw-compile/run.ts (analysis-only grade+sweep) — 2026-04-22
SKILL.md is thorough, but no bun helper exists. Without it, dikw-compile
is agent-driven only. Adding run.ts unlocks cron-based re-compile sweeps.

**Done 2026-04-22 session** — see commit log; `run.ts` landed, direct PGLite reader in `skills/kos-jarvis/_lib/brain-db.ts`.

### [x] evidence-gate/run.ts — 2026-04-22
Ditto. Single-page evaluator for agent or CLI use.

**Done 2026-04-22 session** — see commit log; `run.ts` landed, direct PGLite reader in `skills/kos-jarvis/_lib/brain-db.ts`.

### [x] confidence-score/run.ts — 2026-04-22
Ditto.

**Done 2026-04-22 session** — see commit log; `run.ts` landed, direct PGLite reader in `skills/kos-jarvis/_lib/brain-db.ts`.

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

### [ ] kos-patrol phase 4 gap detection: stoplist for email-template headers — 2026-04-23
Surfaced post P1-C migration. Phase 4 currently flags "Has Attachments",
"Action Required", "From Name", "Processing Status", "Sender Priority",
"Daily Digests", "Mail Actions", etc. as entity gaps because ~684 notion
source pages all embed these as column headers in Notion database views.
The heuristic (mention count ≥ 3) is too coarse against auto-ingested
email corpora.

**Fix options**:
- Add an explicit stoplist of known UI/table-header phrases
- Or require candidate to appear in ≥2 distinct `kind` categories (not
  just N copies of the same notion-source shape)
- Or weight by frontmatter density / heading depth

Cosmetic — current dashboard just shows noisy gaps alongside legit
ones. Not blocking anything downstream.

### [ ] Stage 4 finalize: archive v1 repo
After 7 days of stable v2:
1. Push v1-frozen tag
2. `mv ~/Library/LaunchAgents/com.jarvis.kos-api.plist ~/Library/LaunchAgents/_archive/`
3. Evaluate whether to replace `com.jarvis.kos-deep-lint` with a v2 equivalent
4. Archive v1 repo on GitHub (Settings → Archive)

### [ ] PGLite → Postgres switch evaluation — analyzed 2026-04-25, deferred
Surfaced during the v0.20 sync review. v0.20.2 / v0.20.3 shipped three
flagship reliability features that all skip on PGLite (jobs supervisor,
queue_health doctor check, wedge-rescue wall-clock sweep). Same for
v0.16 durable agent runtime ... it needs a multi-process worker fleet
that PGLite's single-writer lock can't serve.

Full evaluation lives at
[`docs/UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md`](../../docs/UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md).
TL;DR: **defer indefinitely**. Current 1988 pages on PGLite (416 MB
dataDir, <100 ms queries) is comfortably within PGLite's sweet spot,
the WAL durability fork patch has held for 2 days, and Path B retired
the only real lock-contention failure mode. None of the v0.20
Postgres-only features map to current pain.

**Trigger conditions for revisiting** (any one):
1. Brain crosses 5000 pages (PGLite query regressions become visible).
2. Multi-machine / multi-OS access becomes a requirement (e.g. running
   kos-compat-api on a server while editing from a laptop).
3. WAL durability fork patch fails silently (lost write detected via
   doctor or orphan-reducer dual-write reconciliation).
4. Need for parallel workers exceeds the single-writer cap (current
   load is 4-5 cron jobs, well within limit).

When triggered, the migration is `gbrain migrate --to supabase`
(upstream-supported, ~20 min on 1988 pages). Plus reconfiguring 4
launchd plists to point at Postgres `DATABASE_URL`. Estimated total
work: ~1 hour.

### [x] Unresolved frontmatter cross-dir refs — partial fix 2026-04-27 evening (commit `0695a6c`)

Built [`skills/kos-jarvis/frontmatter-ref-fix/`](frontmatter-ref-fix/)
(SKILL.md + run.ts, 617 LOC). Walks `~/brain/**/*.md`, normalizes
frontmatter `*.md`-suffix refs to canonical slugs via line-level regex
(preserves quote style + field order; no yaml.parse so diffs stay tight).
First sweep on production:

- Refs found: **220** (vs handoff's 14 estimate — handoff under-counted)
- Resolved + rewritten: **150 across 51 files**
- Unresolved (left alone): **70** — see follow-up below
- Brain commit: ~/brain `d6be7ce`. DB sync absorbed +177 links
  (8666 → 8843).

Two handoff assumptions turned out wrong: (1) actual count is 150+,
not 14 ... handoff only saw the residual after the first 80% silently
got dropped by `gbrain extract`'s DIR_PATTERN missing `sources/` plural.
(2) Target dir is `entities/` (plural; brain layout), not `entity/`.

### [ ] frontmatter-ref-fix v2 — raw_path exclusion + bare-slug fuzzy resolve

The 70 unresolved targets from the first sweep (commit `0695a6c`) split into:

- ~30 `raw_path:` field values pointing at brain-external raw snapshots
  (`../../raw/web/X.md`). They're correctly external; v2 should
  whitelist `raw_path:` (and any other known external-pointer key) and
  skip them to clean up report noise.
- ~30 bare-slug refs without a dir prefix (`harness-engineering.md` —
  v1-wiki sibling-dir form). v2 should fuzzy-resolve: search the slug
  index for `*/harness-engineering` matches; rewrite if exactly one hit.
- 3 `../../SCHEMA.md` and 1 `../../meta/lint-rules.md` — brain-external
  v1 references that should be deleted (no on-disk replacement).
- 2 `../sources/2026-04-13-alchainhust-darwin-skill-release.md` — real
  dead links; either re-ingest the missing source or delete the refs.

Estimated 1-2h. Cosmetic — current dry-run report shows them as
"unresolved" but they don't break queries.

---

## Done (reference)

- [x] 2026-04-27 evening: **Tier 1 maintenance sweep** (~12 min wall, $0.336 Haiku).
  Three commits in `~/brain`: `eadf1d3` (4 lint ERROR fixes adding missing
  `updated:` field on v1-wiki sources), `5a6a584` (orphan-reducer apply
  --limit 100: 89 edges across 88 candidate pages, 1 no_file fallback),
  `d6be7ce` (frontmatter-ref-fix: 150 refs normalized across 51 files).
  One commit in fork repo: `0695a6c` (new
  [`skills/kos-jarvis/frontmatter-ref-fix/`](frontmatter-ref-fix/) skill,
  617 LOC). Aggregate: Pages 2091 → 2114, Links 8666 → **8843 (+177)**,
  Orphans 814 → **793 (-21)**, lint ERROR 4 → **0**. `brain_score`
  85/100 stable (links 25/25 maxed; orphans component 12/15 needs ~70
  more deorphans to advance). Story in
  [`docs/JARVIS-ARCHITECTURE.md §6.15`](../../docs/JARVIS-ARCHITECTURE.md#615-tier-1-maintenance-sweep--orphan-reducer--frontmatter-ref-fix-2026-04-27-evening).
- [x] 2026-04-25: **Upstream v0.20.4 sync** (commit `8665afb`) — merged 6
  upstream releases (v0.18.2 → v0.20.4: #326 OpenClaw fallback, #369
  smoke-test skillpack, #195 BrainBench extract, #364 jobs supervisor,
  #379 queue resilience, #381 minion-orchestrator skill consolidation).
  Tests 2429 pass / 250 skip / 4 fail (all 4 are cwd-pollution between
  parallel tests, pass in isolation). Conflicts: 2 (`.gitignore` union,
  `manifest.json` skill list union). Auto-merged: 5 (CLAUDE.md,
  README.md, package.json 0.20.4, RESOLVER.md, src/cli.ts mode 0755).
  Fork-local patches preserved: 3 (pglite-schema #370, pglite-engine
  WAL, src/cli.ts +x). Closed P0 [#332](https://github.com/garrytan/gbrain/issues/332)
  via `apply-migrations --force-retry 0.13.0`. Health 60→80. PGLite
  baseline 1988 pages / 3750 chunks / 8666 links / 11020 timeline
  entries / 711 orphans / brain_score 86. v0.20 supervisor +
  queue_health are Postgres-only and intentionally skipped (see new P2
  PGLite/Postgres deferral note). Rollback tag `pre-sync-v0.20-1777105378`,
  PGLite snapshot `~/.gbrain/brain.pglite.pre-sync-v0.20-1777105391`
  (416 MB).
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
