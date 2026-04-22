#!/bin/sh
# kos-patrol.sh — daily brain-health patrol via Minions shell job.
# Triggered daily at 08:07 by launchd (com.jarvis.kos-patrol).
set -eu

GBRAIN="/Users/chenyuanquan/.bun/bin/gbrain"

PARAMS=$(cat <<'JSON'
{
  "cmd": "cd /Users/chenyuanquan/Projects/jarvis-knowledge-os-v2 && set -a && . ./.env.local && set +a && /Users/chenyuanquan/.bun/bin/bun run skills/kos-jarvis/kos-patrol/run.ts",
  "cwd": "/Users/chenyuanquan/Projects/jarvis-knowledge-os-v2"
}
JSON
)

exec env GBRAIN_ALLOW_SHELL_JOBS=1 "$GBRAIN" jobs submit shell \
  --params "$PARAMS" \
  --follow \
  --max-attempts 1 \
  --timeout-ms 1800000 \
  --queue patrol
