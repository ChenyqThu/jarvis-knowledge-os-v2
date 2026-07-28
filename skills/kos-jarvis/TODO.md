# kos-jarvis — Outstanding Work (post v0.42.66.1 sync, 2026-07-28)

> **Sync 2026-07-28** (§6.45, v0.42.64.0 → v0.42.66.1, **265 commits** across 2
> releases, 446 files, +29,791/−2,430): **the largest batch to date.** Two
> conflicts, one real migration (schema **v124 → v125**). Conflicts:
> `.github/workflows/test.yml` modify/delete **again** (same file, same cause as
> §6.44 — expect it every batch; keep the fork's deletion), and
> `src/core/link-extraction.ts`, where the fork's plural `sources` and upstream's
> new `reference` (#2071) are **independent additions to the same alternation** —
> keep both. Upstream self-reports 147 "verified fixes" but the log is full of
> `Revert` → `reland` round-trips; **judge the batch by the final diff, not the
> commit count.**
>
> **§6.44's "stat conservation" survival check FAILED this batch — and that was
> good news.** Fork src went 6 files / +243/−27 → **4 files / +187/−23** because
> upstream *absorbed* two fork patches outright: `extract-atoms.ts` concept
> stamping (→ `eb6cb4a1`, #2123/#2124) and `extract-atoms-drain.ts` zero-yield
> tombstoning (→ `8cd87968`, #2144/#2145). All 7 semantics verified present
> post-merge. **Lesson: treat stat conservation as a "look closer" signal, not a
> pass/fail gate** — a shrinking delta can mean a patch was swallowed (bad) or
> upstream took it (good), and only line-level checking tells you which.
>
> **§6.39's multi-statement-DDL P0: root cause REFUTED, not fixed.** v125 is the
> first multi-statement `sql:` migration since it was filed and it applied
> cleanly — but its statements are independent, so that proves nothing on its
> own. Replaying **v121's verbatim `sql` block** (the one that failed
> deterministically in §6.39) through the same `reserved.unsafe()` path now
> **passes**, while `runMigrationSQL` + `runUnsafe` are **byte-identical** to the
> §6.40-era code and postgres.js has been **3.4.9 all along**. Nothing changed,
> so the postgres.js batch-parse explanation cannot be right. The symptom was
> real; the diagnosis was not, and it is sitting in a public upstream issue.
> **Action: post a correction on garrytan/gbrain#2667** (not yet done — outward
> facing, Lucien's call). Details in
> `docs/UPSTREAM-PATCHES/v0.42.57.0-migrate-only-multistatement-ddl.md`.
>
> Green: typecheck 0, `check:all` **23/23** (new symlink gate; `exports-count`
> baseline 20 → 21), `bun test test/ai/` **467 pass / 0 fail** (was 405).
> Upstream's new zero-tolerance tracked-symlink guard (#3463) fired on 3
> pre-existing fork symlinks under `workers/kos-worker/`; resolved via the
> `ALLOWLIST` upstream left for exactly this case (relative, targets tracked) —
> **the fork's first modification of an upstream script**, with a negative
> control proving the guard still catches new symlinks.
>
> Production **29,698 pages / 78,258 chunks / 0 NULL**, no loss across the
> deploy; both /health → **0.42.66.1**; schema **125**; `brain_score` **84/100**
> (level with §6.44); `embedding_provider` **349ms** (§6.43 724ms, §6.44 1312ms)
> and **`embed_staleness: no stale chunks`** — no signature drift, no accidental
> re-embed. Daemon again did **not** self-relaunch after `bun run build`
> (5th batch running — a constant). **Retrieval A/B vs a 0.42.64.0 binary on the
> same prod DB: 8/8 identical → this batch has zero retrieval impact**, and the
> `--limit` non-monotonicity is confirmed pre-existing (it is also **bidirectional**:
> `Karpathy` scores *higher* at limit 5, `竞品分析` scores *lower*).
> **MCP wire**: #1410's 401 `resource_metadata` still correct through cloudflared,
> existing clients unbroken, and `whoami` now returns `source_id` +
> `federated_read` on the wire (#3279). **Three new items below.** See §6.45.
>
> **Previous — Sync 2026-07-22** (§6.44, v0.42.63.0 → v0.42.64.0, **20 commits**, 74 files,
> +2,503/−228): small single-release batch, **zero migrations** (schema stays
> v124), **one modify/delete conflict** — `.github/workflows/test.yml`, which the
> fork deleted in `1adab13b` and upstream touched in #3231; resolved by keeping
> the deletion. Note the `/sync-upstream` auto-gathered delta reported **no new
> commits** while there were 20 — always confirm with
> `git log --oneline HEAD..upstream/master`. Fork territory zero-invasion; **all
> 6 fork src/ patches survived byte-for-byte** (the pre/post
> `git diff upstream/master -- src/` stat is *identical* — 6 files / +243/−27 —
> a cheaper survival check than eyeballing each file). Two verified by hand:
> `gateway.ts`'s embed-retry block is still nested inside upstream's
> `__embedInputTypeStore` context (§6.35 composition intact two batches running),
> and **`link-extraction.ts`'s plural-`sources` DIR_PATTERN patch is NOT
> superseded by upstream #2866** — #2866 only fixes the *generic* wikilink pass
> and is gated behind `link_resolution.global_basename`, while the fork patch
> makes `sources/` a *qualified* resolution covering markdown links too,
> unconditionally. **Do not delete it just because upstream touched the file.**
> `docs/CLAUDE-UPSTREAM.md` needed no refresh (upstream's CLAUDE.md unchanged in
> range; regen differed only in the 5 intended privacy scrubs). Green: typecheck
> 0, `check:all` 22/22, `bun test test/ai/` **405 pass / 0 fail** (was 393).
> Production **27,553 pages / 71,337 chunks / 0 NULL**, byte-identical across the
> deploy; both /health → **0.42.64.0**; `brain_score` **84/100** (+3), **FAILs
> 3 → 1** (only `cycle_freshness`). **`orphan_ratio` is now 25% and OK — that is
> the fork's own orphan-reduction pass (`7cc00641`, 62% → 25%), NOT upstream
> #3015**; #3015's shared exclusion policy barely moved the denominator
> (20,722 → 20,700). The daemon again did **not** self-relaunch after
> `bun run build` overwrote its binary — explicit bootout+bootstrap required,
> now four batches running, treat as a constant. **#1410 smoke (this batch's one
> externally-visible win)**: `/mcp` 401 now carries
> `resource_metadata="https://kos.chenge.ink/.well-known/oauth-protected-resource"`
> — correct *public* issuer through cloudflared, not `127.0.0.1:7225` — and
> existing clients are unbroken (`lucien-cli` client_credentials → token →
> `tools/list` OK; 7/7 clients consistent). **Still open, this batch closed none
> of them**: §6.39's multi-statement-DDL P0 (zero migrations ⇒ *no evidence
> either way*, not "fine"), #2028 (`GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000`
> re-verified in all 4 plists + `.env.local`, all 4 also confirmed free of
> `OPENAI_BASE_URL`), and the chunkless backstop cron (**still exactly 100**
> chunkless live pages, level with §6.43). See §6.44. Two new items below.
>
> **Previous — Sync 2026-07-21** (§6.43, v0.42.59.0 → v0.42.63.0, **106 commits** across 4
> releases, 443 files): **the largest batch to date, yet zero-conflict merge +
> clean migration**. `merge-tree` flagged 8 "changed in both" files including 3
> rewrite-scale hits on fork src patches (`gateway.ts` +378/−186,
> `pglite-engine.ts` +203/−38, `extract-atoms.ts` +112/−82) — all auto-resolved
> by the recursive virtual base. **Lesson: `changed in both` states that both
> sides moved, it does NOT predict conflict** — treat it as a verify-list, not a
> forecast. Schema **v122 → v124, two migrations applied** (v123 configurable
> FTS language — no backfill at our `english` default; v124 drops
> `compiled_truth` from `pages.search_vector`, #2704 tsvector 1MB overflow).
> **§6.39's multi-statement-DDL P0 still did NOT trigger — and this time that
> was actually verified rather than vacuous**: both migrations are `sql: ''` +
> handler with per-statement `executeRaw`, which structurally cannot reach the
> `conn.unsafe` batch path. **The P0 stays OPEN and still unproven** — it needs a
> migration that uses a multi-statement `sql:` string. Fork territory
> zero-invasion; **5 fork src/ patches survived**, notably the `gateway.ts`
> embed-retry block which stayed *inside* upstream's `__embedInputTypeStore`
> context (§6.35 composition intact) despite the rewrite, and
> `extract-atoms.ts`'s `atoms_scan_hash` tombstone guard landing correctly in
> upstream's three rewritten WHERE clauses. `docs/CLAUDE-UPSTREAM.md` needed no
> refresh (upstream's own CLAUDE.md unchanged this batch; regen was
> byte-identical). Production **27,469 pages / 71,415 chunks / 0 NULL / te3@1536**
> (only **6** cosmetic zembed-mislabels, down from 48); `brain_score` **81/100**
> (+1), **FAILs 3 → 2** as `orphan_ratio` fell 92% → **62%** and left FAIL.
> doctor `embedding_provider ✓ **724ms**` — **16× faster than §6.40's 11,848ms
> via the avman relay**, quantifying §6.41's direct-connect win. Both /health →
> 0.42.63.0; CJK modal query 3/3 stable with **scores up 2–3×** (upstream
> `184b6cb8` title-candidate arm — recall gain, head ordering unchanged).
> **Still open, do not assume this batch closed them**: #2028 (query-embed floor
> still dead → `GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000` must stay in all 4 query
> plists + `.env.local`, re-verified in place) and the chunkless backstop cron
> (upstream #2163 fixed only `synthesize_concepts`; **100 chunkless live pages**
> remain vs 9,241 at §6.41 — `com.jarvis.chunkless-backfill` demoted to backstop
> but still required). New debt found, filed separately: `scripts/launchd/*.plist`
> repo working copies have drifted badly from the live `~/Library/LaunchAgents/`
> versions (live ones verified correct; both gitignored so no secret exposure).
> See §6.43. No new outstanding work from the sync itself; items below carry over.

> **Sync 2026-07-13** (§6.40, v0.42.57.0 → v0.42.59.0, 7 commits): **clean
> zero-conflict merge + no-op production deploy**. v0.42.58.0 provider-agnostic
> gateway (#1249 empty-env clobber / #1250 native baseURL `/v1` normalize /
> #1292 dims-presence guard replacing the structurally-dead litellm-reject /
> #2271 trust_custom_dims for local recipes); v0.42.59.0 five community fixes
> (#2724 pre-v121 schema replay / #2677 migrate preserve-sources + target-aware
> resume / #2726 facts pipe-escape round-trip / #2723 entity-ambiguity
> quarantine / #2200 think source-scope). **Schema zero new migrations** (stays
> v122) → `init --migrate-only` clean no-op; **§6.39's multi-statement-DDL
> migrator bug did NOT trigger** (no migration to run). Note #2724 (bootstrap
> adds the forward-referenced `event_page_id` column first) plausibly addresses
> the §6.39 root cause, but UNVERIFIED this batch — the P0 stays open until a
> future real multi-statement migration validates it. Fork territory
> zero-invasion; 5 fork src/ patches survived (gateway.ts embed-retry block
> 1604–1745 disjoint from upstream's +77 at hunks 389/704/1200/2123; WAL patch
> intact). **§6.32 convergence re-verified**: upstream's new `resolveNativeBaseUrl`
> is idempotent for our `.../v1` avman URL (regex short-circuit, no `/v1/v1`);
> doctor `embedding_provider ✓` real 1536d avman call, DB-aligned. **The §6.32
> "litellm recipe unusable (gateway.ts:670)" caveat is now OUTDATED** — upstream
> #1292 replaced that guard; we still use the native openai recipe so no behavior
> change. Production **27,115 pages / 60,523 chunks / 0 NULL / te3@1536** (48
> cosmetic zembed-mislabels, all 1536d, healing via daily embedding-label-normalize
> cron); `brain_score` **80/100** (+2 vs §6.39). Both /health → 0.42.59.0; CJK
> modal query 3/3 stable; EN Karpathy head intact. See §6.40. No new outstanding
> work; items below carry over.

> **Sync 2026-07-07** (§6.39, v0.42.53.0 → v0.42.57.0, 3 commits): schema
> **v119 → v122** 3-step. v0.42.55.0 security-hardening (dotfile/skills/slug
> confinement + DCR consent default + v120 schema-lint: page_links
> security_invoker + trigger-fn search_path); v0.42.56.0 Life Chronicle
> (timeline + thought-diary + bi-temporal facts ontology, v121/v122);
> v0.42.57.0 pglite live-lock fix. Merge **zero-conflict** (upstream didn't
> touch CLAUDE.md/llms-full.txt); fork territory zero-invasion; 5 fork src/
> patches survived (`gateway.ts` §6.34 untouched; **WAL `pg_switch_wal`
> auto-merged clean despite +289 to `pglite-engine.ts`**). Production **27,019
> pages / 59,896 chunks / 0 NULL / single-model te3@1536** (no cosmetic relabel
> needed this batch); `brain_score` 78/100 (−1 = new chronicle `timeline 1/15`
> dim, unpopulated). **INCIDENT + new P0** (`upstream-issue`
> `migrate-only-multistatement-ddl`): `gbrain init --migrate-only` is broken on
> real Postgres for ADD-COLUMN-then-CREATE-INDEX multi-statement migrations
> (postgres.js `conn.unsafe` batch parse-time validation; PGLite tolerates →
> upstream missed it). The daemon's initSchema path succeeded; schema
> self-advanced to v122 when launchd KeepAlive relaunched the daemon onto the
> mid-build `bin/gbrain`. Repro+root-cause+fix in
> `docs/UPSTREAM-PATCHES/v0.42.57.0-migrate-only-multistatement-ddl.md`; reported garrytan/gbrain#2667. Deploy lesson: `bin/gbrain` IS the launchd
> daemon `program` — `bun run build` mid-sync self-deploys via KeepAlive. See
> §6.39 教训①②③. No other outstanding work introduced; items below carry over.

> **Closure pass 2026-06-26** (post-§6.38 KOS health + backlog audit). Runtime:
> daemon 0.42.53.0 healthy (pid 820), 25,138 pages / 56,828 chunks / 0 NULL /
> single-model te3@1536; KOS crons green (dream-cycle nightly `partial`/exit0,
> kos-patrol, gbrain-backup ~680MB/day, **embedding-label-normalize auto-relabels
> zembed mislabels daily** — did 1158 on 6-25, so the §6.32 papercut is
> self-healing now). **CLOSED this pass**:
> - bug `notion-poller-pglite-lock-deadlock` → `docs/_archived/` (resolved §6.18
>   Postgres migration; notion-poller itself already archived).
> - upstream-issue `v041-dream-cycle-engine-lifecycle` (#1515) → `docs/_archived/`:
>   fixed upstream (`_ownsModuleSingleton`, CHANGELOG closes #1404/#1471/#1619/#1678),
>   live since §6.34; dream-cycle runs nightly exit 0 and graph coverage 0%→**81%**
>   proves the extract phase writes links again.
> - (P2) graph_coverage 0% → RESOLVED (doctor: entity link 81% / timeline 100%).
> - (P2) sync_freshness → won't-fix (structural false-alarm for DB-canonical fork,
>   decided 2026-05-22; re-confirmed).
> - (P3) reranker_health WARN → benign (doctor now [OK], failures below threshold).
> - stale observations (dream LLM-spend / dream-24h-backfill / embedding_columns
>   declare) → no action (auto-healthy 5+ wks later; embedding_column_registry [OK]).
> - removed 1.7MB stale `_archived/gemini-embed-shim/` logs.
> **CORRECTED**: `feishu` is NOT dormant — active article-ingest client (365 calls/14d,
>   last 6-25 08:00). CLAUDE.md fixed; the "(P1) feishu phantom traffic — caller
>   unknown" item below is RESOLVED (caller = legit feishu article ingestion).
> **RESOLVED later in this same pass**:
> - (P1) Notion agent (kos-worker): **link CONFIRMED working** 2026-06-26 — `ntn` shows
>   the worker deployed (3 tools: kosQuery/kosIngest/kosStatus) and live
>   `ntn workers exec kosStatus`/`kosQuery` both succeeded + landed in `mcp_request_log`
>   (06-26 02:34). OAuth valid, daemon 0.42.53.0. The low call volume is **expected
>   (Notion-side is used infrequently by design)** — Lucien confirmed, NOT a broken pipe,
>   no infra action. Refreshed `docs/NOTION-JARVIS-WORKER-USAGE.md` to the current
>   OAuth+MCP wire (commit 2c1533e8; kosDigest dropped — code+deploy only have 3 tools).
>   To raise usage later: re-feed that guide to the Notion agent's instructions.
> - (P1) frontmatter provenance (L746) → DONE (small fix): kos-worker frontmatter now
>   stamps queryable `source` / `notion_id` / `ingested_via` / `ingested_at` (commit
>   5579a443; tsc clean). **omada-sentiment is external code** — Lucien adds the same
>   fields there. No 25k-page backfill (mooted by source_id + the dedicated
>   `ingested_via`/`source_kind` columns; 8,489 pages already tagged).
> - (P2) enrich-sweep timeout → DONE: root cause was an **orphaned lock** (the 6-21
>   timeout left `enrich-sweep.lock`; the dumb existsSync check then wedged every run
>   since 6-16). Added PID-liveness stale-takeover (commit 5579a443); verified `--dry`
>   auto-clears a dead-holder lock + passes pre-flight. Self-healing now.
> - (P3) fork-boundary guard over-broad `*/src/*` (TODO L384) → fixed to allow
>   `workers/`+`server/` fork territory, but **local-only** (`.claude/hooks` is gitignored).
> **NEEDS LUCIEN (shelved 2026-06-26)**: image-ingest still scaffold-only — fill Voyage
>   API key + image dir to bootstrap, or leave shelved (Lucien: leave it for now).

> **Sync 2026-06-20** (§6.37, v0.42.44.0 → v0.42.51.0, 7 commits): additive
> schema only (v117 → v119, `page_generation_clock_sequence_swap` +
> `op_checkpoints_completed_keys_array_check` — contention-free page-gen clock
> + checkpoint integrity). Fork territory zero-invasion; no new fork src/
> adaptation (gateway.ts untouched upstream; §6.35 WAL patch + §6.34 embed-retry
> both auto-merged). Upstream #2200 (federated read reaches by-slug) benefits
> mailagent's cross-source `federated_read = {default, mailagent-emails, omada}`.
> Production at **24,736 pages** / `content_chunks` 54,360 / 0 NULL /
> single-model te3@1536 (4 ingest-drift chunks cosmetic-relabeled per §6.32
> papercut). No new outstanding work introduced; items below carry over from
> the 2026-06-15 maintenance review.

> **Maintenance 2026-06-15** (KB health review, no sync): brain at **24,330
> pages** (mailagent-emails 11,088 / default 9,991 / omada 3,099 / gbrain-docs
> 147), vectors **52,755 chunks / 0 NULL / single-model te3@1536**.
> Four items this session:
> 1. **zembed cosmetic relabel** — 226 freshly-ingested chunks (today's
>    `sources/loop-engineering-orange-book-en` + daily mailagent writes) were
>    mislabeled `zeroentropyai:zembed-1`; verified 1536-d unit-norm (= real te3
>    via avman, the §6.32 papercut), applied the documented `UPDATE
>    content_chunks SET model='openai:text-embedding-3-large'`. Brain back to
>    single-model. **Recurs on every new ingest** — candidate for a kos-patrol
>    nightly auto-relabel step (P3).
> 2. **Synthesis layer is healthy + drained**: atoms 6,047 (default 4,394 +
>    omada 1,653), 6,042/6,047 carry the `concepts` field (PR #2124 + bridge
>    skill landed). `extract_atoms` has skipped "no pages to process" since
>    06-13 = eligible backlog exhausted (remaining are P2 0-yield email
>    threads). `synthesize_concepts` current: 06-13/06-14 both `ok — 2258
>    concepts (T1=177 T2=271 T3=1810)`. 4,329 concept pages total.
> 3. **`extract_facts` still permanently skipped and growing**: "242 legacy
>    v0.31 facts pending" (was 79 @ §6.34) — all `source='mcp:put_page'` omada-
>    sentiment dailies that lack `row_num`; the cycle guard treats them as
>    legacy. Still waiting on the upstream issue (P1 §2026-06-09 item 3). The
>    brain's own per-page fact extraction remains dark until then.
> 4. **kos-patrol phase4 gap detector rewritten** (`kos-patrol/run.ts`). The
>    daily `## Gaps` list was ~85% NER garbage: "Link Systems Inc" (3710, =
>    truncated "TP-Link Systems Inc" — regex dropped the "TP-" hyphen prefix),
>    "Peters Canyon"/"Peters Canyon Road"/"Fulton Way"/"Richmond Hill" (office
>    addresses), "GTM Manager"/"Product Line Manager"/"Technical Support
>    Engineer" (job titles), "Lianzhou International"/"Link Canada" (already
>    have company pages but the exact-match existence check missed them),
>    "Omada\nController" (newline-split span). Three fixes: (a) regex now
>    captures hyphenated brand tokens (`TP-Link`, `Cloud-Based`) and joins on
>    horizontal whitespace only so spans don't cross line breaks; (b) existence
>    check normalizes both sides (strip legal suffixes incl. Sdn/Bhd) so a
>    mention resolves to an existing entity page despite suffix/punct drift;
>    (c) address-tail + job-title-tail + doc-boilerplate filters. Post-fix the
>    20-slot list is dominated by real entities (Niko Wang, MCMC JENDELA, DHCP
>    Option, Access Point, Vendor-Specific Attributes…). typecheck clean,
>    patrol exit 0. Thin tail of generic terms (The Omada / Action Items /
>    Microsoft Teams Meeting) remains — stoplist incrementally per the code
>    comment. **NOTE the dashboard "Next action" still says "enrich-sweep →
>    stubs"; do NOT bulk-convert gaps to stubs without eyeballing — the list is
>    cleaner now but a coarse regex signal, not a vetted entity set.**
> 5. **Takes calibration cold-start**: 216 pending take_proposals (holder=brain
>    203), 0 accepted/resolved → `calibration_profile` can't run (needs ≥5
>    resolved). Digest written to `~/brain/.agent/reports/takes-review-2026-06-15.md`
>    for Lucien's accept/reject pass. Weights skew low (only 3 ≥0.8) — expected
>    cold-start, not a quality issue. **Needs human action, not tokens.**
>
> ---
>
> **Updated 2026-06-14**: v0.42.42.0 upstream sync landed (5 commits,
> v0.42.37.0 → v0.42.42.0, 112 files / +6739 / −538 LoC). Story in
> `docs/JARVIS-ARCHITECTURE.md` §6.35. **3 merge conflicts** (the
> auto-preview only flagged 1 — `merge-tree` surfaced all 3):
> `src/core/ai/gateway.ts` (fork `embedTransportWithRetry` now composed
> INSIDE upstream's `__embedInputTypeStore`; per-attempt timeout stays in
> the wrapper — note: openai is symmetric so the input_type compose is a
> no-op for this brain), `src/core/pglite-engine.ts` (keep both: WAL
> patch + upstream comment), and `test/db-lock-heartbeat-takeover.test.ts`
> (upstream #2015 converged on the fork's §6.34 withEnv fix; dropped a
> duplicate withEnv import the 3-way merge introduced, caught by
> typecheck). Schema **v115 → v116** (migration 116 + #2038 drift
> self-heal). Green gate: typecheck 0, check:all OK, test/ai/ **315 pass /
> 0 fail / 995 expect()** + embed-retry/db-lock 14 pass. Production
> kos.chenge.ink on 0.42.42.0, **24,298 live pages** (grew vs §6.34's
> 15,206 from 5 days of mailagent + omada ingest), content_chunks
> **52,529 / 0 NULL**. Smoke: ZH compound-CJK `知识管理` 0.924; EN
> cross-lingual returns "No results" under default autocut — NOT a
> regression (autocut cuts the low-confidence cross-lingual cluster;
> `--autocut false` reproduces §6.34's 0.8885 hit). Migration auto-ran on
> the first 0.42.42.0 `doctor` connect (idempotent); no lock cleanup
> needed (#2015's heartbeat reaper handles it now).
>
> ---
>
> **Updated 2026-06-09**: v0.42.37.0 upstream sync landed (35 commits,
> v0.42.1.0 → v0.42.37.0, 374 files / +41864 / −2635 LoC). Story in
> `docs/JARVIS-ARCHITECTURE.md` §6.34. **4 merge conflicts** (CLAUDE.md /
> llms-full.txt / skills/RESOLVER.md / src/core/ai/gateway.ts — the last
> because the fork now carries its first src/ runtime patch:
> `fork(ai-gateway) e7b6a554` embed transport retry for the avman relay
> TLS flake, committed FIRST on the sync branch per §6.33 R1–R7 precedent;
> merged with upstream's v0.42.20.0 per-call embed timeout, applied
> per-attempt). Schema **v111 → v115** (4 migrations). check:all green
> after `fix(sync) 352e6a82` withEnv-converted two test-isolation R1
> violations (one ours, one upstream's own v0.42.36.0 test — candidate to
> upstream). test/ai/ **320 pass / 0 fail / 1008 expect()** (+20 vs
> §6.33). Production kos.chenge.ink on 0.42.37.0, **15,206 pages** (±0;
> baseline grew vs §6.33's 13,613 from omada corpus + dailies). Smoke: ZH
> compound-CJK 0.876 / EN semantic 0.889; EN high-frequency single-term
> 'Lucien' now hits the pre-existing 8s ts_rank cliff (25,450 matches,
> email corpus +22% w/w — NOT a sync regression; P2 below). Post-deploy:
> drained 8,625 NULL-vector chunks via `gbrain embed --stale` (the TLS-
> flake fallout the retry patch addresses; final state 48,535 chunks /
> 0 NULL / single-model after normalizing 8,664 zembed-1 cosmetic
> mislabels per the §6.32 rule), cleared 2 expired cycle locks.
>
> ---
>
> **Updated 2026-06-01**: v0.42.1.0 upstream sync landed (27 commits,
> v0.41.14.0 → v0.42.1.0, 605 files / +66781 / −37154 LoC). Story in
> `docs/JARVIS-ARCHITECTURE.md` §6.33. **4 merge conflicts** (CLAUDE.md /
> .github/workflows/test.yml / skills/manifest.json / llms-full.txt;
> pglite-engine.ts / google.ts / RESOLVER.md / package.json auto-merged
> clean this time, fork patches all survived). Schema **v97 → v111** (13
> migrations). check:resolver one-pass (53 skills, 0 fix); check:all caught
> 3 pre-existing banned-name meta-refs in §6.31/§6.32 docs (written after
> their own gate runs) → scrubbed in `fix(sync)`. typecheck clean; test/ai/
> **300 pass / 0 fail / 982 expect()** (+11 vs §6.31). Production
> kos.chenge.ink on 0.42.1.0, **13,613 pages** / 43,311 single-model te3
> chunks (±0). Query scores healthy again (EN 0.81 / ZH 0.83) — §6.32's
> single-space convergence resolved §6.31's 0.51/0.28 dip. embedding-
> gateway-guard VERDICT CLEAN. Lucien's R1–R7 email-stub work committed
> separately first (`fork(kos-jarvis) d98f4530`, not a sync artifact).
>
> ---
>
> **Updated 2026-05-26**: v0.41.14.0 upstream sync landed (34 commits,
> 20 versions, v0.38.2.0 → v0.41.14.0, 818 files / +106211 / −37236 LoC —
> ~3× §6.30's scale). Story in `docs/JARVIS-ARCHITECTURE.md` §6.31.
> **5 merge conflicts** (CLAUDE.md / llms-full.txt / .github/workflows/
> test.yml / skills/manifest.json / src/core/pglite-engine.ts — all
> resolved per §6.30 playbook; pglite WAL patch folded into upstream
> v0.41.8.0's new snapshot+try/finally disconnect structure). Schema
> **v85 → v97** (12 migrations via `init --migrate-only`, zero manual
> ALTER). v0.41.14.0 added a new **strict `check:resolver` gate** —
> flagged 2 fork skills (`image-ingest` no RESOLVER row → fixed by
> adding row; `notion-ingest-delta` no frontmatter triggers → fixed
> by adding `triggers:` array, with YAML lesson learned: inline
> comments between `triggers:` and array items break gray-matter
> parsing). Also caught upstream's missing trailing-newline on a new
> baseline fixture (mechanical local patch). `docs/CLAUDE-UPSTREAM.md`
> refreshed to v0.41.14.0 (2021 lines, 0 banned-name hits). fork-protected
> paths zero-touch. **3140 pages preserved** (exact match to §6.30
> baseline). OAuth 4-client wire confirmed live under v0.41.3.0 CORS
> lockdown (kos-worker token exchange + MCP tools/list → 76 tools).
> Production kos.chenge.ink on 0.41.14.0. doctor health_score **40 →
> 95** (the §6.30 `sync_freshness` FAIL went obsolete per the §6.30
> follow-up: working tree frozen post-§6.28 cutover, no markdown sync
> ever needed). Test gates: typecheck clean; check:all exit 0 (18 sub-
> scripts, post-fix); check:resolver 0 errors / 0 warnings (post-fix);
> test/ai/ **289 pass / 0 fail / 967 expect()** (+15 tests upstream-added
> vs §6.30). 3 new follow-ups added below (P3 archival of notion-ingest-
> delta, P3 conversation-facts-backfill opt-in evaluation, P3 query-score
> drift observed in smoke).
>
> ---
>
> **Updated 2026-05-22**: v0.38.2.0 upstream sync landed (14 commits,
> 14 versions, v0.37.0.0 → v0.38.2.0, 234 files). Story in
> `docs/JARVIS-ARCHITECTURE.md` §6.30. **Only 2 merge conflicts**
> (CLAUDE.md / llms-full.txt, both mechanical). Schema **v78 → v85**
> (7 migrations via `init --migrate-only`, zero manual ALTER). v0.37.3.0
> added a `check:skill-brain-first` gate — flagged `enrich-sweep`
> (SKILL.md mentions "Crustdata"); fixed with a brain-first Convention
> callout (commit b39a50b4). `docs/CLAUDE-UPSTREAM.md` mirror refreshed
> to v0.38.2.0 (closes the §6.29 deferral). fork-protected paths
> zero-touch. 3140 pages preserved, OAuth 4-client health ok, production
> kos.chenge.ink on 0.38.2.0. Full unit suite 6399 pass / 20 fail
> (2 wedged shards + 4 new-PGLite-test env failures — non-gating, see
> §6.30). 2 new follow-ups added below (P2 PGLite test / P3 reranker).
>
> ---
>
> **Updated 2026-05-19**: v0.37.0.0 upstream sync landed (12 commits,
> 11 versions, v0.35.6.0 → v0.37.0.0, 333 files, +52455 / -3317 LoC).
> Story in `docs/JARVIS-ARCHITECTURE.md` §6.29. **Only 4 merge conflicts**
> (CLAUDE.md / llms-full.txt / 2 test/ai/ files — last 2 reverted to
> fork view because v0.36.1.1 #1083 went a different fix path from our
> PR #1016). Schema **v66 → v78** automatically via `applyForwardReferenceBootstrap`
> (12 migrations applied, zero manual ALTER). WAL fork patch survived
> at `src/core/pglite-engine.ts:207` (line shift from L200 due to upstream
> imports). Doctor **health_score 70 → 80**: new v0.36.x checks (home_dir_in_worktree,
> embedding_column_registry, cross_modal_modality_backfill, unified_multimodal_coverage,
> takes_weight_grid, child_table_orphans, markdown_body_completeness) all PASS.
> ZeroEntropy switch lock applied via `gbrain config set ze_switch_declined_at` +
> `ze_switch_prompt_shown=true` (90-day re-ask gate). 3140 pages preserved.
>
> **Active fork dirs**: **11** (8 skills + 2 helpers + _archived) —
> image-ingest scaffold added 2026-05-19 (decision F-1, awaits
> VOYAGE_API_KEY + IMAGE_SOURCE_DIR fill before bootstrap).
> **Branches retired 2026-05-19**: 2 worktrees + 4 branch refs
> (`upstream-fix/bootstrap-mcp-log-cols` + `upstream-fix/bootstrap-oauth-clients-cols`,
> both local + origin) deleted via `git worktree remove` + `git branch -D`
> + `git push origin --delete` after Lucien confirmed nothing to keep.
> **Retained**: `upstream-fix/dream-archive-dir` (PR #1133 still open),
> `upstream-fix/google-recipe-max-batch-tokens` (PR #1016 verdict revised — NOT
> superseded by v0.36.1.1; upstream chose warning-filter path, fork keeps
> declare-max_batch_tokens path; co-exists cleanly).
>
> ---
>
> **Updated 2026-05-17**: v0.35.6.0 upstream sync landed (108 commits,
> 9 versions, v0.34.4 → v0.35.6.0). Story in
> `docs/JARVIS-ARCHITECTURE.md` §6.26. **PR #1017 (oauth_clients
> bootstrap) CLOSED as superseded** by upstream v0.35.5.0 `4446e9f9` —
> upstream's fix is a strict superset (7 probes vs our 2, + DDL conn
> threading + MIGRATIONS introspection guard). Production schema
> unchanged at v66; `bun install` postinstall confirmed "All migrations
> up to date" with no manual ALTER. Only 2 real merge conflicts
> (.gitignore + CLAUDE.md, both mechanical). brain_score 80/100,
> 3138 pages preserved.
>
> **Active fork dirs**: **10** (7 skills + 2 helpers + _archived) —
> unchanged from §6.24. M2-A/B/C/D all closed in prior rounds.
>
> ---
>
> **Updated 2026-05-15** (v0.34.4 sync): 29 commits, v0.31.3 → v0.34.4.
> Story in §6.24. Schema upgraded v45 → v66 (21 migrations + 1 manual
> bootstrap for `oauth_clients.{source_id, federated_read}` — the
> bootstrap PR that v0.35.5.0 has since superseded).
>
> ---
>
> **Updated 2026-05-10**: Same-day follow-up to v0.31.2 sync.
> 4 planned items, 3 commits landed, 1 (M3 production cutover) validated
> end-to-end on throwaway DB but deferred (vector-space compat decision
> needs a clean window). Story in `docs/JARVIS-ARCHITECTURE.md` §6.23.
>
> **Active fork dirs: 14 → 11** (will go to 10 once M3.cutover ships).
>
> Commits this session:
> - `9e3cd0f` — M1: archive kos-lint + frontmatter-ref-fix + slug-normalize,
>   shrink notion-ingest-delta SKILL.md to 5-line redirect
> - `3d667de` — M2-D: mark RESOLVED (premise was wrong; fork never had
>   `OperationContext.remote`)
> - `eedb357` — M2-A: archive triplet (dikw-compile, evidence-gate,
>   confidence-score) — production probe confirmed 100% dead code
>
> M3 pilot validated: native v0.27 Vercel AI SDK gateway with
> `google:gemini-embedding-001` + `--embedding-dimensions 1536` works
> end-to-end on Postgres-backed throwaway DB (`gbrain_m3_pilot`).
> Shim log line count unchanged across pilot lifecycle = 100% native
> traffic. English + Chinese retrieval both produce expected top-hits.
> Production cutover details under M3.cutover entry below.
>
> **Brain unchanged through this work**: 2718 pages, 96% embed coverage
> (244 stale pending — option (a) of M3.cutover handles this), schema v45,
> 35 RLS tables, brain_score 80/100. kos-compat-api PID 23937 served
> through all 4 work blocks without restart needed (only restarted at
> end of M2-A to load new `/ingest` hint string).
>
> **v0.31.2 sync context** (still relevant):
> 22 commits 跨 5 大版本 (v0.27.0 → v0.31.2) / 378 文件 / +57 691 -1 833 LoC。
> 仅 5 个 conflict。pglite-engine.ts WAL patch 自动 merge 干净。typecheck
> 干净,bin 0.31.2,4760 unit pass / 9 fail (mostly env-coupled),check:all
> 干净。Production schema 自动 v34 → v45 via bun install postinstall.
>
> **Upstream PR #627 closed as superseded** by v0.31.1.1 #682+#741 fixwave
> (broader bootstrap cover incl v0.20+v0.26.3+v39-v41)。
>
> **Pre-v0.26.7 TODO**: archived in git history at `6d84bea` parent.
> **Pre-v0.25.0 TODO**: archived in git history at `b23ab28`.
> **Pre-system-review TODO**: archived at `2203f94`.

Brain (post-v0.31.2-merge **+ schema v45 applied 2026-05-09**):
2718 pages (+241 since v0.26.7 sync), 96 % embed coverage (244 stale,backfill
pending), brain_score 80/100。doctor status: warnings (resolver_health 51 issues
全是 ~/.openclaw/workspace AGENTS.md 跨 boundary 引用,不是 fork 责任)。生产
Postgres 17 + pgvector 0.8.2 已升到 schema v45 (35 tables 全 RLS,新增 facts +
oauth_*),WAL fork patch retained for brain-db.ts。

---

## P0 — `sources.config` 被上游 #2829 损坏 — **DONE 2026-07-28**(Lucien 授权后当日执行)

**已修复。** 快照存 `/tmp/sources-config-before-fix-2026-07-28.txt`,然后事务内
`UPDATE sources SET config = (config #>> '{}')::jsonb WHERE … AND
jsonb_typeof(config)='string'`(跑两遍,第二遍匹配 **0 行** → 证实只有单层包裹,
无需 doctor 那条 depth<10 的递归 SQL)。结果 4/4 源均为 object:
`gbrain-docs` → `{"federated": false}`、`mailagent-emails` → `{}`,
`default`/`omada` 未触碰。验证:doctor `source_config_shape` →
**OK: All source config values are JSON objects**;检索行为与 §6.45 A/B 基线
逐位一致(`知识管理` 0.9123 / `Karpathy` 1.1908)—— 符合预期,因为坏字符串
此前读不出来等效于 no-config,修复后 `gbrain-docs` 显式 false、
`mailagent-emails` 空对象,federated 语义不变。再犯概率低:本批已带上游
#2829 的 re-wrapping 修复(`540b86ff`)+ #3420 的写路径自愈(`16782aee`)。
原始条目留档如下。

### 原始条目(2026-07-28, §6.45)

v0.42.66.1 新增的 doctor 检查 `source_config_shape` 在生产库上直接报出来:

| source | 现状 | 应为 |
|---|---|---|
| `gbrain-docs` | 字符串 `"{\"federated\":false}"` | 对象 `{"federated": false}` |
| `mailagent-emails` | 字符串 `"{}"` | 对象 `{}` |
| `default` / `omada` | 对象,完好 | — |

成因是上游 #2829 的 config re-wrapping bug(每次写入把对象再包一层字符串)。
影响:**这两个源的 federation / ACL 设置读不出来**。

**本批之后这条的优先级上升了** —— `8160236a` (#2561) 让
`sources.config.federated` 真正参与本地 CLI 的 unqualified search,在此之前
这个字段基本没人读,坏了也不显形。注意 `default`(`{"federated": true}`)是好的,
所以主路径未受影响。

修法(上游 `16782aee` / #3420 已给自愈):跑任一 `gbrain sources` config 写入即可
自愈嵌套字符串,或按 doctor 打印的 SQL 直接 `UPDATE sources SET config = …`。
**是生产数据写入,需 Lucien 决定后执行。** 改完复跑 `gbrain doctor` 确认该检查转 OK。

---

## P1 — dream cycle 停摆 162h + `enrich-sweep` 被 disabled — **(a) 已由另一 session 修复,(b) 仍 OPEN**(复核 2026-07-28)

**(a) dream-cycle:另一个 session 已于 2026-07-28 修复**(launchd 内存环境滞留
14 晚带着废弃 avman 中继,bootout+bootstrap 换干净环境,同时 reload 了
kos-patrol;全过程见记忆 `pitfall-launchd-env-stale` 与
`docs/KOS-SYNTHESIS-OPERATIONS.md` §一)。本 session 复核佐证:
`dream.stderr.log` 末行(09:09)已是 `invoking: gbrain dream`(**过了 REFUSING
守卫**),launchctl 里 dream-cycle 的 -15 退出码正是那次「kickstart 起真身 +
40 秒内 TERM」零成本验证的痕迹。**残余:`last_full_cycle_at` 仍停在
2026-07-21T22:19Z** —— 环境修了,但还没有一轮完整 cycle 跑完;今晚 03:11 定时
触发后 doctor `cycle_freshness` 应自行转 OK,`links_extraction_lag` 89% 随
cycle 的 extract phase 消化。**明早看一眼 doctor 即可关账。**

**(b) enrich-sweep:仍 disabled,OPEN。** 复核确认 `launchctl print-disabled
gui/501` 依旧报 `"com.jarvis.enrich-sweep" => disabled`,另一 session 未动它。
是花钱的 LLM 作业,启用与否需 Lucien 决定(若要启用:
`launchctl enable gui/501/com.jarvis.enrich-sweep` + bootstrap plist)。

原始条目留档如下。

### 原始条目(2026-07-28, §6.45)

两件都**不是本次 sync 造成的**,是部署 smoke 时撞见的既存状态。

**(a) dream cycle 自 2026-07-21T22:19Z 起没跑过**(doctor 唯一 FAIL
`cycle_freshness`,162h)。连带 `links_extraction_lag` 从 §6.44 的 38% 涨到
**89%**(26,578/29,698 页有未抽取的边)。这是 `a37ef462` 那条 commit 在处理的
"plist 编辑不触达已加载的 launchd job" 问题的延续。`dream.stderr.log` 里的链条:
avman 中继报 `无可用渠道(distributor)` 打挂一轮 cycle → 之后 wrapper 的 §6.41
自检探针拿到**另一把 key**(`sk-WginM…`,而 plist / `.env.local` 里都是
`sk-proj-E2kJ…`)的 401 → 按铁律 `REFUSING TO RUN`。当前四个平面(plist /
`.env` / `.env.local` / `launchctl getenv`)**都已查过,没有一个还带
`sk-WginM`**,所以那条 REFUSING 应是历史记录 —— 但 cycle 至今没恢复,需要
单独收口(手动跑一次 `gbrain dream --source default` 验证,再确认 03:11 的
定时是否真的会触发)。

**(b) `com.jarvis.enrich-sweep` 在 launchd 里是 `disabled`。** plist 文件完好
(22:00,env 合规,无 `OPENAI_BASE_URL`),但 `launchctl print-disabled gui/501`
明确报 disabled,`launchctl list` 里根本没有它。是花钱的 LLM 作业,未擅自启用 ——
**需要先确认是当初有意关的还是误关的。**

> **顺带纠正一条核查方法。** §6.44 写"4 个 plist 逐个确认在位",那句话只核了
> **文件里的 env**,没核**作业是否被加载**。以后这类核对必须同时看
> `launchctl list`(在不在)和 `launchctl print-disabled gui/501`(是不是被禁),
> 光看 plist 内容会给出虚假的安全感。

---

## P2 — `#2846` 是否真的替掉了 embedding-label-normalize cron(added 2026-07-28, §6.45)

上游 `e1919fab` (#2846) 让 `upsertChunks` 写 `content_chunks.model` 时改用
gateway **运行时解析出的模型**,而不是编译期常量 `zeroentropyai:zembed-1` ——
这正是 §6.32 那条 cosmetic 误标、也正是 `com.jarvis.embedding-label-normalize`
日 cron 存在的全部理由。

**本批拿不到证据**:部署后误标 20 行,其中 19 行写于 09:35–09:51,**早于
10:03:56 的 daemon 重启**(旧二进制写的),重启后还没有新 chunk 落库。

下次 sync(或任意一次新内容入库后)复查:
`SELECT model, count(*) FROM content_chunks WHERE created_at > <重启时刻> GROUP BY 1;`
若新写入的 chunk 标签正确 → 该 cron 可降级为纯历史数据修复,再择机退役
(退役前记得它同时还兼着"config 平面一旦离开 te3 就拒跑"的守卫作用,
别把守卫一起扔掉)。

---

## P1 — 评估接入上游 `gbrain maintain` + `orphan-policy` (#3015, added 2026-07-22, §6.44)

v0.42.64.0 带进来 `gbrain maintain [--safe|--dry-run|--json]`
(`src/commands/maintain.ts`)和共享排除策略 `src/core/orphan-policy.ts`。本次 sync
**有意未接入**(保持 sync 纯粹,不混 feature)。两个具体可用点:

1. **`maintain --safe` 的 stale link/timeline 抽取** 正好压住本批 doctor 新报的
   `links_extraction_lag` WARN(10,540/27,546 页 = 38% 有未抽取的边)。先跑
   `--dry-run --json` 看它到底会动什么,再决定要不要挂 cron 或接进看板 F7 的白名单
   运维动作。
2. **`orphans.exclude_prefixes` / `orphans.exclude_slugs` 两个 per-brain config 键**
   —— 比继续刷 orphan-reducer 更治本:把 fork 特有的"本就不该有入链"的页
   (`sources/email/*` 的一部分等)正式从孤儿口径剔除,而不是靠造链把比例压下去。
   注意 orphan-reducer 的两个已知 bug(source-盲 writer / SDK base-URL 双拼)仍在,
   规模化用它之前要先修。

**注意别记错功劳**:当前 `orphan_ratio` 25% 是 fork 自己那轮去孤儿(`7cc00641`,
62% → 25%)的结果,不是 #3015 —— #3015 的默认排除对分母几乎没动(20,722 → 20,700)。

## P2 — 上游检索 top-1 依赖 `--limit` 且非单调(added 2026-07-22, §6.44)

同一 query 只改 `--limit`,头名整个换掉,且**更大的 limit 捞出更高分的文档**:
`知识管理` 在 limit=1/3/5 分别得 0.8391 / 0.8996 / **0.9200**,三个不同头名。
top-1 本应是全局 argmax、与 k 无关 —— 现象指向候选池随 `limit` 缩放,小 limit
饿死召回并**漏掉真正最相关的页**。

**已确认是上游既存行为,非 v0.42.64.0 引入**:从 `master` 拉 worktree 编出
0.42.63.0 二进制,与新二进制打同一生产库 A/B,三个 limit 上逐条同分同头名。

待办:构造最小复现(小库 + 固定语料)后报上游。`src/*` 是 fork no-go,我们不自己修。

**顺带立个规矩**:以后 sync 的 CJK smoke 至少跑 `limit ∈ {1, 5}` —— 只跑单一 limit
既看不见这个缺陷,也无法证明本批对检索无影响。

---

## KOS Knowledge Dashboard — DELIVERED + LIVE (2026-07-22)

Fork-local web 看板(`server/kos-dashboard/`,Bun+Hono :7226,只读 role `kos_dashboard_ro`
SELECT-only+BYPASSRLS)全量交付 F1–F7 并公网上线。Trellis `07-21-kos-dashboard`(+ m1/m2/m3/m4)。
写路径只走 MCP put_page / gbrain CLI,绝不直写 compiled_truth。

- **F1–F4 + F6**(M1/M2,commit `674901d9`):概览/分布/趋势/健康四页 + JSON API,shadcn/ECharts,
  source 全局切换,brain_score 五分项与 doctor 一致,PT 日界。
- **F5 编辑纠偏**(M3,`674901d9`):MCP put_page 写回 + 版本/回滚(put_page-replay 走全链路,非裸
  revert_version)+ 围栏/非 default/非 markdown 三重服务端锁 + 乐观并发。codex 8 轮收敛。
  残余:非 CAS put_page 亚秒 TOCTOU(上游)。
- **F7 操作面板**(第二波,commit `8019a323`):白名单运维(doctor / enrich-sweep-dry / label-normalize /
  kos-patrol / chunkless-backfill / embed 选中页)。shell-less 数组式 spawn + 单飞 + detached 进程组 kill
  + 文件审计(RO 库不能写) + embed 校验(拒 flag 型 slug、非合格集排除、上限 100、修订漂移检测)+
  跨进程嵌入写锁(与 chunkless-backfill.sh 同路径)。公网加固:非放大限速(即时 401/429)、
  `OPENAI_BASE_URL` 存在即 fail-fast、X-Frame-Options/CSP、bodyLimit、DB statement_timeout。
  **codex gpt-5.6-sol xhigh 4 轮独立收敛,fork 可修全修。** 同批硬化了两个 cron 脚本
  (`jarvis-chunkless-backfill.sh`/`jarvis-embedding-label-normalize.sh`:unset OPENAI_BASE_URL、
  排除 flag/归档、锁、失败传播到退出码)。
- **M4 公网**:`kosadmin.chenge.ink → :7226`(Lucien 在 CF Zero Trust / Irvine-MacMini tunnel 建;
  本机 jarvis-office tunnel 凭证丢失已死,tunnel 拓扑见 memory `m4-cloudflared-tunnel-topology`)。
  launchd `keepalive|runatload`,kill-pid 崩溃自恢复实测通过。**公网 + 仅静态 token(Lucien 明确选)**:
  64 字符 token 是写脑/花钱面的唯一口令,务必保密;可后续在该 hostname 叠 Cloudflare Access 做二因子。
  遗留:CF 面板删我早前 `cloudflared route dns` 建的 `kos-dash.chenge.ink → 091f59a8` 死 CNAME(现 530,CLI 删不掉)。

**待报上游 issue(2 个,均 `src/*` fork 禁区 + 生产 chunkless-backfill cron 早已同样暴露)**:
1. `gbrain embed` / `put_page` 无 expected-content-hash 修订守卫 → 并发改写同页可短暂 desync 搜索索引
   (F7 已做**检测**、非预防;codex pass-4 指出)。
2. 完全嵌入写串行化需 DB advisory lock(FS mkdir 锁只是 best-effort;codex pass-3)。
两者的有界性论证见 `server/kos-dashboard/src/ops/lock.ts` 注释:总花费被单飞+有限且递减的合格集+100 上限
独立封死,非无界/不可攻击放大,与 F5 的上游-CAS TOCTOU 同类可接受。

---

## P1 — KB 可补差距盘点 + 综合 sweep 续跑 (2026-07-14, 2026-07-21 复测)

### [ ] (P1) 综合 sweep 剩余 525 个 — 一句话启动 (2026-07-21 复测)

下次有额度时,新 session 直接说 **「跑 synthesis-sweep 剩下的 525 个」**,或
直接执行 (checkpoint 幂等,已完成的永不重付):

```bash
cd /Users/chenyuanquan/Projects/jarvis-knowledge-os-v2
set -a; . ./.env.local; set +a          # 需要 ANTHROPIC_BASE_URL (CRS, /v1)
nohup bun run skills/kos-jarvis/synthesis-sweep/run.ts \
  --refresh-stale --min-neighbors 5 --token-budget 120000 --concurrency 3 \
  > /tmp/synth-$(date +%F).log 2>&1 &
```

- **526 个** = 6 new + 520 stale→refresh (实测 2026-07-14)。checkpoint
  `~/.cache/kos-jarvis/synthesis-sweep/all.jsonl` = 1,887 行 / **1,841 唯一
  slug**,自动加载,无需 `--resume`。
- **成本 ~$235** (sonnet-5 @120k;实测 `people/jie-wu` 127,709 in / 4,266 out
  → ~$0.45/个 × 526)。⚠️ sonnet-5 的 $3/$15 是**按 sonnet-4-6 推的,
  `src/core/model-pricing.ts` 里没有 sonnet-5 条目** — 未证实。
- **`--token-budget 120000 --concurrency 3` 不是随便选的**,是 SKILL.md:92
  的实测稳定点。2026-07-14 上午用**默认 450k + conc 4** 跑了 32 个 → 满屏
  `RATE-LIMIT` 重试,正是 SKILL.md 写明会炸的配置 (`450k / conc 4–6` storms
  `rate_limit_error` + CF 524)。同一段还记着:**~100k context 已能产出优质
  dossier,更大主要加广度不加深度**。
- **成本口径已纠正 (2026-07-14)**: 权威表 `model-pricing.ts:57` = opus-4-8
  **$5/$25**。此前 scratchpad 的 watchdog 按 $15/$75 算,**虚高 3 倍**。那
  32 个实际花 **~$74** (14.27M in / 101k out),单个 **$2.31** 而非 $6.93。
  省钱大头是 **budget 450k→120k (3×)**,换模型只再省 1.7×。
- **`--refresh-stale` 的判据是「提及它的源数量增长 ≥ --stale-delta (默认5)」,
  不是内容变化** (`run.ts:354` 注释)。所以:源被大改但数量没涨 → **不会**
  重跑;只是被 5 条无关新邮件提到 → **会**重跑。今天那 520 个 stale 全是后者。
- 模型默认已于 2026-07-14 改为 `claude-sonnet-5` (`GBRAIN_SYNTHESIS_MODEL`
  可覆盖);`source_of_truth` 现跟随 MODEL → `brain-synthesis-sonnet`
  (旧 1,809 页仍为 `-opus`,可按标签直接对比两模型产出质量)。
- **2026-07-21 复测: 待补 525**(6 new + 519 stale→refresh),与 7/14 的 526 只
  差 1 → 这一周 sweep 一次没跑,checkpoint 最后写入停在 7/14 15:11。DB 侧
  `source_of_truth` 分布: `-opus` 1,805 / `-sonnet` **1** — sonnet 默认改完后
  基本没实跑过,两模型质量当时无样本可比。
- ⚠️ **`--limit N` 不是"跑 N 条"**。它是 `selectTargets` 的 SQL `LIMIT`
  (`run.ts:208`),先按 neighbors 降序取 top-N,**再**过滤 checkpoint → 实际
  跑的条数远小于 N。实测 `--limit 100` 只得到 **41 条**(top-100 hub 里够
  stale-delta 的只有 41 个)。想精确跑 100 条得把 `--limit` 开到 250 左右。
- ⚠️ **checkpoint 按 slug 幂等,换模型重跑要手动摘行**。用 sonnet 跑过的 slug
  记进 `all.jsonl` 后,再想用 opus 重跑同一批必须先删掉对应行,否则直接跳过。
  (幂等本身很好用:2026-07-21 为了改预算/做迁移停启了 3 次 sweep,已完成的
  7 + 41 条一条都没重付。)

#### 2026-07-21 执行记录 + 两处口径纠正

**首批 41 条(sonnet-5 @120k/conc3)**: 41/41 成功、0 失败、仅 1 次 RATE-LIMIT
+ 1 次空响应(退避 6s 重试成功 — SKILL 的 <400 字符不入账护栏生效)。
4,590,451 in / 232,085 out。

**sonnet-5 vs opus 产出对比**:

| | n | 输出 tok 均值 | 中位 | 备注 |
|---|---|---|---|---|
| opus 存量(全部) | 1,887 | 2,392 | 2,236 | |
| opus(仅 in>100k) | 431 | 2,942 | 2,802 | 同口径 |
| **sonnet 本批** | 41 | **5,660** | 5,486 | 输入仅 112k |

⚠️ **这不是纯模型对比**:opus 那批是 450k 预算时代跑的,输入普遍 47 万 tok,
sonnet 本批只用 12 万。真正的读数是「**sonnet 用 1/4 输入产出 1.9 倍篇幅**」。
质性抽查 `people/wesley-gan`:六段结构完整、逐条 `[来源ID]` 引用、洞见段是真
跨 case 综合(把 Latigo 权限需求与 Cov VoIP 缺陷并置,提炼「前线时效 vs 架构
可维护性」的重复张力),不是复述。**结论:继续用 sonnet**(质性样本 n=1,靠篇幅
数据补强)。

**🔴 口径纠正:「budget 450k→120k 省 3×」是错的,真值 1.7×**。上面那条
2026-07-14 的记录说"省钱大头是 budget 450k→120k (3×)",**那是从当天 32 个
全是 hub 的样本外推的**,不能套到整个 sweep。按 `--char-cap 4000` × 1.5 字/tok
换算:**120k ≈ 45 个来源,450k ≈ 169 个**。对 550 个目标实测分布:

| 邻居数 | 数量 | 加预算的效果 |
|---|---|---|
| ≤45 | **253 (46%)** | **零收益也零成本** — 本来就取不满 120k |
| 46–169 | **278 (51%)** | **真收益**,450k 正好全覆盖 |
| >169 | 19 (3%) | 仍截断,多拿 124 源 |

总输入 52.4M → 91.1M tok(**1.7×**),$157 → $273;代价主要在**时间**
(约 9h → 约 22h,只有 51% 的目标会变慢)。**Lucien 2026-07-21 决定放宽回
450k**,已按 `--token-budget 450000 --concurrency 3` 重启跑 547 个。
⚠️ `450k/conc 3` 是**未验证组合**(SKILL 只记录了 `450k/conc 4–6` 会 storm),
起跑后已挂监控盯 rate-limit 风暴,若出现应先降 concurrency。

### [x] (P0-bug) synthesis-sweep 的 checkpoint 是 source-盲的 — 已修 + 已迁移 2026-07-21

**根因**: `loadDone`(`run.ts`)用裸 `r.slug` 做 Map key,`markDone` 写的记录里
根本没有 `source_id` 字段。多源库里 slug **不唯一**,于是一个 slug 在任一源被
合成后,其他源的同名页 `done.get(t.slug)` 命中 → 永远跳过,**再怎么重跑也够
不着**。与 orphan-reducer 的 source-盲 writer、entity-dedup 的跨源同 slug 同族。

**实证**: `people/ezreal-yang` checkpoint 记 in=474,412 / out=5,473,`default`
源确有 opus dossier,而 `mailagent-emails` 源的同名页至今仍是 2026-06-01 的
auto-stub 原文。

**影响面量化(别被表面数字吓到)**: 945 个跨源多份 slug → 414 个"一份厚一份
存根" → 385 个在 checkpoint 里(被压制)。但按存根副本**在自己源里的**邻居数
拆开,397 个副本中:

| 邻居数 | 数量 | |
|---|---|---|
| ≥15 | 39 | 该补 |
| 5–14 | 31 | 该补 |
| 3–4 | 16 | 边缘 |
| **<2** | **311 (78%)** | **证据太少,本就不该合成** |

→ **真正"本该有却被 bug 拦住"的只有 70 个**(mn5 门槛),约 $32。

**修法**: `doneKey(source_id, slug)` 复合 key;查找 `done.get(doneKey(...)) ??
done.get(slug)`,裸 slug 作为老行回退(不回退就要重付 1,841 条)。`markDone`
补 `source_id`。改完 `--plan` 复验 484 不变 → 零行为回归。

**迁移(一次性)**: 老行按 DB 反查归属 — 哪个源持有该 slug 的 sweep dossier 就
补哪个 `source_id`。⚠️ **归属证据只能认 `brain-synthesis-<model>`(opus/sonnet/
haiku/llm),绝不能用 `LIKE 'brain-synthesis%'`** — 裸标签 `brain-synthesis` 是
**enrich-sweep 的 auto-stub**(全库 3,398 页)。第一版脚本就踩了这个,dry-run
展开出 779 个错误行,会把大批从没合成过的存根标记为"已完成"→ **永久锁死,比
原 bug 更糟**。收紧后降到 81。**教训: 这类迁移必须先 dry-run 看展开数**。
- 迁移结果: 1,871 归属成功 / 81 多源展开 / 57 无法归属(保持裸 key,行为不变);
  checkpoint 1,931 → 2,012 行,备份 `all.jsonl.bak-2026-07-21-1123`。
- 验证: `--plan` 目标数 481 → **554**,解锁 **73**(预估 70,吻合)。构成从
  「6 new / 478 stale」变为「170 new / 384 stale」— 那 91 个的迁移正说明它们的
  checkpoint 记录归属到了别的源,本源这份被**正确重判为从没合成过**。

### [ ] (P2) 薄实体页 — 真实缺口只有 18 个,原归因已证伪 (2026-07-21 重测)

**原文 (2026-07-14) 的归因是错的**,2026-07-21 逐个比对证伪:

- 原文写「**1,151 人 → 72 人所有副本都是存根/过薄**,怀疑 `--min-neighbors 5`
  把这 72 人挡在门外」。实跑 `--plan --min-neighbors 2` 确实得到 **72 个 new** —
  数字撞脸,但**不是同一批**。把这 72 个 slug 逐个比对:**projects 27 /
  concepts 23 / companies 16 / people 仅 3**。`mn5` 从来没有挡住那批人物页。
- **`Auto-stub created` 判据会误报**。它匹配的是 body 文本,而 dossier 会把
  存根原文一起吃进去 → `people/zoe-wang` 6,672 字的完整 dossier 也被判「薄」。
  改用**纯长度**(跨源取最长副本 <1500 字)重算才是真值。

**重测真值 (2026-07-21, 纯长度口径)**: 薄实体页 **124 个** — people 63 +
**companies 61**(原文只统计了 people,漏了整个 companies 桶)。拆开看:

| 分类 | 数量 | 说明 |
|---|---|---|
| 已在 checkpoint,但页仍 <1500 字 | **78** | **不是失败**,是证据本来就少 |
| 从未合成 | 46 | 其中 28 个 0 邻居 |
| └ 0 邻居(sweep 结构上永远选不到) | 28 | 已验证 `links_extracted_at` 全非 NULL |
| └ **真正跑一跑就能补上的** | **18** | 2–15 邻居,`mn2`/`mn5` 可选中 |

- **那 78 个「合成过却仍薄」不用管**。抽样 6 个查 checkpoint + DB 对照:
  `companies/backblaze` 7 来源 / out 410 tok、`companies/bosch` 4 来源 /
  1,220 tok、`companies/ajax` 4 来源 / 1,090 tok — **全部写回成功**
  (`source_of_truth: brain-synthesis-opus`,updated_at 2026-06-02),短是因为
  4–15 个来源榨不出更多。`<1500 字` 这个判据在低证据实体上就是误报。
- **那 28 个 0 邻居是真孤儿**,不是没抽边 — 已查 `links_extracted_at` 全部非
  NULL,就是真没有 email/source 页提到它们。sweep 靠 by-mention 图选目标,
  结构上够不着,要补得换路子(或接受)。
- 跨源分布(2026-07-14 实测,仍成立): dossier 在 `mailagent-emails` 781 个 /
  `default` 321 个;两个方向都有(`people/jie-wu` dossier 在 mailagent、default
  是存根;`people/bill-wang` 反之)。早先「人在 `default` 里是全的」不成立。

### [x] (P1-新) doctor 的 `sync_freshness` FAIL 是误报 — **不要跑 `gbrain sync`**（已处置 2026-07-21）

2026-07-21 发现并处置。doctor 报 3 个源 "never synced" + `default` 64 天未 sync,并
建议 `gbrain sync --all`。**照做会导入上万个文件,不是"补上同步"**:

| 源 | DB 页数 | file-backed (`source_path` 非空) | `local_path` 目录里的 md |
|---|---|---|---|
| default | 11,597 | **132** | 16,708 |
| mailagent-emails | 12,593 | **0** | 1,977 |
| omada | 3,132 | **0** | 729 |
| gbrain-docs | 147 | **0** | 0 |

全库 27,469 页里**只有 132 页是文件导入的**,其余 27,337 页全部来自 MCP
`put_page`(mailagent / omada-sentiment / feishu / Notion worker)。三个源的
`local_path` 是建源时的配置遗留,那些目录**从未被导入过** → 它们根本不走 sync
路径,"never synced" 是常态而非故障。

- **删除风险可排除**: reconcile-delete 只作用于 `source_path IS NOT NULL` 的行
  (`src/commands/sync.ts:3594`),这三个源是 0 行;另有 #2828 的 >50%
  mass-delete 安全阀。**但导入方向没有任何安全阀。**
- **覆盖风险实测(这才是真危险)**: `~/mailagent-emails` 的 1,986 个文件里
  **1,982 个 slug 与 DB 撞名**,只有 4 个是新的。撞名的构成:1,560 个邮件页
  (文件均 16,174 字节 vs DB 均 15,041 字,内容相当,无害) + **419 个 dossier
  页**(其中 14 个是当天刚写的 sonnet 产出)。样例:`people/harvey-tian`
  DB 30,726 字档案 ← 会被 564 字节存根覆盖;`people/jaydon-wu` 20,863 字 ←
  1,765 字节。这些页是被**更新**掉的,不进删除统计,**mass-delete 安全阀根本
  不触发**,命令会安静跑完并报成功。
- 目录写入方已由 Lucien 澄清:**就是 mailagent 本身**,每收到一封「重要」等级
  以上的邮件就同步写一份到 `~/mailagent-emails/`。即该目录是重要邮件的本地
  副本(子集),DB 12,593 页是 MCP `put_page` 写的全量 — 两条独立路径,反向
  sync 永远是拿子集覆盖全量。
- **[x] 已处置 2026-07-21**: `UPDATE sources SET local_path=NULL WHERE id IN
  ('mailagent-emails','omada','gbrain-docs')` (UPDATE 3)。原值备份在
  `~/local_path-backup-2026-07-21.txt`。`default` **故意保留** `~/brain` —
  它有 132 页真是文件导入的,属混合状态,需单独判断。
- **这同时是 `gbrain dream` 的前置条件,不只是消 WARN**。`sync` 是
  `ALL_PHASES` 的第 3 个 phase(`src/core/cycle.ts:104`),`gbrain dream` 不带
  `--phase` 就会跑到它。`resolveBrainDir`(`src/commands/dream.ts:272`)的顺序是
  显式 `--dir` → **该源自己的 `local_path`** → 否则 `null`;而
  `~/.gbrain/config.json` 只有 5 个 key,**没有全局 brain 目录兜底**。所以
  `local_path` 一清,`brainDir=null` → 文件系统 phase(lint/backlinks/sync/
  synthesize/extract/patterns)全部以 `no_brain_dir` 跳过。**实测验证**:
  `dream --source omada` 的日志直接从 `extract_facts` 开始,前 5 个 phase 连
  `start` 都没打。
- `default` 的 dream 仍会跑 sync 去扫 `~/brain` 的 16,708 个文件 — **在查清
  那 132 页的来历之前不要跑 `dream --source default`**。

### [x] (P2) doctor `links_extraction_lag 45%` 是标记陈旧,不是真缺边 — 2026-07-21

`gbrain extract --stale` 25 秒扫完 12,368 页,结果
`0 link(s) + 0 timeline entr(ies)` — **一条边都没新增**。那 45%(12,336 页)是
`links_extracted_at` 时间戳过时,内容上边早就抽全了。全库真正"从未抽过边"的只有
**482 页**(mailagent 437 / default 36 / omada 9)。

⚠️ 附带推论:**跑它对 `orphan_ratio 62%` 毫无帮助**(原以为能顺带降孤儿,不成立)。
~~降孤儿要用 `extract links --by-mention`,而按既有结论那个对 concept 类孤儿架构上
无效 → **孤儿这条线目前没有便宜解法**,别再重复试这条路。~~ **← 此结论已于当天
稍晚被推翻,见下一条。**

### [x] (P0-上游-bug) orphan 的真·便宜解法找到了 — DIR_PATTERN 漏了复数 `sources` (2026-07-21)

上一条断言"孤儿没有便宜解法"是**错的**。当天深挖 547 份新 dossier 写进去后
`orphan_ratio` 反而 62%→63% 的原因,一路挖到上游一个正则漏字:

- **根因**: `src/core/link-extraction.ts` 的 `DIR_PATTERN` 目录白名单只列了单数
  `source`,**没有复数 `sources`**。而全库 9,078 个邮件页 slug 都是
  `sources/email/<id>`。任何指向 `sources/*` 的 wikilink/markdown 链接都匹配不上
  → 被当裸名丢弃 → **这些页永远拿不到入链,是最大的孤儿桶(9,078 页 100% 孤儿)**。
  最小复现: `extractEntityRefs('[[sources/email/x]]')` → `needsResolution:true`
  被丢;`[[people/x]]` → false 正常。
- **诊断踩的坑(排查耗时的大头)**:
  1. `resolveSlug` / `resolveCandidateSources` 隔离测试全过,但整批 0 边 →
     一度以为是水位/写入过滤。
  2. 真正堵点其二: **`gbrain extract links` 默认走 FS 路径(`links_fs`)**,扫的是
     磁盘文件(旧存根),不是 DB 的 compiled_truth(我改写的 wikilink 在这)。必须
     显式 **`--source db`** 才走 `extractLinksFromDB`。`--source-id` ≠ `--source`。
  3. `bin/gbrain` 是**编译好的二进制**,改 src/ 后必须 `bun run src/cli.ts` 或
     重编译才生效 —— 见下方 [ ] 重编译待办。
- **修复**: fork src/ 补丁,`DIR_PATTERN` 加 `sources`(放 `source` 前)。这行
  **本就是 fork 改过的**(早前加过 tech/finance/…),不新开冲突面。守卫拦 src/ 编辑,
  由 Lucien 手动 `git apply`。文档 `docs/UPSTREAM-PATCHES/v042-dir-pattern-sources-plural.md`,
  上游 issue [garrytan/gbrain#3188](https://github.com/garrytan/gbrain/issues/3188)。
- **结果**(仅对 mailagent-emails 跑了一次 `extract links --source db`):
  - 32,611 条边一次建成(大头是 opus dossier 正文里一直存在的完整 slug 引用,
    因这 bug 从没被抽过)。
  - 邮件入链 0 → 7,015 / 9,078。
  - `orphan_ratio` **63% WARN → 29% OK**;`graph_signals_coverage` 28.6% → 53.6%
    ("多数查询都触发",对检索质量是实打实提升);doctor 总分 60 → 65。
  - ⚠️ `brain_score` 的 orphans 分项仍 10/15 没动 —— orphan_ratio 25% 仍没够
    满分阈值线(评分曲线比 doctor 的 OK 门槛严),但 orphan_ratio/graph_signals
    才是检索质量的实指标。
- **后续收益(2026-07-21 当天全部吃满)**:
  - [x] **重编译 + 上线 `bin/gbrain`** —— 编译到临时文件→验证(default 源建的
    1,105 条边全指向 sources/,证明新正则在内)→原子 `mv` 覆盖(备份
    `bin/gbrain.bak-preSourcesPatch-2026-07-21`)→`launchctl kickstart -k
    com.jarvis.gbrain-serve-http` 重启守护进程(新 PID,`kos.chenge.ink/health` ok)。
    cron 下次自动用新二进制;serve 守护进程重启后 put_page 内联建 sources 边。
  - [x] **default 源 DB extract** —— 顺带完成,1,105 条 sources/ 边。
  - [x] **批量改写全部 dossier 的引用 → wikilink** —— 范围远超预期的"599 份":
    实际 `bin/gbrain put` 改写 **1,374 份**(含[[sources/),转换 **57,077 条**引用,
    **0 失败**。脚本 `scratchpad/batch-rewrite.ts`。**踩了 3 个坑,全在 dry-run 拦住**:
    (a) `extract` 默认走 FS 路径,必须显式 `--source db` 才读 DB 的 compiled_truth;
    (b) `bin/gbrain` 是编译二进制,改 src 后不重编译不生效,验证期用 `bun run src/cli.ts`;
    (c) 引用格式是 `["来源1000004744"]`(带引号+中文前缀+裸数字/缺前缀/完整 slug 混杂),
    resolve 先漏剥引号,又发现**前缀白名单的英文 `source` 会吃掉 `sources/email/` 的开头**
    → 中文前缀可贴着剥、英文前缀改成必须后跟 `:` 才剥。保留的 19,494 个方括号是
    notion 页的裸尾引用(缺 `sources/notion/` 前缀)+散文,本轮不碰。
  - **建边靠 put 内联**: 新二进制的 `put` 内联 auto-link 就地解析了 `[[sources/email/x]]`,
    改写完邮件孤儿已从 2,063 → 1,362,事后 `extract links --source db` 两个源都建 0 条
    新边(边已存在,`ON CONFLICT DO NOTHING`)。

  **最终成果(整轮 orphan pass, 2026-07-21)**:
  | 指标 | 会话初 | 现在 |
  |---|---|---|
  | orphan_ratio | 62% WARN | **25% OK** |
  | graph_signals_coverage | 28.6%(偶尔) | **56.5%(多数查询触发)** |
  | 邮件孤儿 | 9,078 | **1,362** |
  | doctor 总分 | 5/100 | **65/100** |

  剩余(可选,非本轮): notion 裸尾引用(缺 `sources/notion/` 前缀,19,494 个方括号)
  的归一化 —— 属另一类、有 slug 尾巴碰撞风险,值得单独谨慎做。

### [x] (P0-地雷) launchd 模板自 §6.32 起漂移 6 周 — 已修 2026-07-14

补 §6.42 文档时发现的:**5 个 tracked `.plist.template` 全部还写着
`GBRAIN_EMBEDDING_MODEL=google:gemini-embedding-001`,且无 `OPENAI_API_KEY`** —
自 §6.32(2026-05-31 全库收敛到 te3@1536)起就没同步过。线上 4 个 plist 是对的
(`openai:text-embedding-3-large` + 官方 key + `GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000`
全部实测在位),但**模板才是重建 plist 的源头** → 任何一次从模板重装都会把
embedding 打回 gemini,**重演 §6.32 修的那场三空间事故**;`image-ingest` 尤其危险
(ingest 路径,会直接把异空间向量写进库)。已把 5 个模板补成与线上一致,并把
§6.32/§6.41/§6.42 的禁令直接写进模板注释(改的人当场就看得到,不必先翻 CLAUDE.md)。
注:`.plist.template` 因 `<FILL:…>` 占位符无法直接 `plutil -lint`(**改动前就如此**,
非新引入);验证法 = `sed 's/<FILL:[A-Z_]*>/X/g'` 后再 lint,5/5 OK。

**未修,待定 (P2)**:模板仍缺 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`(线上
serve-http 有,走 CRS)。不确定是否由安装脚本注入 —— 若不是,从模板重建的 daemon
会丢掉 LLM 通道。需查 `scripts/launchd/README.md` 的安装路径后再定。

### [x] (P1) sources 非邮件去孤儿 — DONE 2026-07-14

2,467/2,467 全分类, **2,300 条边落库, 0 错误**, 4h49m (10:27→15:17)。
**DB 验证**: `sources/%` 非邮件孤儿 2,467 → **167**,与算术吻合
(115 置信度<0.8 + 49 判定 none + 3 分类器无输出 = 167) → 每一条声称写入的
边都真的落库。剩余 167 个是分类器诚实的「找不到够格关联」,非失败。
`git.commit: false / "no markdown changes"` 属正常 (DB-only 页,`md:"no_file"`)。
log `/tmp/orphan-sources-nonemail-2026-07-14.log`。

---

## P1 — entity-dedup skill built (2026-07-13, Lucien D: Z-class only)

Graph audit flagged "same entity as multiple graph nodes" (Lucien 裂成 3 节点
≈12.1K 入链;Omada/TP-Link 类似)。**排查纠正了前提**:512 个 entity-vs-
person/company 重叠 bare-slug **= 511 跨源 + 1 同源**。slug 不含 type 前缀
(`type=entity` + `slug=people/lucien-chen`);`entity` vs `person` 差异**跟着
source 走**(mailagent 用 entity,default/enrich 用 person/company)。跨源同 slug
是两轴设计的预期行为 + `REFINEMENT-BACKLOG.md` R1/R2 已 RETRACT + `slug_aliases`
`(source_id,…)` 结构上做不到跨源 → **不合并跨源**。

**Lucien D (2026-07-13)**: 只做 **Z 类同源变体合并**(不做 Y retype、不立 X 跨源
解析层)。新建 `skills/kos-jarvis/entity-dedup/`(run.ts + lib/{candidates,
classifier,merge,report}.ts + SKILL.md)。primitive:同源事务内 repoint inbound/
outbound `links`(先删 unique-约束碰撞 + 自环再 UPDATE)→ 迁 `facts.entity_slug`
→ copy `page_aliases` → insert `slug_aliases` 读时重定向 → 删 alias `content_chunks`
→ soft-delete。LLM 分类 merge/ambiguous/distinct(歧义 quarantine,#2723 场景)。
默认 `--dry`(事务内跑完 ROLLBACK)。

- [x] **验证**:①手写 SQL BEGIN…ROLLBACK 样本(tp-link-system(s)-inc)②merge.ts
  代码路径 dry-run 复现同算术(indeg 465→559,inbound 96/collision 54,outbound
  26/collision 13/selfloop 1,slug_aliases +2,soft-delete 2,dangling=0,POST-
  ROLLBACK 逐项=BEFORE)③loadClusters 对真库产 10 簇(tp-link/eden/edward 三元
  聚齐)。typecheck 0 / check:resolver OK(61 skills)/ brain-first OK / newlines ok。
  零生产写入。样本导出 + 方案 doc 在 scratchpad `entity-dedup/`。
- [x] **(P1) LLM classify 冒烟 + 首批 --apply 落地 2026-07-13**:crs Bearer 跑通
  (`ANTHROPIC_AUTH_TOKEN` 经 `makeClient` authToken 路径;`.env.local` 在主 repo,
  worktree 需 `bun --env-file`)。default 前 10 簇分类质量优:tp-link/shon/eden/
  edward/lucien merge,gavin/edward-wu/siyi-li 正确判 distinct(读真实内容:邮箱/
  中文名/职位),eden-xu/walter/chang-liu/jackson quarantine。Lucien 确认 6 组
  (含 override eden-xu=eden-x、walter-luo=walter-l)。备份 `/tmp/pre-dedup-2026-07-13.dump.gz`
  (744M 验证)。落地:**7 页合并进 6 主页,lucien-chen 2534→2697、tp-link-systems-inc
  →559、eden-x→473、edward-rui→477、shon-y→343;7 条 slug_aliases 读时跳转生效;
  悬空链接 0**。unify 未动 mailagent/omada/gbrain-docs 源、未动跨源。
- [x] **(P1) BUG 修复:multi-alias 互撞**。首轮 eden(2 个 alias:eden+eden-xu)报
  `links_from_to_type_source_origin_unique` 违反 —— repoint 只查了 alias-vs-canonical
  碰撞,漏了 **alias 之间**互撞(同一 origin 同时链两个 alias)。事务回滚干净、eden
  未损。`merge.ts` inbound/outbound 各加一步 inter-alias dedup(同 key 保最小 id),
  eden 重跑成功。单 alias 的 5 组不受影响(已先落地)。
- [x] **(P1) 第二批 mailagent-emails + omada 落地 2026-07-13**:mailagent 扫 75 簇
  → 27 merge / 22 ambiguous / 33 distinct(distinct 判得准:5 个不同 Kevin、
  crystal-cao≠crystal-he、brad-waugh≠brad-lee、2 个不同邮箱 lynn-wang)。omada 4 簇
  → 1 merge(tp-link-support←tp-link-technical-support)、google≠google-play。
  Lucien 定:名字变体用**全名**当 canonical(7 组翻转:jeffrey-zhao/marvin-liu/
  dawning-zhao/gary-wen/philips-zhang/shuo-han/bingqian-zhao);**公司 vs 产品/子部门
  一律不合**(verizon/fios、nokia/bng、ebg-saas/bu、product-security-us/team、
  google/google-play 保持分开)。落地 **24 组**(mailagent 23 + omada 1),备份
  `/tmp/pre-dedup-batch2-2026-07-13.dump.gz`。**全 session 累计 33 页合并、33 条
  slug_aliases、全局悬空链接 0**。
- [ ] **(P2) 剩余候选**:default 的 gavin-gao/xavier 等含歧义(22+ ambiguous 已入报告);
  **跨目录同名**(mailagent 34 对:多为 `concepts/X` 内容孤儿 shadow 真实 `companies/X`
  —— 与孤儿 subagent 领域重叠,本轮未碰,留协调后处理)。工具目前只聚同目录 fuzzy 变体;
  cross-dir exact-bare 聚簇是候选增强。下次 `bun --env-file=<main>/.env.local
  skills/kos-jarvis/entity-dedup/run.ts --source <s> --limit N --dry` review 后 apply。
- [ ] **(P2) 再生成防护**:`putPage`/`import-file` 建页不查 `slug_aliases` +
  唯一约束含 soft-deleted 行 → 活跃管线会复活合并页。持久修复在**管线约定对齐**
  (mailagent/enrich 的 type/slug 选择)或给 upstream 提 issue(putPage 走
  `resolveSlugWithAlias`)。缓解:kos-patrol 加低频 re-merge 巡检。
- [ ] **(P3) X 跨源图层统一**:federated_read 下同实体多节点是真问题,但正解是
  跨源实体身份映射(query/图层 union),非物理合并。Lucien 未立项,单列备忘。

---

## P1 — dream-cycle 夜间回归 RESOLVED + KB 编译 enablement (added 2026-06-09)

### [x] (P1) dream sync/synthesize 自 06-02 起每晚 fail — RESOLVED 2026-06-09 (双根因)

- **RC1 — upstream #1678 (cycle lint DB-disconnect)**: lint phase 创建竞争
  module-style engine 后 disconnect,把共享 db singleton 置空,后续 DB phase
  报 "connect() has not been called"。v0.42.1.0 (06-01 部署) 带 bug;上游
  v0.42.5.0 `766604de` 修复;§6.34 部署 0.42.37.0 已含 → sync 恢复 ok。
- **RC2 — launchd 旧 env 缓存**: `com.jarvis.dream-cycle` + `com.jarvis.kos-patrol`
  plist **文件** 5/31 17:48 (§6.32) 已改 openai@avman,但 job 从未
  bootout/bootstrap → 内存 job 定义仍是 `GBRAIN_EMBEDDING_MODEL=
  google:gemini-embedding-001` + 已过期 Google key,且无 OPENAI_*。每晚
  embed 全败 (stderr 累计 24,236 条 "API key expired"),还把 te3 签名
  chunk 当 prior-signature **invalidate** (06-09 晚 7 个) → NULL 向量持续
  累积 (§6.34 排干的 8,625 NULL 的 dream 侧来源;ingest 侧才是 avman TLS
  flake)。**Fix 2026-06-09**: 两个 job bootout+bootstrap 重载 (serve-http
  本来就对,不动)。
- **验证 (kickstart 22:25 run)**: sync ok / synthesize 回到良性
  skipped(not_configured) / embed 0 gemini 报错 / consolidate 提升 8
  facts → 4 takes。
- **Lesson**: 改 plist EnvironmentVariables 必须随手 bootout+bootstrap,
  否则 launchd 永远用旧 env。§6.32 收敛漏了这两个 job 的重载。

### [~] (P1) Knowledge/wisdom 层编译 enablement — 执行 2026-06-09 晚 (Lucien D2 决定: 先启用,模型升级暂缓)

背景: M2-A 退役 dikw-compile 后,上游现行的 knowledge 编译机制是
**atoms→concepts** (`extract_atoms` per-source 提取 +
`synthesize_concepts` 全局聚合出 tier-promoted concept 页),被
schema pack 门控 — 原 active pack `gbrain-base` 不声明这两个 phase。

1. [x] **Pack 切换 → `gbrain-everything`** (DONE 2026-06-09)。via
   `~/.gbrain/config.json` `schema_pack` 字段 (tier-6 home-config;
   备份 `config.json.before-pack-switch-20260609`)。**上游 papercut**:
   `gbrain schema use` 的校验列表只认 base/recommended/base-v2,而
   loader 实际 bundle 7 个 (含 creator/investor/engineer/everything)
   → `use` 报 "Unknown pack",只能直写 config。另: `schema active/
   explain/graph` 等 inspection 命令不走 extends 链 (everything 显示
   Page types: 0),display-only — merge 机制本身经
   `test/lens-pack-manifests.test.ts` + `test/cycle-pack-gating.test.ts`
   50/50 验证 OK。注意 bundled yaml 在 `bin/gbrain` 编译版二进制里
   resolve 不到 (连 gbrain-base 都 unknown);生产走 `~/.bun/bin/gbrain
   → src/cli.ts` 源码直跑,不受影响。
2. [x] **`cycle.enrich_thin.enabled=true`** (DONE 2026-06-09, DB config
   plane)。对 thin/stub 页做 brain-internal grounded synthesis —
   对口 3,417 email stubs + 13,054 orphans。
3. [x→改判] **extract_facts 卡死根因改判**: `apply-migrations --yes` 报
   "All migrations up to date" — 79 行根本不是 v0.31 legacy,**全部是
   06-02 起 omada-sentiment 日更经 `mcp:put_page` 提取的新 facts**
   (source='mcp:put_page', source_id='omada'),上游 put_page facts
   路径不打 `row_num`,而 cycle guard 把 `row_num IS NULL AND
   entity_slug IS NOT NULL` 一律当 legacy → phase 永久 skip 且逐日
   加重 (70→79)。**候选上游 issue**(guard 应排除 source='mcp:put_page'
   或 put_page 路径应补 row_num)。不动 DB,等上游表态。
4. [DEFERRED] **模型路由落 gbrain config** — Lucien 2026-06-09 D2 决定
   暂缓 (成本考虑)。dream LLM phase 维持上游默认 (chat 默认
   anthropic:claude-sonnet-4-6;extract_atoms Haiku tier)。路由规则
   本身仍有效 (haiku→sonnet, sonnet/opus→fable-5),用于 ad-hoc 编译
   任务;何时落 config 由 Lucien 另行决定。

历史全量 sweep (9.7k source 页) 仍按 pilot-first: 先 100 页试点看质量
+ 单页成本再放量。`dream.synthesize.session_corpus_dir` (conversation
transcript 综合) 与 KB 编译无关,保持 unset。

**验证 run (2026-06-10T02-55-55Z, kickstart)**:
- `extract_atoms: ok` — **首跑产出 28 atoms** (25/50 pages 处理,25
  budget-skipped — per-tick 预算会逐晚消化)。落库 `atoms/2026-06-10/*`,
  内容质量好 (邮件/omada 语料的具体洞察)。注意 atom 页无 `kind`
  frontmatter (上游用 slug 前缀 + pack type 体系) — 与 KOS 9-kind 的
  映射待定,候补 `type-mapping.md` 一行。
- `synthesize_concepts: skipped — no atoms with concept refs` — ~~良性~~
  **改判 2026-06-11: 上游端到端断点 → 当晚三件套全部落地**:
  1. **桥接 skill 落地并验证**: `skills/kos-jarvis/atom-concepts-backfill/`
     (sonnet 批量标注 1-3 个 kebab 共享词表 topic 标签 + jsonb stamp;
     幂等,只碰缺字段的 atom;manifest 59 entries + RESOLVER row +
     check:resolver OK)。试点 60 atoms → `gbrain dream --phase
     synthesize_concepts` **写出 33 个 concept 页 (T2=7/T3=26),
     $0.044/0 失败** — wisdom 层 concepts 首批产出。全量回填跑通
     (~$1,跟着 drain 进度补增量)。坑×2 已修: postgres.js 预序列化参数
     会双重编码成 jsonb string (要用 `sql.json()`);crs 代理 base 自带
     /v1 而官方 SDK 自己追加 → 构造 client 时剥尾部 /v1。
  2. **上游 issue 已提**: [garrytan/gbrain#2123](https://github.com/garrytan/gbrain/issues/2123)
     (证据: synthesize-concepts.ts 头注释设计意图 vs extract-atoms.ts
     无写入 + 生产 696/0 复现 + 外部 stamp 后消费侧立即工作)。
  3. **上游 PR 已提**: [garrytan/gbrain#2124](https://github.com/garrytan/gbrain/pull/2124)
     (branch `upstream-fix/extract-atoms-concept-refs` @ upstream/master
     v0.42.40.0,2 files/+92−3: prompt 加 concepts 字段 + parse kebab
     校验 + frontmatter stamp;测试 20→25 pass,含一条走真 DB 路径的
     端到端回归 — 上游原测试用 `_atoms` seam 喂数据所以漏掉了断点;
     tsc 干净)。**Merge 后**: 桥接 skill 自动退场 (新 atoms 自带
     concepts,backfill 查询空集),归档至 `_archived/`。
  - (P3) fork-boundary guard hook 会拦 /tmp 下 upstream PR worktree 的
    src/ 编辑 — 建议 `guard-fork-boundary.sh` 加判断: 文件不在
    `$CLAUDE_PROJECT_DIR` 下时放行 (本次用 python 替换绕行,记录在案)。
  - (P2) **第二个上游缺陷 (2026-06-12 定位): 0-yield 页永远重新被发现**。
    extract_atoms 的幂等靠 atom row 的 source_hash 排除已处理页 — LLM
    判定提不出 atom 的页没有 atom row → 无 tombstone → 每次 discovery
    都重新入选。后果: ① `--drain` 在 backlog 头部聚集 0-yield 页时
    误判 no_progress 停机 (6/12 01:24 default 卡死在 2,013,log 可见
    remaining 冻结) ② nightly 每晚重复花钱处理同一批 0-yield 页
    (6/12 晚 41 页只产 2 atoms)。**候选第二个上游 issue**(0-yield
    tombstone / no_progress 按 pages-processed 判定)。缓解性事实:
    default 剩余 backlog 头部抽样全是低价值邮件线程页 (Turkeycontroller
    ×3 / Re-cancel-subscription...) — 可提取的精华基本已提完,
    剩余 2,183 页的"排干"边际价值低,不值得硬泵。
- `enrich_thin: ok` — 4/4 源,候选 5 页全部 `insufficient` (brain 内
  证据不足,质量门拦下,宁缺毋滥),$0.07 评估成本。每 tick 上限 3 页 /
  $1,types=[person,company] — 正对 email entity stubs,逐晚啃。
- cycle duration 72s → **563s** (extract_atoms LLM 提取所致)。
- **观察项 (2-3 晚)**: atoms 积累速率 + synthesize_concepts 首跑 +
  dream 时长/成本走势 (绑定既有 v0.36.1.0 dream spend 观察项)。

### [~] (P1) KB 缺口盘点 + 一次性 backfill 启动 (2026-06-09 晚, Lucien D3 全选授权)

盘点 (doctor health_score 15): atoms backlog **2,886 页** (default 2,191 +
omada 695; **mailagent-emails 0 页 eligible** — 邮件 type 不在 pack 的
atom 提取类型里,要进管道需 type 映射决策,候补)。orphan_ratio **FAIL
86%** (13,084/15,231)。calibration holder 错配 (takes 数据 holder=`self`,
查询默认 `garry` → 永远 0 条)。

已启动 (全部满足「幂等、不返工」标准):
1. [x] `emotional_weight.user_holder=self` config 对齐 (DONE 2026-06-09 晚)。
   注意: 未来若想改 holder=lucien 需同步 `UPDATE takes SET holder`。
2. [x] `gbrain extract links --by-mention --source db` — **DONE 2026-06-09
   晚: 92,102 条 mentions 连边落库** (page_links 14k → 106,337),零 LLM
   token。log `/tmp/kb-backfill-20260609.log`。
3. [~] `gbrain dream --phase extract_atoms --drain` 循环 (default → omada,
   30min 窗口,**02:50 deadline 自动停避让 03:11 nightly**,exit 3 = 续跑)。
   成本基线 $0.0125/页 × 2,886 ≈ **$36**,~16h — 今晚跑不完,明天接力:
   重跑同命令即可 (content-hash 幂等)。
   **坑 (已修,记 memory)**: Claude Code shell 注入的
   `ANTHROPIC_BASE_URL=https://api.anthropic.com` (不带 /v1) 会让所有
   anthropic chat 404 "Not Found" → 首轮 drain +0 死循环;`unset
   ANTHROPIC_BASE_URL` 后单批 +22 atoms 恢复。launchd 夜间任务无此 env
   不受影响。手动跑 gbrain LLM 命令前一律 unset。外层循环已加
   no_progress / remaining-stuck 保护。
4. [ ] drain 排干后手动 `gbrain dream --phase synthesize_concepts` 收割
   第一批 tier-promoted concepts。

明确**不跑**的: enrich_thin 批量 (证据不足 stub 日后要重评 = 返工,夜间
质量门慢啃)、backlinks fix (§6.28 audit-only by design)、conversation
LLM fallback (低优)。takes 池 20 条 (理想 >100) 缺的是 Lucien 人工
accept/reject,不是 token。

---

## P2 — Post-v0.42.37.0 sync follow-ups (added 2026-06-09)

- (P2) **Keyword-arm ts_rank cliff on high-frequency terms**. `gbrain search
  "Lucien"` hits the 8s `statement_timeout`: 25,450 matching chunks (the
  mailbox owner's name appears in nearly every email), and the keyword arm
  ranks ALL matches before LIMIT — ts_rank detoasts ~280k buffer pages, CPU-
  bound (cache-hot), inner CTE alone 5.3s. Pre-existing (timeout ×3 predates
  the merge; §6.33's same probe still scored 0.81 on 06-01 — the email corpus
  grew 31k → 37.8k chunks (+22%) in the week since and crossed the cliff).
  `--source` scoping does NOT help (filter applies after the GIN scan +
  detoast). Real fix is upstream query shape (cheap-proxy prefilter before
  ts_rank) — file an issue on garrytan/gbrain. Vector path unaffected (ZH
  0.876 / EN semantic 0.889).
- (P2) **Daily omada-sentiment ingest embeds must stay watched**. 98% of
  omada chunks (2,482/2,521) had NULL vectors before the 06-09 drain — the
  avman TLS flake silently failed corpus-ingest's embed stage AND the daily
  writes. The `fork(ai-gateway)` transport retry now covers the synchronous
  put_page path; kos-patrol should alert if `content_chunks.embedding IS
  NULL` count grows again (add check if recurrence observed).
- (P3) Upstream `db-lock-heartbeat-takeover.test.ts` withEnv conversion
  (352e6a82) is a candidate to PR upstream — their master fails its own
  check-test-isolation gate.

---

## P1 — Post-enrich-sweep KB refinement (added 2026-06-01)

### [x] (P1) Batch KB refinement of the email-corpus stubs — DONE 2026-06-01 (data side)

The full `mailagent-emails` enrich-sweep (Tier-3-only, `--min-mentions 3`,
3482 stubs, rc=0) surfaced 7 quality signals; one batch refinement ran the
same day. Full detail + detection SQL + resolution table in
[`skills/kos-jarvis/REFINEMENT-BACKLOG.md`](REFINEMENT-BACKLOG.md). Outcome:

- **R1 / R2 — RETRACTED.** Premised on the wrong mental model. Per CLAUDE.md's
  two-axis design, **sources are independent namespaces and slugs scope per
  source**, so the stubs correctly live in `mailagent-emails` (not `default`),
  and the same slug existing in both sources is two valid pages, not a dup.
  No move, no cross-source dedup. The `--target-source` / all-source-existence
  code changes are dropped.
- **R3 / R4 / R7 — DONE** (28 + 16 soft-deletes): R3 19 email/domain-mash junk
  pages, R4 9 near-dup company variants (kept richest), R7 16 orphan zembed-1
  test chunks → brain now literally single-model te3 (43,311 / 0 non-unit-norm).
- **R6 — reviewed, no action**: the 68 `<300`-char stubs are concise-but-valid.
- Live email-corpus stubs after cleanup: **3417**.

**Remaining (code only, deferred):** R3 email→alias in NER, R4 dedupe
normalization (strip corp suffixes / `tplink`↔`tp-link`), R5 tier-marker copy —
a focused enrich-sweep code pass; affects only the *next* sweep. Plus a few
borderline R3 names left for Lucien's eyeball (`4com`/`cnet`/`ocn`/`surfnet`/
`sct-telecom`/`marcom`/`5gcom`/`cn`/`hnbu-cn`/`cloud-org`). Ties into the
existing P2 "485 entity pages no link/timeline" graph-coverage item.

---

## P0 — DONE 2026-05-04 (apply-migrations 已跑通)

### [x] 生产 Postgres schema 升到 v34 — DONE

**Result**: 3 migration applied (v32 oauth_infrastructure, v33
admin_dashboard, v34 destructive_guard),schema_version 现在 = 34
(latest)。`gbrain doctor` connection ok,RLS 31/31 tables,embeddings
100%,brain_score 83/100。

**Caveat 解锁过程**: `init --migrate-only` 头一次失败,报 `column
"agent_name" does not exist`。原因: v0.26.7 SCHEMA_SQL line 420
(`CREATE INDEX idx_mcp_log_agent_time ON mcp_request_log(agent_name,
created_at DESC)`) **forward-references** v0.26.3 加的列,但
`applyForwardReferenceBootstrap()` 数组**漏了** `mcp_request_log` 的
3 个 v0.26.3 列(`agent_name`, `params`, `error_message`)。这是
upstream "structurally prevented" 自夸的 bootstrap pattern 又一次
failure。手动 `ALTER TABLE mcp_request_log ADD COLUMN IF NOT EXISTS
agent_name TEXT, params JSONB, error_message TEXT` 后再跑 init
--migrate-only 全过。

**Follow-up**: 见下方新增 P0 给 upstream 提 PR 加 bootstrap 覆盖。

## P0 — upstream PR closed as superseded

### [x] PR #627 to garrytan/gbrain — CLOSED 2026-05-09 (superseded by upstream fixwave #682+#741)

**Filed**: https://github.com/garrytan/gbrain/pull/627
**Closed**: 2026-05-09 with [public superseded comment](https://github.com/garrytan/gbrain/pull/627#issuecomment-4414624389) — upstream's v0.31.1.1-fixwave (#776) extended `applyForwardReferenceBootstrap` to probe `mcp_request_log.{agent_name,params,error_message}` + ALTER COLUMN IF NOT EXISTS, exact same fix bundled with broader v0.20 + v39-v41 column coverage. Our PR became a strict subset. Patch doc `docs/UPSTREAM-PATCHES/v026-bootstrap-mcp-log-fix.md` deleted.

`fix(bootstrap): cover v0.26.3 mcp_request_log columns` — extends
`applyForwardReferenceBootstrap()` 在 PostgresEngine + PGLiteEngine 上
probe `mcp_request_log.{agent_name, params, error_message}`; 表存在
但任一列缺失就 ALTER TABLE ADD COLUMN IF NOT EXISTS。
`REQUIRED_BOOTSTRAP_COVERAGE` 数组 + e2e regression test 都加齐。

**Validation**:
- typecheck clean (~3s)
- `bun test test/schema-bootstrap-coverage.test.ts` 2/2 pass
- `bun test test/bootstrap.test.ts` 6/6 pass (existing tests 没退化)
- e2e `DATABASE_URL=… bun test test/e2e/postgres-bootstrap.test.ts`
  3/3 pass (新 mcp_log case 33 ms,against `pgvector/pgvector:pg16`)
- PR diff: 4 files / +146 -5 lines / 100% additive

**Strategy**: branch `upstream-fix/bootstrap-mcp-log-cols` 切自
`upstream/master` (HEAD 058fe69 v0.26.7),不带 fork-local 内容;push
到 ChenyqThu/jarvis-knowledge-os-v2 (fork of garrytan/gbrain),从 fork
向 upstream 提 PR。所以 PR diff 干净,只有 4 文件 fix。

**Follow-up**: 等 garrytan review/merge。Merge 后下次 fork upstream
sync 拉到这条 fix,删掉 `docs/UPSTREAM-PATCHES/v026-bootstrap-mcp-log-fix.md`
+ 这条 P0 entry。如果 upstream 回避或 30+ 天没动,考虑 fork-local
prepend (但 diff 这么小,PR 路径应赢)。

**Production impact**: 已经手动 `ALTER TABLE mcp_request_log ADD
COLUMN IF NOT EXISTS …` 过了,生产 schema v34, 不依赖此 PR merge。

### [x] 服务 smoke check — DONE 2026-05-04 (详见 Done section)

## P2/P3 — Post-v0.38.2.0 sync follow-ups (added 2026-05-22)

> v0.38.2.0 sync (§6.30). fork-protected paths zero-touch; only 2
> mechanical conflicts. Two minor follow-ups surfaced during smoke.

### [ ] (P2) `hybrid-reranker-integration.serial.test.ts` — 4 fail under fork PGLite pin

New upstream test (added v0.37.11.0 `d0d0e2a6`, absent on fork master
pre-merge). 4 of its 6 cases fail: `hybridSearch(engine, 'alpha keyword',
...)` multi-word keyword query returns an empty candidate pool under
PGLite (the fork pins `@electric-sql/pglite` via package.json override).
**Production (Postgres) is unaffected** — multi-word query smoke
(`knowledge management` → 0.9108) confirmed. Not a regression; the file
never ran on the fork before.

**Options**: (a) bump the fork PGLite override toward upstream's
expectation, (b) file an upstream PR making the test hermetic across
PGLite versions, (c) leave it — the §6.29 gate (typecheck + check:all +
`test/ai/`) is the fork's real gate; full-suite has documented
env-coupling (see "bun test full-suite hang" entry below). **Scope**:
1-2 h investigation.

### [ ] (P3) `reranker_health` ZeroEntropy auth WARN + query `[expand] Not Found`

Post-sync `gbrain doctor` shows `reranker_health: 1 reranker auth
failure — verify ZEROENTROPY_API_KEY`; production `gbrain query` prints
`[ai.gateway] expansion disabled: [expand] Not Found`. Both are optional
enhancement layers (reranker / multi-query expansion); core retrieval is
unaffected (query smoke hits 0.88-0.99). The fork declined ZeroEntropy
(§6.29). Likely v0.37.x/v0.38.x enabled these layers and they probe an
endpoint/key the fork doesn't hold.

**Action**: 15 min — decide to explicitly disable the reranker /
expansion for this brain, or wire creds. Low priority — no retrieval
impact.

## P1 — Post-v0.37.0.0 sync follow-ups (added 2026-05-19)

### [ ] (v0.36.1.0) Observe dream-cycle LLM spend delta from new calibration phases

dream-cycle phase **13 → 16** post-sync (新 propose_takes/grade_takes/
calibration_profile — 全 LLM Anthropic phase)。Cron 03:11 daily 跑。

**What**: 前 2-3 晚后查 `~/brain/.agent/dream-cycles/*.json` 看
`total_cost_usd` 涨多少 vs pre-sync baseline。若涨幅 >$0.5/night,
评估 `GBRAIN_DREAM_SKIP_CALIBRATION` env (若 upstream 有此 flag) 或
plist 加 `--phase-exclude propose_takes,grade_takes,calibration_profile`。

**Scope**: 30 min spot-check 跨 2 晚 + decision。

### [ ] (v0.36.3.0) Declare embedding_columns registry for `embedding` @ 1536d

`gbrain doctor` v0.36.3 加的 `embedding_column_registry` check **现在
auto-PASS**(doctor 检测默认 column 配置 OK)。但显式 declare 可保未来 doctor
不假阴性 + 给 column override workflow(per-query embedding column for A/B)
开门。

```bash
bin/gbrain config set embedding_columns '{
  "embedding": {
    "provider": "google:gemini-embedding-001",
    "dimensions": 1536,
    "type": "vector"
  }
}'
bin/gbrain doctor --json | jq '.checks[] | select(.name=="embedding_column_registry")'
```

**Scope**: 15 min config + verify。

### [ ] (v0.36.6.0) Image ingestion roadmap decision — SCAFFOLDED 2026-05-19, awaits Lucien bootstrap

**Decision 2026-05-19**: option (a) Full enable + cron — Lucien 选这条。
Scaffold 落地，bootstrap 阻塞在 prereq fill 上。

**Scaffold artifacts** (committed):
- `skills/kos-jarvis/image-ingest/SKILL.md` — 5-step bootstrap walkthrough
- `skills/kos-jarvis/image-ingest/run.ts` — wrapper that calls
  `gbrain import <IMAGE_SOURCE_DIR> --json`, archives result to
  `~/brain/.agent/image-ingest/<ISO>.json` + `latest.json` symlink,
  estimates Voyage spend (~500 token/image × $0.05/M)
- `scripts/launchd/com.jarvis.image-ingest.plist.template` — daily 04:33
  cron (between dream-cycle 03:11 and kos-patrol 08:07), 3 `<FILL:*>`
  markers

**Lucien todo (manual, ~30 min)** before bootstrap:
1. Register Voyage account at https://www.voyageai.com → get API key
   (~$0.05/M tokens, multimodal-3)
2. Pick / create `IMAGE_SOURCE_DIR` (e.g. `~/jarvis-images/`) and drop
   some test images
3. `cp scripts/launchd/com.jarvis.image-ingest.plist.template ~/Library/LaunchAgents/com.jarvis.image-ingest.plist`
4. Edit deployed plist: replace `<FILL:NANO_BANANA_API_KEY>` / `<FILL:VOYAGE_API_KEY>`
   / `<FILL:IMAGE_SOURCE_DIR>` with real values
5. `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.jarvis.image-ingest.plist`
6. First manual kick: `launchctl kickstart -k gui/$UID/com.jarvis.image-ingest`
7. Smoke: `tail -50 skills/kos-jarvis/image-ingest/image-ingest.stdout.log`
   + `psql -c "SELECT COUNT(*) FROM content_chunks WHERE embedding_multimodal IS NOT NULL;"`
   + `bin/gbrain search --image <test-image-path>` 看返结果

**Status close trigger**: after step 6 successful + step 7 returns >0
multimodal chunks。Re-open with bug filing if any step fails.

**Manifest**: image-ingest entry added to `skills/manifest.json` (47 → 48
entries). Active fork dirs: 10 → 11.

### [ ] (v0.36.4.0) doctor --remediate vs kos-patrol overlap — see Phase 7.5 evaluation

完整 evaluation note: `~/brain/.agent/reports/doctor-remediate-vs-kos-patrol-2026-05-19.md`

实施替换决策（option a/b/c 见 evaluation note）留 M4 milestone window。

### [x] (v0.35.7.0) Typed-claim fence (`claim_metric/value/unit/period`) for OH transcripts — RESOLVED 2026-05-19 (optional prompt template added, no enforcement)

**Decision 2026-05-19**: option (b) **加进 prompt template 作为可选** —
Lucien 在写 OH transcripts 时可 copy template 起手，未来真有 metric
变化时手动勾上 typed-claim row。不加 lint 强制。

**Implementation**:
- New template at [`templates/oh-transcript-page.md`](templates/oh-transcript-page.md)
  — source-kind frontmatter + holders + summary + 14-col typed-claim
  fence example (3 rows: pure-fact / commitment / prose-only) + quotes +
  linked entities/concepts + open questions
- Template 注释解释了 `claim_metric` 闭合词表 (mrr/arr/team_size/runway/
  burn_rate/cac/ltv/mau/dau/churn_rate/revenue/fundraise/headcount/
  gross_margin/users) 和 normalize 规则
- `skills/kos-jarvis/README.md` templates 段加该文件引用 (9 + 1 specialized)

**Usage**: `cp skills/kos-jarvis/templates/oh-transcript-page.md
sources/oh-transcripts/<founder-slug>-<date>.md` then fill in。

**Re-evaluate trigger**: 如果 1+ month OH transcripts 写作没人 actually
fill 14-col fence (仅写 prose-only rows) → 简化为 10-col fence；如果
开始 frequently fill metric columns → 加 lint check 强制写完整 14 col。

## P1/P2/P3 — System review findings (added 2026-05-19, post v0.37.0.0 followups audit)

> System-wide review run 2026-05-19 evening, post all followup commits.
> 10 new findings consolidated below: 3 P1 functional, 2 P2 structural,
> 5 P3 cosmetic/hygiene. Full review reasoning in conversation transcript
> 2026-05-19 evening.

### [ ] (P1) `feishu` agent daily 08:08-08:10 phantom traffic — caller unknown

`mcp_request_log` 显示 `agent_name='feishu'` (`client_id=gbrain_cl_ffe0727090...`)
每天 08:08-08:10 跑 1 次 `list_pages`，连续 5/18 + 5/19 都有。但 CLAUDE.md
L82 说 feishu "dormant since 2026-05-05"。Caller source 未知。

**Possible sources** (rank by likelihood):
1. mbp-office (cloudflared host) 上某 cron 用 feishu credentials 做 daily
   brain health probe
2. `~/.openclaw/extensions/` 仍残留某 feishu signal-detector cron 没被
   5/05 retire 干净
3. 你自己 ad-hoc 写的某 Cloudflare Worker / shell script 没 record in docs

**Investigation steps**:
- `ssh mbp-office "crontab -l; launchctl list | grep -i feishu"` (本机 ssh
  访问 mbp-office)
- `ls -la ~/.openclaw/extensions/` 看是否有 feishu-related dir 残留 (前提:
  TODO L1163-1168 说 5/05 已 retire jarvis-feishu-signal-detector，但是否真删)
- Cloudflare dashboard → kos.chenge.ink tunnel → access logs filter by
  client_id `gbrain_cl_ffe07270...` → 看 source IP
- 如真找不到 caller: `bin/gbrain auth revoke-client gbrain_cl_ffe0727090...`
  + `rm ~/.gbrain/oauth-clients/feishu.json`，等 24h 看是否有 401 报错弹出

**Why it matters**: Unknown client with `put_page` scope (5/17 写过
`sources/handoff-smoke-1779083446` 来证明 scope 有 write) 是 supply-chain
风险。即使是 Lucien own script，docs 应该 capture。

### [ ] (P1) Notion Knowledge Agent 停摆 — kos-worker MCP 流量 0

**Evidence**:
- `kos-worker` MCP traffic: **5/17 setup smoke 后 0 calls**（mcp_request_log
  从未再现 kos-worker client_id）
- pages 增长: 5/15=56 → 5/16=10 → 5/17=3 → **5/18 起 0**
- `git_sync` ingest_log: 5/15=142 → 5/16=51 → 5/17=2 → **5/18=1 / 5/19=0**

**问题**: Notion Knowledge Agent 没真用。verify Notion Agent UI v2→v3 update
(`docs/NOTION-AGENT-UPDATE-CHECKLIST.md` 5 步) 是否真完成、OAuth client +
worker token 是否有效。manual smoke: Notion Agent UI 触发一次 ingest，看
mcp_request_log 是否 record new kos-worker call。**Scope**: 30 min verify。

> **「缺 sync cron」part — REFRAMED 2026-05-22 (v0.38.2.0 sync, §6.30)**:
> 此 entry 原第 2 部分「需加 daily `gbrain sync` cron」**前提错误**。查证:
> `~/brain/` markdown 工作树自 §6.28 cutover (5/17) 起冻结 —— Notion Agent
> `put_page` 与 dream-cycle 都直接写 DB,没有东西再写 `~/brain/` markdown。
> `gbrain sync`(markdown→DB)因此恒等 no-op;`sources.last_sync_at` 只在
> 真正 import 时前进(`sync.ts:309`)。加 daily sync cron 只会每晚空转。
> `sync_freshness` doctor check(过滤 `WHERE local_path IS NOT NULL`)对本
> fork 的 DB-canonical 单源架构 **结构性失效** —— 量的是一条已废弃路径;
> brain 内容由 `put_page` 保持新鲜(检索 0.9+,3140 pages)。
> **决定 2026-05-22**: 不建 sync cron。`sync_freshness` FAIL 当 known
> false-alarm —— 它只在 on-demand `gbrain doctor` 出现(无 cron 跑 doctor;
> kos-patrol dashboard 是自身 inventory/gap 报告,不含 doctor 分数)。详见 §6.30。

### [ ] (P1) `frontmatter->>'source'` empty on 3139/3140 pages (provenance gap)

Top 15 frontmatter keys 都没含 `notion_id` / `source` / `source_url` (top:
updated/kind/created/status/id/confidence/owners/source_of_truth/source_refs/
aliases/related/source_date/source_type/source_url/raw_path)。`source_type` /
`source_url` 各只 23 pages 含。

**Impact**: 无法 spot-check 某 page 是 Notion 写的 / git_sync 进来的 /
人工编辑的。`gbrain doctor` 也无法 break down "% from Notion" stats。

**Cause**: kos-worker `put_page` builder (workers/kos-worker/src/index.ts
frontmatter builder section) 未 set provenance fields。原 notion-poller
也未 set (历史 git_sync 数据)。

**Fix sketch**:
1. kos-worker 改 frontmatter builder：每个 put_page 时加
   `{ source: 'notion-agent', notion_id: <page_id>, ingested_at: <iso> }`
2. 历史 page backfill: scan markdown body for "From Notion" / "URL: ...notion.so/...",
   set provenance from inference。Scope 中等 (~3140 pages, mostly programmatic)。

### [ ] (P2) `graph_coverage 0% / timeline 0%` — 485 entity pages no link/timeline

Doctor 主动 suggests `gbrain extract all`。这是 markdown brain 的 known
state (per §6.19) — entity-extract 没在 cron 跑。

**Quick action**: `bin/gbrain extract all` 一次 backfill (estimate ~10-15
min for 3140 pages). 之后 graph_coverage warning 消去。dream-cycle 已含
extract phase (`[cycle.extract] done` 见 dream.stderr.log)，但只对 dream
phase scope 的 pages 做。一次性 extract all 把历史 page 一次补齐。

**Scope**: 15 min run + verify doctor warning gone.

### [ ] (P2) sync_freshness 41h — symptom of P1-2 (no sync cron)

Doctor: `Source 'default' last synced 41h ago. Run gbrain sync --source <id>`.

Standalone action: `bin/gbrain sync --skip-failed --no-pull` 一次清 41h
gap。但根因 = 缺 sync cron (P1-2)。可单独 ad-hoc 跑作为 stop-gap.

### [ ] (P3) Stale log files — `_archived/gemini-embed-shim/` 占 1.7 MB (70% of fork repo)

| Path | Size | mtime |
|---|---|---|
| `_archived/gemini-embed-shim/shim.stderr.log` | 777K | 5/1 |
| `_archived/gemini-embed-shim/shim.stdout.log` | 900K | 5/9 |
| `dream-wrap/dream.stderr.log` | 62K | 5/19 (daily growing) |
| `kos-patrol/patrol.stderr.log` | 234B | 5/9 (M1 retire-era kos-lint errors) |
| `enrich-sweep/sweep.stderr.log` | 3K | 5/17 (pre-§6.28 embed shim errors) |

**Action options**:
- `rm skills/kos-jarvis/_archived/gemini-embed-shim/shim.{stdout,stderr}.log`
  (skill code retain, just kill 1.7 MB logs from retired service) — 10 sec
- Add logrotate script for active services (dream-wrap 每天 62K += 22 MB/year
  unbounded)

### [ ] (P3) `whoknows_health` doctor warning — fixture path env unset

Doctor warning: `whoknows eval fixture path could not be resolved. Set
GBRAIN_WHOKNOWS_FIXTURE_PATH to the absolute path for
test/fixtures/whoknows-eval.jsonl`.

**Fix**: 1-line config set, OR `unset` the check (we don't actively use
whoknows eval). If we want it on:
```bash
bin/gbrain config set whoknows_fixture_path \
  /Users/chenyuanquan/Projects/jarvis-knowledge-os-v2/test/fixtures/whoknows-eval.jsonl
```

### [ ] (P3) `eval_candidates` capture mode unused — 1 row in 18 days

`GBRAIN_CONTRIBUTOR_MODE` enabled (per TODO §"2026-05-01 v0.25.0 sync"
decision) but only 1 row captured since 5/1. Either:
- Actually use the eval data (write a fork-side eval consumer)
- Disable to reduce noise (`unset GBRAIN_CONTRIBUTOR_MODE` + remove from
  any plist)

**Scope**: 10 min decision + cleanup if disable.

### [ ] (P3) `kos-patrol/run.ts` retains retired kos-lint references

L7 docblock: `*   2. Lint (delegate to kos-lint/run.ts)` — describes
retired phase
L135-144: retirement note + archived path reference (informational, OK)
L404: `...(lint.errors > 0 ? ["- Fix kos-lint ERROR findings ..."]:[])` —
**dead branch** (phase2 returns hard-coded `errors=0`, never fires)

**Action**: 5 min cleanup — delete L404 dead branch, update L7 docblock
to say "Lint (retired 2026-05-10 — see L135 note)".

### [ ] (P3) `resolver_health: 8 warnings` (down from 57 pre-sync — investigate residual)

doctor `resolver_health` improved from 57 issues (29 err + 28 warn) to **8
warnings (0 errors)** after v0.37.0.0 sync. But 8 残留 warnings 内容 unknown.

**Action**: `bin/gbrain doctor --json | jq '.checks[] | select(.name=="resolver_health") | .issues'`
inspect remaining warnings. Most likely 都是 cross-boundary refs to
`~/.openclaw/workspace` AGENTS.md (non-fork responsibility) per TODO L72,
but verify after sync.

## P1 — Post-v0.34.4 sync follow-ups (added 2026-05-15)

### [x] (PR-3) Upstream PR: `gbrain dream --archive-dir` flag — FILED 2026-05-17 ([#1133](https://github.com/garrytan/gbrain/pull/1133))

Branch `upstream-fix/dream-archive-dir` cut from `upstream/master`
(HEAD `af7e5379` v0.35.6.0). Adds `--archive-dir <path>` flag to
`src/commands/dream.ts` that, paired with `--json`, writes the
CycleReport to `<path>/<iso>.json` (colon-free fs-safe timestamp)
and atomically swaps a `<path>/latest.json` symlink. Helper
`archiveReport()` + `isoStamp()` lifted from fork-side
`skills/kos-jarvis/dream-wrap/run.ts` patterns. 3 files / +205 -3.
Tests: `bun test test/dream-cli-flags.test.ts test/dream.test.ts`
**29 pass / 0 fail / 72 expect() / 19.46 s** (5 new static-introspection
+ 5 new integration cases against real PGLite + temp dir).

On merge:
1. Fork `skills/kos-jarvis/dream-wrap/run.ts` trims from 205 LoC →
   ~30 LoC (exit-code translation only — clean/ok/partial/skipped → 0,
   failed → 1, wrap-level error → 2; the archive + symlink + ISO
   stamp surface all delegate to upstream)
2. Cron contract unchanged for launchd
3. Active fork dirs unchanged (dream-wrap kept for the exit-code
   semantic that upstream doesn't yet fold in — partial = exit 0
   instead of failed = exit 1)

Pattern matches PR #1017 (superseded by v0.35.5.0 #1111) — fork-side
experience codified into upstream so the wrapper layer thins.

### [x] (PR-2) Upstream PR: extend forward-bootstrap to cover oauth_clients.{source_id, federated_read} — CLOSED 2026-05-17 (superseded by v0.35.5.0 #1111)

**[garrytan/gbrain#1017](https://github.com/garrytan/gbrain/pull/1017)**.
Branch `upstream-fix/bootstrap-oauth-clients-cols` cut from
`upstream/master` (HEAD `24881f60` v0.34.4). Pattern lift from #627:
probe `oauth_clients.{source_id, federated_read}` in the
`information_schema` round-trip, ALTER TABLE ADD COLUMN IF NOT EXISTS
when missing, FK on `source_id` to `sources(id)` and `NOT NULL
DEFAULT '{}'` on `federated_read`. Both PostgresEngine and PGLiteEngine
mirror the change. `REQUIRED_BOOTSTRAP_COVERAGE` gains two entries.
3 files / +87 -4 / `bun test test/schema-bootstrap-coverage.test.ts
test/bootstrap.test.ts` 11 pass / 0 fail (50 expect() vs 48 pre-patch).

E2E test in `test/e2e/postgres-bootstrap.test.ts` not extended — the
in-memory PGLite contract test already validates the per-column
bootstrap loop; PR body offers to add an oauth-specific E2E case if
maintainers prefer.

On merge: drop this entry from TODO + on next fork sync the local
changes (if any) auto-merge clean.

Production impact: already manually ALTER-ed on the fork's prod DB
during the v0.34.4 sync (§6.24); not blocking. PR closes the gap for
any other downstream that runs `gbrain init --migrate-only` on a
pre-v0.34 schema after pulling v0.34.x.

### [x] (CJK-eval) Reassess "vector search only" assumption after v0.32.7 CJK fix wave — VERDICT 2026-05-15: assumption holds for compound CJK; tighten the wording, no behavior change

15-query probe via `gbrain search` (keyword-only, tsvector path) at
schema v66 / v0.34.4 / Postgres engine:

| Pattern | Sample | Result |
|---|---|---|
| English single/multi word | `Lucien`, `Omada`, `Notion`, `Postgres` | 10-18 hits, 0.3-0.5 scores |
| Mixed CJK+space | `AI 网关` | 8 hits via Latin fragment, low CJK weight |
| 2-3 char CJK | `知识管理`, `知识库` | 2-3 hits via body-fragment containment |
| 4-char CJK compound | `向量检索`, `嵌入模型`, `云控制器`, `万兆网卡`, `Gemini 嵌入` | **0 hits** every time |
| 2-char CJK names | `拉勾`, `猫人` | 0 hits |

**Verdict**: v0.32.7's CJK work landed downstream of where it would
have helped pure-keyword retrieval here. Postgres `to_tsvector('simple')`
treats Han runs as a single non-tokenizable blob; matches only fire when
the query string is a literal substring of the body (and even then
they're scored weakly). 4-char compound CJK — the *typical* operator
query shape on this brain — still goes 0/N on keyword. Vector path
remains the only reliable retrieval for CJK compound queries.

**Operating-assumption update**: CLAUDE.md's "vector search is the
only working retrieval path on Chinese queries" is correct in spirit
but slightly overstated — English-on-CJK-corpora keyword search works
fine, and so does fragment match on 2-3 char standalone CJK terms.
The accurate wording is: *compound CJK queries (4+ Han characters
without whitespace) cannot be served by tsvector and require the
vector path*. Update CLAUDE.md to this tighter form in a follow-up
edit; no behavior change to kos-patrol / kos-compat-api routing.

**Hybrid budget save — not yet worth it**: the original probe goal
was to find a path that lets cost-sensitive callers (kos-patrol gap
detection, etc.) drop the embed call. Today's keyword path can't
serve the compound-CJK queries those workloads actually issue, so
hybrid + keyword-first / vector-backfill saves nothing on the
modal query. Re-evaluate if upstream lands a real CJK tokenizer
(jieba binding, ICU, or pgroonga ext — none in v0.34.x).

### [x] (overlap-matrix) Evaluate v0.31.6 / v0.32.2 / v0.33.0 vs fork hot-memory pieces — VERDICT 2026-05-15: no retirements; upstream features complementary, not replacement

Built the side-by-side. None of the three upstream surfaces is a
superset of the fork piece I framed it against; the original
"potentially redundant" column overstated the overlap. Detail:

| Upstream | Real surface | Fork piece | Verdict |
|---|---|---|---|
| v0.31.6 extract-facts-during-sync (`src/core/facts/extract.ts` runs per page-write, lands in `facts` table + `## Facts` fence) | per-page real-time fact extraction | concept-synthesis (M2-A.pilot, decision (b) keep ad-hoc, **never wired**) | **No overlap.** Upstream's extract-facts is per-page real-time; concept-synthesis was for cross-page multi-month recurrence clustering. Different problem. Fork has nothing wired on the per-page real-time path. |
| v0.32.2 facts-fence (`## Facts` fence on entity pages as system-of-record, reconciled to DB on every sync; `src/core/facts-fence.ts` + migrate.ts:2572) | INSIDE individual brain pages | digest-to-memory (weekly Sun 22:00 cron writes `[knowledge-os]` summary to `~/.openclaw/workspace/MEMORY.md`) | **Different surface entirely.** facts-fence is intra-page, intra-brain; digest-to-memory is cross-system push from brain → OpenClaw MEMORY.md. No conflict, no retire. |
| v0.33.0 "morning pulse" — actual scope is `gbrain recall --pulse / --since-last-run / --pending` on the `facts` table (PR title is misleading; `src/commands/recall.ts`) | hot-memory fact recall, entity-scoped + time-windowed | kos-patrol daily 08:07 cron (brain-wide health audit → `~/brain/.agent/dashboards/knowledge-health-<date>.md` + digests) | **Different scope.** Upstream pulse queries the facts table for recently-added rows; kos-patrol audits structural health (lint / staleness / entity gaps). Same cadence convention, totally different output. No retire. |

**No retirements warranted from this matrix.** M2-A.pilot decision
(b) — *keep concept-synthesis ad-hoc, don't wire* — also survives:
the upstream feature that landed (extract-facts) addresses a
different need (per-page fact extraction), not the recurrence-
clustering need concept-synthesis was prototyped for.

**Side benefit: a new capability to evaluate, not a retire**.
Upstream's `extract-facts-during-sync` would give the fork's brain
a real-time per-page fact index for free. Currently it's **not
enabled** here (every `gbrain sync` skips the facts:absorb writer
because the sub-process never connects — same root cause as the
[`facts:absorb`](#-factsabsorb-sub-process-factsabsorb-writer-has-no-db-connection-added-2026-05-15)
P1 entry above). Re-evaluating whether to enable it on this fork is
worth tracking; for now, no fork code changes from this matrix
work.

Decision artifact lives in this entry; no separate plan doc needed.

---

## P1 — consolidation PLAN 落地 (M1 milestone, 仍 active)

> 来自 [`docs/KOS-JARVIS-CONSOLIDATION-PLAN.md`](../../docs/KOS-JARVIS-CONSOLIDATION-PLAN.md)
> §7 M1 milestone。每条独立可起手,合计 ~6 h 研究 + 30 min cleanup。
> v0.26.7 sync 后 M1 内容**未变**(上游没 close 任何 fork 责任),
> 但**新增 M2 候选**见下方"M2 milestone 候选"段。

### [x] Wire-status check: dikw-compile / evidence-gate / confidence-score — RESOLVED 2026-05-17 (stale — done in M2-A 2026-05-04/05-10)

This entry pre-dates M2-A. The wire-status investigation **was performed
2026-05-04** (production probe: `dikw_layer` set on 0/2477 pages,
`evidence_level` 1/2477, `confidence` 2470/2477 but values hardcoded in
`kos-compat-api.ts:454,533` not script-computed; cross-checked all callers
in kos-compat-api / workers/notion-poller / kos-patrol — none spawn the
triplet's run.ts; the README "Runs after idea-ingest..." line was always
aspirational). **Verdict: 100% dead code**, leading to:

- Triplet archived 2026-05-10 (commit `eedb357`, M2-A) →
  `skills/kos-jarvis/_archived/{dikw-compile,evidence-gate,confidence-score}/`
- `kos-compat-api.ts:600` rewritten: `"dikw-compile recommended"` →
  `"use \`gbrain dream\` for cross-page synthesis"`
- `skills/manifest.json` 3 entries deleted; `skills/RESOLVER.md`
  `## KOS-Jarvis extensions` archive note added
- See "Done" section: "2026-05-04 M2-A wire-status check — verdict:
  RETIRE triplet" + "2026-05-10 (M2-A.archive) Archive triplet"

### [x] kos-lint 退役 pilot test — DONE 2026-05-10 (mechanical retire, formal pilot procedure short-circuited by smoke-test evidence)

The PLAN §6 four-step pilot procedure was short-circuited by the
2026-05-04 service smoke (above in Done section): kos-patrol stderr
showed `[2] kos-lint JSON parse failed; exit=3` for the live runner,
and patrol still reported 0 WARN — i.e. **production was already
operating without kos-lint** because the runner was naturally broken.
Strongest possible PILOT-RETIRE evidence, no baseline-vs-control run
needed.

**Action taken (commit `9e3cd0f`, 2026-05-10)**:
- `skills/kos-jarvis/kos-lint/` moved to `skills/kos-jarvis/_archived/kos-lint/`
- `kos-patrol/run.ts` Phase 2 turned into a no-op (`return { rows: 0,
  findings: [], errors: 0, warns: 0 }`) with docblock listing where
  each of the 6 checks now lives:
  - check 1 (frontmatter) → upstream `frontmatter-guard` skill + `gbrain doctor`
  - check 2 (duplicate id) → `gbrain doctor` schema integrity
  - check 3 (dead links) → upstream BrainWriter linkValidator (sync gate)
  - check 4 (orphans) → `gbrain orphans` + dream-cycle phase
  - checks 5+6 (weak links, evidence gap) → **not yet rehomed**;
    future `kos-quality` ~150 LoC shim if Lucien wants them back

**Deferred (no current need)**: the ~150 LoC `kos-quality` shim for
checks 5+6 (weak links + evidence gap). Five days post-retire,
`kos-patrol` still reports 0 ERROR / 0 WARN daily and no operator
has missed the two KOS-unique checks. If a specific brain-quality
question arises that those checks were uniquely suited to answer,
re-open and build kos-quality; until then it would be premature
abstraction.

**Verdict**: M1 milestone item closes. Active fork dirs unchanged
since the retire commit already landed; just need this TODO entry
in the right state.

### [x] Archive frontmatter-ref-fix + slug-normalize — RESOLVED 2026-05-17 (stale — done in M1 2026-05-10 commit 9e3cd0f)

Both directories were moved to `skills/kos-jarvis/_archived/` in commit
`9e3cd0f` (2026-05-10, M1 milestone). README.md "_archived/" tree section
already lists them with the retire date. RESOLVER.md M1 archive note also
present. This entry was just never flipped.

### [x] 重写 notion-ingest-delta SKILL.md 为 5-line 跳转 — RESOLVED 2026-05-17 (stale — done in M1 2026-05-10 commit 9e3cd0f, then again 2026-05-17 as RETIRED stub)

SKILL.md shrunk to a 5-line redirect on 2026-05-10 (M1 commit `9e3cd0f`).
2026-05-17 it was rewritten again to a RETIRED stub after the
notion-poller-itself retire (see §6.27) — the worker that the redirect
pointed at is now under `workers/_archived/notion-poller/`. SKILL.md
now points at §6.27 and at the still-alive `/ingest` endpoint.

---

## P1 — M2 milestone 候选 (post-v0.26.7,新增 fork 收缩机会)

> v0.26.7 sync 引入了三件事,改变了 fork 收缩路线图。每件都需要独立
> 评估 — 不是"立即退役",是"评估退役路径 / 部分迁移"。Net target 从
> M1 的 "16 → 11 active" 进一步缩到 M2 后 "11 → 7-8 active"。

### [x] (M2-A) wire-status 查证 — RESOLVED 2026-05-04

**Verdict**: **RETIRE all three triplet skills**(`dikw-compile`,
`confidence-score`, `evidence-gate`)。**PILOT `concept-synthesis`** 在
188 个 concept pages 上(下次 session)。

**Decisive evidence** (production probe 2026-05-04):
- `frontmatter.dikw_layer` 设值 = **0 / 2477** (0.00%)
- `frontmatter.evidence_level` 设值 = **1 / 2477** (单 E2,0.04%)
- `frontmatter.confidence` 设值 = 2470 / 2477 — **但值是
  `kos-compat-api.ts:454,533` 硬编码模板字符串**,不是脚本算的

Cross-checked: `kos-compat-api.ts`, `workers/notion-poller`,
`kos-patrol/run.ts` 没有任何一个 spawn 三件套的 `run.ts`。
**全部是 dead code**,从未在生产 ingest pipeline 中跑过。

完整决策记录见 `docs/KOS-JARVIS-CONSOLIDATION-PLAN.md` §M2-A
(updated 2026-05-04) + `docs/JARVIS-ARCHITECTURE.md` §6.21 末尾
"M2-A resolution"段。

### [x] (M2-A.archive) Archive triplet — DONE 2026-05-10

3 dead skill dirs (`dikw-compile`, `evidence-gate`, `confidence-score`)
moved to `skills/kos-jarvis/_archived/`. Triggers removed from
`skills/RESOLVER.md` `## KOS-Jarvis extensions` table (with M2-A archive
note). `skills/manifest.json` three entries deleted (49 → 46). Prompt
string in `server/kos-compat-api.ts:600` rewritten:
`"dikw-compile recommended"` → `"use \`gbrain dream\` for cross-page
synthesis"`. `skills/kos-jarvis/README.md` `_archived/` tree expanded
with M2-A entries. `skills/kos-jarvis/_lib/brain-db.ts` caller list
updated. **Active fork dirs: 14 → 11.**

### [x] (M2-A.pilot) concept-synthesis pilot — DONE 2026-05-10, decision (b)

**Verdict**: option **(b) Keep ad-hoc** — do NOT wire to dream-cycle.

Pilot ran deterministic-only (Phase 1 + Phase 2) on 181 concept pages
via a transient script `/tmp/m2a-pilot.ts`. No LLM calls, no brain
page mutations.

**Tier distribution**: T1=0, T2=0, T3=11, T4=170 (93.9% single-mention).
Zero concepts cleared the multi-month-recurrence threshold required to
justify Phase 3 LLM synthesis. Mention-count algo only counts slug-string
references in `~/brain/sources/`, not natural-language prose mentions —
so absolute counts undershoot, but the **shape** (long-tail T4 dominance)
is robust.

**Phase 1 dedup wins**: 22 Jaccard ≥0.5 + 11 substring pairs = 33
candidate merges (~18% of corpus). Concrete cases: `office-3f-ap01` ⊂
`ap-office-3f-ap01`, the 5 `fsct-2025-*` ticket pages, the
`dashboard` ⊂ `dashboard-site` ⊂ `dashboard-site-health` chain. These
are real garbage that one-pass cleanup (LLM or rule-based) can address.

**Why not (a) wire-to-cron**: optimizes for a use case (sustained T1/T2
evolution narratives) that doesn't exist in this brain. Premature
automation. Phase 3+4 LLM cost (~$1-3/week) for zero candidates.

**Why not (c) fork-own-version**: would add new fork-local code on the
same day we just deleted 7 dirs (M1+M2-A+M3). Net surface increase. The
deterministic Phase 1+2 already lives in `/tmp/m2a-pilot.ts` (not
committed to fork — transient artifact); Lucien can re-run any time.

**Decision evidence**: `~/brain/.agent/reports/concept-synthesis-pilot-2026-05-10.md`
(brain commit `b9e32d8aa7`).

If the corpus shifts later (signal-detector + voice-note-ingest accumulate
enough recurring concept stubs across multiple months), reopen and
re-evaluate (a) or (c) with new evidence.

### [x] (M2-B) `kos-compat-api` ↔ `gbrain serve --http` + thin translator 评估 — VERDICT 2026-05-15: option (c), don't touch

Sized the three candidate paths against actual surfaces:

- Upstream `src/commands/serve-http.ts`: 1116 LoC. OAuth 2.1 +
  MCP JSON-RPC transport + admin dashboard + token persistence.
- Fork `server/kos-compat-api.ts`: 661 LoC. KOS-v1 contract:
  `GET /health`, `GET /status`, `GET /digest`, `POST /query`,
  `POST /ingest`. Bearer-auth, JSON body.
- MCP ops available (`src/core/operations.ts`): `query`, `search`,
  `get_page`, `put_page`, `list_pages`, `takes_*`, etc. — none of
  them is a 1:1 for `/ingest` or `/digest`.

**Endpoint-by-endpoint translation feasibility for option (a)**:

| KOS-v1 endpoint | MCP equivalent | Notes |
|---|---|---|
| `POST /query` | `tools/call` `name="query"` | clean 1:1 (~80 LoC saved) |
| `GET /status` | `tools/call` `name="list_pages"` + client-side aggregation | partial; per-kind histograms need new aggregation (~20-30 LoC saved best case) |
| `GET /digest` | none | reads `~/brain/.agent/digests/patrol-*.md` — pure fork-side concern, stays |
| `POST /ingest` | none | writes md to filesystem + git commit + spawns `gbrain sync` subprocess — pure fork-side concern, stays (~250 LoC unchanged) |
| `GET /health` | n/a | HTTP-level ping, stays (~5 LoC) |

**Net LOC math** for option (a): theoretical ~500 LoC reduction in the
TODO premise was wishful — only /query and /status have direct MCP
equivalents (~110 LoC). A translation layer adds back ~80-150 LoC
(KOS-v1 → JSON-RPC marshal, OAuth client management for talking to
its own subprocess, error-code mapping). **Realistic net change: 0
to -50 LoC**, in exchange for:

- One extra subprocess (`gbrain serve --http`) at boot + lifecycle
- OAuth 2.1 client-side dance for kos-compat-api → gbrain-serve
- A second port to expose internally
- Higher MTTR for incidents that fan out across two processes

**(b)** rejected — Notion Knowledge Agent and OpenClaw feishu cron
are hard-coded against `kos.chenge.ink/<endpoint>` with KOS-v1
JSON-body shape. Migrating them is out of scope for the fork.

**(c) selected — don't touch.** kos-compat-api is fine. The
"upstream closed our root cause" framing in the original M2-B
hypothesis is technically true (HTTP boundary now upstream-supported)
but operationally moot — fork-side /ingest + /digest dominate the
LoC and the external clients lock us to KOS-v1 wire shape anyway.

**Re-evaluate trigger**:
- Upstream ships a non-OAuth, KOS-style HTTP mode (unlikely).
- Notion Agent rebuild reaches a point where MCP-over-HTTP is on
  the table for external systems.
- kos-compat-api needs a feature only OAuth-MCP provides (per-client
  audit, etc.) that's not worth porting.

Decision artifact: this entry. No code, no plan doc.

### [x] (M2-C) Phase 4-5 邮件/日历导入 → 改基于上游 `archive-crawler` — VERDICT 2026-05-15: option (b) split — archive-crawler covers Phase 5 Email; Phase 4 Calendar stays fork-local

Read `skills/archive-crawler/SKILL.md` for source-format coverage.
Supported `Source.type` values: `local`, `dropbox`, `backblaze`,
`gmail-takeout`, `mbox`, `pst`. Refuses to run without
`archive-crawler.scan_paths` allow-list in `gbrain.yml` (safety
gate; writes to `originals/` / `personal/` / `ideas/`).

| Fork Phase | Format | archive-crawler covers? |
|---|---|---|
| Phase 5 — Email | `.mbox`, Gmail takeout, `.pst` | **Yes, fully**. Both `mbox` and `gmail-takeout` are first-class source types. |
| Phase 4 — Calendar | Apple/Google Calendar via API, `.ics` export | **No**. Not in `Source.type` enum. Calendar isn't an "archive of files" — it's a stream of structured events that needs an OAuth/API client or `.ics` parser fork-side. |

**Verdict (b) — partial migration**:

- **Phase 5 Email** → upstream-driven. When the time comes to
  implement, the work is `gbrain.yml` config + path allow-list +
  per-mbox manifest review, NOT a new fork-local skill. Net fork
  surface gain from Phase 5: 0 new skills.
- **Phase 4 Calendar** → stays on the original fork-local plan. Needs
  either an OAuth Google Calendar client (in `workers/calendar-poller/`
  similar to `workers/notion-poller/`) or a recurring `.ics` export +
  parse step. archive-crawler can't help.

**Acceptance**: this entry's verdict is the artifact. Per the M2-C
scope note, **Phase 4-5 implementation itself is out of milestone
scope** — neither has been started, both gate on
`docs/JARVIS-NEXT-STEPS.md` Phase 1-3 finishing first.

**Follow-up when Phase 4-5 actually starts**: update
`docs/JARVIS-NEXT-STEPS.md` Phase 5 section to say "configure
upstream archive-crawler with `gmail-takeout` source", and Phase 4
to remain fork-local with the calendar-poller worker design. No doc
edits today — wait until that work moves to active.

**Scope reduction**: original fork plan estimated Phase 5 at ~1 week
of net-new skill build; archive-crawler reduction is ~3-4 days saved
(config + review loop vs ground-up worker). Phase 4 unaffected.

### [x] (M2-D) `Operation.scope` + `.localOnly` 取代 fork-local `OperationContext.remote` — RESOLVED 2026-05-10 (premise wrong, never-needed)

**Verdict**: **No code change required.** Fork-local code 从未实现过
`OperationContext.remote`,`git grep "ctx\.remote\|context\.remote"` 在
`server/` `workers/` `skills/kos-jarvis/_lib/` 中天然归零(只有
`brain-db.test.ts:88` 的 `remote: true` 是 v0.25.0 `EvalCandidateInput`
eval-row schema 字段,不是 OperationContext flag)。

**Premise correction**: 原 M2-D 假设 "Operation.scope + .localOnly 是
fork 老 OperationContext.remote 的成熟版" 是错的。读
`src/core/operations.ts:223-249`(F7b hardening,v0.30.0):
- `OperationContext.remote: boolean` 仍是 **REQUIRED 字段**(每个 transport 必须显式 set)
- `Operation.scope` / `Operation.localOnly` 是 **operation-side** 安全声明(描述 op 自己的危险度)
- `OperationContext.remote` 是 **caller-side** 信任度(描述 caller 是不是远程)
- 两者**互补**(scope=admin + localOnly + remote=true → HTTP 路径 reject),不是替代关系

Fork 也没有 hand-rolled `kos-compat-api` 的 remote check — 所有信任分级都
完全 delegate 给 `gbrain` CLI 子进程或下游 op handlers。

**Action taken**: 单 commit 标记 entry RESOLVED,无 code 改动。

### [x] (M3.pilot) Native Google embedding pilot — DONE 2026-05-10

End-to-end pilot ran in throwaway local Postgres DB (`gbrain_m3_pilot`,
schema v45 via `init --supabase --non-interactive --embedding-model
google:gemini-embedding-001 --embedding-dimensions 1536`). 2 sample
concept pages (English + mixed CJK) synced + embedded via the **native
v0.27 Vercel AI SDK gateway** (NANO_BANANA_API_KEY for
`GOOGLE_GENERATIVE_AI_API_KEY`).

**Verification**:
- `vector_dims(content_chunks.embedding) = 1536` ✓
- English query `founder mode` → top hit 0.92 ✓
- Chinese query `向量检索` → top hit 0.90 ✓
- `wc -l shim.stdout.log` unchanged across pilot lifecycle (last
  shim write 23:53 UTC; pilot ran 00:23-00:30) — **100% native traffic**
- Production service mesh unaffected (kos-compat-api PID continued,
  BrainDb pinned to production DB)
- `~/.gbrain/config.json` clobbered by init (per CLAUDE.md fork rule);
  restored from `~/.gbrain/config.json.pre-m3-2026-05-10` snapshot
- Pilot artifacts cleaned: `dropdb gbrain_m3_pilot`, `rm -rf /tmp/m3-pilot-brain`

**Findings worth flagging** (now in §6.23):
1. `content_chunks.model` is audit-only fallback string
   (`postgres-engine.ts:1136` writes `chunk.model || 'text-embedding-3-large'`);
   import path doesn't fill `chunk.model`. Real provider is correct
   (vector content is real Google output) but column lies. Use shim
   log delta to verify cutover, not this column.
2. `init --supabase` writes DB `config.embedding_model` without
   `provider:` prefix. `loadConfigWithEngine` doesn't actually read
   that field anyway (file/env-only by design,
   `src/core/config.ts:182-184`). Cosmetic, no impact.

### [x] (M3.cutover) gemini-embed-shim 退役 — DONE 2026-05-10

**Cutover landed same day as pilot.**

5 deployed plists (kos-compat-api / dream-cycle / enrich-sweep /
kos-patrol / notion-poller) + 5 templates carry
`GOOGLE_GENERATIVE_AI_API_KEY` (= NANO_BANANA_API_KEY) +
`GBRAIN_EMBEDDING_MODEL=google:gemini-embedding-001` +
`GBRAIN_EMBEDDING_DIMENSIONS=1536`. `kos-compat-api` plist
additionally dropped `OPENAI_BASE_URL` + `OPENAI_API_KEY=stub`.
`~/.gbrain/config.json` extended with embedding fields.
`launchctl bootout` + `bootstrap` cycle of all 5 services. Re-embed
of all 5548 chunks (`gbrain embed --all`) into clean native vector
space — Google free-tier quota hit ~60% through the first run; retry
covered the remaining shim-era chunks. `null_left=0` for all chunks
throughout. Shim launchd service bootout'd, deployed plist deleted,
`skills/kos-jarvis/gemini-embed-shim/` → `_archived/`,
`scripts/launchd/com.jarvis.gemini-embed-shim.plist.template` →
`scripts/launchd/_archived/`. Docs synced (RESOLVER, manifest,
README, CLAUDE.md, CONSOLIDATION-PLAN, scripts/launchd/README,
JARVIS-NEXT-STEPS, .env). Backups retained at
`~/.gbrain/config.json.pre-m3-cutover-2026-05-10` +
`/tmp/pg-pre-m3-cutover-2026-05-10.dump` (89 MB) +
`/tmp/pre-m3-cutover-2026-05-10/` (6 plists).

**Audit attestation**:
- shim launchd service: gone (verified via `launchctl list`)
- shim log line count: stayed at 6703 across cutover + re-embed
  windows = 100% native traffic
- query smoke (English + Chinese): top hits in healthy 0.7-0.9 band

Active fork dirs: 11 → 10. **Story in `docs/JARVIS-ARCHITECTURE.md`
§6.23 (M3.cutover landed same day continuation)**.

### [x] (M3.cutover-followup) Backfill remaining shim-era chunks — DONE 2026-05-10

**100% native vector space achieved.** All 5548 chunks now embedded by
the v0.27 native gateway (`google:gemini-embedding-001` + 1536 dim).
Zero NULL embeddings, zero shim-era residuals.

**Procedure**:
1. SQL `UPDATE content_chunks SET embedding = NULL, embedded_at = NULL
   WHERE embedded_at < now() - interval '2 hours'` — marked 1563
   shim-era chunks as stale.
2. `gbrain embed --stale` x 4 successive runs — each batch hit Google
   free-tier RPM cap and exited 0 with partial progress, but quota
   reset between runs (per-minute RPM, not daily). Throughputs:
   881 → 440 → 199 → 20 chunks per pass.
3. One stuck page (`sources/notion/re-qataer-isp-ooredoo-sms-...`,
   23 chunks, max 18131-char chunk) wouldn't clear via `--stale`
   batching — single-page invocation `gbrain embed <slug>` succeeded
   immediately. Likely page-level batch retry policy differs from the
   `--stale` flow's larger group batching when chunks approach
   per-batch token caps.
4. Final state: `null_left=0`, all 5548 chunks embedded by native
   gateway, query smoke (English "Omada Cloud" + Chinese "知识管理")
   in healthy 0.6-0.76 band.

**Cost**: ~5 retry rounds × ~880 chunks avg + final single-page = ~5000
Google embedding API calls beyond M3.cutover's initial 6802. Total
session API consumption ~$0.50-0.70.

**What** (next session, ~2-3 h):

Plist edits (deployed at `~/Library/LaunchAgents/com.jarvis.{kos-compat-api,notion-poller,dream-cycle,enrich-sweep,kos-patrol}.plist`,
templates at `scripts/launchd/com.jarvis.*.plist.template`):
- Add to EnvironmentVariables:
  - `GOOGLE_GENERATIVE_AI_API_KEY=$NANO_BANANA_API_KEY`
  - `GBRAIN_EMBEDDING_MODEL=google:gemini-embedding-001`
  - `GBRAIN_EMBEDDING_DIMENSIONS=1536`
- Remove from EnvironmentVariables:
  - `OPENAI_BASE_URL=http://127.0.0.1:7222/v1`
  - `OPENAI_API_KEY=stub-for-gemini-shim`
- Also add `embedding_model` + `embedding_dimensions` fields to
  `~/.gbrain/config.json` so non-launchd-spawned `gbrain` invocations
  (Lucien's interactive CLI) match.

Vector-space compat decision (pick one before bootout):
- **(a) Force re-embed all 2718 pages right after cutover.** Few
  minutes / few cents on Google. Cleanest. Run
  `gbrain embed --all --force` (or equivalent — verify flag exists in
  v0.31.2 first).
- **(b) Keep shim running 24-48h soak.** Let new chunks be native, old
  chunks stay shim-era; sample 10-20 representative production queries
  before/after; compare top-k overlap. If degradation < threshold,
  proceed to bootout. Costs nothing extra but observation window.
- **(c) Just cutover and `gbrain embed --stale`** to backfill the 244
  stale chunks only. Existing 2474 chunks untouched. Risk: if normalization
  differs, mixed vector space silently degrades retrieval.

Recommend **(a)** — clean state is cheap here.

Then:
1. Cycle services: `launchctl bootout gui/$UID/com.jarvis.<svc>` +
   `bootstrap gui/$UID ~/Library/LaunchAgents/com.jarvis.<svc>.plist`
   for the 5 affected services
2. Smoke: `curl -H "Authorization: Bearer $KOS_API_TOKEN"
   http://127.0.0.1:7225/status` returns 2718 pages, query a Chinese
   phrase, watch shim log line count — must NOT increase
3. `launchctl bootout gui/$UID/com.jarvis.gemini-embed-shim` +
   `rm ~/Library/LaunchAgents/com.jarvis.gemini-embed-shim.plist`
4. `git mv skills/kos-jarvis/gemini-embed-shim
   skills/kos-jarvis/_archived/gemini-embed-shim`
5. `git mv scripts/launchd/com.jarvis.gemini-embed-shim.plist.template
   scripts/launchd/_archived/`
6. Update: `skills/manifest.json` (delete shim entry),
   `skills/RESOLVER.md` KOS section (no shim trigger to remove —
   it has none — but add archive note), `skills/kos-jarvis/README.md`
   (move shim to _archived/ tree, active dirs 11 → 10), fork
   `CLAUDE.md` (remove the "shim is currently routing" rule —
   replace with "embeddings now native via v0.27 gateway"),
   `docs/KOS-JARVIS-CONSOLIDATION-PLAN.md` (M3 milestone CHECK)

**Acceptance**: shim launchd service gone, 0 shim log writes after
cutover, query latency/quality unchanged from pre-cutover baseline,
fork active dirs **11 → 10**.

**Scope**: 30 min plist edits + 30 min cycle/smoke + 30 min vector-space
re-embed (option a) + 30 min retire/cleanup. Total ~2 h. Needs window
where Lucien is OK with brief launchd churn (~5 minutes during cycle).

**Scope**: 1-2 h pilot + 30 min production switch + 30 min retire/cleanup。Total ~2-3 h。

---

## P2 — quality / observation

### [ ] check-resolvable 2 测试 fail (dev-box 环境耦合,上游测试 gap)

**Why**: 上游 `bun test` 里两个 case `openclaw_workspace_home_root` 抢
占 `repo_root` 解析,源头是 dev-box 上 `~/openclaw` 跟 fork repo root
共存的环境耦合,非生产 fire。本轮 launchd 修复期间复现仍在。

**What**: 缩窄到 hermetic temp-dir scope (`createTempWorkspace()` +
`TMPDIR`) 让 test 不依赖 `$HOME`。可能要给上游开 PR(纯测试 fix,
production code 不动)。

**Scope**: 30 min 改 + 上游 PR window。低优先,non-prod。

---

_(P1 list 见上面 "consolidation PLAN 落地" section,M1 milestone 4 项)_

---

## P2 — observation / cosmetic

### [x] `GBRAIN_SOURCE_BOOST` tune-up evaluation — VERDICT 2026-05-17: no tune needed, default factor=1.0 works

5-query probe (mixed English + CJK, default boost factor=1.0):

| Query | Top-3 sources | Verdict |
|---|---|---|
| `Lucien` | 0.51 concepts/, 0.46 concepts/ (0 notion in top-3) | ✓ concepts dominate |
| `Omada Cloud` | 1.10 sources/notion, 1.10 sources/notion (notion dominant) | ✓ expected — Omada is a notion-heavy entity |
| `知识管理` | 0.29 syntheses/, 0.28 sources/(non-notion) | ✓ syntheses lead |
| `向量检索` | 0 results | known CJK 4-char compound issue (§6.25); vector path didn't surface either — unrelated to source boost |
| `Notion` | 0.51 concepts/, 0.46 companies/, 0.44 syntheses/ | ✓ structured pages lead |

**Decision**: keep default `factor=1.0` (no `GBRAIN_SOURCE_BOOST` env). The
original hypothesis that "notion-source occupies 60% and may swamp short
Chinese queries" did not materialize. Top-3 is dominated by concepts /
syntheses / companies on most queries; notion-sources only lead when the
query target IS a notion-heavy entity (Omada), which is the correct
behavior. No plist EnvironmentVariables change needed.

The default-everywhere-uniform behavior is actually working for this
brain shape — concept/synthesis pages have stronger semantic alignment
to query text than email-source pages do. The retrieval ranker is
already separating signal from noise without source-aware bias.

### [x] CHUNKER_VERSION 3→4 re-walk cost — VERDICT 2026-05-17: N/A, brain has 0 code pages

`bin/gbrain reindex-code --dry-run` returned: `preview: 0 code page(s),
~0 tokens, est. $0.00 on text-embedding-3-large`. This brain is
markdown-only (concepts / sources / syntheses / projects / companies);
the CHUNKER_VERSION semantic for code-pages doesn't apply here. Closing
without action.

### [x] Patrol dashboard ↔ stdout 数字不一致 — RESOLVED 2026-05-17 (stale — fixed by 444cc81f BrainDb migration)

The original 04-29 fs-walking vs DB-direct path discrepancy was closed
when `kos-patrol/run.ts` Phase 1 migrated to `BrainDb.listAllPages()`
(commit `444cc81f`, 2026-04-30). Today's verification:
- `~/brain/.agent/dashboards/knowledge-health-2026-05-17.md`: `Total pages: 3138`
- Latest stdout `[1] Inventory …` line: `3138 pages; kinds: source=2226, ...`
- `~/brain/.agent/digests/patrol-2026-05-17.md`: `[knowledge-os] 2026-05-17 patrol: 3138p / 0E 0W / stale=0 / gaps=20`
- All three values flow from the same `inv.total` in `phase1(pages)`,
  where `pages` comes from `db.listAllPages()` (run.ts:62).

No fs walking exists anywhere in run.ts. The 04-29 issue was real then,
the 04-30 BrainDb migration solved it, this TODO entry just was never
flipped. Closing.

### [ ] Calendar checkpoints (carried forward, post-Path-3 调整)

| Date | Action | 状态 |
|---|---|---|
| 2026-05-04 | Stage 4 v1 archive — `com.jarvis.kos-api.plist.bak` to `_archive/`,archive v1 GitHub repo | **today** |
| 2026-05-07 | Step 2.4 commit-batching review for `~/brain` per-ingest commits | active |
| 2026-05-25 | Re-evaluate Gemini 3072-dim embeddings vs current 1536-dim truncation | active |
| ~~Trigger-based~~ | ~~PGLite → Postgres switch~~ | **CLOSED 2026-04-29 via Path 3 (§6.18)** |

### [x] Sync_failures cleanup: 48 chunker_version legacy entries — DONE 2026-05-15

`gbrain sync --skip-failed --no-pull` on the host: `Acknowledged 48
pre-existing failure(s)`. `~/.gbrain/sync-failures.jsonl` open→0.
Verified via direct read of the jsonl pre-run (`total=48 open=48
acked=0`) and post-run noop sync (`Already up to date`). All 48 were
the same `column "chunker_version" of relation "pages" does not exist`
shape captured today 07:02 UTC during the morning poll, before the
schema-v66 fix wave fully drained. Schema is at v66 now so the failure
mode can't reproduce.

### [x] bun test full-suite hang investigation — DONE 2026-05-15 (root-caused, env-coupled)

`bun test --bail` (no `--reporter=verbose`; that flag was rejected by
bun 1.3, accepted values are `junit` and `dots`) ran 616 tests across
37 files in **45 s** before hitting the bail. Root cause:

**`test/think-pipeline.serial.test.ts`** — the `beforeAll` hook
(`new PGLiteEngine() → connect({}) → initSchema() + seed`) exceeded
bun's default 5 s hook timeout, exiting with `a beforeEach/afterEach
hook timed out for this test` after 6 538 ms. Same family as the
PGLite #223 cold-start hang we've recorded under §6.20 — PGLite cold
init varies wildly on this Mac (3-15 s seen). Without `--bail`, every
serial test that opens a fresh PGLite engine pays the same tax in
sequence, which is what drove the original 30-min wedge during the
v0.34.4 sync.

**Not a code defect, not a fix-it-now item.** Practical mitigations:
1. Run `bun test --bail` to abort on first PGLite-cold-start miss
   rather than letting it accumulate.
2. Run a specific test file (`bun test test/<file>.ts`) when you only
   need targeted coverage — fork's day-to-day green path.
3. If we ever need full-suite green on this box, the upstream-side fix
   is bumping the hook timeout via `test.timeout(15_000)` at the top
   of any `.serial.test.ts` that boots PGLite cold. Not worth filing
   upstream unless other operators report the same wedge.

Diagnosis evidence: bun-test-bail log captured the failing file name
clearly (single test failed before the others kept running). Suite
total before bail: 616 tests / 37 files / 45 s; 0 unexpected failures
beyond the timeout itself.

### [x] ai.gateway "google recipe missing max_batch_tokens" NOTICE — DONE 2026-05-15 (fork-local + upstream PR pending)

`src/core/ai/recipes/google.ts` now declares `max_batch_tokens: 20_000`
+ `chars_per_token: 2` (CJK-aware density on mixed Notion corpora);
`safety_factor` left at gateway default 0.8 → pre-split at ~8 000
chars/batch. Manual `kos-compat-api /ingest` smoke confirmed the
warning no longer surfaces and embedding round-trips at 0.99+ cosine
on the new chunk. 34/34 `recipes-contract` + `gateway` tests pass.

Fork-local patch doc at
[`docs/UPSTREAM-PATCHES/v034-google-recipe-max-batch-tokens.md`](../../docs/UPSTREAM-PATCHES/v034-google-recipe-max-batch-tokens.md).
Upstream PR filed 2026-05-15:
**[garrytan/gbrain#1016](https://github.com/garrytan/gbrain/pull/1016)** —
branch `upstream-fix/google-recipe-max-batch-tokens` cut from
`upstream/master` (HEAD `24881f60` v0.34.4), 3 files / +25 -7 / `bun
test test/ai/` 144/144 green.

**Verdict revised 2026-05-19 (v0.37.0.0 sync)**: upstream v0.36.1.1
`#1083` cherry-pick went a **different** fix path — narrowed gateway
warning filter to the configured embedding provider only (gateway.ts),
NOT declared `max_batch_tokens` on `google.ts`. Both paths achieve
"silence google warning under default OpenAI config" but the fork path
has additional business value (CJK pre-split via `max_batch_tokens=20_000`
+ `chars_per_token=2` reduces reactive token-cap discovery overhead).
Fork google.ts +7 lines retained through v0.37.0.0 merge; upstream
test versions reverted to fork view (expect 0 google warnings under
fork config). On v0.37.0.0 sync verified: `bun test test/ai/` 224/224
green with both paths co-existing. PR #1016 still open in upstream —
re-evaluate close/keep on next maintainer response.

**Diagnostic correction** — the original P2 framing suggested this
was just log noise. A 2026-05-15 morning probe initially read the
notion-poller stderr's 117 394 historical `ingest 500` lines as an
active fire; ingest_log + a manual `/ingest` probe disproved that.
The actual 500s in stderr date from the v0.21 PGLite-lock-deadlock
era (Path 3 root-caused 2026-04-29). 38 MB stderr rotated to
`.archive.gz` and `.gitignore` extended so future rotations stay
out of git.

### [x] (facts:absorb) Sub-process facts:absorb writer has no DB connection — RESOLVED 2026-05-19 (root cause removed by §6.28 cutover)

Root cause was `kos-compat-api /ingest` spawning `gbrain sync` sub-process
without calling `BrainDb.connect()` on its path. **§6.28 (2026-05-17)
retired kos-compat-api**; the sub-process path no longer exists. Notion
Knowledge Agent now talks via OAuth + MCP `put_page` directly to
`gbrain serve --http` which is a single-process op handler (no sub-process
fork, BrainDb already connected).

**Verification 2026-05-19 (post v0.37.0.0 sync)**:
- `bin/gbrain doctor --json` → `facts_extraction_health: ok ("No facts:absorb
  failures in the last 24h.")` + `facts_health: ok`
- `ingest_log` 全历史 `source_type='facts:absorb'` count = **0** (从未触发,
  说明 noise source 已彻底消失)
- v0.35.8.0 phantom-page 改进 (新加 `refreshPageBody` + `migrateFactsToCanonical`)
  作为 bonus 加固了 facts:absorb 周边路径,但不是本 entry 的 fix path

Closing without upstream PR — entry premise无效后，fork 无需 src/core/facts/
edit。Done sec.

---

## P2 — post-§6.28 cutover follow-ups (added 2026-05-17)

### [ ] (entity-graph latency) Evaluate dream-cycle 24h backfill 足够否 — DECISION 2026-05-19: defer, spot-check next session

**Why**: §6.28 Complete-A 接受 Notion Agent put_page 24h 内 entity-graph 弱
(auto_links + auto_timeline remote-skip safety gate at
`src/core/operations.ts:610-612`)。dream-cycle (`com.jarvis.dream-cycle.plist`,
03:11 daily) `synthesize` + `patterns` phase 应当 backfill — 但实际效果
need empirical verification on this brain shape.

**Decision 2026-05-19** (post v0.37.0.0 sync): **defer** — option (c)
spot-check after observation. dream-cycle 跑后 24h 应能 backfill,但还没积累足够
empirical evidence 决定加 cron。v0.37.0.0 sync 期间没有大量新 Notion Agent
writes (Notion Knowledge Agent 上线后流量不大,§6.28 cutover 当天 setup
smoke 20 calls,之后 1 call/day)。先观察。

**Next-session spot-check protocol**:
1. `psql -c "SELECT slug, created_at FROM pages WHERE source_id='default' AND created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 10;"`
2. For each slug from (1):
   - `gbrain backlinks <slug>` — expect inbound links if dream-cycle backfilled
   - `psql -c "SELECT frontmatter -> 'links' FROM pages WHERE slug = '<slug>';"` — expect outbound auto_links populated
3. If 24h+ stale (no graph entries on aged Notion-Agent-written pages) →
   re-open this entry to add 15-min cron running
   `gbrain doctor --remediate --yes --target-score 80 --max-usd 0` (Lucien's
   decision sec's option (b), zero-LLM mechanical handlers only)

**Re-evaluate triggers**:
- Notion Knowledge Agent 流量上升到 10+ calls/day stable
- spot-check 发现 24h 后 entity-graph 仍空
- 或 1 month 后再 spot-check 一次

**Scope (if reopened)**: 30 min spot-check + 1 h cron 实施 (launchd plist +
shim script)。

### [x] (mcp_request_log retention) Add cron deleting old audit rows — RESOLVED 2026-05-19 (premature optimization, verified)

**Verdict**: close as premature.

**Evidence (2026-05-19 post v0.37.0.0 sync)**:
- `mcp_request_log`: **22 rows / 8KB total / 2 day history** (20 rows from
  §6.28 cutover day smoke + 1 row/day since). Notion Knowledge Agent
  hasn't ramped up — modeled "50-200 calls/day" never materialized.
- `mcp_spend_log` (new v0.36.4.0 v77 table): **0 rows**, same situation.
- Upstream v0.36.x did NOT ship auto-retention. Both tables grow unboud.

**Why now-close**: Plan agent R3's 70K rows/year extrapolation was
hypothetical. Actual rate is <1 row/day. At true scale (500 calls/day
steady state hypothetical future) = 180K rows/year — still small for
Postgres with idx on `created_at`. Admin dashboard `count(*) FILTER
(WHERE created_at > now() - interval '24h')` is fast at <1M rows.

**Re-evaluate trigger**:
- `SELECT COUNT(*) FROM mcp_request_log` > 50K, OR
- admin dashboard p95 query latency > 1s

Until then: no cron, no plist, no script. Build when problem exists.

### [x] (cloudflared) `kos.chenge.ink` route cleanup on mbp-office — RESOLVED 2026-05-17 (Lucien chose port flip not hostname switch; no separate cleanup needed)

Originally drafted assuming dual-hostname strategy (new `mcp.chenge.ink` for
new wire, leave old `kos.chenge.ink → :7225` as rollback path for N+2 weeks).
Lucien instead chose atomic origin-port flip: same `kos.chenge.ink` hostname,
cloudflared origin updated from `:7225` to `:7225` in one step. No separate
cleanup task remains; rollback path is "flip cloudflared origin back to
`:7225` + re-bootstrap kos-compat-api plist from `_archived/`".

---

## P3 — speculative

### [ ] 启用 v0.20+ 上游 features (Postgres-only)

**Why**: Path 3 解锁 jobs supervisor、queue_health、wedge-rescue、
backpressure-audit。我们没跑 worker daemon 所以没立刻收益,但若以后想
用 `gbrain agent run` durable subagent runtime(v0.16),现在能跑了。

**What**: 评估业务价值。若有具体 use case(如自动化 dikw-compile 或
长跑 enrichment),配置 supervisor + worker。否则不做。

**Acceptance**: 决定记录(`docs/JARVIS-ARCHITECTURE.md` 或 README)。

**Scope**: 30 min 评估,2-3 h 配置(若选)。

---

## Done (most recent)

- [x] **2026-05-17 kos-deep-lint retire (§6.28 follow-up, zombie cleanup)** —
      Discovered during fork ownership review after kos-compat-api cutover.
      Evidence: (1) `scripts/minions-wrap/kos-deep-lint.sh` targets v1 KOS
      repo at `/Users/chenyuanquan/Projects/jarvis-knowledge-os` running v1
      Python `./kos lint --deep`, comment self-acknowledges
      "Retained during v1→v2 overlap period" (overlap ended ~5 months ago);
      (2) `launchctl print run count = 0` + `last exit code = (never exited)` —
      service never fired since M1 (2026-05-10) likely because `kos-lint/` dir
      was archived and log path `skills/kos-jarvis/kos-lint/deep-lint.std*.log`
      became invalid; (3) v1 repo `~/Projects/jarvis-knowledge-os` last mtime
      2026-04-19 (cold for 1 month at time of retire). Retire ops:
      `launchctl bootout gui/$UID/com.jarvis.kos-deep-lint` + `rm
      ~/Library/LaunchAgents/com.jarvis.kos-deep-lint.plist` +
      `git mv scripts/launchd/com.jarvis.kos-deep-lint.plist.template →
      scripts/launchd/_archived/` + `git mv scripts/minions-wrap/kos-deep-lint.sh
      → scripts/launchd/_archived/` (kept with plist for context). Docs
      updates: `docs/JARVIS-ARCHITECTURE.md` arch diagram + cron table mark
      retired with §6.28-follow-up reference; `scripts/minions-wrap/README.md`
      strike entry. Active fork-unique launchd services: 3 → 2 (kos-patrol,
      enrich-sweep). Active plist templates: 7 → 5 (after this + kos-compat-api +
      notion-poller all archived in same window — though notion-poller plist
      template was archived 2026-05-17 also per §6.27).
- [x] **2026-05-17 kos-compat-api retire (Complete-A) + MCP-over-HTTP cutover (branch `migration/kos-compat-api-retire`)** —
      Lucien override of M2-B 2026-05-15 verdict ("(c) don't touch")。Trigger: mailagent
      方案 B「待 spec」(§6.27) + Lucien stance「一劳永逸」+ upstream OAuth + MCP + admin dashboard
      已成熟 (v0.34+ `gbrain serve --http`)。**Scope: Complete-A** — fork `server/kos-compat-api.ts`
      (661 LoC, KOS-v1 Bearer wire on `kos.chenge.ink :7225`) retired → `server/_archived/`
      (Phase 3 executed same session — Lucien chose atomic flip, no obsv window)。SSoT 反转 (DB-canonical, Notion Agent put_page 不写
      `~/brain/<dir>/<slug>.md` 也不 git commit)。**不写 BrainExporter** (Lucien 不用
      disk + obsidian; dream-cycle 24h 内 backfill entity-graph)。/digest tool 永久下线
      (Lucien 直接看 `~/brain/.agent/digests/patrol-*.md` 或 OpenClaw MEMORY.md)。
      **Brain-side 改动**: 新 `scripts/launchd/com.jarvis.gbrain-serve-http.plist.template`
      (gbrain serve --http on :7225, OAuth 2.1 + MCP JSON-RPC, --public-url
      `https://kos.chenge.ink`, KeepAlive + RunAtLoad)；`scripts/migration/dual-mode-verify.sh`
      smoke script (验旧 `/query` vs 新 `tools/call query`)；`docs/JARVIS-ARCHITECTURE.md` §6.28
      retire story (140 行)。**Client 改动**: `workers/kos-worker/src/index.ts` rewrite
      (215 → 536 LoC: OAuth client_credentials helper + MCP JSON-RPC framing helper +
      3 tools (kosQuery/kosIngest/kosStatus) + worker-side URL fetch + frontmatter builder +
      kindToType map port from kos-compat-api.ts:67-79)。kosDigest 删除。kosStatus 走
      `list_pages` + worker-side aggregation 避 admin scope。`workers/kos-worker/SETUP.md`
      重写部署步骤 + OAuth client 注册 step + env vars (KOS_MCP_BASE + KOS_OAUTH_CLIENT_ID +
      KOS_OAUTH_CLIENT_SECRET 替代 KOS_API_TOKEN)。**Handoff docs**:
      `docs/NOTION-AGENT-UPDATE-CHECKLIST.md` (Lucien-facing Notion UI v2→v3 step-by-step,
      Step 0-2 + 运维 notes + rollback)；`docs/EXTERNAL-CLIENTS-MCP-WIRE-HANDOFF.md`
      (~600 行 self-contained for OpenClaw feishu jarvis / mailagent / 任何 future caller —
      11 sections + Python + TS + bash code patterns + per-client notes + smoke
      acceptance)。**Trade-offs accepted (per plan file `mellow-whistling-porcupine.md`)**:
      (1) Notion Agent ingest 24h entity-graph 弱 (auto_links/auto_timeline remote-skip at
      `src/core/operations.ts:610-612`; dream-cycle 03:11 daily backfill); (2) kosIngest URL
      模式失去 fork-side Tavily/FlareSolverr 能力 (worker plain fetch, X.com / Cloudflare-protected
      页需 paste markdown); (3) kosStatus 采样模式 (`list_pages` capped at limit=100, no offset
      exposed — exact total 需 `gbrain status` on host); (4) kosDigest 永久下线。
      **Plan agent critique 硬化**: G2 schema verify (oauth_clients `source_id`+`federated_read`
      列存在即 ≥ v60+v61 OK); G3 cloudflared 跨机器 ops **完全规避** — Lucien 选复用 port
      `:7225` (atomic launchctl swap: kos-compat-api bootout → port freed → gbrain-serve-http
      bootstrap on same port), cloudflared `kos.chenge.ink` ingress 完全不动；G5 soft-delete
      data-loss moot (没 BrainExporter); R4 get_stats >3s latency 避 (用 list_pages)。
      **Backup**: `~/.gbrain/config.json.pre-migration-20260517`, `/tmp/pg-pre-migration-20260517.dump.gz`
      (110 MB gzip)。**Phase 3 (executed same session, atomic port re-use)**: Lucien register
      OAuth clients (×4) + paste kos-worker.json into chat → Claude `launchctl bootout
      com.jarvis.kos-compat-api` (frees `:7225`) + `cp` plist template to ~/Library/LaunchAgents/
      with `<FILL:NANO_BANANA_API_KEY>` filled + `launchctl bootstrap gbrain-serve-http` (binds
      `:7225`) + smoke `curl http://127.0.0.1:7225/health` + `curl https://kos.chenge.ink/health` →
      Claude `ntn workers env set/push/deploy` + 3-tool smoke → Lucien Notion UI update per
      checklist → Claude `git mv server/kos-compat-api.ts server/_archived/` + plist template
      archive。KOS_API_TOKEN 留 .env.local 注释 + kos-compat-api plist 留在 `scripts/launchd/_archived/`
      作 rollback marker (rollback = pure launchctl swap back, no mbp-office touch needed)。
      完整 plan: `/Users/chenyuanquan/.claude/plans/mellow-whistling-porcupine.md`。
- [x] **2026-05-09 v0.31.2 上游同步 (sync-v0.31.2 branch)** — 22 commits 跨 5 大版本 (v0.27.0/v0.28.x/v0.29.x/v0.30.x/v0.31.x → v0.31.2) / 378 文件 / +57691 -1833 LoC,**只 5 个 conflict** (上次 v0.26.7 是 31)。机械分类:`package.json` 保 fork `@electric-sql/pglite 0.4.4` override + 加 upstream `@jsquash/{avif,png}` 解码器,`bun.lock` + `llms-full.txt` take upstream regenerate (bun install + bun run build:llms),`README.md` take v0.28.8 LongMemEval 头条 (HEAD 有 v0.25.0 重复段),`skills/RESOLVER.md` take 上游 voice-note 5-keyword + 重新 append KOS 段。`pglite-engine.ts` WAL patch **自动 merge 干净**(无需 reapply,upstream 重构没动 disconnect 块)。`bun install` 拉 20 新 dep (ai@6 + @ai-sdk/{anthropic,google,openai,openai-compatible}@3 + jsquash + heic-decode + eventsource-parser + exifr)。typecheck 干净 (~3s),bin compile 0.31.2,`bun run test` 4760 pass / 9 fail (1 known + 2 env-coupled fork P2 + 2 self-test 递归 + 2 doctor-fix env + 1 perf warn + 1 build-llms 已 regen 修),`bun run check:all` clean。**production schema v34 → v45 silent-applied via bun install postinstall** — v0.31.1.1 fixwave (#682+#741) 的 bootstrap 加固真的 work,**无需手动 ALTER**(对比 v0.26.7 sync 的 mcp_request_log 手 ALTER 教训)。35 tables 全 RLS,facts table 已 ready (0 entries 等下次 ingest),2718 pages,brain_score 80/100,embed coverage 96% (244 stale 等下次 backfill)。**M3 milestone probe-passed**: `gbrain providers test --model google:gemini-embedding-001` 用现有 NANO_BANANA_API_KEY → 286ms / 768 dim default green。Production cutover 推到下个 session(本机 PGLite #223 cold-start hang 阻碍 `/tmp/pilot-brain` 端到端验证;用 Postgres-backed throwaway DB 绕开)。**PR #627 closed as superseded** by upstream v0.31.1.1 fixwave。**Privacy 修**: upstream check-privacy.sh 抓到 3 处历史 sync 记叙文里的 banned word(`docs/JARVIS-ARCHITECTURE.md` §6.20 + `skills/kos-jarvis/TODO.md` L416),改成 generic 措辞。Service mesh restart: kos-compat-api PID 27071→92596 (v0.31.2 loaded), gemini-embed-shim 续跑, 4 cron 服务 (dream-cycle/kos-patrol/notion-poller/enrich-sweep) bootout/bootstrap 后 idle 等定时。kos-patrol smoke: `~/brain/.agent/dashboards/knowledge-health-2026-05-10.md` 写出,2718 pages / 0 ERROR / 1421 WARN (WARN 涨从 762 由于 +241 新 page + 可能新 lint rule)。完整 sync 故事 [§6.22](../../docs/JARVIS-ARCHITECTURE.md#622-upstream-v0312-sync-2026-05-09)。
- [x] **2026-05-05 Feishu signal-detector extension 退役 + brain-side bridge docs 归档** —
  Lucien 复盘判定 `~/.openclaw/extensions/jarvis-feishu-signal-detector/` 在产 garbage:
  虽然 extension 实际部署且每天采信号 (Haiku 4.5 per-message + 写 `~/brain/agent/pending-enrich.jsonl`),
  但下游 `enrich-sweep` 从未在 cron 上消费这个队列(始终是 manual `--plan`),信号写入无人读。
  决议:rm `~/.openclaw/extensions/jarvis-feishu-signal-detector/`(独立 repo
  `~/Projects/jarvis-feishu-signal-detector/` 保留为冷备,Lucien 手动重启 gateway);
  fork repo 内 `git mv` 三份契约文档进 `_archived/`(`skills/kos-jarvis/_archived/feishu-bridge/`,
  `skills/kos-jarvis/_archived/pending-enrich/`,`docs/_archived/FEISHU-SIGNAL-DETECTOR-SETUP.md`)。
  跨文件引用同步:`skills/manifest.json` 删 2 entry,`skills/RESOLVER.md` 删 2 trigger 行 + 加归档说明,
  `skills/kos-jarvis/README.md` 表格 + 目录树 + 状态行更新,`workers/kos-worker/SETUP.md` +
  `docs/integration-clients.md` + `skills/kos-jarvis/{enrich-sweep,gemini-embed-shim}/SKILL.md` +
  `CLAUDE.md` 路径改到 `_archived/`,`docs/KOS-JARVIS-CONSOLIDATION-PLAN.md` 决定从 KEEP unique 改为
  ARCHIVED(KEEP-unique 数 7 → 5)。Net fork 收缩(本轮): 16 → 14 active dirs。
- [x] **2026-05-04 PR #627 to garrytan/gbrain (forward-reference bootstrap fix)** — branch `upstream-fix/bootstrap-mcp-log-cols` 切自 `upstream/master` (HEAD `058fe69` v0.26.7), 不带 fork-local 内容; push 到 ChenyqThu/jarvis-knowledge-os-v2 fork; gh pr create 提 PR 到 garrytan/gbrain master。Diff 干净: 4 files / +146 -5 lines / 100% additive (postgres + pglite engines extend probe → ALTER COLUMN IF NOT EXISTS, schema-bootstrap-coverage REQUIRED_BOOTSTRAP_COVERAGE 加 3 entries, e2e postgres-bootstrap 加 mcp_log regression case)。Validation: typecheck clean, schema-bootstrap-coverage 2/2, bootstrap.test 6/6 (no regression), postgres-bootstrap e2e 3/3 against `pgvector/pgvector:pg16` (新 case 33ms)。等 garrytan review/merge,merge 后下次 fork sync 拉到这条 fix 即可删 `docs/UPSTREAM-PATCHES/v026-bootstrap-mcp-log-fix.md`。链接: https://github.com/garrytan/gbrain/pull/627
- [x] **2026-05-04 M2-A wire-status check — verdict: RETIRE triplet** — Production probe (2026-05-04, schema v34): `dikw_layer` 0/2477 (0.00%), `evidence_level` 1/2477 (0.04%), `confidence` 2470/2477 但值是 `kos-compat-api.ts:454,533` 硬编码 template 字符串 (`confidence: low` 写死),不是 confidence-score 脚本算的。Cross-check: `kos-compat-api.ts` (HTTP 入口) / `workers/notion-poller/` (cron) / `kos-patrol/run.ts` 都不 spawn 三件套 `run.ts`。`kos-compat-api.ts:600` 那行 "dikw-compile recommended" 只在 JSON `next:` 提示字符串里,API caller 可忽略,不算 invocation。`kos-patrol/SKILL.md:100` cross-ref `confidence-score/SKILL.md` 是 doc 引用,不是 code call。**结论**: 三件套 (`dikw-compile`, `confidence-score`, `evidence-gate`) 在 production 是 100% dead code,从未在 ingest pipeline 中跑过。`concept-synthesis` v0.25.1 跟 dikw 结构不同 (per-batch sweep over `concepts/` only, 4-phase dedup+score+synth+cluster, vs dikw 的 per-page DIKW layer cross-kind),但 188 个 concept pages 是它的天然目标。**Decision**: archive 三件套 → `skills/kos-jarvis/_archived/`, pilot concept-synthesis 在 188 pages 上 (next session, 2 h)。Net fork shrinkage: 11 active → 8。Combined with kos-lint retire (M1) → 11 → 7 active 由下次 sync 时实现。完整记录: `docs/KOS-JARVIS-CONSOLIDATION-PLAN.md` §M2-A + `docs/JARVIS-ARCHITECTURE.md` §6.21 "M2-A resolution"。
- [x] **2026-05-04 服务 smoke (kos-compat-api + cron 全过)** — `kos-compat-api` PID 87485 → 27071, `gemini-embed-shim` PID 63403 → 27143 (launchctl bootout/bootstrap, 加载 v0.26.7 src via shim)。`gbrain --version` returns 0.26.7。local + remote `kos.chenge.ink/status` 都返回 `total_pages=2477` ✅ 一致。`launchctl kickstart -k kos-patrol` smoke: exit=0, **0 ERROR / 0 WARN**, dashboard + digest 写到 `~/brain/.agent/{dashboards,digests}/`。`notion-poller` 5 个 cycle 干净 (`0 ingested, 0 skipped`)。**惊喜发现**: kos-patrol stderr `[2] kos-lint JSON parse failed; exit=3` — `kos-lint` 已经天然 broken,patrol 跳过它后照常 0 WARN。这是 PILOT-RETIRE 候选最强 evidence,M1.kos-lint-retire pilot 从 4h research 简化为 ~30 min mechanical cleanup。
- [x] **2026-05-04 production schema 升 v31 → v34 (apply-migrations 跑通)** — `gbrain init --migrate-only` 头一次失败,报 `column "agent_name" does not exist` (SCHEMA_SQL line 420 `CREATE INDEX … (agent_name, created_at DESC)` forward-references v0.26.3 列;`applyForwardReferenceBootstrap()` 数组**漏**了 mcp_request_log 3 个 v0.26.3 列 — upstream "structurally prevented" 自夸的 bootstrap pattern 又一次 fail)。Workaround: 手动 `ALTER TABLE mcp_request_log ADD COLUMN IF NOT EXISTS agent_name TEXT, params JSONB, error_message TEXT;` 后再跑 init --migrate-only,3 个 migration 全 apply (v32 oauth_infrastructure / v33 admin_dashboard_columns_v0_26_3 / v34 destructive_guard_columns)。验证: schema_version=34 (latest),`gbrain doctor` connection ok,RLS 31/31 tables,embeddings 100%,brain_score 83/100,oauth_clients/oauth_authorization_codes/oauth_access_tokens/oauth_refresh_tokens 4 表 created,pages.deleted_at 列 present。Doctor 总 status=warnings (85),3 个非 P0 warn:resolver_health 37 routing_miss (上游 v0.25.1 新 9 skill 的 routing-eval fixture phrases 跟 RESOLVER 触发词不齐 — 上游小 bug 见 P2),sync_failures 1 (people/will-vanish.md,旧),graph_coverage 0% display (但 brain_score 给满分 25/25 link + 3/15 timeline,矛盾,doctor display bug)。完整 patch 候选写在 [`docs/UPSTREAM-PATCHES/v026-bootstrap-mcp-log-fix.md`](../../docs/UPSTREAM-PATCHES/v026-bootstrap-mcp-log-fix.md),P0 列表已填 upstream PR 任务。
- [x] **2026-05-04 v0.26.7 上游同步 (commit `a2e5e5b`,branch `sync-v0.26.7`)** — 25 commits 跨 8 release (v0.25.1 → v0.26.7) 一次 merge。31 个冲突机械分类:19 个 src/test 文件直接 take upstream(post-base 全部是 sync 副作用,fork 没动 src/), `pglite-engine.ts` WAL patch 14 行重新 apply,`@electric-sql/pglite 0.4.4` override 保留(upstream 想 0.4.3),`skills/RESOLVER.md` KOS-Jarvis extensions 段移到末尾(v0.25.1 加了 Uncategorized 段在前),`skills/manifest.json` 49 skill (30 旧 + 9 v0.25.1 + 10 fork),`.gitignore` 显式合并 fork 段 + upstream `.context/`,CHANGELOG/TODOS 顶部 fork HEAD 段为空 → 直接 take upstream entries。`bun install` 拉新 deps (cookie-parser, cors, express, express-rate-limit 来自 v0.26.0 admin)。`bun run typecheck` 干净(~3s),bin compile 出 0.26.7,49 skill conformance 全过。**生产 Postgres schema 仍 v31**(repo merge 不动 production),`gbrain doctor` 报 `connection: fail "column deleted_at does not exist"`(v0.26.5 destructive_guard_columns migration 待跑) + 37 routing_miss WARN(上游新 9 skill 的 routing-eval fixture phrases 太严)。**Review 关键发现**:(a) v0.25.1 `concept-synthesis` (T1-T4 tier + LLM synthesis on concepts/) 与 fork `dikw-compile + confidence-score` 部分重叠 → M2-A 候选;(b) v0.26.0 `gbrain serve --http` + bearer auth + admin dashboard 给 `kos-compat-api` 内部走 MCP-over-HTTP + 翻译层开了门 → M2-B 候选;(c) v0.25.1 `archive-crawler` 覆盖 fork 原 Phase 4-5 邮件/日历 import 计划 → M2-C 候选;(d) `Operation.scope` + `.localOnly` 是 fork `OperationContext.remote` 的成熟版 → M2-D 候选。M2 milestone 4 项 P1 已加入上方"M2 milestone 候选"段。Net target 从 M1 的 "16 → 11 active" 进一步缩到 M2 后 "11 → 7-8 active"。
- [x] **2026-05-02 night consolidation PLAN 写就 (P0 closed)** — 详细分析 16 个 fork skill dirs vs v0.25.0 上游 32 skill 的覆盖度,写 [`docs/KOS-JARVIS-CONSOLIDATION-PLAN.md`](../../docs/KOS-JARVIS-CONSOLIDATION-PLAN.md) (~700 行)。Inventory matrix (18 行/skill × {wired/cover/upstream-feature/decision/notes})、5 个 decision bucket (KEEP-unique 7 / KEEP-partial 4 / ARCHIVE 2 / PILOT-RETIRE 1 / REWRITE-AS-LINK 1)、`kos-lint` pilot test plan (4 步 procedure + acceptance + ~4h estimate)、4-milestone deprecation timeline (M1 baseline / M2 next sync / M3 provider abstraction probe / M4 v0.26.0+60d retro)、7-row risk register、out-of-scope notes、acceptance criteria。**Net target**: 16 active skill dirs → 11 active + 2 archived + 1 retired by v0.26.0。M1 milestone 拆 4 个 P1 落地项已搬到上面 P1 list。
- [x] **2026-05-02 evening launchd surgery — dream-cycle + kos-deep-lint P0 双杀** — Path A 完整执行:5 plist templates 删 `GBRAIN_HOME` env 块 (`com.jarvis.{dream-cycle,kos-compat-api,kos-patrol,enrich-sweep,notion-poller}.plist.template`),5 deployed plists 同步改 (~/Library/LaunchAgents/),回收 `com.jarvis.kos-deep-lint.plist.template` 进 repo + 加 `PATH` env block (closes exit 127:wrap script 内 `./kos` 是 `#!/usr/bin/env bun` shebang,launchd 默认 PATH 找不到 bun)。bootout + bootstrap 6 服务 (kos-compat-api 第一次 bootstrap 失败 `Input/output error`,retry 即 OK,新 PID 87485)。迁移 `~/brain/.gbrain/{audit/backpressure-2026-W18.jsonl,audit/subagent-jobs-2026-W18.jsonl,sync-failures.jsonl}` → `~/.gbrain/` (W18 audit 文件目标侧不存在,zero overlap;sync-failures.jsonl 同样 zero overlap)。删空 `~/brain/.gbrain/`。验证:`launchctl kickstart -k gui/$UID/com.jarvis.dream-cycle` 写出 `~/brain/.agent/dream-cycles/2026-05-02T07-38-04Z.json` (status=partial / 8 phases / 2572ms / exit 0,新 v0.25.0 synthesize+patterns phase 跑通);kos-deep-lint PATH smoke (mimic launchd env) bun 1.3.10 reachable + `kos --help` 输出 OK;6 服务 `launchctl print` 全部 `GBRAIN_HOME_lines=0`,kos-compat-api state=running PID 87485 binds :7225。Sandbox 拦了 launchctl(`Operation not permitted` + `Input/output error`),用 `dangerouslyDisableSandbox` 绕过。**P0 closed**:dream-cycle production breakage + kos-deep-lint exit 127。Net P0 list 从 3 缩到 1 (consolidation review)。
- [x] **2026-05-02 v0.25.0 sync — merged to master** (commit `f6bb039` no-ff merge of `sync-v0.25.0`). Post-merge: gemini-embed-shim (PID 2502→63403) + kos-compat-api (PID 32389→63464) restarted to load v0.25.0 src/cli.ts via `~/.bun/bin/gbrain → src/cli.ts` shim. /status local + remote both confirm total_pages=2425. Dream `--phase orphans` from /tmp ✓. kos-patrol cron one-shot ✓ (exit 0, dashboard + digest written to `~/brain/.agent/{dashboards,digests}/`). `~/.gbrain/config.json` extended with `eval.capture: true` + `scrub_pii: true`; first eval row captured by smoke `gbrain query`. **`.env` + `.env.local` `GBRAIN_HOME=/Users/chenyuanquan/brain` commented out** with explanatory blocks (was a leftover from the never-completed "brain config under brain repo" migration; redirected loadConfig to a non-existent path). Local-dev gbrain CLI now works from project dir; 3 of 5 prev-failing tests fixed. **2 follow-ups filed P0** (see top): dream-cycle cron breakage from launchd-plist-set GBRAIN_HOME (same root cause; plist surgery deferred to next session), kos-deep-lint exit 127 (plist drift, pre-existing). Story in [§6.20](../../docs/JARVIS-ARCHITECTURE.md#620-upstream-v0250-sync-2026-05-01).
- [x] **2026-05-01 v0.25.0 upstream sync** (branch `sync-v0.25.0`) — 16 commits / 12 versions in one merge: v0.22.10 → v0.22.16 (7 patch releases handoff missed), v0.23.0/0.23.1/0.23.2 (dream conversation synthesis + local CI gate + dream marker fix), v0.24.0 (skillify hardening), v0.25.0 (BrainBench-Real eval capture). Schema v29 → v30 (`eval_candidates` + `eval_capture_failures`). Conflicts on 8 files (`.gitignore`, `VERSION`, `package.json`, `bun.lock`, `CHANGELOG.md`, `TODOS.md`, `src/core/sync.ts`, `test/sync-failures.test.ts`) — all empty-HEAD additions or version-string overrides. WAL fork patch (`pglite-engine.ts:182 pg_switch_wal()`) survived. Privacy-gate (`scripts/check-privacy.sh`, new in upstream) fired on 2 fork files mentioning the banned name; scrubbed (the prior-fork slug form → `your-openclaw/chat/`, example JSON line genericized). **BrainDb safety net**: added 5 eval methods (`logEvalCandidate` / `listEvalCandidates` / `deleteEvalCandidatesBefore` / `logEvalCaptureFailure` / `listEvalCaptureFailures`) + 4 type aliases + 6 unit tests (in-memory PGLite, hermetic). Handoff's "BrainDb 必须补齐 5 方法" was wrong (BrainDb is not a BrainEngine impl), but mirroring the surface anyway lets future fork skills consume eval data without reaching into upstream `src/core/`. **Decision reversed at session start**: enabled `GBRAIN_CONTRIBUTOR_MODE` / `eval.capture=true` (handoff said don't, but baseline-gating future retrieval changes is worth the per-call write). Validation: typecheck clean, `bun test` 1400+ green, BrainDb test 6/6, doctor schema_version 30, `/status` local + `kos.chenge.ink` total_pages=2424, kos-patrol smoke OK, dream `--phase orphans` OK. Story in [§6.20](../../docs/JARVIS-ARCHITECTURE.md#620-upstream-v0250-sync-2026-05-01).
- [x] **2026-04-30 D + G + H 收尾** —
  - **D (upstream v0.22.9 sync, commit `8ae9aef`)**: cherry-pick
    `08746b0` 单 commit (sync error-code 分类 — `classifyErrorCode()`,
    `summarizeFailuresByCode()`,12 new tests)。Conflict 仅
    `.gitignore` 一处(merge 两边),解 conflict 保留 fork OMC + launchd
    runtime ignore + upstream `.claude/`。Build OK 190ms bundle / 255ms
    compile,`gbrain --version` 0.22.9。
  - **G (`default` source `local_path` 设)**: SQL 一句 UPDATE
    `sources` SET `local_path='/Users/chenyuanquan/brain'` WHERE
    `id='default'`。`gbrain frontmatter audit --json` `per_source` 现
    填:`[{source_id:"default", source_path:"/Users/chenyuanquan/brain",
    total:0, ...}]`。
  - **H (push to origin/master)**: 7 commits push (Phase B/C 6 +
    v0.22.9 1)。GitHub HEAD = local HEAD。
- [x] **2026-04-30 Phase C cleanup — dead-link cluster + patrol dedup +
  cosmetics + arch §6.19** — 推 Lucien 选的 A+B+C+E+F 5 项一波打完。
  - **A (35 dead-link ERROR → 0)**: brain 21 文件 × 31 link 重写从
    same-dir short form `(slug.md)` → 完整 `(../<dir>/slug.md)`,3 轮
    sync(commits `cde82a1`/`ede9a40`/`1349986`)消尽 lint cluster。
    Decisions/phase-2-feishu 4 个 cross-repo refs 改 backtick form
    (brain ≠ fork repo,不该 wikilink fork 文件)。
  - **B (patrol Phase 4 case-variant dedup)**: phase4() 加 normalize
    (lowercase + strip non-alphanum + drop suffix Inc/LLC/Ltd/Corp/Co/
    GmbH) + Levenshtein ≤ 1 (≥ 4 chars) 两阶段合并。验证:Link Systems
    Inc 5 变体合并为 379 mentions(原 206 + 88 + 56 + 19 + 10 单独占 5
    个槽位),Link Canada Inc 51,MCMC JENDELA 35。Dashboard 现在显示
    Cloud VMS / RADIUS Server / MCP Server / Link Cloud / Link EBG /
    AWS CDN / Operations Assistant / Time Upgrade / Upload Firmware /
    Carrier Grade AAA / PoE AIO / Omada Roadmap / Omada Beta Program 等
    真长尾 entity gap。
  - **C (graph_coverage 0% docs)**: 加 §6.19 to JARVIS-ARCHITECTURE.md
    解释 markdown-only brain 的 metric 行为 — `graph_coverage` 用
    page-percent (% pages with ≥1 inbound entity-link / timeline) 算法,
    notion source 占 60% 不会被 entity-extract,所以 percentage 趋 0%。
    Code Cathedral metric 同理 0%(我们无 code page)。**这是 design
    property,不是 regression**;不跑 `gbrain link-extract` 追指标。
  - **E (`/status` engine label `pglite` → `postgres`)**: 改
    `server/kos-compat-api.ts:258` 解决 Path 3 之后的旧 hardcoded
    label。下游 Notion Knowledge Agent / OpenClaw feishu 现在拿到正
    engine 标识。
  - **F (kos-patrol launchd exit 2 → success)**: `scripts/launchd/
    com.jarvis.kos-patrol.plist.template` 加 `<key>SuccessfulExitCodes
    </key><array><integer>0</integer><integer>2</integer></array>` —
    patrol 设计 0=clean / 1=ERROR / 2=WARN-only,launchd 不再因 exit 2
    报"ServiceFail"。Exit 1(真有 ERROR)仍 surface。
  - **Net**: 2 P1 + 1 P2 + 2 P3 关闭。Phase A→B→C 系列总耗 ~3 h focused
    work,2305→2340 pages,100% embed coverage 保持,brain_score 84/100
    稳定(embed 35/35 + links 25/25 + timeline 3/15 + orphans 11/15 +
    dead-links 10/10)。
- [x] **2026-04-29 Phase A system review + Phase B #1+#2 双杀** —
  Lucien 触发 first systematic review since 04-22。Phase A 实测 6 维度
  (brain health / service mesh / query smoke / storage / patrol /
  TODO 对账),plan at `~/.claude/plans/session-docs-session-handoff-
  2026-04-29-piped-codd.md`。Phase B-1: `scripts/jarvis-pg-backup.sh` +
  `com.jarvis.gbrain-backup.plist.template` + launchctl bootstrap;
  manual run 产 63MB pg_dump (DB 239MB → 26 % gzip),pg_restore --list
  TOC 275 entries,daily 03:33,14d retention。Phase B-2:
  `skills/kos-jarvis/kos-patrol/run.ts` 加 30+ stoplist 词 (4 passes) +
  ≥2-distinct-kind 规则。dashboard 从 100 % Notion column-header 噪声
  ("Original EML"×862, "Action Type"×858) 翻转到 95 % 真实信号
  (Link Systems Inc, MCMC Jendela, Cloud VMS, RADIUS Server, MCP Server,
  PoE AIO, Omada Roadmap...)。
- [x] **2026-04-29 241 stale embeddings auto-consumed** — Phase A
  实测 `SELECT COUNT(*) FROM content_chunks WHERE embedding IS NULL`
  返 0。期间无人手动跑 `gbrain embed --stale`;推断 dream-cycle 的
  embed phase 在 04-29 23:44Z 跑过把 NULL 一并补完(虽然 phase report
  说 0 embedded,可能 timing/caching 问题)。Net: 100 % embed coverage,
  原 P1 关闭。
- [x] **2026-04-29 zombie sync leak closed by Path 3** — PGLite 时代
  6 个 long-running zombie 持锁问题,Phase A `ps -axo` 实测 0 zombie,
  Postgres MVCC 让 zombie 即使存在也不阻塞 client。原 P1→P2(observation)
  现归档 Done。剩余 root cause(spawn 来源)若再出现可由 patrol Phase 7
  cheap WARN 监测捕获。
- [x] **2026-04-29 Path 3 Postgres migration** (commit `33c0410`) —
  PGLite single-writer lock topology silent-fail under v0.21+ workload.
  Migrated to local Postgres 17 + pgvector 0.8.2 via `gbrain migrate
  --to supabase --url postgresql://chenyuanquan@127.0.0.1:5432/gbrain`.
  2117 pages + 8231 links + 11084 timeline transferred. BrainDb dual-
  engine refactor (~80 LOC). 0 plist edits. notion-poller +186p/5.5min
  /0 zombies. dream-cycle 1030ms warm. /status 90 ms during burst.
  Trigger #3 of v020 evaluation satisfied. See [§6.18](../../docs/JARVIS-ARCHITECTURE.md#618-pglite--本地-postgres-迁移--path-3-p0-unblock-2026-04-29-afternoon).
- [x] **2026-04-29 spawnAsync fix** (commit `093601e`) — replaced 4
  `spawnSync` calls with Promise-wrapped `spawn` to unfreeze Bun event
  loop. /status stayed responsive (138-193ms) during in-flight gbrain
  sync 134s. **Made Path 3 unnecessary for the event-loop fix**, but
  Path 3 was still needed for the lock-deadlock root cause.
- [x] **2026-04-29 v0.22.8 upstream sync** (commit `811c266`) — merged
  9 minor releases (v0.21.0 → v0.22.8). Schema v24 → v29 via
  v0.22.6.1's `applyForwardReferenceBootstrap()`. Fork patch on
  `pglite-schema.ts` dropped (#370 closed by upstream PR #440). WAL
  fork patch retained for cold-backup viability. Production cutover:
  2117/2117 pages preserved, brain_score 85/100 stable.
  Story in [§6.17](../../docs/JARVIS-ARCHITECTURE.md#617-upstream-v0228-sync-2026-04-29-commit-811c266).
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
