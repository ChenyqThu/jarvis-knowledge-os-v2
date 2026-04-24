/**
 * Direct PGLite reader for KOS quality-gate skills.
 *
 * Why direct: `gbrain list` caps at 100 rows (MCP list_pages operation).
 * With 1700+ pages we need full-table access. `engine.listPages({ limit:
 * 100000 })` in upstream does exactly that; we call it the same way.
 *
 * Single-writer lock: PGLite is one-writer, many-reader-via-same-handle.
 * Open briefly, read, close. Don't hold across LLM calls. When
 * `kos-compat-api` is running its own gbrain subprocess, we'll hit
 * "Timed out waiting for PGLite lock" — caller should retry or run
 * during quiet window.
 */
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { homedir } from "node:os";

const DEFAULT_DB = `${homedir()}/.gbrain/brain.pglite`;

export type PageRow = {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string;
  timeline: string;
  frontmatter: Record<string, unknown>;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
};

export type BackrefCount = { to_slug: string; inbound: number };

export class BrainDb {
  private db: PGlite | null = null;
  constructor(private path: string = DEFAULT_DB) {}

  async open(): Promise<void> {
    if (this.db) return;
    // Match src/core/pglite-engine.ts:48 — without the `vector` extension the
    // `<=>` operator fails at load time with code 58P01 on fresh handles.
    this.db = await PGlite.create({
      dataDir: `file://${this.path}`,
      extensions: { vector, pg_trgm },
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      // Mirror the fork-local WAL-durability patch in
      // src/core/pglite-engine.ts:disconnect(). pglite 0.4.4 on macOS
      // 26.3 loses writes on close() unless a WAL switch forces the
      // durable LSN forward. See docs/UPSTREAM-PATCHES/
      // v018-pglite-wal-durability-fix.md. Harmless on read-only
      // handles (pg_switch_wal is a no-op when no new WAL records).
      try {
        await this.db.query("SELECT pg_switch_wal()");
      } catch {
        // best-effort: close still proceeds even if the switch fails
      }
      await this.db.close();
      this.db = null;
    }
  }

  private get pg(): PGlite {
    if (!this.db) throw new Error("BrainDb.open() not called");
    return this.db;
  }

  async listAllPages(filter?: { type?: string }): Promise<PageRow[]> {
    const where = filter?.type ? `WHERE type = $1` : "";
    const params = filter?.type ? [filter.type] : [];
    const { rows } = await this.pg.query<PageRow>(
      `SELECT id, slug, type, title, compiled_truth, timeline, frontmatter,
              content_hash, created_at, updated_at
       FROM pages ${where}
       ORDER BY updated_at DESC`,
      params
    );
    return rows.map((r) => ({
      ...r,
      frontmatter:
        typeof r.frontmatter === "string"
          ? JSON.parse(r.frontmatter)
          : r.frontmatter ?? {},
    }));
  }

  async getPage(slug: string): Promise<PageRow | null> {
    const { rows } = await this.pg.query<PageRow>(
      `SELECT id, slug, type, title, compiled_truth, timeline, frontmatter,
              content_hash, created_at, updated_at
       FROM pages WHERE slug = $1`,
      [slug]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      ...r,
      frontmatter:
        typeof r.frontmatter === "string"
          ? JSON.parse(r.frontmatter)
          : r.frontmatter ?? {},
    };
  }

  /** Count inbound links grouped by target slug, for all pages in one scan. */
  async inboundCounts(): Promise<Map<string, number>> {
    const { rows } = await this.pg.query<{ slug: string; inbound: number }>(
      `SELECT p.slug, COUNT(l.id)::int AS inbound
       FROM pages p
       LEFT JOIN links l ON l.to_page_id = p.id
       GROUP BY p.slug`
    );
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.slug, Number(r.inbound) || 0);
    return m;
  }

