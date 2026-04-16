---
name: kos-jarvis
description: |
  Lucien's KOS-flavored extensions on top of GBrain. DIKW compilation,
  E0-E4 evidence levels, confidence scoring, link-quality rules, the
  9 KOS page types (source/entity/concept/project/decision/synthesis/
  comparison/protocol/timeline) as augmentations to GBrain's 20-dir MECE,
  daily lint/patrol, and the MEMORY reflux bridge to OpenClaw.
type: extension-pack
owner: lucien
upstream_compat: garrytan/gbrain >= 0.10.1
---

# kos-jarvis — KOS extension pack over GBrain

Lucien 从 `ChenyqThu/jarvis-knowledge-os` (KOS v1, Python/Shell) 迁移到
GBrain fork 时带过来的**质量管控 + 编译深度**定制层。所有扩展都驻扎在
`skills/kos-jarvis/` 一个目录内，**不修改 upstream src/ 或其他 skills/**，
以便长期跟随 `garrytan/gbrain` upstream merge 而不产生冲突。

## 为什么存在

GBrain 的核心哲学是 Thin Harness, Fat Skills。其原生能力覆盖实体富化、
被动信号捕获、MCP 暴露——这些 KOS v1 没有，是迁移的首要动机。但 GBrain
不覆盖这些 KOS v1 已有的能力：

| KOS v1 独有 | GBrain 无 | 本 pack 提供 |
|------------|----------|-------------|
| DIKW 编译管道（Data → Information → Knowledge → Wisdom） | brain-ops 是内循环 | `dikw-compile/` |
| Evidence Levels E0-E4 | `confidence=high/med/low` 即止 | `evidence-gate/` |
| 编译评分 A/B/C/F | 无质量评分 | `confidence-score/` |
| kos lint 六项检查 | `maintain/` 有部分 | `kos-lint/` |
| kos patrol 巡检 + 缺口检测 | `maintain/` 覆盖一半 | `kos-patrol/` |
| 9 种页面类型（作为 kind 字段约束） | 20-dir MECE（作为目录约束） | `templates/` + `type-mapping.md` |
| MEMORY 回流到 OpenClaw `MEMORY.md` | 无 | `digest-to-memory/` |
| Notion 实时增量摄入 | 仅一次性 migrate | `notion-ingest-delta/` |
| 飞书消息通道 | 无 | `feishu-bridge/` |

## 目录结构（计划）

```
skills/kos-jarvis/
├── README.md                       # 本文件
├── PLAN-ADJUSTMENTS.md             # 迁移期间发现的计划偏差记录
├── type-mapping.md                 # KOS 9 types ↔ GBrain 20 dirs 映射
├── templates/                      # 9 种 KOS 页面模板（Week 1 搬运）
│   ├── source-page.md
│   ├── entity-page.md
│   ├── concept-page.md
│   ├── project-page.md
│   ├── decision-page.md
│   ├── synthesis-page.md
│   ├── comparison-page.md
│   ├── protocol-page.md
│   └── timeline-page.md
├── dikw-compile/                   # Week 2
├── evidence-gate/                  # Week 2
├── confidence-score/               # Week 2
├── kos-lint/                       # Week 2
├── kos-patrol/                     # Week 2
├── digest-to-memory/               # Week 3（保留澄清点）
├── notion-ingest-delta/            # Week 3
└── feishu-bridge/                  # Week 3
```

## 与 GBrain 原生 skills 的关系

- **依赖**：`brain-ops`, `enrich`, `migrate`, `query`, `maintain`, `signal-detector`
- **追加触发**：DIKW compile 在 `ingest-pipeline` 后追加一步（强关联 > 弱覆盖检查）
- **不覆盖**：本 pack 不替换原生 skills；在 GBrain upstream 行为之上做 opt-in 校验

## 升级策略

1. `git fetch upstream && git merge upstream/master`
2. 冲突面：仅当 upstream 动 `skills/RESOLVER.md` 的公共表格时。本 pack 只
   追加 RESOLVER 扩展段（文件末尾 `## KOS-Jarvis extensions` 下），不动
   upstream 内容
3. 每月对 upstream CHANGELOG.md 做一次 review，评估是否有 upstream 新能力
   可以替代本 pack 某一项扩展（扩展应随时间自愿退场，而非永久膨胀）

## 当前状态（2026-04-16）

- [x] Week 1: Fork，v1-frozen tag，bun install，gbrain init，5 页 import 冒烟（frontmatter 保真 100%）
- [ ] Week 2: 5 个核心 skill 移植
- [ ] Week 3: 桥接层（kos-worker、飞书、Notion delta、MEMORY 回流）
- [ ] Week 4: 85 页全量 + 7 天双读验证

详见 `/Users/chenyuanquan/.claude/plans/docs-gbrain-vs-kos-analysis-md-gbrain-parsed-candle.md`（主 plan 文件）
