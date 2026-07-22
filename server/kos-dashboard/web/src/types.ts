// Response shapes mirroring server/kos-dashboard/src/routes/*.ts exactly.
// Keep in sync with the backend — this is the frontend/backend contract.

export interface BrainScoreComponents {
  embed_coverage: number;
  link_density: number;
  timeline_coverage: number;
  no_orphans: number;
  no_dead_links: number;
}

export interface OverviewResponse {
  pages: number;
  chunks: number;
  sources: number;
  deleted_pages: number;
  last24h_pages: number;
  embedding: {
    chunk_coverage: number;
    page_coverage: number;
    chunkless_pages: number;
  };
  brain_score: {
    total: number;
    components: BrainScoreComponents;
  };
  orphans: number;
}

export interface SourceRow {
  source_id: string;
  name: string;
  pages: number;
  chunks: number;
  embedded_chunks: number;
  chunk_coverage: number;
  page_coverage: number;
  newest_content_at: string | null;
}

export interface KindCount {
  kind: string;
  count: number;
}

export interface TypeCount {
  type: string;
  count: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface ConnectedPage {
  slug: string;
  source_id: string;
  title: string;
  links: number;
}

export interface KindsResponse {
  kos_kinds: KindCount[];
  page_types: TypeCount[];
  top_tags: TagCount[];
  most_connected: ConnectedPage[];
}

// ---- Trends (F3) ----
// FROZEN CONTRACT (prd.md "API 契约"): bucket is a sparse-array entry —
// backend omits rows for zero-count buckets entirely, so the frontend
// zero-fills (lib/zero-fill.ts). `bucket` is a PT-local `YYYY-MM-DD` string
// (design.md §5 item 0), opaque for display — never re-parse as a Date.

export interface TrendBucket {
  bucket: string;
  count: number;
}

/** Pages trend rows carry `source_id` (current backend groups by bucket +
 * source unconditionally), which is what lets the "全部" view stack by
 * source (design.md §5). */
export interface PagesTrendBucket extends TrendBucket {
  source_id: string;
}

export interface TrendsResponse {
  pages: PagesTrendBucket[];
  chunks: TrendBucket[];
  /** NOT present in the backend response as of this implementation (see
   * implement-frontend.md deviations) — optional so the embedding-coverage
   * chart degrades to an empty-state instead of crashing until Scope A
   * ships it. Values are a coverage ratio in [0, 1], not a raw count. */
  embedding_coverage?: TrendBucket[];
  /** Same caveat as `embedding_coverage` — chunkless-count-over-time. */
  chunkless?: TrendBucket[];
}

// ---- Health (F4) ----

export interface ChunklessPageRow {
  slug: string;
  source_id: string;
  title: string;
  created_at: string;
}

export interface OrphanPageRow {
  slug: string;
  source_id: string;
  title: string;
  updated_at: string;
}

export interface HealthResponse {
  /** Up to 500 rows (`CHUNKLESS_LIMIT` in health.ts) — `chunkless_total` is
   * the true count, used for the "显示 500 / 共 N" table caption. */
  chunkless: ChunklessPageRow[];
  chunkless_total: number;
  mislabeled_chunks: number;
  /** Up to 100 rows (`ORPHAN_LIMIT` in health.ts) — `orphans_total` is the
   * true count, used for the "显示 100 / 共 N" table caption. */
  orphan_pages: OrphanPageRow[];
  orphans_total: number;
  soft_deleted: number;
}

// ---- Editor (F5) ----
// Mirrors server/kos-dashboard/src/routes/pages.ts. The write-side dual lock
// (design.md §0/§2): a page is editable iff it has no takes/facts fence AND
// its source_id is 'default'. `lock_reason` disambiguates why an uneditable
// page is locked; the server re-decides authoritatively on every write.

/** Why a page can't be edited. `null` = editable. `unsupported_page_kind` =
 * a code/image page (put_page would coerce it to markdown and destroy its
 * chunking). */
export type PageLockReason = 'fenced' | 'unsupported_page_kind' | 'non_default_source' | null;

/** One row in the browse list (`GET /pages`). This list HONORS the global
 * `?source=` tab filter (unlike detail/versions/save/revert, which target the
 * page's own `source_id` explicitly — see Editor.tsx). */
export interface PageListItem {
  slug: string;
  source_id: string;
  type: string;
  title: string;
  kind: string;
  /** DB `page_kind` (markdown|code|image) — only 'markdown' is editable. */
  page_kind: string;
  updated_at: string;
  editable: boolean;
  lock_reason: PageLockReason;
}

export interface PageListResponse {
  pages: PageListItem[];
  total: number;
  limit: number;
  offset: number;
}

/** Full page for the editor (`GET /pages/detail?source=<EXPLICIT>&slug=`).
 * `content` is the reconstructed full markdown (frontmatter + body) to edit;
 * `fence_kinds` lists any takes/facts fence categories detected server-side. */
export interface PageDetail {
  slug: string;
  source_id: string;
  type: string;
  title: string;
  kind: string;
  page_kind: string;
  updated_at: string;
  content: string;
  editable: boolean;
  lock_reason: PageLockReason;
  fence_kinds: string[];
  /** Opaque optimistic-concurrency token — send it back as
   * `expected_content_hash` on save so a concurrent write is rejected (409). */
  content_hash: string | null;
}

/** One snapshot in `page_versions` (`GET /pages/versions?source=<EXPLICIT>&slug=`). */
export interface PageVersion {
  id: number;
  snapshot_at: string;
  bytes: number;
}

export interface PageVersionsResponse {
  versions: PageVersion[];
}

/** The put_page result surfaced by both save and revert (revert replays the
 * historical content through put_page). `status` is 'created_or_updated' on a
 * real write, or 'skipped' when upstream declined it (e.g. oversized). Optional
 * `write_through` reports the on-disk .md sync — an `error`/`skipped` there
 * means the DB row saved but the disk file did not. */
export interface PutPageResult {
  slug: string;
  status: string;
  chunks: number;
  write_through?: { written?: boolean; error?: string; skipped?: string };
}

/** `POST /pages/save` success body. `page` carries the post-write
 * {content_hash, updated_at} so the client resets dirty + the concurrency token
 * locally, without a refetch (which raced the editor — codex). */
export interface PageSaveResponse {
  ok: true;
  result: PutPageResult;
  page: { content_hash: string | null; updated_at: string; title: string; type: string; kind: string } | null;
}

/** `POST /pages/revert` success body (revert is a put_page replay). `page`
 * carries the reverted content + fresh meta so the client updates the editor
 * locally, without a refetch. */
export interface PageRevertResponse {
  ok: true;
  result: PutPageResult;
  page: { content: string; content_hash: string | null; updated_at: string; title: string; type: string; kind: string };
}

// ---- Ops panel (F7) ----
// Mirrors server/kos-dashboard/src/routes/ops.ts. Every action is a fixed
// server-side command template; the client only ever picks an action id (and,
// for embed-selected, a source + a subset of the live chunkless list).

/** read = no writes/spend; write = mutates the brain but no LLM/embed spend;
 * spend = real OpenAI/LLM cost. Drives the UI badge + confirm level. */
export type OpsDanger = 'read' | 'write' | 'spend';

export interface OpsAction {
  id: string;
  label: string;
  desc: string;
  danger: OpsDanger;
  /** Require a destructive-confirm dialog before running. */
  confirm: boolean;
  /** embed-selected needs a source + slugs; the rest are parameterless. */
  needs_params: boolean;
}

export interface OpsJob {
  id: string;
  action: string;
  params: Record<string, unknown> | null;
  status: 'running' | 'done' | 'error';
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  timed_out: boolean;
}

export interface OpsActionsResponse {
  actions: OpsAction[];
  /** The single in-flight job, if any (ops are single-flight). */
  running: OpsJob | null;
}

export interface OpsJobsResponse {
  jobs: OpsJob[];
}

export interface OpsJobDetail {
  job: OpsJob;
  /** Tail of the job's combined stdout+stderr log. */
  log: string;
}

export interface OpsRunResponse {
  ok: true;
  job: OpsJob;
}
