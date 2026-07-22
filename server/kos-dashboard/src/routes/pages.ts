import { Hono } from 'hono';
import matter from 'gray-matter';
import { sql } from '../db.ts';
import { resolveSourceFilter } from '../source-filter.ts';
import { detectFences, TAKES_FENCE_BEGIN, FACTS_FENCE_BEGIN } from '../fence.ts';
import { toEditableMarkdown } from '../page-serialize.ts';
import { putPage, mcpWriteConfigured } from '../mcp-client.ts';

// The OAuth client `kos-dashboard` has write scope on the `default` source only
// (design.md §0). A page is editable only when it is on that source AND carries
// no takes/facts fence (a remote-read strip would drop them on a round-trip)
// AND is a markdown page (put_page would coerce a code/image page to markdown
// and destroy its modality-specific chunking). All three are re-decided
// server-side on every mutation — the client's `editable` flag is never trusted.
const WRITABLE_SOURCE = 'default';
const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 100;
const VERSIONS_LIMIT = 50;

const takesLike = `%${TAKES_FENCE_BEGIN}%`;
const factsLike = `%${FACTS_FENCE_BEGIN}%`;

type LockReason = 'fenced' | 'unsupported_page_kind' | 'non_default_source' | null;

/** Precedence: fence (data loss) > page_kind (modality corruption) > source
 * (scope). */
function lockReason(fenced: boolean, pageKind: string, sourceId: string): LockReason {
  if (fenced) return 'fenced';
  if (pageKind !== 'markdown') return 'unsupported_page_kind';
  if (sourceId !== WRITABLE_SOURCE) return 'non_default_source';
  return null;
}

/**
 * Guard against a save that would destructively wipe frontmatter. put_page
 * REPLACES a page's frontmatter from the submitted content (parseMarkdown via
 * gray-matter), which only recognizes a `---` fence at byte 0 (optional BOM);
 * leading whitespace or a missing closer makes it treat the whole document as
 * body → `{}` frontmatter, and a missing type/title is then re-inferred from the
 * path. Verified gray-matter behavior: leading-whitespace → empty data;
 * unterminated block → throws. Returns an error string, or null when valid.
 */
function validateEditableContent(content: string): string | null {
  if (content.trim().length === 0) return 'empty content';
  if (!/^\uFEFF?---\r?\n/.test(content)) {
    return 'content must begin with a --- frontmatter block (no leading blank lines)';
  }
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return 'frontmatter is not valid YAML (check the closing --- and indentation)';
  }
  const fm = parsed.data as Record<string, unknown>;
  if (!fm || typeof fm !== 'object' || Object.keys(fm).length === 0) {
    return 'frontmatter block is empty or unterminated';
  }
  if (typeof fm.type !== 'string' || fm.type.trim() === '') return 'frontmatter must include a non-empty type';
  if (typeof fm.title !== 'string' || fm.title.trim() === '') return 'frontmatter must include a non-empty title';
  return null;
}

/** Reads the post-write {content_hash, updated_at} so save/revert can return
 * them and the client can update its state locally — no refetch (which had a
 * clobber race against the editor, codex). */
interface PageMeta {
  content_hash: string | null;
  updated_at: string;
  title: string;
  type: string;
  kind: string;
}
async function readPageMeta(source: string, slug: string): Promise<PageMeta | null> {
  const rows = await sql<PageMeta[]>`
    SELECT content_hash, updated_at, title, type,
           COALESCE(NULLIF(frontmatter->>'kind',''),'unknown') AS kind
    FROM pages
    WHERE source_id = ${source} AND slug = ${slug} AND deleted_at IS NULL LIMIT 1
  `;
  return rows[0] ?? null;
}

export const pagesRoute = new Hono();

