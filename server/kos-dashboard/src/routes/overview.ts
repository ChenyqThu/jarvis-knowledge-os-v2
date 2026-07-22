import { Hono } from 'hono';
import { sql } from '../db.ts';
import { cached } from '../cache.ts';
import { resolveSourceFilter } from '../source-filter.ts';

interface OverviewRow {
  page_count: number; // getStats.page_count — deleted_at IS NULL (what's shown as "pages")
  page_count_all: number; // getHealth's literal page_count — NO deleted_at filter, used as the
  // brain_score denominator so our score matches `gbrain doctor` / getHealth exactly.
  deleted_pages: number;
  last24h_pages: number;
  chunk_count: number;
  embedded_count: number;
  link_count: number;
  pages_with_timeline: number;
  orphan_pages_raw: number; // literal getHealth orphan count (no deleted filter) — score input only
  orphan_pages_visible: number; // deleted_at IS NULL excluded — the displayed "orphans" field
  dead_links: number;
  source_count: number;
  pages_with_embedded_chunk: number;
  chunkless_pages: number;
}

/**
 * `?source=` filter fragment for subqueries whose base table is aliased `p`
 * (pages) — either directly or via a join. Empty fragment = whole brain.
 * Every subquery below already has a WHERE with at least one base condition
 * (even a bare `true`, to preserve the upstream getHealth quirks that some
 * subqueries deliberately don't filter deleted_at), so this always composes
 * as a trailing `AND p.source_id = $n`.
 */
function sourceCond(source: string | undefined) {
  return source ? sql`AND p.source_id = ${source}` : sql``;
}

async function loadOverview(source?: string) {
  const cond = sourceCond(source);
  const [row] = await sql<OverviewRow[]>`
    SELECT
      (SELECT count(*) FROM pages p WHERE p.deleted_at IS NULL ${cond})::int AS page_count,
      (SELECT count(*) FROM pages p WHERE true ${cond})::int AS page_count_all,
      (SELECT count(*) FROM pages p WHERE p.deleted_at IS NOT NULL ${cond})::int AS deleted_pages,
      (SELECT count(*) FROM pages p WHERE p.deleted_at IS NULL AND p.created_at >= now() - interval '24 hours' ${cond})::int AS last24h_pages,
      (SELECT count(*) FROM content_chunks c JOIN pages p ON p.id = c.page_id WHERE true ${cond})::int AS chunk_count,
      (SELECT count(*) FROM content_chunks c JOIN pages p ON p.id = c.page_id WHERE c.embedded_at IS NOT NULL ${cond})::int AS embedded_count,
      (SELECT count(*) FROM links l JOIN pages p ON p.id = l.from_page_id WHERE true ${cond})::int AS link_count,
      (SELECT count(DISTINCT t.page_id) FROM timeline_entries t JOIN pages p ON p.id = t.page_id WHERE true ${cond})::int AS pages_with_timeline,
      (SELECT count(*) FROM pages p
        WHERE NOT EXISTS (SELECT 1 FROM links l WHERE l.to_page_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM links l WHERE l.from_page_id = p.id)
          ${cond}
      )::int AS orphan_pages_raw,
      (SELECT count(*) FROM pages p
        WHERE p.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM links l WHERE l.to_page_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM links l WHERE l.from_page_id = p.id)
          ${cond}
      )::int AS orphan_pages_visible,
      (SELECT count(*) FROM links l JOIN pages p ON p.id = l.from_page_id
        WHERE NOT EXISTS (SELECT 1 FROM pages p2 WHERE p2.id = l.to_page_id)
          ${cond}
      )::int AS dead_links,
      (SELECT count(*) FROM sources s ${source ? sql`WHERE s.id = ${source}` : sql``})::int AS source_count,
      (SELECT count(DISTINCT p.id) FROM pages p
        JOIN content_chunks c ON c.page_id = p.id AND c.embedded_at IS NOT NULL
        WHERE p.deleted_at IS NULL ${cond}
      )::int AS pages_with_embedded_chunk,
      (SELECT count(*) FROM pages p LEFT JOIN content_chunks c ON c.page_id = p.id
        WHERE c.id IS NULL AND p.deleted_at IS NULL ${cond}
      )::int AS chunkless_pages
  `;

  const pageCountAll = Number(row.page_count_all);
  const chunkCount = Number(row.chunk_count);
  const embeddedCount = Number(row.embedded_count);
  const linkCount = Number(row.link_count);
  const pagesWithTimeline = Number(row.pages_with_timeline);
  const orphanPagesRaw = Number(row.orphan_pages_raw);
  const deadLinks = Number(row.dead_links);
  const pageCount = Number(row.page_count);

  // brain_score: literal port of getHealth (postgres-engine.ts:5359-5384).
  // Deliberately mirrors the upstream quirk where the score denominator
  // (page_count_all / orphan_pages_raw) is NOT deleted_at-filtered, unlike
  // getStats.page_count. This keeps our brain_score numerically identical to
  // `gbrain doctor` / getHealth() for cross-checking. The separately exposed
  // top-level `orphans` field below uses the deleted-excluded count instead
  // (per this task's spec), since it's a diagnostic list, not a score input.
  const chunkCoverage = embeddedCount / Math.max(chunkCount, 1);
  const linkDensity = pageCountAll > 0 ? Math.min(linkCount / pageCountAll, 1) : 0;
  const timelineCoverageWhole = pageCountAll > 0 ? Math.min(pagesWithTimeline / pageCountAll, 1) : 0;
  const noOrphans = pageCountAll > 0 ? 1 - orphanPagesRaw / pageCountAll : 1;
  const noDeadLinks = pageCountAll > 0 ? 1 - Math.min(deadLinks / pageCountAll, 1) : 1;

  const embedCoverageScore = pageCountAll === 0 ? 35 : Math.round(chunkCoverage * 35);
  const linkDensityScore = pageCountAll === 0 ? 25 : Math.round(linkDensity * 25);
  const timelineCoverageScore = pageCountAll === 0 ? 15 : Math.round(timelineCoverageWhole * 15);
  const noOrphansScore = pageCountAll === 0 ? 15 : Math.round(noOrphans * 15);
  const noDeadLinksScore = pageCountAll === 0 ? 10 : Math.round(noDeadLinks * 10);
  const brainScoreTotal =
    embedCoverageScore + linkDensityScore + timelineCoverageScore + noOrphansScore + noDeadLinksScore;

  return {
    pages: pageCount,
    chunks: chunkCount,
    sources: Number(row.source_count),
    deleted_pages: Number(row.deleted_pages),
    last24h_pages: Number(row.last24h_pages),
    embedding: {
      chunk_coverage: chunkCoverage,
      page_coverage: Number(row.pages_with_embedded_chunk) / Math.max(pageCount, 1),
      chunkless_pages: Number(row.chunkless_pages),
    },
    brain_score: {
      total: brainScoreTotal,
      components: {
        embed_coverage: embedCoverageScore,
        link_density: linkDensityScore,
        timeline_coverage: timelineCoverageScore,
        no_orphans: noOrphansScore,
        no_dead_links: noDeadLinksScore,
      },
    },
    orphans: Number(row.orphan_pages_visible),
  };
}

export const overviewRoute = new Hono();

overviewRoute.get('/overview', async c => {
  const resolved = await resolveSourceFilter(c);
  if (!resolved.ok) {
    return c.json({ error: 'invalid source' }, 400);
  }
  const data = await cached(`overview:${resolved.source ?? 'all'}`, () => loadOverview(resolved.source));
  return c.json(data);
});
