# Bug Report: notion-poller → kos-compat-api PGLite 锁死锁

**报告日期**: 2026-04-28  
**严重程度**: High — 导致 kos.chenge.ink 外部完全不可用  
**发现者**: Jarvis (OpenClaw)  
**状态**: 🟡 **方案 A (短期) 已实施 2026-04-29** — 事件循环不再被
spawnSync 冻结。**方案 B (彻底)** 仍是 P1 follow-up
([TODO.md](../../skills/kos-jarvis/TODO.md))。

---

## 2026-04-29 update — 方案 A landed (commit `<pending>`)

`server/kos-compat-api.ts` 的 4 个 `spawnSync` 调用全部替换为 `spawnAsync`
(基于 `node:child_process.spawn` 的 Promise 包装)。事件循环不再因为
gbrain 子进程运行被冻结。

**Concurrency proof** (smoke test 2026-04-29 03:42 local):
- /ingest in flight (gbrain sync 正在工作)
- 同时 5 次 /status 探针 → **HTTP 200 in 161-193ms**(修复前会阻塞 30+ 秒)

仍然存在的问题(独立于事件循环):
- gbrain sync 子进程仍可能因 PGLite 锁竞争 hang(对 SIGTERM 可能不响应,
  SIGKILL 才能解锁) → 留下 zombie 子进程持有锁
- v0.22.8 同步后 `sources.chunker_version=null` 触发**全量 re-walk**,
  每次 /ingest spawn 一次 gbrain sync 都触发 207-file 重整,5+ 分钟一次,
  我们的 180s timeout 砍掉它再次留下 zombie → 循环放大

下一步:
- P2 — 一次性 `gbrain reindex-code --yes` 或长 timeout 全量 sync,settle
  `chunker_version` → subsequent ingests 走快速路径
- P1 — 方案 B (kos-compat-api 内 BrainDb 直写,无子进程) — 根除锁竞争

---

## 原始报告 (2026-04-28)

---

## 问题现象

1. `kos.chenge.ink/status` 外部请求持续超时（45s 无响应）
2. `localhost:7225/status` 本地请求同样超时
3. server stdout 日志每隔 ~30 秒出现一对：
   ```
   {"method":"POST","path":"/ingest","status":500,"dur_ms":30183}
   {"method":"GET","path":"/status","status":200,"dur_ms":310}
   ```
   `/ingest` 精确耗时 30 秒后返回 500，随后 `/status` 才能通
4. `lsof -i :7225` 显示 PID 70543（`bun run workers/notion-poller/run.ts`）保持连接

---

## 根本原因

### 层次一：`spawnSync gbrain import` 阻塞 Bun 事件循环

`server/kos-compat-api.ts` 的 `/ingest` handler 内部调用：

```typescript
const result = spawnSync("gbrain", ["import", ...], { ... });
```

`spawnSync` 是**同步调用**，在整个 gbrain 进程运行期间，Bun HTTP server 的事件循环完全冻结，无法处理任何其他请求（包括 `/health`、`/status`、外部 Cloudflare tunnel 转发的请求）。

### 层次二：PGLite 单写锁竞争

PGLite 是嵌入式 Postgres，**同一时间只允许一个进程持有写锁**。

当前进程锁持有情况：
- `kos-compat-api` server（PID 59235）: 启动时打开 PGLite 连接，长期持有读锁
- `gbrain import`（由 spawnSync 触发）: 需要写锁 → 等待 server 释放 → server 在等 gbrain 完成 → **死锁**

gbrain 的锁等待超时设置为 **30 秒**，因此每次 `/ingest` 都精确卡 30 秒后返回 500：
```
GBrain: Timed out waiting for PGLite lock.
```

### 层次三：notion-poller 每 5 分钟触发一轮连续 ingest

notion-poller 的 launchd 配置 `StartInterval: 300`（5 分钟），每次运行会对所有 Notion DB 里最近编辑的页面逐一调用 `/ingest`。

当前监控的 DB（来自 `.env.local`）：
- `2df15375830d8094980efd1468ca118c` — email inbox（页面数量多，每次触发大量 ingest）
- `2f015375830d80b7b057cfe94de8a40c` — calendar event

每个 `/ingest` 耗时 30s（死锁超时），多个页面串行下来，一轮 notion-poller 可能持续数分钟，期间 server 完全不可用。

---

## 复现路径

```
launchd 定时触发 notion-poller (每 5 分钟)
  → notion-poller: POST /ingest (page 1)
    → kos-compat-api: spawnSync("gbrain", ["import", ...])  [阻塞事件循环]
      → gbrain: 尝试获取 PGLite 写锁
        → kos-compat-api server 持有 PGLite 连接 (读锁)
          → gbrain 等待 30 秒 → 超时 → 返回 500
    → 事件循环解冻
  → notion-poller: POST /ingest (page 2)
  → ...（重复）
```

