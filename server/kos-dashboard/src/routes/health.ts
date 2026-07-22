import { Hono } from 'hono';
import { sql } from '../db.ts';
import { cached } from '../cache.ts';
import { resolveSourceFilter } from '../source-filter.ts';

// The one true embedding model+dims for this brain since the §6.32
// convergence (CLAUDE.md). Chunks with any other model label are cosmetic
// mislabels (gateway.ts writes the gateway default, not the configured
// model — see CLAUDE.md §6.32) or genuine drift; either way, doctor-worthy.
const EXPECTED_EMBED_MODEL = 'openai:text-embedding-3-large';

const CHUNKLESS_LIMIT = 500;
const ORPHAN_LIMIT = 100;

async function loadHealth(source?: string) {
  const cond = source ? sql`AND p.source_id = ${source}` : sql``;

  const [chunklessPage, chunklessTotal, mislabeled, orphanPage, orphansTotal, softDeleted] = await Promise.all([
    sql<{ slug: string; source_id: string; title: string; created_at: string }[]>`
      SELECT p.slug, p.source_id, p.title, p.created_at
      FROM pages p
      LEFT JOIN content_chunks c ON c.page_id = p.id
      WHERE c.id IS NULL AND p.deleted_at IS NULL ${cond}
      ORDER BY p.created_at DESC
      LIMIT ${CHUNKLESS_LIMIT}
    `,
    sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pages p
      LEFT JOIN content_chunks c ON c.page_id = p.id
      WHERE c.id IS NULL AND p.deleted_at IS NULL ${cond}
    `,
    sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM content_chunks c
      JOIN pages p ON p.id = c.page_id
      WHERE c.model <> ${EXPECTED_EMBED_MODEL} ${cond}
    `,
    sql<{ slug: string; source_id: string; title: string; updated_at: string }[]>`
      SELECT p.slug, p.source_id, p.title, p.updated_at
      FROM pages p
      WHERE p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM links l WHERE l.to_page_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM links l WHERE l.from_page_id = p.id)
        ${cond}
      ORDER BY p.created_at DESC
      LIMIT ${ORPHAN_LIMIT}
    `,
    sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pages p
      WHERE p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM links l WHERE l.to_page_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM links l WHERE l.from_page_id = p.id)
        ${cond}
    `,
    sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pages p WHERE p.deleted_at IS NOT NULL ${cond}
    `,
  ]);

  return {
    chunkless: chunklessPage.map(r => ({
      slug: r.slug,
      source_id: r.source_id,
      title: r.title,
      created_at: r.created_at,
    })),
    chunkless_total: Number(chunklessTotal[0]?.count ?? 0),
    mislabeled_chunks: Number(mislabeled[0]?.count ?? 0),
    orphan_pages: orphanPage.map(r => ({
      slug: r.slug,
      source_id: r.source_id,
      title: r.title,
      updated_at: r.updated_at,
    })),
    orphans_total: Number(orphansTotal[0]?.count ?? 0),
    soft_deleted: Number(softDeleted[0]?.count ?? 0),
  };
}

export const healthRoute = new Hono();

healthRoute.get('/health', async c => {
  const resolved = await resolveSourceFilter(c);
  if (!resolved.ok) {
    return c.json({ error: 'invalid source' }, 400);
  }
  const data = await cached(`health:${resolved.source ?? 'all'}`, () => loadHealth(resolved.source));
  return c.json(data);
});
