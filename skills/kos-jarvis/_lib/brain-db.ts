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
    this.db = await PGlite.create(`file://${this.path}`);
  }

  async close(): Promise<void> {
    if (this.db) {
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

  /** Raw query escape hatch. Prefer the helpers above when one fits. */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const { rows } = await this.pg.query<T>(sql, params);
    return rows as T[];
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
