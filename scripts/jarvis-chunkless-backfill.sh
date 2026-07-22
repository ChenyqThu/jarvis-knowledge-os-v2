#!/usr/bin/env bash
# jarvis-chunkless-backfill.sh — chunk+embed the pages the dream cycle
# structurally cannot see.
#
# UPSTREAM BUG (confirmed 2026-07-14, see §6.41):
#   1. synthesize_concepts (src/core/cycle/synthesize-concepts.ts:219) and
#      extract_atoms (src/core/cycle/extract-atoms.ts:565) write pages via
#      engine.putPage(), which touches ONLY the `pages` table — it never creates
#      content_chunks rows.
#   2. The cycle's Phase 8 is `embed --stale` (src/core/cycle.ts:26).
#   3. That predicate is rooted in `FROM content_chunks cc JOIN pages p`
#      (postgres-engine.ts buildStaleChunkWhere), so a page with ZERO chunk rows
#      contributes ZERO rows — it is invisible to the only thing that would have
#      embedded it, forever.
#
#   Net: pages born inside the cycle are never embedded. At discovery: 9,241
#   pages (~34% of the brain), including 100% of atoms (6,739 of 6,739 — that
#   pipeline had never embedded anything). Not intentional: `embed_skip` exists
#   as the opt-out and was set on exactly 1 page brain-wide.
#
#   This is upstream territory (src/), which the fork does not patch, so this
#   walks the gap from outside instead. Remove it if upstream ever chunks in
#   putPage or roots the stale predicate in `pages`.
#
# WHY `gbrain embed` REPAIRS IT: embedPage() chunks from compiled_truth when a
# page has no chunks (src/commands/embed.ts:535), so feeding it the missing
# slugs is exactly the repair.
#
# NOT backfilled: extract_receipt pages (run receipts like "Synthesized 2629
# concepts from 2629 groups" — bookkeeping, not knowledge; embedding them would
# pollute retrieval), pages carrying `embed_skip`, and empty bodies.
#
# NEVER `gbrain embed --all` here: engine chunk rows come back without
# embedded_at, so `chunks.filter(c => !c.embedded_at)` matches everything and
# --all re-embeds all 60,580 chunks (~12M tokens).
#
# Manual: bash scripts/jarvis-chunkless-backfill.sh [--dry] [--max N]
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env.local; set +a
unset ANTHROPIC_BASE_URL
# §6.41 iron rule: the embed path must NEVER carry OPENAI_BASE_URL (it goes
# direct to api.openai.com on the official key). The F7 dashboard strips it from
# the child env, but this script self-sources .env.local — re-assert it here so
# one accidental uncomment in .env.local can't silently reroute embeddings.
unset OPENAI_BASE_URL

CONN="${GBRAIN_DATABASE_URL:-postgresql://chenyuanquan@127.0.0.1:5432/gbrain}"
BATCH=40
MAX=${MAX_PAGES:-3000}   # per-run ceiling so a surprise backlog can't burn the
                         # whole embedding quota in one unattended pass
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry) DRY=1 ;;
    --max) MAX="$2"; shift ;;
  esac
  shift
done
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# The gap, minus the three exclusions above. Kept in one place so the count and
# the work always agree.
WHERE="p.deleted_at IS NULL
   AND p.type <> 'extract_receipt'
   AND NOT (COALESCE(p.frontmatter, '{}'::jsonb) ? 'embed_skip')
   AND length(coalesce(p.compiled_truth, '')) > 0
   AND p.slug NOT LIKE '-%'
   AND EXISTS (SELECT 1 FROM sources s WHERE s.id = p.source_id AND s.archived IS NOT TRUE)
   AND NOT EXISTS (SELECT 1 FROM content_chunks c WHERE c.page_id = p.id)"
# `p.slug NOT LIKE '-%'`: a slug beginning with '-' would be parsed by
# `gbrain embed --slugs` as a CLI flag (e.g. --all / --background / --dry-run),
# escaping the bound + the never---all rule (codex). Such slugs are pathological;
# exclude them here rather than risk forwarding a flag-shaped value.
# The `sources ... archived IS NOT TRUE` clause keeps spend off archived sources.

pending() { psql "$CONN" -At -c "SELECT count(*) FROM pages p WHERE $WHERE;"; }

