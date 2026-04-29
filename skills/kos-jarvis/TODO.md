# kos-jarvis — Outstanding Work (post v0.22.8 sync, 2026-04-29)

> **Created**: 2026-04-29 from current pain points after upstream
> v0.22.8 sync (commit `811c266`).
> **Previous TODO.md** (now archived in git history at `14fff49`):
> covered v1-wiki migration backlog, all closed.
> **Entry point for next session**:
> [`docs/SESSION-HANDOFF-2026-04-29-post-v0.22.8-sync.md`](../../docs/SESSION-HANDOFF-2026-04-29-post-v0.22.8-sync.md)

The brain is healthy on v0.22.8 (schema v29, 2117 pages, brain_score 85/100,
doctor health 85/100, all 9 jarvis services running). Items below are
ranked by blocking severity. Each has an acceptance criterion.

---

## P1 — quality, fast follow-up

### [ ] Zombie `gbrain sync` subprocess leak — root cause + plug

**Why**: Phase C cutover surfaced 6 long-running `gbrain sync --no-pull`
subprocesses that had been holding the PGLite lock for hours (200-700
min CPU each, parented to PID 1, ignored SIGTERM, only released lock
on SIGKILL). They're the **mechanical explanation** for the recurring
kos-compat-api `/ingest` 500 timeout pattern that motivated commit
`971b9ba` (CF 524 defense). The 6 we killed are gone; the source that
spawned them is still active.

**What** (investigative steps):
1. Monitor `pgrep -lf 'gbrain sync.*--no-pull'` over 24 h. If new
   zombies appear, note their parent + spawn time → cron correlation.
2. Read each launchd cron's wrapper script. Check for places that:
   - shell out `gbrain sync` without `timeout N`
   - shell out without `--timeout-ms` flag
   - never SIGKILL a hung subprocess on retry