  /**
   * Insert or update one link row. Mirrors src/core/pglite-engine.ts:365
   * (engine.addLink). Default link_source='manual' — our callers are
   * programmatic writers, not markdown extraction.
   *
   * Called in-process to avoid the PGLite lock contention you hit when
   * `spawnSync('gbrain link')` is invoked while BrainDb is already open.
   * Returns true if a new row was inserted, false if it was a no-op
   * (ON CONFLICT DO UPDATE touches the same row).
   */
  async addLink(
    from: string,
    to: string,
    opts: {
      linkType?: string;
      context?: string;
      linkSource?: "markdown" | "frontmatter" | "manual";
    } = {}
  ): Promise<boolean> {
    const src = opts.linkSource ?? "manual";
    const result = await this.pg.query<{ id: number; xmax: number }>(
      `INSERT INTO links (from_page_id, to_page_id, link_type, context, link_source)
       SELECT f.id, t.id, $3, $4, $5
       FROM pages f, pages t
       WHERE f.slug = $1 AND t.slug = $2
       ON CONFLICT (from_page_id, to_page_id, link_type, link_source, origin_page_id) DO UPDATE SET
         context = EXCLUDED.context
       RETURNING id, xmax::text::int AS xmax`,
      [from, to, opts.linkType ?? "", opts.context ?? "", src]
    );
    if (result.rows.length === 0) return false;
    // xmax is 0 on pure INSERT, non-zero when the ON CONFLICT branch fired.
    return result.rows[0].xmax === 0;
  }

  /** Count rows in the links table (fast, used by tests/validation). */
  async countLinks(filter?: { linkType?: string; linkSource?: string }): Promise<number> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.linkType !== undefined) {
      params.push(filter.linkType);
      clauses.push(`link_type = $${params.length}`);
    }
    if (filter?.linkSource !== undefined) {
      params.push(filter.linkSource);
      clauses.push(`link_source = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await this.pg.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM links ${where}`,
      params
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Raw query escape hatch. Prefer the helpers above when one fits. */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const { rows } = await this.pg.query<T>(sql, params);
    return rows as T[];
  }

  /**
   * Pages with zero inbound links — matches `gbrain orphans` SQL
   * (src/core/pglite-engine.ts:685). Returns raw unfiltered rows; caller
   * applies pseudo/domain filters (see src/commands/orphans.ts:shouldExclude).
   */
  async listOrphans(): Promise<Array<{ slug: string; title: string; domain: string | null }>> {
    const { rows } = await this.pg.query<{ slug: string; title: string; domain: string | null }>(
      `SELECT p.slug,
              COALESCE(p.title, p.slug) AS title,
              p.frontmatter->>'domain' AS domain
       FROM pages p
       WHERE NOT EXISTS (SELECT 1 FROM links l WHERE l.to_page_id = p.id)
       ORDER BY p.slug`
    );
    return rows;
  }

  /**
   * Vector-similar pages to a given slug via pgvector cosine distance.
   * Uses the first embedded chunk of the source page as the anchor vector;
   * returns top-K pages (dedup'd at the page level via MIN(distance)).
   * Callers that want per-chunk precision should query content_chunks
   * directly.
   */
  async findSimilar(
    slug: string,
    limit: number
  ): Promise<
    Array<{ slug: string; title: string; compiled_truth: string; distance: number }>
  > {
    const { rows } = await this.pg.query<{
      slug: string;
      title: string;
      compiled_truth: string;
      distance: number;
    }>(
      `WITH target AS (
         SELECT c.embedding, p.id AS page_id
         FROM content_chunks c
         JOIN pages p ON p.id = c.page_id
         WHERE p.slug = $1 AND c.embedding IS NOT NULL
         ORDER BY c.chunk_index ASC
         LIMIT 1
       )
       SELECT p.slug,
              COALESCE(p.title, p.slug) AS title,
              p.compiled_truth,
              MIN(c.embedding <=> t.embedding)::float AS distance
       FROM content_chunks c
       JOIN pages p ON p.id = c.page_id
       CROSS JOIN target t
       WHERE p.id != t.page_id AND c.embedding IS NOT NULL
       GROUP BY p.slug, p.title, p.compiled_truth
       ORDER BY distance ASC
       LIMIT $2`,
      [slug, limit]
    );
    return rows;
  }

  /** Chunk count per page — used by citation-density heuristic. */
  async chunkCounts(): Promise<Map<string, number>> {
    const { rows } = await this.pg.query<{ slug: string; n: number }>(
      `SELECT p.slug, COUNT(c.id)::int AS n
       FROM pages p
       LEFT JOIN content_chunks c ON c.page_id = p.id
       GROUP BY p.slug`
    );
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.slug, Number(r.n) || 0);
    return m;
  }
}
