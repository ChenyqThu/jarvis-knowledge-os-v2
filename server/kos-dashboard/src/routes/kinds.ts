import { Hono } from 'hono';
import { sql } from '../db.ts';
import { cached } from '../cache.ts';
import { resolveSourceFilter } from '../source-filter.ts';

async function loadKinds(source?: string) {
  const cond = source ? sql`AND p.source_id = ${source}` : sql``;
  const [kosKinds, pageTypes, topTags, mostConnected] = await Promise.all([
    // KOS kind lives in frontmatter (GIN-indexed), 9 kos-jarvis page kinds
    // plus legacy/uncategorized values. NULL or empty-string frontmatter->>'kind' -> 'unknown'.
    sql<{ kind: string; count: number }[]>`
      SELECT COALESCE(NULLIF(p.frontmatter->>'kind', ''), 'unknown') AS kind, count(*)::int AS count
      FROM pages p
      WHERE p.deleted_at IS NULL ${cond}
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    // pages.type is upstream's separate classification (person/company/concept/...) — do not conflate with kind.
    sql<{ type: string; count: number }[]>`
      SELECT p.type, count(*)::int AS count
      FROM pages p
      WHERE p.deleted_at IS NULL ${cond}
      GROUP BY 1
      ORDER BY 2 DESC
    `,
    sql<{ tag: string; count: number }[]>`
      SELECT t.tag, count(*)::int AS count
      FROM tags t
      JOIN pages p ON p.id = t.page_id
      WHERE p.deleted_at IS NULL ${cond}
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 20
    `,
    // Aggregate link counts once over the (much smaller) links table, then
    // join to pages and take top 10 — avoids a correlated subquery per row
    // over all ~27k pages. Not restricted to person/company (unlike
    // getHealth.most_connected) — this is a general "most connected pages"
    // list per this task's endpoint spec. Link counts are computed over the
    // whole links table regardless of `?source=` (a page's connectedness
    // doesn't change just because we're viewing one source); only the final
    // page list is scoped to the requested source.
    sql<{ slug: string; source_id: string; title: string; links: number }[]>`
      WITH link_counts AS (
        SELECT page_id, count(*)::int AS links
        FROM (
          SELECT from_page_id AS page_id FROM links
          UNION ALL
          SELECT to_page_id AS page_id FROM links
        ) x
        GROUP BY page_id
      )
      SELECT p.slug, p.source_id, p.title, lc.links
      FROM link_counts lc
      JOIN pages p ON p.id = lc.page_id
      WHERE p.deleted_at IS NULL ${cond}
      ORDER BY lc.links DESC
      LIMIT 10
    `,
  ]);

  return {
    kos_kinds: kosKinds.map(r => ({ kind: r.kind, count: Number(r.count) })),
    page_types: pageTypes.map(r => ({ type: r.type, count: Number(r.count) })),
    top_tags: topTags.map(r => ({ tag: r.tag, count: Number(r.count) })),
    most_connected: mostConnected.map(r => ({
      slug: r.slug,
      source_id: r.source_id,
      title: r.title,
      links: Number(r.links),
    })),
  };
}

export const kindsRoute = new Hono();

kindsRoute.get('/kinds', async c => {
  const resolved = await resolveSourceFilter(c);
  if (!resolved.ok) {
    return c.json({ error: 'invalid source' }, 400);
  }
  const data = await cached(`kinds:${resolved.source ?? 'all'}`, () => loadKinds(resolved.source));
  return c.json(data);
});
