# kos-jarvis — Outstanding Work (post Phase C cleanup, 2026-04-30)

> **Updated**: 2026-04-30 — refreshed after Phase A→B→C run. Phase C
> closed dead-link cluster (35→0), patrol dedup (5 case-variants → 1),
> graph_coverage docs (markdown-only expected), `/status` engine label,
> kos-patrol launchd exit 2.
> **Entry point for next session**: write fresh handoff at
> `docs/SESSION-HANDOFF-2026-05-01-post-phase-c.md` (TBD).
> **Pre-Path-3 TODO**: archived in git history at `7b6a409`.
> **Pre-system-review TODO**: archived at `2203f94`.
> **Pre-Phase-C TODO**: archived at `b23ab28`.

The brain is healthy on Postgres 17 + pgvector 0.8.2 (schema v29,
**2340+ pages, 100 % embed coverage, 0 zombies**, all 10 jarvis services
running). After Phase C: kos-patrol 0 ERROR / 985 WARN, dashboard
gaps now show real long-tail entities (Link Systems Inc, MCMC Jendela,
Cloud VMS, RADIUS Server, MCP Server, Link Cloud, Link EBG, AWS CDN,
Operations Assistant, Time Upgrade, Upload Firmware, Carrier Grade AAA,
PoE AIO, Omada Roadmap, Omada Beta Program). Items below are ranked by
current value, not by historical severity.

---

## P1 — quality, fast follow-up

_(empty — 上轮 P1 全部 closed in Phase C, see Done)_

---

## P2 — observation / cosmetic

### [ ] `GBRAIN_SOURCE_BOOST` tune-up evaluation (1-week soak now ~6天满)

**Why**: v0.22.0 加的 source-aware retrieval ranking。Default boost map
不知道我们 layout(`sources/notion/` vs upstream's `your-openclaw/chat/`),
所以我们 brain 在 factor=1.0 全均 — 等于无 source-aware boost。Notion-
source 占 60 %,可能 swamp 短中文 query。

**What**(P0 review 中的 step 3 会做这个):
1. 跑 5-10 个代表性中文查询(`/query`),手动评 top-3 相关性。
2. 若 notion-sources 不当主导,设 plist EnvironmentVariables:
   `GBRAIN_SOURCE_BOOST="concepts/:1.5,projects/:1.3,syntheses/:1.5,sources/notion/:0.7"`
3. 重跑同样 query。win >5 % → 留;else → revert。

**Acceptance**: 决定记录到 `docs/JARVIS-ARCHITECTURE.md`。

**Scope**: 1 h 评估(post-soak)。

### [ ] CHUNKER_VERSION 3→4 re-walk cost (markdown-only,大概率 cheap)

**Why**: v0.21.0 设 `CHUNKER_VERSION 4`,sources.chunker_version 已被
手动 pin 到 '4'。理论上 markdown body cache-hit on embedding(241 stale
除外),代价应该极小,但没正式 verify。

**What**: `gbrain reindex-code --dry-run` 看 ConfirmationRequired。若
embedding cost <$1,直接 `--yes`。

**Acceptance**: cost preview 抓取 + 决定记录。

**Scope**: 15 min preview, 0-30 min reindex。

### [ ] Patrol dashboard ↔ stdout 数字不一致 (新发现 2026-04-29)

**Why**: Phase A review 发现 `~/brain/.agent/dashboards/knowledge-health-2026-04-29.md`
显示 `35 ERROR + 796 WARN`,而同次 patrol stdout log 显示 `0 ERROR, 762 WARN`。
两个数字应该 always 一致。Dashboard total pages 显示 2151 vs Postgres
2305 — dashboard 似乎走 fs walking 而 stdout 走 DB,page set 不同。

**What**:
1. 读 `skills/kos-jarvis/kos-patrol/run.ts` 的 lint 调用点 vs dashboard
   写入点。
2. 确认 page-set 来源是否真的不同(fs walking vs `db.listAllPages`)。
3. Decision:统一到一个 source,或文档化 expected gap。

**Acceptance**: stdout `Lint:` 和 dashboard `## Lint` 数字一致,OR
`docs/JARVIS-ARCHITECTURE.md` 加段说明 "expected gap"。

**Scope**: 30 min 调研 + 30 min 修(若选)。

### [ ] Calendar checkpoints (carried forward, post-Path-3 调整)

| Date | Action | 状态 |
|---|---|---|
| 2026-05-04 | Stage 4 v1 archive — `com.jarvis.kos-api.plist.bak` to `_archive/`,archive v1 GitHub repo | active |
| 2026-05-07 | Step 2.4 commit-batching review for `~/brain` per-ingest commits | active |
| 2026-05-25 | Re-evaluate Gemini 3072-dim embeddings vs current 1536-dim truncation | active |
| ~~Trigger-based~~ | ~~PGLite → Postgres switch~~ | **CLOSED 2026-04-29 via Path 3 (§6.18)** |

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

- [x] **2026-05-01 v0.25.0 upstream sync** (branch `sync-v0.25.0`) — 16 commits / 12 versions in one merge: v0.22.10 → v0.22.16 (7 patch releases handoff missed), v0.23.0/0.23.1/0.23.2 (dream conversation synthesis + local CI gate + dream marker fix), v0.24.0 (skillify hardening), v0.25.0 (BrainBench-Real eval capture). Schema v29 → v30 (`eval_candidates` + `eval_capture_failures`). Conflicts on 8 files (`.gitignore`, `VERSION`, `package.json`, `bun.lock`, `CHANGELOG.md`, `TODOS.md`, `src/core/sync.ts`, `test/sync-failures.test.ts`) — all empty-HEAD additions or version-string overrides. WAL fork patch (`pglite-engine.ts:182 pg_switch_wal()`) survived. Privacy-gate (`scripts/check-privacy.sh`, new in upstream) fired on 2 fork files mentioning the banned name; scrubbed (`wintermute/chat/` → `your-openclaw/chat/`, example JSON line genericized). **BrainDb safety net**: added 5 eval methods (`logEvalCandidate` / `listEvalCandidates` / `deleteEvalCandidatesBefore` / `logEvalCaptureFailure` / `listEvalCaptureFailures`) + 4 type aliases + 6 unit tests (in-memory PGLite, hermetic). Handoff's "BrainDb 必须补齐 5 方法" was wrong (BrainDb is not a BrainEngine impl), but mirroring the surface anyway lets future fork skills consume eval data without reaching into upstream `src/core/`. **Decision reversed at session start**: enabled `GBRAIN_CONTRIBUTOR_MODE` / `eval.capture=true` (handoff said don't, but baseline-gating future retrieval changes is worth the per-call write). Validation: typecheck clean, `bun test` 1400+ green, BrainDb test 6/6, doctor schema_version 30, `/status` local + `kos.chenge.ink` total_pages=2424, kos-patrol smoke OK, dream `--phase orphans` OK. Story in [§6.20](../../docs/JARVIS-ARCHITECTURE.md#620-upstream-v0250-sync-2026-05-01).
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
