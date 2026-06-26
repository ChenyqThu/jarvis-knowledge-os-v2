# Notion Jarvis ↔ kos-worker 使用指南

> Audience: Notion Jarvis(Notion AI agent + kos-worker tools)
> Author: Lucien × Jarvis v2 · 原版 2026-04-17 · **刷新 2026-06-26(§6.38 closure pass)**
> 状态:kos-worker 已部署 Notion 侧,端到端链路 **2026-06-26 实测通**
> (`ntn workers exec kosStatus` / `kosQuery` 均 success,落在 brain 的
> `mcp_request_log`)。本文告诉 Notion Jarvis 日常处理信息时怎么调用。

## ⚠️ 2026-06-26 刷新说明(先读这条)

2026-04 旧版描述的链路已全部退役。当前事实:

- **wire**:kos-worker 经 **OAuth 2.1 + MCP(JSON-RPC)** 连
  `https://kos.chenge.ink/mcp`(不再是旧的 kos-compat-api Bearer / `/query`)。
- **后端**:jarvis Mac 上 `gbrain serve --http :7225`(**Postgres + pgvector**,
  gbrain **0.42.53.0**,**25,000+ 页**,openai `text-embedding-3-large`@1536 向量)。
- **notion-poller 已 RETIRED**(2026-05-17, §6.27)。不再有 poller 自动摄入
  「受监控 DB」——所以旧文「别和 poller 重复干活」这条**作废**:URL / 粘贴正文 /
  meeting notes / 任何查询**都归你**。邮件由 mailagent 独立直推,不走你。
- **工具是 3 个**:`kosQuery` / `kosIngest` / `kosStatus`。旧文提到的 `kosDigest`
  已下线(用 `kosQuery` 问「最近 brain 有什么新东西」即可)。
- **嵌入不会再 `embedded=false`**:gemini-shim 已退役,嵌入走 gbrain 内置网关。

## 你是什么,能拿到什么

你是 Notion 里的 AI 助手,拥有一个 `kos-worker`(已部署,workspace 可见)。它暴露
**3 个工具**,底下经 OAuth+MCP 对接住在 Lucien Mac 上、`https://kos.chenge.ink`
暴露的 `gbrain`(Postgres + 向量化 + 跨源知识库,2.5 万+ 页)。

两件事:
1. **问 brain**:中文/英文自然语言问题,拿回跨来源结果(`kosQuery`)
2. **写 brain**:把此刻在 Notion 里看到的有价值内容(文章 URL / markdown 正文)
   推进 brain(`kosIngest`),之后所有 Notion / 飞书 / CLI 查询都能检索到

## 架构位置

```
  Lucien in Notion  →  Notion Jarvis (你)
        │ 调用工具
        ▼
  kos-worker  (已部署 Notion Worker, v0.2.0)
        │ OAuth 2.1 + MCP (JSON-RPC)
        ▼
  https://kos.chenge.ink/mcp  →  gbrain serve --http :7225 on jarvis Mac
        │
        ▼
  gbrain (Postgres + pgvector, te3@1536)  ←  dream-cycle / kos-patrol / enrich-sweep 周期任务
```

## 工具清单

### 1. `kosQuery` — 检索知识库

**何时用**
- Lucien 问「我之前看过的 XX 怎么说来着?」
- 写 PRD 时要回忆 harness / context engineering / agent 架构的既有判断
- 起草某人简介时想看 brain 里有没有他的页面
- 任何时候不确定某个概念的精确定义
- 「最近 brain 有什么新东西?」(旧 kosDigest 的活现在也用它)

**不要用**
- 你自己能直接答、不依赖 Lucien 私有语境的问题(如「React 是什么」)——浪费 token
- 需要实时信息的问题(股价、今天天气)。brain 是知识层,不是实时层。

**参数**:`question`(必填,字符串):中文优先,完整自然句,一次一个问题。

**返回**:跨来源的相关结果(带 `[concept:xxx]` / `[source:xxx]` 内部标识 + 相似度分)。
可在回复里保留这些标识或转译成「见 xxx」。

### 2. `kosIngest` — 摄入内容到知识库

**何时用 `markdown` 路径**
- Lucien 说「这段内容很有价值,帮我存到知识库」
- 你看到某个 Notion 页面值得长期保留
- Lucien 粘贴邮件 / 聊天记录 / 论文段落,希望沉淀

