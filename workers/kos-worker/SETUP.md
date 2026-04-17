# KOS Worker — Notion ↔ Knowledge OS Bridge

Notion Custom Agent 的 worker，让 Notion Jarvis 可以直接查询和操作 Knowledge OS。

## 架构

```
Notion AI Agent (📚 Knowledge Agent)
  → KOS Worker (Notion cloud, 4 tools)
    → KOS API Server (Mac mini :7720, HTTP wrapper over kos CLI)
      → ./kos query/ingest/digest/status
```

## 组件

### 1. Notion Worker (`src/index.ts`)
4 个 tools 供 Notion AI agent 调用：
- `kosQuery` — 知识库检索
- `kosIngest` — URL 摄入
- `kosDigest` — 知识变更摘要
- `kosStatus` — 健康状态

### 2. KOS API Server (`server/kos-api.py`)
轻量 HTTP server（Python stdlib），wrap kos CLI 命令。

## 部署步骤

### Step 1: 启动 KOS API Server（Mac mini）

```bash
# 直接运行
python3 workers/kos-worker/server/kos-api.py --port 7720

# 或带 token 认证
python3 workers/kos-worker/server/kos-api.py --port 7720 --token YOUR_SECRET

# 通过 Tailscale serve 暴露
tailscale serve --bg 7720
```

### Step 2: 部署 Notion Worker

```bash
cd workers/kos-worker
ntn login                    # 如未登录
ntn workers deploy --name "kos-worker"

# 配置环境变量
ntn workers env set KOS_API_BASE "https://your-tailscale-hostname:7720"
ntn workers env set KOS_API_TOKEN "YOUR_SECRET"
ntn workers env push
```

### Step 3: 创建 Notion Custom Agent

在 Notion 中创建 📚 Knowledge Agent，关联 kos-worker 的 4 个 tools。

### Step 4: 更新 Notion Jarvis 主路由

在 §4 混合路由调度中添加 Knowledge Agent 条目（触发关键词：摄入、知识库、wiki、knowledge）。

## 本地测试

```bash
# 启动 API server
python3 workers/kos-worker/server/kos-api.py --port 7720 &

# 测试 endpoints
curl http://127.0.0.1:7720/health
curl http://127.0.0.1:7720/status
curl -X POST http://127.0.0.1:7720/query -H 'Content-Type: application/json' -d '{"question":"harness engineering 是什么"}'
curl "http://127.0.0.1:7720/digest?since=7"

# 测试 worker tools (本地)
ntn workers exec kosStatus --local
ntn workers exec kosQuery --local -d '{"question":"什么是 context engineering"}'
```