// GET /pages — list/search (RO read). Honors the global ?source= filter.
pagesRoute.get('/pages', async c => {
  const resolved = await resolveSourceFilter(c);
  if (!resolved.ok) return c.json({ error: 'invalid source' }, 400);
  const source = resolved.source;
  const kind = c.req.query('kind')?.trim() || undefined;
  const q = c.req.query('q')?.trim() || undefined;
  const limit = Math.min(
    Math.max(Number(c.req.query('limit') ?? LIST_LIMIT_DEFAULT) || LIST_LIMIT_DEFAULT, 1),
    LIST_LIMIT_MAX,
  );
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);

  const sourceCond = source ? sql`AND p.source_id = ${source}` : sql``;
  const kindCond = kind ? sql`AND p.frontmatter->>'kind' = ${kind}` : sql``;
  const qCond = q
    ? sql`AND (p.slug ILIKE ${'%' + q + '%'} OR p.title ILIKE ${'%' + q + '%'})`
    : sql``;

  const [rows, totalRows] = await Promise.all([
    sql<
      {
        slug: string;
        source_id: string;
        type: string;
        title: string;
        kind: string;
        page_kind: string;
        updated_at: string;
        fenced: boolean;
      }[]
    >`
      SELECT p.slug, p.source_id, p.type, p.title, p.page_kind,
             COALESCE(NULLIF(p.frontmatter->>'kind',''),'unknown') AS kind,
             p.updated_at,
             (p.compiled_truth LIKE ${takesLike} OR p.compiled_truth LIKE ${factsLike}) AS fenced
      FROM pages p
      WHERE p.deleted_at IS NULL ${sourceCond} ${kindCond} ${qCond}
      ORDER BY p.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pages p
      WHERE p.deleted_at IS NULL ${sourceCond} ${kindCond} ${qCond}
    `,
  ]);

  return c.json({
    pages: rows.map(r => {
      const reason = lockReason(r.fenced, r.page_kind, r.source_id);
      return {
        slug: r.slug,
        source_id: r.source_id,
        type: r.type,
        title: r.title,
        kind: r.kind,
        page_kind: r.page_kind,
        updated_at: r.updated_at,
        editable: reason === null,
        lock_reason: reason,
      };
    }),
    total: Number(totalRows[0]?.count ?? 0),
    limit,
    offset,
  });
});

// GET /pages/detail?source=&slug= — one page for editing (RO read). Requires an
// explicit source (slug is unique only per source_id: pages_source_slug_key).
pagesRoute.get('/pages/detail', async c => {
  const resolved = await resolveSourceFilter(c);
  if (!resolved.ok) return c.json({ error: 'invalid source' }, 400);
  if (!resolved.source) return c.json({ error: 'source required' }, 400);
  const slug = c.req.query('slug')?.trim();
  if (!slug) return c.json({ error: 'slug required' }, 400);

  const rows = await sql<
    {
      id: number;
      slug: string;
      source_id: string;
      type: string;
      title: string;
      page_kind: string;
      timeline: string;
      compiled_truth: string;
      frontmatter: Record<string, unknown>;
      content_hash: string | null;
      updated_at: string;
      kind: string;
    }[]
  >`
    SELECT p.id, p.slug, p.source_id, p.type, p.title, p.page_kind, p.timeline, p.compiled_truth,
           p.frontmatter, p.content_hash, p.updated_at,
           COALESCE(NULLIF(p.frontmatter->>'kind',''),'unknown') AS kind
    FROM pages p
    WHERE p.deleted_at IS NULL AND p.source_id = ${resolved.source} AND p.slug = ${slug}
    LIMIT 1
  `;
  if (rows.length === 0) return c.json({ error: 'not found' }, 404);
  const p = rows[0];

  const tagRows = await sql<{ tag: string }[]>`SELECT tag FROM tags WHERE page_id = ${p.id} ORDER BY tag`;
  const tags = tagRows.map(t => t.tag);

  const fences = detectFences(p.compiled_truth);
  const reason = lockReason(fences.length > 0, p.page_kind, p.source_id);
  const content = toEditableMarkdown(
    {
      type: p.type,
      title: p.title,
      timeline: p.timeline,
      compiled_truth: p.compiled_truth,
      frontmatter: p.frontmatter,
    },
    tags,
  );

  return c.json({
    slug: p.slug,
    source_id: p.source_id,
    type: p.type,
    title: p.title,
    kind: p.kind,
    page_kind: p.page_kind,
    updated_at: p.updated_at,
    // Opaque optimistic-concurrency token — echo it back on save (design.md §4).
    content_hash: p.content_hash,
    content,
    editable: reason === null,
    lock_reason: reason,
    fence_kinds: fences,
  });
});

