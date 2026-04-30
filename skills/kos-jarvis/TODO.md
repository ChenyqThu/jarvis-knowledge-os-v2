# kos-jarvis — Outstanding Work (post Phase A system review, 2026-04-29)

> **Updated**: 2026-04-29 18:30 local — refreshed after Phase A system
> review + Phase B (#1 backup + #2 patrol stoplist).
> **Entry point for next session**: write a fresh handoff under
> `docs/SESSION-HANDOFF-2026-04-30-post-system-review.md` (TBD).
> **Pre-Path-3 TODO**: archived in git history at `7b6a409`.
> **Pre-system-review TODO**: archived at `2203f94`.

The brain is healthy on Postgres 17 + pgvector 0.8.2 (schema v29,
**2305+ pages, 100 % embed coverage, 0 zombies**, all 9 jarvis services
running). Phase A measured: /status burst 217-247ms, sequential
107-166ms; /query retrieval + LLM synthesis healthy on 5-query Chinese
smoke. The two biggest items in this list (auto-backup + patrol
stoplist) are now closed in **Done**. Items below are ranked by current
value, not by historical severity.

---

## P1 — quality, fast follow-up

### [ ] graph_coverage 0% 调研 + 解决

**Why**: doctor 的新 metric 说 `Entity link coverage 0%, timeline 0%`,
即使 `gbrain stats` 显示 8231 links + 11084 timeline。v0.21.0 加的
`code_edges_chunk` + `code_edges_symbol` 表很可能 redefine 了"counts"。

**What**:
1. `gbrain doctor --json | jq .checks.graph_coverage` 看 details。
2. 跑 `gbrain link-extract && gbrain timeline-extract` 看 metric 是否
   变化。
3. 若仍 0 %,跑 `gbrain reindex-code --dry-run` 看代价 — 我们 markdown-
   only 估计 0 cost,可以直接 `--yes`。
4. Decision:接受 0 % 作为 markdown-only brain 的预期,update README +
   handoff "this WARN is expected" — 防止以后 sync 反复调研。

**Acceptance**: doctor 的 `graph_coverage` 报合理非零数字,OR 文档
"this WARN is expected on markdown-only" 落地。

**Scope**: 30 min 调研,0-1 h reindex(若选)。

---

## P2 — observation / cosmetic

### [ ] `GBRAIN_SOURCE_BOOST` tune-up evaluation (1-week soak now ~6天满)

**Why**: v0.22.0 加的 source-aware retrieval ranking。Default boost map
不知道我们 layout(`sources/notion/` vs upstream's `wintermute/chat/`),
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

### [ ] `default` source `local_path` 没设 (v0.22.4 audit gap)

**Why**: `gbrain frontmatter audit --json` 返 `{ok: true, total: 0,
per_source: []}`,因为 v0.22.4 source-resolver 走 sources 表的 local_path
列,我们 default source 没设。Audit 仍 green,但 per-source 详情缺。

**What**: `gbrain sources update default --local-path ~/brain`(CLI shape
可能不同;`gbrain sources --help` 确认)。

**Acceptance**: audit 返 `per_source: [{source_id: "default", path:
".../brain", ...}]`。

**Scope**: 15 min。

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

### [ ] Patrol Phase 4 — case-variant entity dedup (后续优化)

**Why**: 本次 stoplist 扫完后 dashboard 仍 20 gaps,但其中 4 行是同一
公司变体("Link Systems Inc" / "Link System Inc" / "LINK SYSTEMS INC" /
"Link System")。phase4 regex case-sensitive,没合并 case 变体或 OCR
近邻。理论上加 case-fold + Levenshtein-distance ≤2 dedup 可以让 20→
~12 unique signals。

**What**: 在 `skills/kos-jarvis/kos-patrol/run.ts` 的 `phase4()` 加
case-fold + edit-distance dedup 层(保留 max-mention 变体,合并 count
+ pages + kinds 集合)。

**Acceptance**: dashboard 不再出现"Link Systems Inc / Link System Inc /
LINK SYSTEMS INC / Link System"四个独立行;真实 unique gap ~10-12。

**Scope**: 1-2 h(实现 + tune)。

### [ ] Calendar checkpoints (carried forward, post-Path-3 调整)

| Date | Action | 状态 |
|---|---|---|
| 2026-05-04 | Stage 4 v1 archive — `com.jarvis.kos-api.plist.bak` to `_archive/`,archive v1 GitHub repo | active |
| 2026-05-07 | Step 2.4 commit-batching review for `~/brain` per-ingest commits | active |
| 2026-05-25 | Re-evaluate Gemini 3072-dim embeddings vs current 1536-dim truncation | active |
| ~~Trigger-based~~ | ~~PGLite → Postgres switch~~ | **CLOSED 2026-04-29 via Path 3 (§6.18)** |

---

## P3 — speculative

### [ ] Push to origin/master (now 2 commits ahead, +2 pending this session)

**Why**: master 比 origin 多 2 commits(handoff 写"8 commits"是过期
数字,实际已 push 6 个)。本 session 加 backup 基建 + patrol stoplist
+ TODO refresh 后会再 +3。Lucien 控制 push 时机。

**What**:
```bash
git push origin master  # 2 + 3 = 5 commits ahead
```

**Acceptance**: GitHub `ChenyqThu/jarvis-knowledge-os-v2` master HEAD =
local HEAD。

**Scope**: 1 min。

### [ ] /status `engine` label cosmetic (post Path 3)

**Why**: `server/kos-compat-api.ts:258` hardcoded
`engine: "gbrain (pglite)"`。/status JSON 现在自报 pglite 但实际数据
来自 Postgres(总页数对得上 2305)。无功能影响,但下游 Notion Knowledge
Agent / OpenClaw feishu 偶尔解析 engine 字段决定路径,会被误导。

**What**: 改为 `engine: "gbrain (postgres)"`(或者更稳健:从 BrainDb
config 读 engine 字段动态填)。

**Acceptance**: `curl /status | jq .engine` → `gbrain (postgres)`。

**Scope**: 5-10 min。

### [ ] kos-patrol launchd `last exit code = 2` cosmetic

**Why**: kos-patrol 的 exit code 设计是 `errors>0 ? 1 : warns>0 ? 2 : 0`,
所以"0 ERR + warns" 仍 exit 2。launchd 把 ≠0 视 fail,导致每天 launchd
report "last exit code = 2" 看起来像 ServiceFail。Service 实际健康。

**What**: 在 `scripts/launchd/com.jarvis.kos-patrol.plist.template` 加:
```xml
<key>SuccessfulExitCodes</key>
<array><integer>0</integer><integer>2</integer></array>
```
(launchd 会把 0 + 2 都视为 success;1 仍视 fail = 真有 lint ERROR)

**Acceptance**: `launchctl print` 之后 last exit code 不再触发 alert
ascript;退出码 1 仍 surface。

**Scope**: 5 min。

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
