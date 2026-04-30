# kos-jarvis — Outstanding Work (post Path 3 Postgres migration, 2026-04-29)

> **Updated**: 2026-04-29 17:30 local — refreshed after Path 3 close.
> **Entry point for next session**:
> [`docs/SESSION-HANDOFF-2026-04-29-post-postgres-migration.md`](../../docs/SESSION-HANDOFF-2026-04-29-post-postgres-migration.md).
> **Pre-Path-3 TODO**: archived in git history at `7b6a409`.

The brain is healthy on Postgres 17 + pgvector 0.8.2 (schema v29,
2303+ pages, all 9 jarvis services running). The P0 lock-deadlock
that paused notion-poller ingestion for 2 days is closed. Items
below are ranked by current value, not by historical severity.

---

## P0 — next session focus

### [ ] Full system review + TODO re-prioritization

**Why now**: 自 04-22 以来连续 7 天高速迭代 — v0.14 → v0.17 → v0.18.2 →
v0.20.4 → v0.22.8 sync,filesystem-canonical Step 2.x,bug-report 闭环,
Path 3 Postgres migration。每个 sync 各做局部决定,没系统性 review 过
"all of it together"。 Lucien 明确要求新 session 完整 review + 结合
TODO 重新评估待办 + 推进系统优化。

**Scope**:
1. **Brain health audit** (15 min): `gbrain doctor`, `gbrain stats`,
   `gbrain orphans --count`, /status 数字趋势,1 周以内的 dream
   cycle archive 一致性,`pg_stat_activity` 看 Postgres 活动模式。
2. **Service mesh audit** (15 min): 9 个 launchd jobs 各自 last-run
   exit code + cron schedule 是否合理 + log 文件大小看是否在转动 + 
   cloudflared tunnel 健康。
3. **Query quality smoke** (15 min): 5-10 个代表性中文查询(技术、
   人物、决策、近期事件),手动评 top-3 相关性。判断是否要触发
   `GBRAIN_SOURCE_BOOST` 调优(P2 的 1-week soak 现在 6 天满)。
4. **Storage + backup audit** (10 min): `du -sh ~/.gbrain` 看 PGLite
   cold backup 的大小 + 上次 modify 时间;`pg_dump gbrain | wc -c`
   看 Postgres 数据规模;评估当前备份策略是否充分(Postgres 后我们
   没设 pg_dump 计划)。
5. **TODO re-evaluation** (15 min): 把 P1/P2/P3 跟实际状态对账。
   有些 P2 (e.g. /ingest 500 root cause) 已被 Path 3 物理消除,可以
   归档;有些 P1 (zombie sync leak 监测) 因为 Postgres MVCC 优先级
   下降到 P2/observation;新 P1 (e.g. pg_dump 备份策略) 需要 add。
6. **Recommend next 3 work items** (10 min): 给 Lucien 看一个 ranked
   list + scope 估计,等他选哪个推进。

**Acceptance**:
- 一份 ≤500 字的 system review markdown(可放在 `~/.claude/plans/` 或
  作为 inline 总结发给 Lucien),覆盖以上 5 个维度的关键数字。
- 更新 TODO.md(降级/归档 stale 项,新增 review 中发现的项)。
- ranked 推荐清单(top 3 work items + scope estimate),让 Lucien 选。

**Scope**: ~80 min review + 0-2h 推进选定的 work item。

---

## P1 — quality, fast follow-up

### [ ] 241 stale embeddings — `gbrain embed --stale`

**Why**: Path 3 migration 把 PGLite 上 NULL embedding 的 chunks 一并迁
到 Postgres。Source side 显示 100%,migrate verify 显示 94 % (241 stale)
— 差量是 v0.21+ 添加的 fenced-code chunks 之类没及时 embedded 的部分。
Shim 在 :7222 健康,直接跑 `embed --stale` 能补完。

**What**:
```bash
gbrain embed --stale 2>&1 | tail -10
psql -d gbrain -c "SELECT COUNT(*) FROM content_chunks WHERE embedding IS NULL;"
# expect: 0
```

**Acceptance**: `embedding IS NULL` 计数为 0,doctor 的 `embed_coverage`
为 100 %。

**Scope**: 5-15 min(取决于 shim 吞吐 + 241 chunks 大小)。

