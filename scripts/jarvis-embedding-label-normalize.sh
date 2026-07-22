#!/usr/bin/env bash
# jarvis-embedding-label-normalize.sh — daily cosmetic fix for the gbrain embed
# mislabel bug. The daemon stamps the per-chunk `content_chunks.model` column
# with a stale gateway default (`zeroentropyai:zembed-1`) on EVERY write
# (mailagent/舆情 daily writes, corpus-synth/synthesis-sweep re-runs, any MCP
# put_page), even though the vector itself is the real openai:text-embedding-3-
# large@1536 (§6.32 convergence; served direct from api.openai.com since §6.41
# retired the avman relay). The label is purely cosmetic — the
# dynamic column resolver routes by COLUMN name, not the model label — but a
# drifting label trips the embedding-gateway-guard's "mixed-model" regression
# check and muddies diagnostics. This normalizes it daily.
#
# SAFETY GUARD: only relabels when the brain's embedding config is still
# openai:text-embedding-3-large. If the config ever legitimately switches
# models, this refuses to relabel — so it never MASKS a real model change /
# incoherence (which is exactly what the guard should catch).
#
# Manual: bash scripts/jarvis-embedding-label-normalize.sh [--dry]
set -uo pipefail
DB="${GBRAIN_DATABASE_URL:-postgresql://chenyuanquan@127.0.0.1:5432/gbrain}"
STALE_LABEL="zeroentropyai:zembed-1"
CANON="openai:text-embedding-3-large"
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Guard: confirm the brain is still on the canonical te3 model (DB config plane).
# A FAILED query (psql nonzero) must be an error, not a benign SKIP — otherwise a
# DB outage silently reports success (codex). An empty result with psql exit 0
# (key genuinely absent) is still a legitimate SKIP.
cfg=$(psql "$DB" -At -c "SELECT value FROM config WHERE key='embedding_model'") \
  || { echo "$(ts) ERROR: embedding_model config query failed"; exit 1; }
if [ "$cfg" != "$CANON" ]; then
  echo "$(ts) SKIP: embedding_model='$cfg' != '$CANON' — refusing to relabel (would mask a real model change)"
  exit 0
fi

# A failed count query must be an error, not "0 mislabeled → nothing to do"
# (codex): validate psql's exit status and that the result is numeric.
n=$(psql "$DB" -At -c "SELECT count(*) FROM content_chunks WHERE model='$STALE_LABEL' AND embedding IS NOT NULL") \
  || { echo "$(ts) ERROR: mislabel count query failed"; exit 1; }
case "${n:-}" in ''|*[!0-9]*) echo "$(ts) ERROR: bad count '${n:-}'"; exit 1;; esac
if [ "$n" -eq 0 ]; then echo "$(ts) ok: 0 mislabeled chunks, nothing to do"; exit 0; fi

if [ "$DRY" = 1 ]; then
  echo "$(ts) [dry] would relabel $n chunks '$STALE_LABEL' -> '$CANON'"
  exit 0
fi
if psql "$DB" -c "UPDATE content_chunks SET model='$CANON' WHERE model='$STALE_LABEL'" >/dev/null 2>&1; then
  echo "$(ts) relabeled $n chunks '$STALE_LABEL' -> '$CANON'"
else
  # Don't echo success after a failed UPDATE (codex HIGH: the script had no
  # `set -e`, so a failed relabel was still reported as done).
  echo "$(ts) ERROR: relabel UPDATE failed"
  exit 1
fi
