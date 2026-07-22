import { sql } from '../db.ts';
import { MAX_EMBED_SLUGS } from './registry.ts';

// Server-side validation for the embed-selected action's parameters. The client
// picks slugs from the health page's chunkless list, but we NEVER trust that —
// we re-derive the live chunkless set for the requested source and intersect.
// The caller can therefore only ever embed pages the server itself confirms are
// currently chunkless for that source, which closes two holes at once:
//   - injection / arbitrary-slug (a slug not in the live set is rejected), and
//   - wasted spend on already-embedded pages (they're not chunkless → rejected).

export type EmbedValidation =
  | { ok: true; slugs: string[] }
  | { ok: false; status: 400 | 409; error: string; detail?: string };

export async function validateEmbedTargets(source: string, requested: unknown): Promise<EmbedValidation> {
  if (!Array.isArray(requested) || requested.length === 0) {
    return { ok: false, status: 400, error: 'slugs required', detail: 'expected a non-empty array of slugs' };
  }
  // Bound the RAW array length FIRST — before any map/trim/Set work — so a
  // million-element (or millions-of-duplicates) array is rejected in O(1)
  // instead of forcing heavy allocation just to fail the post-dedup count
  // (codex MEDIUM).
  if (requested.length > MAX_EMBED_SLUGS) {
    return {
      ok: false,
      status: 400,
      error: 'too many slugs',
      detail: `select at most ${MAX_EMBED_SLUGS} pages per run (use chunkless-backfill for a large backlog)`,
    };
  }
  if (requested.some(s => typeof s !== 'string' || s.trim().length === 0)) {
    return { ok: false, status: 400, error: 'invalid slugs', detail: 'every slug must be a non-empty string' };
  }
  const uniq = [...new Set((requested as string[]).map(s => s.trim()))];
  // Defense-in-depth for the buildEmbedArgv BLOCKER: a slug beginning with `-`
  // would be parsed by `gbrain embed` as a flag (e.g. `--all`). Reject here too
  // so a flag-shaped value never even reaches argv assembly.
  const flagLike = uniq.filter(s => s.startsWith('-'));
  if (flagLike.length > 0) {
    return {
      ok: false,
      status: 400,
      error: 'invalid slugs',
      detail: `slugs must not begin with '-' (flag-like): ${flagLike.slice(0, 3).join(', ')}`,
    };
  }

  // Intersect the request with the set of pages that are BOTH chunkless AND
  // eligible to embed. "Eligible" mirrors the vetted chunkless-backfill script's
  // exclusions exactly (jarvis-chunkless-backfill.sh): skip `extract_receipt`
  // run-receipts (embedding them pollutes retrieval), pages carrying the
  // `embed_skip` opt-out, and empty bodies. It ALSO requires the owning source
  // to be non-archived (codex MEDIUM: don't spend embedding pages of a source
  // that's archived / pending purge). A page can be chunkless yet deliberately
  // un-embeddable (e.g. docs/claude-upstream is embed_skip), and the UI's raw
  // chunkless list shows those — but acting on them here would violate the
  // opt-out, so they're rejected.
  const rows = await sql<{ slug: string }[]>`
    SELECT p.slug
    FROM pages p
    LEFT JOIN content_chunks c ON c.page_id = p.id
    WHERE c.id IS NULL
      AND p.deleted_at IS NULL
      AND p.source_id = ${source}
      AND EXISTS (SELECT 1 FROM sources s WHERE s.id = p.source_id AND s.archived IS NOT TRUE)
      AND p.type <> 'extract_receipt'
      AND NOT (COALESCE(p.frontmatter, '{}'::jsonb) ? 'embed_skip')
      AND length(COALESCE(p.compiled_truth, '')) > 0
      AND p.slug IN ${sql(uniq)}
  `;
  const eligible = new Set(rows.map(r => r.slug));
  const bad = uniq.filter(s => !eligible.has(s));
  if (bad.length > 0) {
    const preview = bad.slice(0, 5).join(', ') + (bad.length > 5 ? ` …(+${bad.length - 5})` : '');
    return {
      ok: false,
      status: 409,
      error: 'ineligible selection',
      detail: `not embeddable for source '${source}' (must be chunkless, non-receipt, not embed_skip, non-empty; reload the health page): ${preview}`,
    };
  }
  return { ok: true, slugs: uniq };
}
