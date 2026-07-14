#!/usr/bin/env bash
# jarvis-avman-embed-probe.sh — watch for avman's te3 channel coming back.
#
# 2026-07-14: avman started returning 503 "分组 *** 下模型 text-embedding-3-large
# 无可用渠道（distributor）" — the relay itself is up (chat 200, /models still
# lists te3) but has no upstream channel for the embedding model. The brain now
# routes te3 through GitHub Models via the litellm recipe instead.
#
# That replacement has a HARD DEADLINE: GitHub Models is fully retired
# 2026-07-30 (`sunset: Thu, 30 Jul 2026 00:00:00 GMT` on every response). So we
# need either avman back or another te3 provider before then. This probe answers
# the first half; run it hourly and read the log.
#
# Exit 0 = avman still down (nothing to do). Exit 10 = avman IS BACK, revert.
#
# Manual: bash scripts/jarvis-avman-embed-probe.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
[ -f .env.local ] && { set -a; . ./.env.local; set +a; }

LOG="${AVMAN_PROBE_LOG:-/tmp/avman-embed-probe.log}"
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
DEADLINE_EPOCH=$(date -j -f "%Y-%m-%d" "2026-07-30" "+%s" 2>/dev/null || echo 0)
NOW_EPOCH=$(date "+%s")
DAYS_LEFT=$(( (DEADLINE_EPOCH - NOW_EPOCH) / 86400 ))

body=$(curl -sS --max-time 30 -X POST "${OPENAI_BASE_URL}/embeddings" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"text-embedding-3-large","input":"avman channel probe","dimensions":1536}' \
  -w '\n%{http_code}' 2>&1)
code=$(printf '%s' "$body" | tail -1)

if [ "$code" != "200" ]; then
  echo "$(ts) still down (HTTP $code) — GitHub Models retires in ${DAYS_LEFT}d" >> "$LOG"
  exit 0
fi

# Don't trust the status alone: a relay can 200 with a wrong-width vector.
dims=$(printf '%s' "$body" | sed '$d' | python3 -c \
  'import json,sys; print(len(json.load(sys.stdin)["data"][0]["embedding"]))' 2>/dev/null || echo 0)
if [ "$dims" != "1536" ]; then
  echo "$(ts) HTTP 200 but dims=$dims (want 1536) — NOT usable, staying on GitHub Models" >> "$LOG"
  exit 0
fi

cat >> "$LOG" <<EOF
$(ts) ✅ AVMAN IS BACK — te3 200 @ 1536 dims. Revert off GitHub Models (retires in ${DAYS_LEFT}d):
  1. 4 plists (dream-cycle, enrich-sweep, gbrain-serve-http, kos-patrol) +
     .env.local: GBRAIN_EMBEDDING_MODEL=openai:text-embedding-3-large,
     drop LITELLM_BASE_URL / LITELLM_API_KEY
  2. ~/.gbrain/config.json + DB config: embedding_model=openai:text-embedding-3-large
  3. UPDATE pages SET embedding_signature='openai:text-embedding-3-large:1536'
       WHERE embedding_signature='litellm:text-embedding-3-large:1536';
     (skip this and 21,701 chunks read as stale -> a pointless ~4.3M-token re-embed)
  4. launchctl bootout + bootstrap com.jarvis.gbrain-serve-http
     (kickstart alone does NOT re-read the plist)
  5. Revoke the GitHub PAT.
  Backups: ~/.gbrain/backups/embed-swap-20260714-103430/
EOF
exit 10
