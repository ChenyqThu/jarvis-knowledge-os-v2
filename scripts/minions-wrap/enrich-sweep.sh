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

# Timeout: 4h, raised from 1h on 2026-07-27.
#
# Six consecutive runs had been dying as `aborted: timeout` (the
# mailagent-emails NER cache last landed 2026-06-28), but the timeout was the
# symptom, not the disease. Phase D resolved each stub's first-mention date by
# spawning one cold `gbrain get` PER MENTION: 52,323 subprocesses for a
# 3,237-candidate sweep, ~26h of pure process startup, against only 6,731
# distinct pages. Mention counts are heavy-tailed, so a single candidate could
# eat the whole window — people/lucien-chen has 4,306 mentions and burned 31
# minutes producing one date. No timeout would have been large enough. Fixed in
# run.ts (fetchUpdatedDates: one batched psql read); the run is now bounded by
# `gbrain put`, roughly 1s per stub.
#
# 4h is kept as headroom for a cold run that must also redo NER, and is bounded
# by the dream slot, not picked round: launchd starts this Sun 22:13, so the
# worst case ends 02:13 Mon, clear of com.jarvis.dream-cycle at 03:11. Do not
# raise it past that without moving one of the two jobs.
#
# Interruption is still expensive: Phase C persists the NER cache only after the
# whole pass finishes, so a run killed mid-NER keeps nothing and the next week
# restarts from zero while the backlog grows ~40-70 emails/day.
exec env GBRAIN_ALLOW_SHELL_JOBS=1 "$GBRAIN" jobs submit shell \
  --params "$PARAMS" \
  --follow \
  --max-attempts 1 \
  --timeout-ms 14400000 \
  --queue enrich
