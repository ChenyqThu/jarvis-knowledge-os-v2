# KOS 综合运维手册

> 面向 Lucien 的操作手册：知识沉淀怎么发生、有富余预算时该买什么、哪些东西被停用了以及为什么。
> 建立于 2026-07-28，起因是一次生产事故（见文末"事故背景"）。

---

## 一、先搞清楚谁在产生知识

这是最容易搞混的一点。KOS 里有**两条**产生实体页的流水线，它们互不认识：

| 流水线 | 产出 | 页面 `type` | 质量 |
|---|---|---|---|
| **dream cycle 的 `synthesize_concepts`** | 带"一句话定性"的真内容 | `person` / `company` / `concept` | 人物公司 **~99%** 覆盖 |
| **`enrich-sweep`（fork 自加）** | 只有反链列表的空壳 | `entity` | **0%** 综合 |
| **`synthesis-sweep`（fork 自加）** | 带证据引用的深度档案（dossier） | 原地覆写实体页 | 手工触发，2,566 页已做 |

**真正的知识来自第一条和第三条。** `enrich-sweep` 只造壳，它的产出必须再经过 `synthesis-sweep` 才有内容。

### 每晚自动发生什么

launchd `com.jarvis.dream-cycle` 每日 **03:11 (PT)** 跑 `skills/kos-jarvis/dream-wrap/run.ts`，约 20 个阶段。产生知识的是：

```
extract        链接/时间线物化
extract_facts  从 ## Facts 围栏抽事实
extract_atoms  Haiku → 原子页（无新内容时正常跳过）
patterns       跨会话主题
synthesize_concepts   概念综合 ← 主力，一轮约 2,630 个 concept、~35 分钟
consolidate    Sonnet 把事实聚成 take
propose_takes / grade_takes
embed          补嵌 stale chunk
```

**`status=partial` 是常年基线，不代表故障。** 它由 `lint: warn`（650 条待修）和 `extract_facts: warn`（3,186 条 legacy fact 待围栏）驱动，与综合无关。判断健康要看**归档有没有生成**：

```bash
ls -t ~/brain/.agent/dream-cycles/*.json | head -3
```

失败时 `archiveReport()` 根本不写归档，所以 `latest.json` 可能长期指向一次白天的手动运行而**伪装成健康**。看时间戳：定时运行的归档应该是 UTC 10:xx（= PT 03:11）。

---

## 二、`synthesis-topup` —— 把富余预算变成知识

### 用法

```bash
bun run skills/kos-jarvis/synthesis-topup/run.ts
```

不带参数 = 只报缺口，不花钱。输出长这样：

```
model: claude-sonnet-5 (sonnet pricing $3/$15 per 1M)
measured from 2566 past entities: ~87208 in + 3112 out tokens = $0.31/entity

gap: 2266 entities with >=3 neighbors and no dossier
     full cost if you did all of them: $699

  by source: mailagent-emails=2248  default=15  omada=3
  by type:   concept=1135  project=909  entity=221  person=1
```

定预算，出计划（**仍然不写**）：

```bash
bun run skills/kos-jarvis/synthesis-topup/run.ts --budget-usd 50
```

确认计划后真跑：

