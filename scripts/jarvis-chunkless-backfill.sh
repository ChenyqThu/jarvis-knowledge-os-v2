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
   AND NOT EXISTS (SELECT 1 FROM content_chunks c WHERE c.page_id = p.id)"

pending() { psql "$CONN" -At -c "SELECT count(*) FROM pages p WHERE $WHERE;"; }

total=$(pending)
if [ "${total:-0}" -eq 0 ]; then echo "$(ts) ok: no chunkless pages"; exit 0; fi
echo "$(ts) start: $total chunkless pages (cap $MAX/run)"
psql "$CONN" -At -F' ' -c "SELECT p.type, p.source_id, count(*) FROM pages p WHERE $WHERE GROUP BY 1,2 ORDER BY 3 DESC;" \
  | sed 's/^/  /'

if [ "$DRY" = 1 ]; then echo "$(ts) [dry] would embed up to $MAX"; exit 0; fi

done_n=0
# Per source: slugs are NOT unique across sources (concepts/captive-portal lives
# in default + mailagent-emails + omada), so an unscoped embed silently no-ops on
# whichever copy it resolves first. --source must also precede --slugs, which
# swallows every following non---token.
for SRC in $(psql "$CONN" -At -c "SELECT DISTINCT p.source_id FROM pages p WHERE $WHERE;"); do
  while [ "$done_n" -lt "$MAX" ]; do
    SLUGS=()
    while IFS= read -r l; do [ -n "$l" ] && SLUGS+=("$l"); done < <(
      psql "$CONN" -At -c "SELECT p.slug FROM pages p WHERE $WHERE AND p.source_id = '$SRC' ORDER BY p.id LIMIT $BATCH;")
    [ ${#SLUGS[@]} -eq 0 ] && break
    bin/gbrain embed --source "$SRC" --slugs "${SLUGS[@]}" >/dev/null 2>&1 \
      || echo "$(ts) warn: batch failed under source=$SRC (continuing)"
    done_n=$((done_n + ${#SLUGS[@]}))
  done
done

echo "$(ts) embedded ~$done_n pages; $(pending) still pending"
# New chunks land with the gateway's stale ZE default in `model`; the 08:25
# normalize cron would fix it, but do it now so a manual run is self-contained.
bash scripts/jarvis-embedding-label-normalize.sh
