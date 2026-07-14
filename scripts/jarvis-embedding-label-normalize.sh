#!/usr/bin/env bash
# jarvis-embedding-label-normalize.sh — daily cosmetic fix for the gbrain embed
# mislabel bug. The daemon stamps the per-chunk `content_chunks.model` column
# with a stale gateway default (`zeroentropyai:zembed-1`) on EVERY write
# (mailagent/舆情 daily writes, corpus-synth/synthesis-sweep re-runs, any MCP
# put_page), even though the vector itself is the real openai:text-embedding-3-
# large@1536 via avman (§6.32 convergence). The label is purely cosmetic — the
# dynamic column resolver routes by COLUMN name, not the model label — but a
# drifting label trips the embedding-gateway-guard's "mixed-model" regression
# check and muddies diagnostics. This normalizes it daily.
#
# SAFETY GUARD: only relabels while the brain is still on text-embedding-3-
# large@1536, under EITHER transport (see TRANSPORT below). If the config ever
# switches to a genuinely different model, this refuses to relabel — so it never
# MASKS a real model change / incoherence (which is exactly what it should catch).
#
# TRANSPORT (2026-07-14): avman's te3 channel went 503 ("无可用渠道"), so the
# brain routes te3 through GitHub Models via the litellm recipe, which makes the
# config plane read `litellm:text-embedding-3-large`. Same model, same vectors —
# verified by re-embedding stored chunks through GitHub and comparing to the
# avman-era vectors: self-cosine 0.9994-1.0000 vs a 0.3961 cross baseline. So
# both labels are accepted as "on te3", and the chunk label converges on the
# transport-independent `openai:text-embedding-3-large` (the model's identity;
# GitHub serves OpenAI's te3 via Azure). That keeps the label plane uniform —
# a mix of openai:/litellm: labels would trip embedding-gateway-guard's
# mixed-model check — and survives the revert to avman.
#
# Manual: bash scripts/jarvis-embedding-label-normalize.sh [--dry]
set -uo pipefail
DB="${GBRAIN_DATABASE_URL:-postgresql://chenyuanquan@127.0.0.1:5432/gbrain}"
CANON="openai:text-embedding-3-large"
# Labels that are really te3@1536 wearing the wrong name: the gateway's stale
# ZE default, plus the litellm-transport spelling of te3 itself.
STALE_LABELS="'zeroentropyai:zembed-1','litellm:text-embedding-3-large'"
# Config values that mean "still on te3@1536" — one per transport.
TE3_CONFIGS=" openai:text-embedding-3-large litellm:text-embedding-3-large "
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Guard: confirm the brain is still on te3@1536 (DB config plane), any transport.
cfg=$(psql "$DB" -At -c "SELECT value FROM config WHERE key='embedding_model'" 2>/dev/null)
case "$TE3_CONFIGS" in
  *" $cfg "*) ;;
  *) echo "$(ts) SKIP: embedding_model='$cfg' is not a te3@1536 label — refusing to relabel (would mask a real model change)"
     exit 0 ;;
esac

n=$(psql "$DB" -At -c "SELECT count(*) FROM content_chunks WHERE model IN ($STALE_LABELS) AND embedding IS NOT NULL" 2>/dev/null)
n=${n:-0}
if [ "$n" -eq 0 ]; then echo "$(ts) ok: 0 mislabeled chunks, nothing to do"; exit 0; fi

if [ "$DRY" = 1 ]; then
  echo "$(ts) [dry] would relabel $n chunks -> '$CANON'"
  exit 0
fi
psql "$DB" -c "UPDATE content_chunks SET model='$CANON' WHERE model IN ($STALE_LABELS)" >/dev/null 2>&1
echo "$(ts) relabeled $n chunks -> '$CANON'"