3. Most likely culprits in order:
   a. `com.jarvis.kos-deep-lint` (oldest cron, weekly Mon)
   b. OpenClaw cron `~/.openclaw/workspace/skills/knowledge-os/...`
      (calls `kos.chenge.ink` HTTP, but may also call CLI)
   c. `workers/notion-poller/run.ts` (Path B retired the minion-wrap;
      verify run.ts itself doesn't shell `gbrain sync`)

**Acceptance**:
- 24h watch shows zero new `gbrain sync` zombies, OR
- offending site identified + wrapped with `timeout 600 gbrain sync` (or
  equivalent Promise.race + AbortSignal in TS), AND
- new test in `skills/kos-jarvis/kos-patrol/run.ts` adds a Phase 7
  "stale-process check" that fires WARN if any `gbrain` subprocess
  has been alive > 10 min holding the brain lock.

**Scope**: 2-3 h investigative + 1 h fix.

### [ ] graph_coverage 0% post-v0.21.0

**Why**: doctor's new metric reports `Entity link coverage 0%, timeline 0%.
Run: gbrain link-extract && gbrain timeline-extract` despite `gbrain stats`
showing 8229 links + 11084 timeline entries. v0.21.0 added new `code_edges_chunk`
+ `code_edges_symbol` tables; the metric likely re-defined what counts.

**What**:
1. Run `gbrain link-extract && gbrain timeline-extract` and re-check
   doctor. If it still shows 0%, the metric requires the new
   `code_edges_*` tables to be populated, which only `gbrain
   reindex-code --yes` (CHUNKER_VERSION 3→4) does.
2. Decision: either accept 0% as expected for markdown-heavy brains
   (we don't have much code), or run `reindex-code --yes` after
   verifying cost preview is reasonable.

**Acceptance**: doctor's `graph_coverage` either reports a sensible
nonzero number, OR we update fork README / handoff with "this WARN is
expected on markdown-only brains, ignore it" so future syncs don't
re-investigate.

**Scope**: 30 min investigation, 0-1 h reindex if we choose to.

### [ ] kos-patrol Phase 4 stoplist for Notion email/UI labels

**Why**: This was filed as P2 in the archived TODO (4-23) but has been
sitting unaddressed. Today's `~/brain/.agent/dashboards/knowledge-health-2026-04-28.md`
shows 20 entity gaps, **all of which are Notion email/UI column headers**
("Action Type", "Original EML", "Key Points", "Best Regards", "Open Threads",
...). Real gaps drown in noise. Now the brain is post-bulk-import and
notion-poller is steady-state, so the stoplist will prevent regression.

**What**:
- Add a `STOPLIST` const in `skills/kos-jarvis/kos-patrol/run.ts` Phase 4
  with the obvious offenders (~30 phrases from today's dashboard)
- Or smarter: require candidate to appear in ≥2 distinct `kind` categories
  (not just N notion-source rows)

**Acceptance**: tomorrow's patrol dashboard shows ≤5 gaps, all
real entities (people / companies / concepts).

**Scope**: 1 h.

---

## P2 — observation / cosmetic

### [ ] Confirm CHUNKER_VERSION 3→4 re-walk cost before next sync

**Why**: v0.21.0 set `CHUNKER_VERSION 4`; the `sources.chunker_version`
gate forces a full re-walk on next `gbrain sync` regardless of git
HEAD. We didn't run `gbrain reindex-code --dry-run` during cutover.
Markdown bodies should cache-hit on embedding (4023 chunks already
embedded), so cost should be tiny — but verify.

**What**: `bun run src/cli.ts reindex-code --dry-run` and read the
ConfirmationRequired envelope. If cost <$1 in embedding, just run
`--yes` to upgrade chunks proactively. If higher, defer to a budgeted
window.

**Acceptance**: cost preview captured + decision recorded.

**Scope**: 15 min preview, 0-30 min reindex.

### [ ] `default` source's `local_path` not set up for v0.22.4 audit

**Why**: `gbrain frontmatter audit --json` returns
`{ok: true, total: 0, per_source: []}` because the v0.22.4 source-resolver
walks `sources` table for rows with `local_path` set, and our `default`
source apparently doesn't. Audit returns green anyway, but per-source
detail is missing.

**What**: `gbrain sources update default --local-path ~/brain` (CLI
shape may differ; confirm via `gbrain sources --help`).

**Acceptance**: `gbrain frontmatter audit --json` returns
`per_source: [{source_id: "default", path: ".../brain", ...}]`.

**Scope**: 15 min including investigation.

### [ ] `GBRAIN_SOURCE_BOOST` tune-up evaluation (1-week soak)

**Why**: v0.22.0 added source-aware retrieval ranking. Default boost
map doesn't know our layout (`sources/notion/` vs upstream's
`wintermute/chat/`), so our brain ranks at factor=1.0 across the board
— effectively no source-aware boost. With ~1245 notion-source pages
(60% of brain), they may swamp short Chinese queries.

**What** (after 1 week of v0.22.8 production observation):
1. Run 5-10 representative Chinese queries (`/query` endpoint), score
   the top-3 results manually for relevance vs noise.
2. If notion-sources dominate inappropriately, set in
   `com.jarvis.kos-compat-api.plist`'s EnvironmentVariables:
   `GBRAIN_SOURCE_BOOST="concepts/:1.5,projects/:1.3,syntheses/:1.5,sources/notion/:0.7"`
3. Re-run the same queries. If win >5%, keep. Else revert.

**Acceptance**: decision recorded in `docs/JARVIS-ARCHITECTURE.md`.

**Scope**: 1 h evaluation post-soak.

### [ ] Calendar checkpoints (carried forward)

| Date | Action |
|---|---|
| 2026-05-04 | Stage 4 v1 archive — `com.jarvis.kos-api.plist.bak` to `_archive/`, archive v1 GitHub repo |
| 2026-05-07 | Step 2.4 commit-batching review for `~/brain` per-ingest commits |
| 2026-05-25 | Re-evaluate Gemini 3072-dim embeddings vs current 1536-dim truncation |
| Trigger-based | PGLite → Postgres switch (4 named conditions in `docs/UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md`) |

---

## P3 — speculative

### [ ] Push merge commit `811c266` to origin/master

**Why**: `git status` shows `Your branch is ahead of 'origin/master'
by 7 commits.` The merge is on local master but not pushed. User
controls when to push (allowedPrompts didn't include push during sync).

**What**: `git push origin master` (after one final smoke confirming
production is stable for ≥30 min on v0.22.8).

**Acceptance**: GitHub `ChenyqThu/jarvis-knowledge-os-v2` master shows
`811c266` at HEAD.

**Scope**: 1 min.

### [ ] kos-compat-api `/ingest` HTTP 500 root cause

**Why**: Now that the zombie-sync hypothesis is on the table (P1
above), the previously-mysterious 500 timeouts on `/ingest` may have
the same root cause. After the P1 fix lands, monitor `/ingest` 500
rate; if it disappears, this can be retired.

**Acceptance**: stderr log shows zero `Failed to start server`,
zero PGLite-lock-timeout 500s, over a 7-day window.

**Scope**: passive monitoring after P1 lands.

---

## Done (most recent)

- [x] **2026-04-29 v0.22.8 upstream sync** (commit `811c266`) — merged
  9 minor releases (v0.21.0 → v0.22.8). Schema v24 → v29 via
  v0.22.6.1's `applyForwardReferenceBootstrap()`. Fork patch on
  `pglite-schema.ts` dropped (#370 closed by upstream PR #440).
  WAL fork patch retained. Production cutover: 2117/2117 pages
  preserved, brain_score 85/100 stable, /status 298ms /query 11.7s.
  Rollback tag `pre-sync-v0.22.8-1777445821`, snapshot
  `~/.gbrain/brain.pglite.pre-sync-v0.22.8-1777447016` (550MB).
  Story in [`docs/JARVIS-ARCHITECTURE.md §6.17`](../../docs/JARVIS-ARCHITECTURE.md#617-upstream-v0228-sync-2026-04-29-commit-811c266).
- [x] **2026-04-27 evening Tier 1 sweep** + frontmatter-ref-fix v1+v2
  + 4 orphan-reducer rounds. Lint ERRORs 4→0, frontmatter long-tail
  refs 70→0, orphans 814→732. See archived TODO + §6.15-§6.16.
- [x] **2026-04-25 v0.20.4 upstream sync** (commit `8665afb`).
- [x] **2026-04-23 v0.18.2 upstream sync** with 1-line fork patch
  (commit `aceb838`) — closed today by v0.22.6.1.
- [x] **2026-04-22 v0.17.0 upstream sync** (commit `b6ea540`) +
  filesystem-canonical Step 2.2/2.3.
- [x] **2026-04-20 v0.14.0 upstream sync** + 85-page wiki import +
  port cutover.

Older items in archived TODO at git `14fff49^:skills/kos-jarvis/TODO.md`.