```bash
bun run skills/kos-jarvis/synthesis-topup/run.ts --budget-usd 50 --go
```

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--budget-usd N` | 无 | 花多少钱。不给就只报告 |
| `--min-neighbors N` | 3 | **质量下限，不是性能旋钮**（见下） |
| `--concurrency N` | 3 | 透传给 synthesis-sweep |
| `--go` | 关 | 真正执行。默认只出计划 |

### 三个必须知道的坑

**1. $0.31 是均值，但它总是先买最贵的。**

预算换算用的是均值（`$5 ÷ $0.31 ≈ 16 个`），可实际挑选是**按邻居数降序**——也就是从最贵的那一端开始拿。队列顶端那些有 1,000+ 邻居，上下文体量是均值的十几倍。

所以：**计划里的 $5 会花掉明显多于 $5。** 偏差随批次变小而变大（小批全是长尾，大批才会被均值稀释）。

> 先跑 `--budget-usd 5 --go`，对一下真实扣费和 checkpoint 里新增记录的 `in_tokens`，得到你自己的单价，再决定放量。别直接照 $699 做预算。

**2. `--min-neighbors` 调低 = 买到更多页面和更少知识。**

低于 3 个关联页就没有足够素材可综合，模型只能注水。这个参数控制的是"有没有东西可写"，不是"跑多快"。

**3. `person` 显示接近 0 是正确的，不是 bug。**

人物和公司在 `default` 和 `mailagent-emails` 两个源都已 ~99% 综合。**长期缺口一直是 `concept`（1,135）和 `project`（909）**，这两类从来没被系统性处理过。

### 它和 `synthesis-sweep` 的关系

`synthesis-topup` 不自己做综合，它只回答"该做哪些"，然后调 `synthesis-sweep`。因为后者：

- 一次只吃一个 `--source`，而缺口横跨三个源且**极不均匀**（2248 / 15 / 3）
- 没有预算上限的概念
- 默认会直接写

想绕开 wrapper 直接用底层工具也可以，`--go` 之前它会把命令原样打出来：

```bash
bun run skills/kos-jarvis/synthesis-sweep/run.ts --source mailagent-emails --limit 16 --min-neighbors 3 --concurrency 3 --resume
```

`--resume` 让它跳过 checkpoint 里已完成的，所以**重复运行是安全且便宜的**，不会为已有档案二次付费。

---

## 三、被停用的东西（别随手打开）

### `enrich-sweep` 的周 cron —— 已 `launchctl disable`

```bash
# 现状（重启也不会自动回来）
launchctl print-disabled gui/$(id -u) | grep enrich
```

**停用原因不是它坏了，是它的设计规模不对。** 它自己的 SKILL.md 写着：

> fill the gap between "86 pages, 3 entity pages" and "86 pages, ~30 entity pages"
> Nightly cron is a future possibility but **not wired in v1.0; too expensive to run every day at full-brain scale**

它是为 **86 页**的脑子设计的**一次性**工具，产出 20–40 个 stub 交人工审阅。有人还是把它接到了周 cron 上。现在脑子 29,683 页，同样的算法每周产出 **3,237 个空壳**——那不是待办队列，只是量。

要重新启用前先想清楚：**空壳本身不是知识**，它还需要 `synthesis-topup` 花钱填肉。

### Tavily 网页增强 —— 已改为 `--tavily` 显式开启

内部语料的人名拿去公网搜同名人，结果**多半是另一个人**。实测错误案例：

- `people/chris-wright` → "美国前能源部长"
- `people/xiaoyu-sun` → "前 WNBA 球员，纽约自由人"
- `people/charlie-ling` → "西安大略大学教授，150+ 论文"

但也不是全错——`khalid-yang`（TP-Link 监控产品总监）、`crustdata`（数据供应商）是准的。**逐页不可知，所以默认关闭。**

---

## 四、出事了怎么回滚

所有批量操作都留了快照表，**没有硬删除**：

| 快照表 | 内容 |
|---|---|
| `pages_clobber_snapshot_20260727` | 614 页被覆写前的状态 |
| `pages_tavily_snapshot_20260727` | 9 个 Tavily 污染页（07-27 首轮清理） |
| `pages_redundant_stub_snapshot_20260728` | 989 个冗余空壳（软删除前） |
| `pages_tavily_snapshot_20260728` | 3 个 Tavily 错误页（全脑扫描后） |

查现存快照：

```sql
SELECT tablename FROM pg_tables WHERE tablename LIKE 'pages_%snapshot%' ORDER BY 1;
```

软删除的页面用 `deleted_at` 标记，恢复只需：

```sql
UPDATE pages SET deleted_at = NULL WHERE ...;
```

Postgres 每日备份在 `~/.gbrain/backups/`，**保留 15 天**（最早 2026-07-13）：

```bash
ls -t ~/.gbrain/backups/gbrain-*.dump | head -3
```

> ⚠️ **备份窗口只有 15 天。** 07-13 之前被覆写的页面（06-01/06-02 那两批共约 2,963 个 stub）已**永久丢失**，无从核实。批量操作前先确认当天备份存在。

恢复到临时库比对（**不碰生产**）：

```bash
createdb gbrain_restore_check
pg_restore -d gbrain_restore_check -t pages --no-owner --no-acl ~/.gbrain/backups/gbrain-YYYYMMDD.dump
```

---

## 五、事故背景（为什么有这些护栏）

2026-07-27，一次 `enrich-sweep` 运行覆写了 **614 个生产页面**，其中 411 个有真实内容。

根因是**存在性检查和写入指向不同的源**：检查读 `mailagent-emails`（NER 语料源），写入却因为 `gbrain put` 没带 `--source` 落到 `default`。于是 `default` 里已有的实体页在检查中完全隐形，被判定为"新"，用模板覆写。

日志里唯一的征兆是这一行：

```
[resume] 3237 to write, 0 already exist (skipped)
```

**一个已有 2,990 个实体页的脑子，抽出 3,237 个实体，零碰撞——这在统计上不可能。** 这行输出当时就在屏幕上，没人追问。

取证还发现同一个 bug 从 **2026-04-17** 起每次成功运行都在覆写（06-01 批 402 个、06-02 批 2,561 个）。

### 由此确立的规矩

1. **批量写入必须先出计划**，`--go` 才执行
2. **`gbrain put` 必须带 `--source`**，slug 跨源不唯一
3. **零碰撞是危险信号**，不是干净信号
4. **判据要抽样验证再批量执行**——清 Tavily 时第一版判据会误删 229 个合法页（把老版 stub 模板的 `- Role: unknown` 当成了 Tavily 散文），抽了 14 个样本才发现
5. **跑完整 `bun test` 会污染生产配置**——`test/schema-cli.test.ts` 等会写 `~/.gbrain/config.json`，曾把 `schema_pack` 从 `gbrain-everything` 冲成 `gbrain-base-v2`，导致两个综合阶段被静默跳过

---

## 相关文件

- 命令实现：[`skills/kos-jarvis/synthesis-topup/run.ts`](../skills/kos-jarvis/synthesis-topup/run.ts)
- 底层工具：[`skills/kos-jarvis/synthesis-sweep/`](../skills/kos-jarvis/synthesis-sweep/)
- 空壳生成器（已停用 cron）：[`skills/kos-jarvis/enrich-sweep/`](../skills/kos-jarvis/enrich-sweep/)
- dream 包装器：[`skills/kos-jarvis/dream-wrap/run.ts`](../skills/kos-jarvis/dream-wrap/run.ts)
- 架构全景：[`docs/JARVIS-ARCHITECTURE.md`](JARVIS-ARCHITECTURE.md)
