# CLAUDE.md

## Jarvis KOS v2 fork — read first (Lucien's context)

This repo is a **fork of `garrytan/gbrain`**, not a vanilla install. When
working on this codebase, before touching anything else:

1. Read [`skills/kos-jarvis/README.md`](skills/kos-jarvis/README.md) — the
   fork-local extension pack boundary. **All Jarvis-specific logic lives
   under `skills/kos-jarvis/`**. Never modify `src/*`, `skills/RESOLVER.md`
   outside the `## KOS-Jarvis extensions` append-only section, or other
   upstream `skills/*`. If you think you need to change upstream, file an
   issue on the fork instead so we can evaluate whether it's worth the
   merge-conflict tax.
2. Read [`docs/JARVIS-ARCHITECTURE.md`](docs/JARVIS-ARCHITECTURE.md) — the
   full migration story (v1 Python/shell → v2 GBrain TS + Gemini shim),
   current deployment (launchd / kos.chenge.ink / Notion Knowledge Agent
   / OpenClaw feishu), and the Jarvis triangle (KOS compiles ↔ Notion
   operates ↔ OpenClaw executes). Latest sync story: **§6.46 v0.42.68.1
   upstream sync (2026-07-31, 54 commits / one release /
   v0.42.66.1 → v0.42.68.1 / 185 files; **zero-migration**, schema stays
   **v125** on both sides. **Upstream closed the fork's own issue #2028**:
   `f75dbb4e` (#3690) fixes §6.42's query-embed deadline — the shared
   `AbortSignal` arrived already aborted, making the 2s
   `MIN_QUERY_EMBED_BUDGET_MS` floor dead code and silently degrading hybrid
   search to keyword-only (= **empty results** for compound CJK here); fixed
   with a fresh `AbortSignal.timeout(remaining)` at `hybrid.ts:873`.
   **`GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000` STAYS** — now belt-and-braces, but
   retiring it is its own change (P2). **The batch's key lesson: a clean merge
   is NOT a clean semantic merge.** Upstream #3651 absorbed the fork's google
   embedding batch-cap patch (**3rd absorption** after §6.45's two) but inserted
   at a different offset in the same object literal → git auto-merged with **no
   conflict marker**, leaving **duplicate `max_batch_tokens`/`chars_per_token`
   keys**, where JS silently lets the last win. Only **TypeScript (TS1117)**
   caught it — **never skip the green gate because there were no conflicts.**
   Resolved by `git checkout upstream/master -- <file>` (not a hand-edit; the
   fork-boundary hook correctly blocked that); fork src **4→3 files**. Conflicts
   (5): `.github/workflows/test.yml` modify/delete for the **3rd consecutive
   batch** (now a constant — keep the deletion, stop re-deciding); `CLAUDE.md`
   →ours; `llms-full.txt` →regen; two fork test patches for the absorbed google
   cap →upstream. `docs/CLAUDE-UPSTREAM.md` refreshed (+13 lines, #3596
   engine-live static-import rule). Green: typecheck 0, check:all **24/24**
   (new `check-engine-dynamic-import.sh`; exports-count still 21; §6.45's
   symlink ALLOWLIST holding), `bun test test/ai/` **480 pass / 0 fail**.
   Prod **29,968 pages / 77,863 chunks / 0 NULL** — byte-identical across the
   deploy; both /health → 0.42.68.1; brain_score 83/100;
   `embedding_provider` **360ms** and **`embed_staleness: no stale chunks`**.
   Daemon again did **not** self-relaunch after `bun run build` — **6 batches,
   a constant**. **Retrieval A/B vs a 0.42.66.1 binary on the same prod DB: 7/8
   identical, 1 changed *for the better*** (`竞品分析` L=1:
   `competitive-benchmarking` 0.8296 → `competitive-analysis` 0.8384);
   nondeterminism ruled out first (4× per binary, 4/4 stable each), likely
   #3677. **Method: never compare against a previous sync's A/B table** — the
   corpus moved (29,698→29,968), so an A/B is only valid same-moment,
   same-corpus, two binaries. MCP wire green (#1410 `resource_metadata` still
   correct through cloudflared). **Two new open items, both pre-existing**:
   a `sync_failures` FAIL that is **test pollution** (`source_id: srcE`,
   `notes/bad.md` absent, written 2026-07-27 during §6.45) making `doctor` exit
   non-zero (P1, prod state file, needs Lucien); google recipe
   `chars_per_token` now 4 (English) where the fork used 2 (CJK) — dormant
   since embedding is direct-OpenAI, but must be re-tuned if Gemini embedding
   ever returns (P2). Also: `links_extraction_lag` reporting **100%** is
   **pre-existing and expected** (timestamp-based; `page_links` really holds
   215,698 rows; warn-only by upstream design), and §6.45's **162h dream stall
   self-healed** — `cycle_freshness` now 11h)**.
   Previous: §6.45 v0.42.66.1 sync (2026-07-28, **265 commits** across 2
   releases / 446 files — largest batch to date; schema v124→v125; upstream
   *absorbed* two fork patches, so **§6.44's stat-conservation check FAILED and
   that was good news** — treat it as a "look closer" signal, never a pass/fail
   gate; **§6.39's P0 root cause REFUTED, not fixed** — v121's verbatim `sql`
   replays cleanly through byte-identical code on the same postgres.js 3.4.9, so
   the batch-parse attribution cannot be right, and public upstream issue #2667
   still carries the wrong diagnosis awaiting a correction (Lucien's call));
   §6.44 v0.42.64.0 sync (2026-07-22, 20 commits / 74 files —
   zero-migration v124; #1410 gave `/mcp` 401 a correct *public*
   `resource_metadata` through cloudflared; `orphan_ratio` 25%+OK was the
   fork's own `7cc00641` pass, **not** upstream #3015);
   §6.43 v0.42.63.0 sync (2026-07-21, **106 commits** / 443 files —
   largest batch to date, yet zero-conflict; schema v122→v124, two migrations;
   **`merge-tree`'s "changed in both" is a verify-list, NOT a conflict
   forecast** — 3 rewrite-scale hits on fork src patches all auto-resolved;
   doctor embedding_provider **724ms vs §6.40's 11,848ms via the avman relay**,
   quantifying §6.41's direct-connect win);
   §6.40 v0.42.59.0 sync (2026-07-13, 7 commits, zero-migration
   v122, provider-agnostic gateway; note its "litellm recipe unusable" caveat
   retirement still stands);
   §6.39 v0.42.57.0 sync (2026-07-07, 3 commits, schema v119→v122
   3-step; the P0 it filed — `gbrain init --migrate-only` failing on real
   Postgres for multi-statement ADD-COLUMN+CREATE-INDEX migrations — had its
   **root cause REFUTED in §6.45**: the postgres.js `conn.unsafe` batch
   parse-time explanation cannot be right, because v121's verbatim SQL now
   replays cleanly through byte-identical code on the same postgres.js 3.4.9.
   **The symptom was real, the diagnosis was not, and the trigger is still
   unidentified**; the three fork workarounds in
   docs/UPSTREAM-PATCHES/v0.42.57.0-migrate-only-multistatement-ddl.md are
   **not currently needed**, and garrytan/gbrain#2667 still carries the wrong
   diagnosis pending a correction);
   §6.38 v0.42.53.0 sync (2026-06-26, zero-migration schema v119). Note §6.32
   (2026-05-31) was the embedding convergence, not a sync.
   **§6.41 embedding incident (2026-07-14, NOT a sync — RESOLVED)**: avman's te3
   channel 503'd, silently killing the vector half of every query. Embedding now
   goes **direct to api.openai.com on an official key, no relay** (vectors
   identical, cosine 1.0000 → zero re-embed). A GitHub Models stopgap in between
   lasted two hours and was abandoned: its real ceiling is **150 req/day**, and
   `gbrain embed` spends one request per page, so it can serve neither ingest nor
   a backfill. See the ⚠️ bullet below for the standing rules this cost us, and
   §6.41 for the full trail. Also found there: **9,241 pages (~34% of the brain,
   incl. 100% of atoms) were never chunked** — cycle-born pages that
   `embed --stale` structurally cannot see (upstream garrytan/gbrain#2163);
   backfilled, with `com.jarvis.chunkless-backfill` (07:00) holding the line.
   **#2163 is PARTIALLY fixed upstream as of v0.42.63.0** (§6.43): only
   `synthesize_concepts` now writes through the chunk+embed pipeline; other
   cycle phases still don't, and 100 chunkless live pages remained at the
   2026-07-21 check — **the backstop cron stays**.
   **§6.42 query-embed deadline (2026-07-14, same day, MITIGATED not fixed)**:
   with embedding healthy at ~250ms, the vector arm *still* died — `expandQuery`
   (LLM, **1.5–41s** via CRS) runs first inside the same 6s absolute deadline and
   spends it, then the embed aborts in ~0ms → silent keyword-only → **empty
   results for compound CJK**. `GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000` is now in all
   4 plists + `.env.local` and **must stay**. It only mitigates (4/6 → 1/6) and is
   load-dependent — idle boxes pass at 6s too, so green queries prove nothing. The
   2s `MIN_QUERY_EMBED_BUDGET_MS` floor that upstream added for exactly this case
   is **dead code** (the shared `AbortSignal` has already fired); reported at
   garrytan/gbrain#2028. See §6.42.
3. Read [`skills/kos-jarvis/TODO.md`](skills/kos-jarvis/TODO.md) — current
   outstanding work (P0/P1/P2). Check here before suggesting "what should
   we do next?"

### Fork-specific rules (override upstream behavior)

- **⚠️ NO RELAY ON THE EMBEDDING PATH ANY MORE (§6.41, 2026-07-14).** avman's
  te3 channel went 503 ("无可用渠道 / distributor") and embedding now goes
  **direct to `api.openai.com` with an official OpenAI key** — `OPENAI_API_KEY`
  set, **`OPENAI_BASE_URL` UNSET** across all four planes. Do not reintroduce
  `OPENAI_BASE_URL`: the M3-era prohibition, un-retired. §6.32's "OPENAI_BASE_URL
  is INTENTIONAL and REQUIRED" is **obsolete** — it described the avman relay.
  Vector space unchanged (official te3 reproduces the stored vectors at cosine
  **1.0000**, 6/6 → zero re-embed). Rate ceiling is now 3,000 req/min instead of
  a relay's channel health. Three traps §6.41 paid for, keep them in mind:
  - **The model label is NOT cosmetic.** `pages.embedding_signature` =
    `<provider:model>:<dims>` drives staleness, so changing the model *string*
    (even for the identical model) marks every stamped page stale — 21,701
    chunks, a ~4.3M-token re-embed the nightly `dream` would have run. Any swap
    must UPDATE the signature in the same breath.
  - **Never `gbrain embed --all`** — engine chunk rows come back without
    `embedded_at`, so it re-embeds all 61k chunks. Use `--slugs`.
  - **Always pass `--source`, before `--slugs`** — slugs are NOT unique across
    sources, so an unscoped embed silently no-ops on another source's copy.
  Also from §6.41: `com.jarvis.chunkless-backfill` (daily 07:00) walks an
  upstream bug — cycle-born pages are never chunked and `embed --stale` cannot
  see chunkless pages (upstream garrytan/gbrain#2163).
  The rest of this bullet is the §6.32 convergence, which still defines the
  vector space — only the transport changed.
- **Embeddings: OpenAI `text-embedding-3-large` @ 1536d** (§6.32 convergence,
  2026-05-31; via the avman.ai relay until §6.41 went direct). The whole
  brain (38,056 chunks: `default` 6,940 + `mailagent-emails` 31,116) was
  re-embedded into ONE coherent vector space after the prior state was
  found incoherent: `~/.gbrain/config.json` said
  `google:gemini-embedding-001`, but `default` actually held stale
  gemini-bridge-shim vectors (norm ~0.70, mislabeled `text-embedding-3-large`)
  and `mailagent-emails` held `zeroentropyai:zembed-1` (the daemon embedded
  these at ingest under a prior ZE-default config; mailagent itself only sends
  content via MCP `put_page` — `PageInput` has no embedding field, verified) —
  three mismatched spaces a single
  global query model could never serve. Production env (4 plists + `.env.local`
  + `~/.gbrain/config.json` + DB-plane `config` table — ALL must agree) carries
  `GBRAIN_EMBEDDING_MODEL=openai:text-embedding-3-large`,
  `GBRAIN_EMBEDDING_DIMENSIONS=1536`, and `OPENAI_API_KEY` — an **official
  OpenAI key**, no `OPENAI_BASE_URL`, since §6.41. The §6.32-era text here said
  `OPENAI_BASE_URL=https://api.avman.ai/v1` was "INTENTIONAL and REQUIRED" and
  that the M3 no-base-URL rule was retired; both statements are **dead** —
  that base URL now points at a channel avman no longer has. Caveat baked in:
  gbrain's embed path **mislabels** the per-chunk `model` column as the gateway
  default (`zeroentropyai:zembed-1` — the default, never the configured model),
  so after any re-embed run `UPDATE content_chunks SET
  model='openai:text-embedding-3-large'` to fix the cosmetic label — the daily
  `com.jarvis.embedding-label-normalize` cron does this, and refuses to run if
  the config plane ever leaves te3, so it can't mask a real model change.
  §6.32's "the `litellm` recipe is unusable (gateway.ts:670)" caveat is also
  **RETIRED** — upstream #1292 replaced that guard (§6.41 ran production on
  litellm for two hours), though nothing needs it now that the path is direct.
  `GOOGLE_GENERATIVE_AI_API_KEY` and any ZeroEntropy key are now **vestigial**
  for embedding (kept in env but unused). External writers (mailagent etc.) send
  content via MCP `put_page` (no client embedding possible — `PageInput` has no
  vector field), so the daemon embeds everything via openai@avman → past content
  re-embedded + new content auto-unifies. **No writer-side change needed**; the
  only rule is never wire a writer to bypass the daemon with pre-computed vectors. See §6.32.
- **Chinese-first knowledge base.** Postgres tsvector has no CJK
  tokenizer, so **compound CJK queries (4+ Han characters without
  whitespace)** cannot be served by keyword search and require the
  vector path. English queries and 2-3 char standalone CJK terms
  match fine via body-fragment containment (see §6.25 for the
  2026-05-15 15-query probe). Operationally: always ensure vector
  search is live (`gbrain serve --http` on :7225 reachable via
  `kos.chenge.ink`, `OPENAI_API_KEY` set in plist and **no
  `OPENAI_BASE_URL`** — §6.41) before declaring queries broken — the modal
  operator query on this brain is a compound CJK phrase that depends on it.
  **`GBRAIN_QUERY_EMBED_TIMEOUT_MS=30000` must stay in all 4 plists +
  `.env.local`** (§6.42): upstream's query-embed deadline is 6s *absolute
  from search entry*, and `expandQuery` (an LLM call, measured **1.5–41s**
  through CRS) spends it before the embed runs — the embed then aborts in
  ~0ms and hybrid search silently degrades to keyword-only, which for
  compound CJK means **empty results**. Losing this env var doesn't error;
  it just makes Chinese queries fail under load. Caveats: it **mitigates,
  not fixes** (4/6 → 1/6 on the measured distribution — a 41s expansion
  still blows 30s), and it is **load-dependent**, so passing queries on an
  idle box prove nothing.
  **UPDATE (§6.46, 2026-07-31): the upstream root cause is FIXED.**
  [#2028](https://github.com/garrytan/gbrain/issues/2028) was closed by
  upstream #3690 (`f75dbb4e`): the `MIN_QUERY_EMBED_BUDGET_MS` 2s floor was
  dead code because the shared `AbortSignal` arrived already fired, and the
  fix gives the embed a **fresh** `AbortSignal.timeout(remaining)`
  (`src/core/search/hybrid.ts:873`). **Keep the env var anyway** — it is now
  belt-and-braces rather than the only defense, and retiring an env var whose
  failure mode is *silent empty Chinese results* deserves its own change with
  its own under-load verification (TODO P2), not a quiet deletion during a sync.
- **9 KOS page kinds coexist with GBrain's 20-dir MECE.** KOS `kind`
  frontmatter (source/entity/concept/project/decision/synthesis/comparison/
  protocol/timeline) is preserved on every page; it drives kos-jarvis
  quality gates (evidence threshold per kind) while GBrain's directory
  placement follows upstream RESOLVER.md. Mapping lives in
  `skills/kos-jarvis/type-mapping.md`.
- **`kos.chenge.ink` is the stable external boundary** (hostname unchanged
  across the 2026-05-17 cutover; only the origin server + port changed:
  fork-side `kos-compat-api :7225` Bearer → upstream native `gbrain serve
  --http :7225` OAuth 2.1 + MCP JSON-RPC). Cloudflared on mbp-office holds
  the public ingress; jarvis Mac runs the brain. External systems (Notion
  Knowledge Agent, mailagent future, OpenClaw feishu future) talk to
  `https://kos.chenge.ink` via OAuth + MCP wire; never gbrain CLI directly,
  never the retired KOS-v1 Bearer shape. Wire spec at
  [`docs/EXTERNAL-CLIENTS-MCP-WIRE-HANDOFF.md`](docs/EXTERNAL-CLIENTS-MCP-WIRE-HANDOFF.md)
  is self-contained for any caller. If you change MCP op signatures or
  OAuth client scopes, notify Lucien.
- **OAuth client identities**: legacy clients live at
  `~/.gbrain/oauth-clients/<name>.json` (gitignored, mode 600, plaintext
  `client_secret`); newer ones (post-v0.42) live in the **`oauth_clients` DB
  table** with a *hashed* secret (shown ONCE at registration — capture it then,
  it's unrecoverable). Never commit secrets. If lost:
  `bin/gbrain auth revoke-client <client_id>` then re-register via
  `bin/gbrain auth register-client`. There is **no update command** — to change
  an existing client's `federated_read` (cross-source read), `UPDATE
  oauth_clients SET federated_read = ARRAY[...]` directly (daemon reads it live;
  keeps the creds). Active clients:
  - `kos-worker` — Notion Knowledge Agent (default).
  - `lucien-cli` — Lucien ad-hoc CLI.
  - `mailagent` — chat-save (write `default`); **`federated_read = {default,
    mailagent-emails, omada}`** so its LLM can query across all three (2026-06-02).
  - `mailagent-bulk` — bulk email ingest (write/read `mailagent-emails`).
  - `omada-sentiment` — the Omada 舆情/竞品 sentiment system's daily writer
    (write+read `omada`, `client_credentials`; created 2026-06-02; secret in
    `~/.gbrain/oauth-clients/omada-sentiment.secret.txt`, mode 600).
  - `feishu` — **active** article-ingest client: ingests articles Lucien
    surfaces into KOS (~daily ~08:00; 365 calls/14d, last 2026-06-25). The
    earlier "dormant since 2026-05-05" note was wrong — corrected §6.38 closure pass.
- **MCP skill publishing is ENABLED** (`mcp.publish_skills = true`,
  `mcp.skills_dir = <repo>/skills`, both in the DB config plane; 2026-06-02). The
  MCP server publishes all 56 skills (upstream + fork, fork under `kos-jarvis/…`
  names) via `list_skills` / `get_skill` so a thin client (mailagent's LLM, etc.)
  can discover + follow them, then call the CRUD MCP tools. Publishing is GLOBAL
  (one catalog for all OAuth clients — no per-client skill allowlist); curate on
  the *client/prompt* side (e.g. mailagent should use `query`/`idea-ingest`/
  `brain-ops`, not the `kos-jarvis/*` batch/operator skills).
- **Retired (2026-05-17, §6.28)**: `server/kos-compat-api.ts` (661 LoC,
  KOS-v1 Bearer wire that bound `:7225`) → `server/_archived/`, executed
  same-session via atomic port re-use (not 1-week deferred). Mbp-office
  cloudflared NEVER touched — `kos.chenge.ink` ingress still routes to
  `:7225` of jarvis Mac; only the brain-side process bound to `:7225`
  changed (kos-compat-api booted out → gbrain serve --http bootstrapped on
  the freed port, ~5 s downtime). Old `KOS_API_TOKEN` env var stays in
  `.env.local` commented-out as a rollback marker (re-bootstrap
  kos-compat-api from `scripts/launchd/_archived/` to swap back, again
  no cloudflared touch). Historical feishu command-mapping doc at
  `skills/kos-jarvis/_archived/feishu-bridge/SKILL.md` (archived
  2026-05-05) records the v1→v2 cutover layout for reference.
- **Production engine is Postgres, not PGLite.** `~/.gbrain/config.json`
  must say `"engine": "postgres"` + `"database_url": "postgresql://chenyuanquan@127.0.0.1:5432/gbrain"`.
  Running `gbrain init --pglite ...` (e.g. for a M3 pilot) will
  **clobber** this global config — always pass `--dir /tmp/...` AND
  manually inspect/restore `~/.gbrain/config.json` after pilot work.
  Backup at `~/.gbrain/config.json.before-sync-fix` (2026-05-09).
- **Secrets stay out of git.** `scripts/launchd/*.plist` is gitignored;
  only `*.plist.template` is tracked. `.env.local` (contains
  `NANO_BANANA_API_KEY` + `KOS_API_TOKEN`) is also gitignored.

### Upstream sync policy

- Cherry-pick `garrytan/gbrain:master` monthly.
- Prefer minimal conflict: if upstream touches `skills/RESOLVER.md`,
  resolve by keeping our `## KOS-Jarvis extensions` section at the end.
- If upstream fundamentally changes `src/core/ai/gateway.ts` (the v0.27
  embedding gateway), our shim strategy may need re-evaluation. M3
  cutover is the long-term fix.
- **Upstream `CLAUDE.md`-style content** (Architecture, Key files,
  Testing, Build, Pre-ship, CHANGELOG voice, etc.) lives in
  [`docs/CLAUDE-UPSTREAM.md`](docs/CLAUDE-UPSTREAM.md), NOT this file.
  Future upstream `CLAUDE.md` conflicts merge there. Keep this file
  fork-only.

---

## Two organizational axes (must-know for any brain query)

GBrain knowledge is organized along two orthogonal axes:

- **Brain** — WHICH DATABASE. Personal brain is `host`. Mountable team
  brains via `gbrain mounts add`. Routing: `--brain`, `GBRAIN_BRAIN_ID`,
  `.gbrain-mount` dotfile.
- **Source** — WHICH REPO INSIDE THE DATABASE. A brain holds many
  sources (wiki, gstack, openclaw, essays). Slugs scope per source.
  Routing: `--source`, `GBRAIN_SOURCE`, `.gbrain-source` dotfile.

Both axes follow the same 6-tier resolution pattern. See
`docs/architecture/brains-and-sources.md` for diagrams and
`skills/conventions/brain-routing.md` for the agent decision table.

For our fork: brain = `host`. Sources (2026-06-02): `default` (personal
brain), `mailagent-emails` (email corpus), `gbrain-docs` (upstream gbrain docs,
145 pages), `omada` (Omada product KB: 114 user-guide sections + 572 FAQs + 24
corpus-synth viewpoint pages + 720 entities; built via `corpus-ingest`; the
`omada-sentiment` client appends daily 舆情/竞品 data). All on one coherent
embedding space (openai:text-embedding-3-large@1536 via avman, §6.32).

## Skills + routing

29 upstream skills + 14 fork-local kos-jarvis skills (manifest at
`skills/manifest.json`, total 49+ post-v0.31.2). Routing table at
`skills/RESOLVER.md` — fork's `## KOS-Jarvis extensions` section is
append-only at the END of the file.

When the user's request matches an available skill, **invoke via the
Skill tool as the FIRST action**. Don't answer directly, don't use
other tools first. The skill's specialized workflow produces better
results than ad-hoc answers. Examples:

- "is this worth building", brainstorming → `office-hours`
- bugs / errors / "why is this broken" → `investigate`
- ship / deploy / push / "commit and ship" → `ship`
- code review / "check my diff" → `review`
- update docs after shipping → `document-release`
- weekly retro → `retro`
- design system / brand → `design-consultation`
- visual audit / polish → `design-review`
- architecture review → `plan-eng-review`

For brain operations specifically:
- query / search → `query` (or `brain-ops` for read-enrich-write loops)
- ingest a link / article / tweet → `idea-ingest`
- ingest video / audio / book → `media-ingest`
- ingest meeting transcript → `meeting-ingestion`
- enrich an entity → `enrich` (single) / `enrich-sweep` (bulk, fork)
- daily lint / patrol → `kos-patrol` (fork) — runs daily 08:07 cron

**NEVER hand-roll ship operations.** Don't manually `git commit + push +
gh pr create` when `/ship` is available. /ship handles VERSION bump,
CHANGELOG, document-release, pre-landing review, test coverage audit.
Manual PR creation skips all of these.

## Reference: where things live

- Upstream gbrain context (architecture, key files, testing, build,
  ship workflows, CHANGELOG voice, etc.):
  [`docs/CLAUDE-UPSTREAM.md`](docs/CLAUDE-UPSTREAM.md)
- Fork architecture + sync stories:
  [`docs/JARVIS-ARCHITECTURE.md`](docs/JARVIS-ARCHITECTURE.md)
- Fork extension boundary + state:
  [`skills/kos-jarvis/README.md`](skills/kos-jarvis/README.md)
- Fork outstanding work:
  [`skills/kos-jarvis/TODO.md`](skills/kos-jarvis/TODO.md)
- Consolidation roadmap (M2/M3 milestones, fork shrinkage plan):
  [`docs/KOS-JARVIS-CONSOLIDATION-PLAN.md`](docs/KOS-JARVIS-CONSOLIDATION-PLAN.md)
- Skill routing table (upstream + fork):
  [`skills/RESOLVER.md`](skills/RESOLVER.md)
- KOS Knowledge Dashboard (F1–F7, live 公网 `kosadmin.chenge.ink`, launchd
  `com.jarvis.kos-dashboard` on :7226, RO role + MCP-only writes):
  [`server/kos-dashboard/`](server/kos-dashboard/) — delivery + 残余 in
  [`skills/kos-jarvis/TODO.md`](skills/kos-jarvis/TODO.md) "KOS Knowledge Dashboard" 段
