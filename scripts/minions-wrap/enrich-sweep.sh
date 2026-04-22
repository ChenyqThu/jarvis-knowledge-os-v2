#!/bin/sh
# enrich-sweep.sh — weekly entity-extraction sweep via Minions shell job.
# Triggered Sun 22:13 by launchd (com.jarvis.enrich-sweep).
set -eu

GBRAIN="/Users/chenyuanquan/.bun/bin/gbrain"

PARAMS=$(cat <<'JSON'
{
  "cmd": "cd /Users/chenyuanquan/Projects/jarvis-knowledge-os-v2 && set -a && . ./.env.local && set +a && /Users/chenyuanquan/.bun/bin/bun run skills/kos-jarvis/enrich-sweep/run.ts --min-mentions 3 --max-tier2 30",
  "cwd": "/Users/chenyuanquan/Projects/jarvis-knowledge-os-v2"
}
JSON
)

exec env GBRAIN_ALLOW_SHELL_JOBS=1 "$GBRAIN" jobs submit shell \
  --params "$PARAMS" \
  --follow \
  --max-attempts 1 \
  --timeout-ms 3600000 \
  --queue enrich
