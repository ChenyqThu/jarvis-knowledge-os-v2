# Plan Adjustments — 迁移期间发现的偏差记录

> Last updated: 2026-04-17 (post-cutover Phase 2+3 wave)

主 plan 文件在 `/Users/chenyuanquan/.claude/plans/docs-gbrain-vs-kos-analysis-md-gbrain-parsed-candle.md`。
本文件记录执行中发现与原 plan 的偏差、以及对应的处理方案。

---

## 1. GBrain 的目录模型是 **20-dir MECE**，不是 9-type

**原 plan 假设**：KOS 9 types（source/entity/concept/project/decision/synthesis/
comparison/protocol/timeline）直接挂到 GBrain 的 `type` 字段上。

**实际情况**：GBrain 的 `docs/GBRAIN_RECOMMENDED_SCHEMA.md` 定义了 20 个
MECE 目录（people/companies/deals/meetings/projects/ideas/concepts/writing/
programs/org/civic/media/personal/household/hiring/sources/prompts/inbox/
archive/agent），并有 `RESOLVER.md` 决策树强制 MECE 归档。它的粒度比
KOS 9 types 更细，且以**目录**而非**字段**表达类型。

**处理**：
- 让 GBrain 原生 20-dir 作为 canonical type system
- KOS 9 types 作为 frontmatter 的 `kind` 字段保留（实测 `gbrain import`
  完整保留自定义 frontmatter），用于质量管控（如 decision 页面的证据要求
  不同于 source 页面）
- 新增 `type-mapping.md`：KOS `kind` ↔ GBrain dir 的映射表
  - 例：KOS `kind: synthesis` → GBrain `concepts/` 或 `writing/`
  - 例：KOS `kind: entity`（人）→ GBrain `people/`
  - 例：KOS `kind: decision` → GBrain `concepts/` + `kind: decision` 保留
- `dikw-compile` skill 在写页面时同时设置 GBrain dir 路径和 KOS kind 字段

## 2. `gbrain migrate` ≠ 导入

**原 plan 用语**：`gbrain migrate --source <dir>`

**实际**：`gbrain migrate --to <pglite|supabase>` 是 DB 引擎切换命令。
真正的批量导入是 `gbrain import <dir> [--no-embed]`。增量 git 同步用
`gbrain sync --repo <path>`。

**处理**：主 plan 后续阶段的 `gbrain migrate` 全部替换为 `gbrain import` 或
`gbrain sync`。Week 4 的全量迁移用：
```bash
gbrain import ~/Projects/jarvis-knowledge-os/knowledge/wiki/ --no-embed
gbrain embed --all       # 需要 OPENAI_API_KEY，Week 2 前补
```

## 3. Frontmatter 保真优于预期

**原 plan 担心**：GBrain migrate 可能丢失 KOS 的 9 类自定义字段
（id/kind/confidence/source_refs/source_of_truth/owners/...）。

**实测**：5 页冒烟导入，所有 KOS 自定义字段完整保留。GBrain 的 schema
对未知字段是"透传"而非"丢弃"，`gbrain get <slug>` 原样输出。
风险表第一项（migrate 字段丢失）可以降级为低风险。

## 4. `templates/` 不存放页面模板

**原 plan**：把 KOS 9 种页面模板复制到 v2 根目录 `templates/`。

**实际**：GBrain 的根 `templates/` 只放身份文件
（SOUL.md.template / USER.md.template / ACCESS_POLICY.md.template /
HEARTBEAT.md.template）。页面模板的 canonical 位置在
`docs/GBRAIN_RECOMMENDED_SCHEMA.md` 内联示例。

**处理**：KOS 9 种模板放 `skills/kos-jarvis/templates/`，不碰根 templates/。

## 5. OpenAI key 的影响范围比预期小

**原 plan**：担心没有 OPENAI_API_KEY 会阻塞 Week 1。

**实测**：`gbrain init`、`gbrain import --no-embed`、`gbrain list`、
`gbrain search`（BM25 keyword）都不需要 OpenAI。OpenAI 仅用于 `gbrain embed`
（向量化）和 hybrid search 的 query expansion。

