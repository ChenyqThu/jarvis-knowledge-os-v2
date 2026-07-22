import { Hono } from 'hono';
import { sql } from '../db.ts';
import { cached } from '../cache.ts';
import { resolveSourceFilter } from '../source-filter.ts';

interface SourceRow {
  source_id: string;
  name: string;
  pages: number;
  chunks: number;
  embedded_chunks: number;
  page_coverage: number;
  newest_content_at: string | null;
}

async function loadSources(source?: string) {
  // sources.newest_content_at (schema column) is never populated by any
  // write path in production (verified empty on all 4 rows) — compute
  // freshness from pages.updated_at instead.
  const rows = await sql<SourceRow[]>`
    SELECT
      s.id AS source_id,
      s.name,
      COALESCE(pg.pages, 0)::int AS pages,
      COALESCE(ck.chunks, 0)::int AS chunks,
      COALESCE(ck.embedded_chunks, 0)::int AS embedded_chunks,
      CASE WHEN COALESCE(pg.pages, 0) = 0 THEN 0
           ELSE COALESCE(pg.pages_with_embedded, 0)::float / pg.pages END AS page_coverage,
      pg.newest_content_at
    FROM sources s
    LEFT JOIN (
      SELECT
        source_id,
        count(*) AS pages,
        max(updated_at) AS newest_content_at,
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM content_chunks c WHERE c.page_id = p.id AND c.embedded_at IS NOT NULL
          )
        ) AS pages_with_embedded
      FROM pages p
      WHERE deleted_at IS NULL
      GROUP BY source_id
    ) pg ON pg.source_id = s.id
    LEFT JOIN (
      SELECT p.source_id,
             count(*) AS chunks,
             count(*) FILTER (WHERE c.embedded_at IS NOT NULL) AS embedded_chunks
      FROM content_chunks c
      JOIN pages p ON p.id = c.page_id
      GROUP BY p.source_id
    ) ck ON ck.source_id = s.id
    ${source ? sql`WHERE s.id = ${source}` : sql``}
    ORDER BY pages DESC NULLS LAST
  `;

  return rows.map(r => ({
    source_id: r.source_id,
    name: r.name,
    pages: Number(r.pages),
    chunks: Number(r.chunks),
    embedded_chunks: Number(r.embedded_chunks),
    chunk_coverage: Number(r.chunks) === 0 ? 0 : Number(r.embedded_chunks) / Number(r.chunks),
    page_coverage: Number(r.page_coverage),
    newest_content_at: r.newest_content_at,
  }));
}

export const sourcesRoute = new Hono();

sourcesRoute.get('/sources', async c => {
  const resolved = await resolveSourceFilter(c);
  if (!resolved.ok) {
    return c.json({ error: 'invalid source' }, 400);
  }
  // Shape stays an array even when `?source=` narrows it to one row.
  const data = await cached(`sources:${resolved.source ?? 'all'}`, () => loadSources(resolved.source));
  return c.json(data);
});