### [ ] Postgres backup 策略

**Why**: 切到 Postgres 后,原 PGLite 的 `cp -R ~/.gbrain/brain.pglite/`
不再适用。当前没有自动备份。生产风险:笔记本断电/磁盘故障会丢全部 ingest。

**What**:
1. 写 `scripts/launchd/com.jarvis.gbrain-backup.plist.template`,daily
   03:30 触发(避开 dream cycle 03:11)。
2. 内部跑 `pg_dump -d gbrain -Fc -f ~/.gbrain/backups/gbrain-$(date +%Y%m%d).dump`,
   保留 14 天 rolling。
3. retention prune:删除 14 天前 dump。
4. 跟 `~/.gbrain/brain.pglite.pre-path2-1777504487` (502MB) 一起作为
   层级 backup(快照点+rolling)。

**Acceptance**:
- `~/.gbrain/backups/` 有最近 14 天 dump,新的每天产生。
- `pg_restore --list <dump> | head -20` 表明 dump 完整。
- launchd job `com.jarvis.gbrain-backup` 在 service health 列出 ✅。

**Scope**: 30-45 min(写 plist + 写 wrapper script + 跑一次 verify)。

### [ ] kos-patrol Phase 4 stoplist for Notion email/UI labels

**Why**: 这条从 04-23 archived TODO 滚到现在没修。最新 patrol dashboard
显示 20 entity gaps 全部是 Notion email/UI column headers ("Action Type",
"Original EML", "Key Points", "Best Regards", "Open Threads", ...)。
真实 gap 被噪声淹没。Notion 经过 Path 3 重新 ingest 之后会持续滋生。

**What**:
- Add `STOPLIST` const in `skills/kos-jarvis/kos-patrol/run.ts` Phase 4
  用 ~30 个明显 offender。
- 或更聪明:require candidate appears in ≥2 distinct `kind` categories
  (not just N notion-source rows)。

**Acceptance**: 明天的 patrol dashboard 显示 ≤5 gaps,全为真实 entity。

**Scope**: 1 h。

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

### [ ] Zombie `gbrain sync` subprocess leak — 降级 observation

**Why原 P1**: PGLite 时代发现 6 个长跑 zombie 持有 lock。Path 3 之后
Postgres MVCC 让 zombie 不再阻塞其他 client,所以"leak 即灾难"已经不
存在 — 但 leak 本身的 root cause(spawn 来源未识别)仍没解决。

**Now**: 持续 24 h `pgrep` 监测。若 0 zombie,标记为 closed-by-Path3。
若仍出现,追溯 spawn 来源(最可能 `com.jarvis.kos-deep-lint` 老 cron)。
不再列为 active 调查项,只在 patrol Phase 7 加"stale-process check
WARN"作 cheap 监测。

**Acceptance**: 24 h 监测 0 zombie → 归档到 Done。或加 patrol Phase 7
WARN check 作 cheap 持续监测。

**Scope**: 0-1 h(只加 patrol check)。

### [ ] Calendar checkpoints (carried forward, post-Path-3 调整)

| Date | Action | 状态 |
|---|---|---|
| 2026-05-04 | Stage 4 v1 archive — `com.jarvis.kos-api.plist.bak` to `_archive/`,archive v1 GitHub repo | active |
| 2026-05-07 | Step 2.4 commit-batching review for `~/brain` per-ingest commits | active |
| 2026-05-25 | Re-evaluate Gemini 3072-dim embeddings vs current 1536-dim truncation | active |
| ~~Trigger-based~~ | ~~PGLite → Postgres switch~~ | **CLOSED 2026-04-29 via Path 3 (§6.18)** |

---

## P3 — speculative

### [ ] Push to origin/master (now 8 commits ahead)

**Why**: master 比 origin 多 8 commits(includes v0.22.8 sync, spawnAsync
fix, Path 3 Postgres migration)。Lucien 控制 push 时机。

**What**: 
```bash
git push origin master  # 8 commits ahead
```
(in next session,after smoke 30 min on Postgres + 0 zombies confirmed)

**Acceptance**: GitHub `ChenyqThu/jarvis-knowledge-os-v2` master HEAD =
local HEAD (currently `33c0410`)。

**Scope**: 1 min(在 next session 的系统 review 完成 + production
stable 之后)。

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