此间所有其他请求（外部 Cloudflare tunnel → kos.chenge.ink）均被 Bun 阻塞，表现为永久超时。

---

## 历史背景

plist 注释中记录了上一次死锁修复尝试（2026-04-22，v0.17 sync）：
```
<!-- As of v0.17 sync (2026-04-22), this is a DIRECT bun invocation (pre-v0.14 design).
The v0.14-era wrapper at scripts/minions-wrap/notion-poller.sh was retired because
the outer `gbrain jobs submit --follow` held the PGLite write lock while
/ingest -> `spawnSync gbrain import` inside kos-compat-api needed it
→ 10-min deadlock every cycle. -->
```

**v0.14 修复** 去掉了 Minions 层，锁死时间从 10 分钟缩短到 30 秒，但死锁本质未解决。

---

## 临时缓解措施

Jarvis 已手动 `kill -9 70543` (notion-poller)，kos.chenge.ink 恢复响应。

⚠️ **但 launchd `StartInterval: 300` 会在下次触发时重新启动 notion-poller**，问题将复现。

建议立即禁用 launchd job：
```bash
launchctl unload ~/Library/LaunchAgents/com.jarvis.notion-poller.plist
```

---

## 修复方案（供 Claude Code 参考）

### 方案 A：最小改动（推荐先做）

**将 `kos-compat-api.ts` 的 `/ingest` 中 `spawnSync` 改为非阻塞**

核心思路：`/ingest` 接收 markdown → 写入磁盘文件 → 立刻返回 202 → 后台 worker 异步 import。

```typescript
// 当前（有问题）
const result = spawnSync("gbrain", ["import", slugPath], { timeout: 30000 });

// 改为（方案 A）
// 1. 写 markdown 到临时文件
// 2. 用 spawn（非 sync）启动 gbrain import
// 3. 立即返回 202 Accepted + { slug, queued: true }
// 4. 或用内置 BrainDb API 异步操作（见方案 B）
```

关键点：只要不用 `spawnSync`，事件循环就不会被冻结，`/status` 等请求可以正常响应。

### 方案 B：从根本解决（推荐彻底修复）

**在 kos-compat-api server 内部直接使用 BrainDb TypeScript API，不 spawn gbrain CLI**

- BrainDb 已作为 TypeScript 库存在（`skills/kos-jarvis/_lib/brain-db.ts`）
- Server 和 BrainDb 在**同一进程**内 → 不存在跨进程 PGLite 锁竞争
- ingest 操作变为纯 async/await，完全不阻塞事件循环

```typescript
// 当前
const result = spawnSync("gbrain", ["import", slugPath]);

// 方案 B
const db = new BrainDb(BRAIN_DIR);
await db.put({ slug, markdown, title, kind, source, tags });
// BrainDb.put 是 async，不阻塞，不争锁
```

**副作用**: embed（向量化）也需要在进程内完成（调用 gemini-embed-shim HTTP API），而不是依赖 gbrain CLI 的 embed 子命令。

### 方案 C：限流 + 队列（工程改进）

在 notion-poller 侧增加限流：
- 每次 ingest 后 `sleep 2s`（给 server 喘息窗口）
- 或改为串行队列，一次只发一个 `/ingest`，等 200 再发下一个

这不能解决 30 秒死锁，但可以减少 server 不可用的连续时长。
**不推荐单独使用**，需配合方案 A 或 B。

---

## 推荐修复顺序

1. **立即**: `launchctl unload ~/Library/LaunchAgents/com.jarvis.notion-poller.plist` 防止问题复现
2. **短期**: 实施方案 A（`spawnSync` → 非阻塞），消除事件循环冻结
3. **中期**: 实施方案 B（BrainDb 直接 API），彻底消除跨进程 PGLite 锁竞争
4. **验证**: 
   ```bash
   # 启动 notion-poller 压测
   bun run workers/notion-poller/run.ts --backfill &
   # 同时验证 /status 可用性
   watch -n2 'curl -s --max-time 3 https://kos.chenge.ink/status | jq .total_pages'
   ```

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `server/kos-compat-api.ts` | `/ingest` handler，`spawnSync` 在此处 |
| `workers/notion-poller/run.ts` | Notion 轮询逻辑，HTTP `/ingest` 调用方 |
| `skills/kos-jarvis/_lib/brain-db.ts` | BrainDb TypeScript API（方案 B 的依赖） |
| `~/Library/LaunchAgents/com.jarvis.notion-poller.plist` | launchd job，`StartInterval: 300` |
| `~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist` | server launchd job，`KOS_API_PORT: 7225` |

---

## 当前 KOS 状态（2026-04-28 修复后）

```json
{
  "total_pages": 2117,
  "engine": "gbrain (pglite)",
  "brain": "/Users/chenyuanquan/brain"
}
```

`kos.chenge.ink` ✅ 外部可访问（notion-poller 已 kill，server 正常）
