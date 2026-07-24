#!/usr/bin/env bash
# jarvis-email-link-sweep.sh — graph edges for remote-written email pages.
#
# WHY THIS EXISTS (confirmed 2026-07-23):
#   put_page skips auto-link/auto-timeline for remote MCP callers — a
#   deliberate security gate (prompt-injected page text could plant arbitrary
#   outbound edges; src/core/operations.ts, `skipped: 'remote'`, since v0.10.3).
#   mailagent writes every email over MCP, so email pages get chunks +
#   embeddings + facts in realtime but ZERO graph edges. Historically edges
#   came from ad-hoc manual batch runs (2026-06-09 / 07-08 mentions passes,
#   07-21 markdown pass) — nothing automatic. New pages since ~07-06 sat
#   edge-less until this cron.
#
# WHAT IT RUNS — two deterministic passes (zero LLM, zero embedding spend;
# pure DB reads + regex; needs no API keys):
#
#   1. `extract --stale --source-id <src>`
#      Links + timeline for pages whose pages.links_extracted_at watermark is
#      NULL/stale. Upstream-designed for cron (v0.42.7 #1696). Catches every
#      page written since the v0.42.64.0 deploy (2026-07-21 ~17:00), which no
#      longer false-stamps the watermark at put_page time. NOTE: pages written
#      2026-07-06→07-21 by the v0.42.63.0 binary carry a false stamp
#      (links_extracted_at == created_at with the link pass skipped) and are
#      invisible to this pass — harmless in practice (v4 producer bodies carry
#      no markdown-link syntax) but see the one-time reset in the PR notes.
#
#   2. `extract links --by-mention --source db --source-id <src> --since <D>`
#      The gazetteer entity-mention pass — THE pass that connects emails to
#      people/companies/projects entity pages. Cross-source aware
#      (to_source_id carries the entity page's own source, typically
#      'default'; verified extractMentionsFromDb — NOT the orphan-reducer
#      source-blind writer). ON CONFLICT idempotent; own checkpoint table for
#      crash resume. --since filters on page updated_at (emails are
#      immutable, so ≈ created_at); the 3-day default window overlaps daily
#      runs safely. Cost note: the pass still point-reads every page ref in
#      the source (~13k getPage calls) before the since-filter — a few
#      minutes on local Postgres, fine daily.
#
# Manual:  bash scripts/jarvis-email-link-sweep.sh
#          SINCE=2026-05-01 bash scripts/jarvis-email-link-sweep.sh   # backfill
#          SOURCE_ID=omada bash scripts/jarvis-email-link-sweep.sh    # other src
# Verify:  launchctl print "gui/$(id -u)/com.jarvis.email-link-sweep"
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env.local; set +a
# §6.41 iron rule: never let a relay base URL leak into any gbrain invocation
# (extract is LLM/embed-free, but keep every cron uniform); ANTHROPIC_BASE_URL
# 404s gbrain chat when inherited from an interactive shell.
unset OPENAI_BASE_URL ANTHROPIC_BASE_URL

SRC="${SOURCE_ID:-mailagent-emails}"
SINCE="${SINCE:-$(date -v-3d +%Y-%m-%d)}"
CONN="${GBRAIN_DATABASE_URL:-postgresql://chenyuanquan@127.0.0.1:5432/gbrain}"
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
fail=0

echo "$(ts) start: link sweep source=$SRC since=$SINCE"

# Pass 1 — watermark-driven links+timeline sweep (also stamps the watermark).
if ! bin/gbrain extract --stale --source-id "$SRC"; then
  echo "$(ts) ERROR: extract --stale failed"; fail=1
fi

# Pass 2 — gazetteer mention edges (email → entity pages).
if ! bin/gbrain extract links --by-mention --source db --source-id "$SRC" --since "$SINCE"; then
  echo "$(ts) ERROR: by-mention pass failed"; fail=1
fi

# Health line: recent pages still edge-less. Informational, NOT a failure —
# an email that mentions no known entity legitimately has zero edges.
EDGELESS=$(psql "$CONN" -At -c "SELECT count(*) FROM pages p
  WHERE p.source_id='$SRC' AND p.deleted_at IS NULL
    AND p.created_at > now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM links l WHERE l.from_page_id = p.id);" 2>/dev/null || echo '?')
echo "$(ts) done: $EDGELESS pages (7d window) currently edge-less (informational)"

[ "$fail" = 1 ] && { echo "$(ts) FAILED: one or more passes errored"; exit 1; }
exit 0
