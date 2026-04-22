#!/bin/sh
# notion-poller.sh — run Notion delta poll via Minions shell job.
# Triggered every 5 min by launchd (com.jarvis.notion-poller).
set -eu

ROOT="/Users/chenyuanquan/Projects/jarvis-knowledge-os-v2"
GBRAIN="/Users/chenyuanquan/.bun/bin/gbrain"

PARAMS=$(cat <<'JSON'
{
  "cmd": "cd /Users/chenyuanquan/Projects/jarvis-knowledge-os-v2 && set -a && . ./.env.local && set +a && /Users/chenyuanquan/.bun/bin/bun run workers/notion-poller/run.ts",
  "cwd": "/Users/chenyuanquan/Projects/jarvis-knowledge-os-v2",
  "env": {
    "KOS_API_BASE": "http://127.0.0.1:7220"
  }
}
JSON
)

exec env GBRAIN_ALLOW_SHELL_JOBS=1 "$GBRAIN" jobs submit shell \
  --params "$PARAMS" \
  --follow \
  --max-attempts 2 \
  --timeout-ms 600000 \
  --queue notion