// GET /pages/versions?source=&slug= — version history. Reads page_versions via
// the RO role directly (NOT MCP get_versions, which strips takes fences for
// remote callers — operations.ts:2542).
pagesRoute.get('/pages/versions', async c => {
  const resolved = await resolveSourceFilter(c);
  if (!resolved.ok) return c.json({ error: 'invalid source' }, 400);
  if (!resolved.source) return c.json({ error: 'source required' }, 400);
  const slug = c.req.query('slug')?.trim();
  if (!slug) return c.json({ error: 'slug required' }, 400);

  const pageRows = await sql<{ id: number }[]>`
    SELECT id FROM pages WHERE source_id = ${resolved.source} AND slug = ${slug} AND deleted_at IS NULL LIMIT 1
  `;
  if (pageRows.length === 0) return c.json({ error: 'not found' }, 404);

  const versions = await sql<{ id: number; snapshot_at: string; bytes: number }[]>`
    SELECT id, snapshot_at, octet_length(compiled_truth) AS bytes
    FROM page_versions WHERE page_id = ${pageRows[0].id}
    ORDER BY snapshot_at DESC, id DESC
    LIMIT ${VERSIONS_LIMIT}
  `;
  return c.json({
    versions: versions.map(v => ({ id: Number(v.id), snapshot_at: v.snapshot_at, bytes: Number(v.bytes) })),
  });
});

interface StoredWritable {
  id: number;
  type: string;
  title: string;
  timeline: string;
  compiled_truth: string;
  page_kind: string;
  frontmatter: Record<string, unknown>;
  content_hash: string | null;
}

/**
 * Re-reads the STORED page (RO) and enforces the write invariants the client
 * cannot be trusted to have honored: existence, fence-free, markdown. Returns
 * the row, or a ready-to-return error Response. Shared by save and revert so
 * rollback can't bypass the fence/page_kind gate (codex HIGH).
 */
async function loadWritableStored(
  source: string,
  slug: string,
): Promise<{ stored: StoredWritable } | { status: 404 | 409; error: string; detail?: string; fence_kinds?: string[] }> {
  const rows = await sql<StoredWritable[]>`
    SELECT id, type, title, timeline, compiled_truth, page_kind, frontmatter, content_hash
    FROM pages WHERE deleted_at IS NULL AND source_id = ${source} AND slug = ${slug} LIMIT 1
  `;
  if (rows.length === 0) return { status: 404, error: 'not found' };
  const stored = rows[0];
  const fences = detectFences(stored.compiled_truth);
  if (fences.length > 0) {
    return { status: 409, error: 'fenced page', detail: 'takes/facts fences would be lost; editing disabled', fence_kinds: fences };
  }
  if (stored.page_kind !== 'markdown') {
    return { status: 409, error: 'unsupported page kind', detail: `page_kind='${stored.page_kind}' is not editable` };
  }
  return { stored };
}