**何时用 `url` 路径**
- Lucien 发来某篇文章 / Blog / Twitter thread 链接,要 brain 存一份

**何时都不要调**
- 只是闲聊,内容不值得长期保留
- 内容是你自己刚总结的 summary(除非 Lucien 明确让你存)

**参数**

| 参数 | 类型 | 说明 |
|---|---|---|
| `url` | string? | 要摄入的 URL。与 `markdown` 二选一。 |
| `markdown` | string? | markdown 正文。可带自己的 YAML frontmatter(`---` 开头),也可不带(服务端补默认)。 |
| `title` | string? | 页面标题,强烈建议填。 |
| `slug` | string? | 自定义英文短横线 slug,默认从 title 生成。 |
| `kind` | string? | `source`(默认)/ `concept` / `project` / `decision` / `synthesis` / `protocol` / `timeline` / `comparison` / `entity`。绝大多数保持 `source`。 |
| `source` | string? | 来源标识,默认从 URL / notion_id 推断;手动场景写 `manual:<描述>`。 |
| `notion_id` | string? | 内容来自某 Notion 页面就传 UUID,会进 frontmatter 便于溯源。 |
| `tags` | string[]? | 追加到 frontmatter.tags 的额外标签。 |

> **溯源(2026-06-26 增强)**:worker 现在把 `source` / `notion_id` / `ingested_via:
> kos-worker` / `ingested_at` 写进 frontmatter,所以你存的页面之后可被
> `frontmatter->>'source'` 精确溯源。尽量填 `title` + `source`(或 `notion_id`)。

**示例:用户粘贴的 meeting 纪要**
```
kosIngest({
  title: "2026-06-26 Omada 周会要点",
  markdown: "- 决定把 MR-HD roadmap 延后一个 sprint\n- Lucien 写 PRD 并 loop Alex",
  kind: "source",
  source: "manual:omada-weekly-2026-06-26",
  tags: ["meeting", "omada"]
})
→ { imported: true, slug: "sources/2026-06-26-omada-..." }
```

### 3. `kosStatus` — 健康快照

**何时用**:Lucien 问「brain 现在什么状况?」/ 你怀疑 ingest 失败想先确认服务在不在。

**返回**:最近 100 页采样的 `by_type` 分布 + `latest_updated_at`(MCP `list_pages`
上限 100;要全库精确总数让 Lucien 在 host 跑 `gbrain status`)。

## 错误模式和兜底

| 症状 | 可能原因 | 你应该做 |
|---|---|---|
| `kosIngest` 返回 502 | 上游 URL fetch 失败(404 / CF 拦截) | 告诉 Lucien,建议手动复制为 markdown 再调一次 |
| `kosQuery` 返回空或低相关 | 问题太宽,或 brain 真没内容 | 换更具体问法重试;仍不行就说「brain 里没明确记录」 |
| 连接超时 / 401 | daemon 挂了 / OAuth token 失效 | 告诉 Lucien「kos.chenge.ink 不可达或 token 失效,检查 `gbrain-serve-http` launchd」 |

## 复活提醒(2026-06-26)

**基础设施 100% 正常**(本日实测:kosStatus + kosQuery 端到端 success)。如果你最近
很少调这些工具——**主动用起来**:
- Lucien 问起既有判断 / 概念 / 人物时,先 `kosQuery` 再答
- 看到值得长期保留的内容(非邮件)主动 `kosIngest`
- 不确定时,`kosStatus` 确认 brain 在线

## Appendix: kos-worker 部署方(host 侧)

```bash
cd workers/kos-worker
npm run check          # typecheck
ntn workers deploy     # 推到 Notion
ntn workers env push   # 如果改了 env(OAuth client_id/secret、MCP endpoint)
```

部署文件:`workers/kos-worker/src/index.ts`(当前 v0.2.0,3 tools)。
host 侧验证一次调用是否落地:
```bash
psql "postgresql://chenyuanquan@127.0.0.1:5432/gbrain" -tAc \
  "SELECT operation, status, created_at FROM mcp_request_log WHERE agent_name='kos-worker' ORDER BY created_at DESC LIMIT 3"
```