total=$(pending) || { echo "$(ts) ERROR: chunkless count query failed"; exit 1; }
# A failed psql must NOT read as "0 chunkless → nothing to do" (codex).
case "${total:-}" in ''|*[!0-9]*) echo "$(ts) ERROR: bad count '${total:-}'"; exit 1;; esac
if [ "$total" -eq 0 ]; then echo "$(ts) ok: no chunkless pages"; exit 0; fi
echo "$(ts) start: $total chunkless pages (cap $MAX/run)"
psql "$CONN" -At -F' ' -c "SELECT p.type, p.source_id, count(*) FROM pages p WHERE $WHERE GROUP BY 1,2 ORDER BY 3 DESC;" \
  | sed 's/^/  /'

if [ "$DRY" = 1 ]; then echo "$(ts) [dry] would embed up to $MAX"; exit 0; fi

# Cross-process mutex (codex HIGH): the F7 dashboard action, the launchd cron,
# and any manual run ALL invoke this script, so a single atomic mkdir lock
# serializes them — otherwise two overlapping runs select and embed the same
# chunkless pages twice (double OpenAI spend + racing writes). Steal a stale
# lock only when its holder PID is dead. (Write path only — --dry exited above.)
# Lock path is shared BY NAME with the dashboard's embed-selected action
# (server/kos-dashboard/src/ops/lock.ts) so ALL embedding writers are mutually
# exclusive. Steal only a dead-PID lock, or a pid-less dir old enough to be a
# crashed acquisition — never a FRESH pid-less dir (that's a holder mid-acquire),
# which closes the "observe empty lock → steal → overwrite" race (codex HIGH).
LOCK_DIR="$HOME/.cache/kos-jarvis/embed-write.lock"
mkdir -p "$(dirname "$LOCK_DIR")"
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then echo $$ > "$LOCK_DIR/pid"; return 0; fi
  local holder age
  holder=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [ -n "${holder:-}" ]; then
    kill -0 "$holder" 2>/dev/null && return 1   # live holder
    echo "$(ts) clearing stale lock (dead pid $holder)"
  else
    age=$(( $(date +%s) - $(stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0) ))
    [ "$age" -lt 120 ] && return 1              # fresh pid-less dir → back off
    echo "$(ts) clearing abandoned pid-less lock (age ${age}s)"
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null && { echo $$ > "$LOCK_DIR/pid"; return 0; }
  return 1
}
if ! acquire_lock; then
  echo "$(ts) skip: another embedding writer holds the lock"; exit 0
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

done_n=0
failed=0
# Per source: slugs are NOT unique across sources (concepts/captive-portal lives
# in default + mailagent-emails + omada), so an unscoped embed silently no-ops on
# whichever copy it resolves first. --source must also precede --slugs, which
# swallows every following non---token.
SRCS=$(psql "$CONN" -At -c "SELECT DISTINCT p.source_id FROM pages p WHERE $WHERE;") \
  || { echo "$(ts) ERROR: source-list query failed"; exit 1; }
for SRC in $SRCS; do
  case "$SRC" in -*) echo "$(ts) skip flag-like source '$SRC'"; continue;; esac
  while [ "$done_n" -lt "$MAX" ]; do
    # Capture with an explicit exit check — a psql failure inside `< <(...)`
    # process substitution is invisible and would look like "no more slugs",
    # ending the run as a false success (codex).
    SLUG_ROWS=$(psql "$CONN" -At -c "SELECT p.slug FROM pages p WHERE $WHERE AND p.source_id = '$SRC' ORDER BY p.id LIMIT $BATCH;") \
      || { echo "$(ts) ERROR: slug query failed under source=$SRC"; failed=1; break; }
    SLUGS=()
    while IFS= read -r l; do [ -n "$l" ] && SLUGS+=("$l"); done <<< "$SLUG_ROWS"
    [ ${#SLUGS[@]} -eq 0 ] && break
    if ! bin/gbrain embed --source "$SRC" --slugs "${SLUGS[@]}" >/dev/null 2>&1; then
      echo "$(ts) warn: batch failed under source=$SRC (continuing)"; failed=1
    fi
    done_n=$((done_n + ${#SLUGS[@]}))
  done
done

echo "$(ts) embedded ~$done_n pages; $(pending) still pending"
# New chunks land with the gateway's stale ZE default in `model`; the 08:25
# normalize cron would fix it, but do it now so a manual run is self-contained.
if ! bash scripts/jarvis-embedding-label-normalize.sh; then
  echo "$(ts) warn: label-normalize step failed"; failed=1
fi

# Propagate embed failures to the exit code so the F7 job (and any caller) can't
# read a partial/failed run as success (codex HIGH).
if [ "$failed" = 1 ]; then
  echo "$(ts) FAILED: one or more embed batches errored"
  exit 1
fi
exit 0