**处理**：Week 1 和 Week 2 核心 skill 开发可无 OpenAI 推进。Week 3
`notion-ingest-delta` 和 Week 4 全量 embed 前补 OPENAI_API_KEY 即可。

## 6. GStack 缺失，非阻塞

**观察**：`gbrain init` 提示 `GStack: not found`，建议安装到
`~/.claude/skills/gstack/`。GStack 是 thinking skills pack（office-hours /
ceo-review / investigate / retro），跟知识库本身正交。

**处理**：本次迁移不装 GStack。如后期需要思考类 skill，再评估。

## 7. 实测 import 性能

**数字**：6 页 / 0.1s = 60 pages/s，全部是文件操作 + PGLite upsert。
85 页估算 ~1.5s，31M raw/ 也不构成瓶颈。Week 4 的全量 import 预算可以
从"半小时"收紧到"1 分钟内"。

---

## 8. enrich-sweep Tier 1 降级(2026-04-17)

**原 plan 假设**：Phase 3 有外部 API(Tavily/Brave/Exa for Tier 2,
Crustdata/Proxycurl/PDL for Tier 1)。

**实际**：只有 `TAVILY_API_KEY` 可用(Lucien 已配置);无 Crustdata 类
结构化人物 API。

**处理**:
- Tier 1 候选(mention ≥ 8 或出现在 decisions/meetings)**降级为 Tier 2 处理**
  — 走 Tavily web 搜索而非 LinkedIn-like 结构化数据
- stub 里加 `tags: wants-tier1` 标记,enrich-sweep 报告里列出这批候选
- 未来 Lucien 补 Crustdata key 后,针对 `wants-tier1` 名单重跑(增量模式)

## 9. `gbrain put` 已自动 embed(2026-04-17)

**原 plan**:enrich-sweep 需要先 `gbrain put` 再 `gbrain embed <slug>`。

**实际**:`gbrain put --help` 文档里写着 "Chunks, embeds, and reconciles
tags" — 写入时自动 chunk + embed + tag。无需显式调用 `gbrain embed`。

**处理**:enrich-sweep/run.ts Phase D 只调 `gbrain put`,省去一次 embed
往返。Gemini shim 必须在线(预飞检查已覆盖)。

## 10. `~/brain/` 本地目录不存在(2026-04-17)

**观察**:虽然 `digest-to-memory/run.ts` 和 `kos-patrol/SKILL.md` 都默认
`BRAIN=~/brain`,但该目录实际上不存在 — GBrain 的页面只驻在 PGLite DB
中。`~/brain/agent/` 子树只在有 skill 显式写入时才被 `mkdir -p` 出来。

**处理**:enrich-sweep 的报告写入路径 `~/brain/agent/reports/` 在 run.ts
里已加 `mkdir -p`。读/写"页面"走 `gbrain list/get/put`,不走文件系统。

## 11. `gbrain list --json` 不支持(2026-04-17)

**观察**:`gbrain list` 在带 `--json` flag 时仍输出 TSV(未实现)。

**处理**:enrich-sweep 和 kos-patrol 都按 kos-lint 约定解析 TSV
(`slug\tkind\tupdated\ttitle`)。

## 12. P1 kos-lint path-resolver 尚未修,首次 patrol 报告 116 ERROR(2026-04-17)

**观察**:kos-patrol 首跑报告 116 个 dead-link ERROR — 多半是 v1 导入的
相对路径(`../syntheses/foo.md` vs 扁平 slug `foo`)。

**处理**:归为 P1,不在本 wave 修。patrol 报告可读性可接受;enrich-sweep
自身不依赖 lint 结果。下一个 wave 的第一件事应修 kos-lint/run.ts 的
path-resolver,让数字回到真实值(< 20)。

---

## 升级路径的假设验证(需持续观察)

- [ ] upstream merge 冲突面是否真的只在 RESOLVER.md? → 等第一次 upstream 有
      更新时验证
- [ ] kos-jarvis skills 和 upstream skills 是否会竞争 routing? → 需要看
      RESOLVER.md 扩展段的写法是否 override upstream
- [ ] OpenClaw manifest (`package.json` 里的 `openclaw.compat`) 是否影响
      本 pack? → 看 OpenClaw 侧后续集成方式