// POST /pages/save {source, slug, content, expected_content_hash?} — write via
// MCP put_page. Guard order (codex review): source → stored page (fence /
// page_kind) → content validity → optimistic concurrency → MCP.
pagesRoute.post('/pages/save', async c => {
  if (!mcpWriteConfigured()) return c.json({ error: 'write path not configured' }, 503);
  const body = (await c.req.json().catch(() => null)) as
    | { source?: string; slug?: string; content?: string; expected_content_hash?: string | null }
    | null;
  if (!body || typeof body.source !== 'string' || typeof body.slug !== 'string' || typeof body.content !== 'string') {
    return c.json({ error: 'source, slug, content required' }, 400);
  }
  const { source, slug, content } = body;

  if (source !== WRITABLE_SOURCE) {
    return c.json({ error: 'source not writable', detail: `only '${WRITABLE_SOURCE}' source is editable` }, 403);
  }

  const loaded = await loadWritableStored(source, slug);
  if ('error' in loaded) {
    return c.json({ error: loaded.error, detail: loaded.detail, fence_kinds: loaded.fence_kinds }, loaded.status);
  }
  const stored = loaded.stored;

  const invalid = validateEditableContent(content);
  if (invalid) return c.json({ error: 'invalid content', detail: invalid }, 400);
  // Don't let the editor INTRODUCE a fence into a fence-free page — it would be
  // silently stripped on the next remote read.
  if (detectFences(content).length > 0) {
    return c.json({ error: 'content adds a fence', detail: 'editor content must not contain takes/facts fence markers' }, 400);
  }

  // Best-effort optimistic concurrency (design.md §4): the client echoes back the
  // content_hash it opened the page with — which may be `null` for a legacy page
  // never written through put_page. Reject if the stored hash has since changed,
  // comparing `null` as a first-class value so a null→hash transition (an
  // already-committed concurrent/zombie write, e.g. after a 30s save timeout) is
  // ALSO caught (codex: a nullable hash previously bypassed the check). Opt-in:
  // only enforced when the client sent the field. A residual sub-second TOCTOU
  // remains between this RO read and the non-CAS put_page write — put_page has no
  // compare-and-set — so this narrows, not closes, the lost-update race (needs an
  // upstream CAS to fully close; src/* is a fork no-go).
  if (
    'expected_content_hash' in body &&
    (body.expected_content_hash ?? null) !== (stored.content_hash ?? null)
  ) {
    return c.json(
      { error: 'conflict', detail: 'page changed since it was opened; reload and re-apply your edit' },
      409,
    );
  }

  try {
    const result = await putPage(slug, content);
    // Return the fresh {content_hash, updated_at} so the client updates its
    // state locally instead of refetching.
    const page = await readPageMeta(source, slug);
    return c.json({ ok: true, result, page });
  } catch (e) {
    return c.json({ error: 'save failed', detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// POST /pages/revert {source, slug, version_id} — roll back by REPLAYING the
// historical content through put_page (full chunk+embed+write-through pipeline),
// NOT the bare `revert_version` MCP op. That op only does `UPDATE pages SET
// compiled_truth, frontmatter` (postgres-engine.ts:5257) and leaves
// content_chunks, embeddings, type/title/tags/timeline, and the on-disk .md
// stale — search would return pre-revert content and a later `gbrain sync`
// could overwrite the rollback from stale disk (codex BLOCKER). page_versions
// only snapshots compiled_truth + frontmatter, so the current type/title/tags/
// timeline are preserved (a content rollback, not a full-row rollback). Replay
// snapshots the current state first (put_page → createVersion), so the rollback
// is itself reversible.
pagesRoute.post('/pages/revert', async c => {
  if (!mcpWriteConfigured()) return c.json({ error: 'write path not configured' }, 503);
  const body = (await c.req.json().catch(() => null)) as
    | { source?: string; slug?: string; version_id?: number }
    | null;
  if (
    !body ||
    typeof body.source !== 'string' ||
    typeof body.slug !== 'string' ||
    typeof body.version_id !== 'number'
  ) {
    return c.json({ error: 'source, slug, version_id required' }, 400);
  }
  const { source, slug, version_id } = body;

  if (source !== WRITABLE_SOURCE) {
    return c.json({ error: 'source not writable', detail: `only '${WRITABLE_SOURCE}' source is editable` }, 403);
  }

  // Same editability gate as save — rollback is a write, so a fenced or
  // non-markdown page is off-limits (codex HIGH: rollback bypassed the fence lock).
  const loaded = await loadWritableStored(source, slug);
  if ('error' in loaded) {
    return c.json({ error: loaded.error, detail: loaded.detail, fence_kinds: loaded.fence_kinds }, loaded.status);
  }
  const page = loaded.stored;

  // The version must belong to this (source, slug) page.
  const verRows = await sql<{ compiled_truth: string; frontmatter: Record<string, unknown> }[]>`
    SELECT compiled_truth, frontmatter FROM page_versions WHERE id = ${version_id} AND page_id = ${page.id} LIMIT 1
  `;
  if (verRows.length === 0) return c.json({ error: 'version not found for page' }, 404);
  const ver = verRows[0];
  // A historical version could itself contain a fence; replaying it would make
  // the live page fenced (and thereafter un-editable / strip-exposed). Refuse.
  if (detectFences(ver.compiled_truth).length > 0) {
    return c.json({ error: 'fenced version', detail: 'cannot roll back to a version that contains a fence' }, 409);
  }

  const tagRows = await sql<{ tag: string }[]>`SELECT tag FROM tags WHERE page_id = ${page.id} ORDER BY tag`;
  const tags = tagRows.map(t => t.tag);

  // Reconstruct the historical markdown: the version's body + frontmatter,
  // with the current type/title/tags/timeline (which versions don't snapshot).
  const content = toEditableMarkdown(
    {
      type: page.type,
      title: page.title,
      timeline: page.timeline,
      compiled_truth: ver.compiled_truth,
      frontmatter: ver.frontmatter,
    },
    tags,
  );

  try {
    const result = await putPage(slug, content);
    // Return the reverted content + fresh meta so the client updates its editor
    // and state locally (no refetch clobber race).
    const meta = await readPageMeta(source, slug);
    return c.json({
      ok: true,
      result,
      page: {
        content,
        content_hash: meta?.content_hash ?? null,
        updated_at: meta?.updated_at ?? '',
        title: meta?.title ?? page.title,
        type: meta?.type ?? page.type,
        kind: meta?.kind ?? 'unknown',
      },
    });
  } catch (e) {
    return c.json({ error: 'revert failed', detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});
