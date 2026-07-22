import { Hono } from 'hono';
import { sql } from '../db.ts';
import { cached } from '../cache.ts';
import { resolveSourceFilter } from '../source-filter.ts';

const GRANULARITIES = new Set(['day', 'week']);
const DEFAULT_DAYS = 90;
const MAX_DAYS = 730;
// Day boundary is Pacific Time, not the DB session TZ (Lucien, 2026-07-21 —
// overrides the Beijing-day-boundary draft; see prd.md). A named zone
// (rather than a fixed UTC offset) handles PST/PDT automatically. `bucket`
// is serialized as a plain string: day -> 'YYYY-MM-DD', week -> the Monday's
// 'YYYY-MM-DD' (Postgres date_trunc('week', ...) already aligns to Monday
// per ISO 8601). This format is a frozen contract with the frontend's
// zero-fill logic — do not change without updating both sides.
const TREND_TZ = 'America/Los_Angeles';
const BUCKET_FORMAT = 'YYYY-MM-DD';

async function loadTrends(granularity: 'day' | 'week', days: number, source?: string) {
  const condP = source ? sql`AND p.source_id = ${source}` : sql``;
  const [pages, chunks, embeddingCoverage, chunkless] = await Promise.all([
    sql<{ bucket: string; source_id: string; count: number }[]>`
      SELECT
        to_char(date_trunc(${granularity}, p.created_at AT TIME ZONE ${TREND_TZ}), ${BUCKET_FORMAT}) AS bucket,
        p.source_id,
        count(*)::int AS count
      FROM pages p
      WHERE p.deleted_at IS NULL AND p.created_at >= now() - (${days} || ' days')::interval ${condP}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,
    // Chunk growth stays one row per bucket (summed across sources). It is NOT
    // grouped by source_id: the shipped frontend consumes it as a single
    // series, and emitting per-source rows would silently under-count there.
    // The `?source=` filter still narrows it via the pages join.
    sql<{ bucket: string; count: number }[]>`
      SELECT
        to_char(date_trunc(${granularity}, c.created_at AT TIME ZONE ${TREND_TZ}), ${BUCKET_FORMAT}) AS bucket,
        count(*)::int AS count
      FROM content_chunks c
      JOIN pages p ON p.id = c.page_id
      WHERE c.created_at >= now() - (${days} || ' days')::interval ${condP}
      GROUP BY 1
      ORDER BY 1
    `,
    // Embedding coverage over time — CUMULATIVE and CURRENT-STATE approximation.
    // For each bucket, coverage = (chunks created on-or-before that bucket,
    // within the window, that CURRENTLY have an embedding) / (all chunks
    // created on-or-before that bucket, within the window). There are no
    // historical embedding snapshots, so this reflects today's embedding state
    // projected back onto creation dates — it answers "is the recently-created
    // cohort embedded", not "what was coverage on that past day". Emitted DENSE
    // via a generate_series spine so quiet buckets carry the prior cumulative
    // ratio forward (both running sums are unchanged) instead of reading as a
    // 0% dip once the frontend zero-fills. `coverage` is a [0,1] ratio; the
    // frontend carries it in the `count` field of its bucket type.
    sql<{ bucket: string; coverage: number }[]>`
      WITH spine AS (
        SELECT to_char(gs, ${BUCKET_FORMAT}) AS bucket
        FROM generate_series(
          date_trunc(${granularity}, (now() AT TIME ZONE ${TREND_TZ}) - ((${days} - 1) || ' days')::interval),
          date_trunc(${granularity}, (now() AT TIME ZONE ${TREND_TZ})),
          ('1 ' || ${granularity})::interval
        ) AS gs
      ),
      per_bucket AS (
        SELECT
          to_char(date_trunc(${granularity}, c.created_at AT TIME ZONE ${TREND_TZ}), ${BUCKET_FORMAT}) AS bucket,
          count(*)::int AS total,
          count(*) FILTER (WHERE c.embedding IS NOT NULL)::int AS embedded
        FROM content_chunks c
        JOIN pages p ON p.id = c.page_id
        WHERE c.created_at >= now() - (${days} || ' days')::interval ${condP}
        GROUP BY 1
      )
      SELECT
        s.bucket,
        COALESCE(
          SUM(COALESCE(pb.embedded, 0)) OVER (ORDER BY s.bucket)::float
            / NULLIF(SUM(COALESCE(pb.total, 0)) OVER (ORDER BY s.bucket), 0),
          0
        ) AS coverage
      FROM spine s
      LEFT JOIN per_bucket pb ON pb.bucket = s.bucket
      ORDER BY s.bucket
    `,
    // Chunkless sentinel (#2163): currently-chunkless live pages, bucketed by
    // their PT creation day. True chunkless history is unreconstructible
    // (backfilled pages leave no trace of when they were chunkless), so this is
    // the honest read: it surfaces whether NEWLY created pages are still
    // leaking un-chunked (intraday, before the 07:00 backfill cron catches up).
    // Sparse (zero-count buckets omitted) — the frontend zero-fills, and 0 is
    // the correct fill here (no chunkless page created that day).
    sql<{ bucket: string; count: number }[]>`
      SELECT
        to_char(date_trunc(${granularity}, p.created_at AT TIME ZONE ${TREND_TZ}), ${BUCKET_FORMAT}) AS bucket,
        count(*)::int AS count
      FROM pages p
      LEFT JOIN content_chunks c ON c.page_id = p.id
      WHERE c.id IS NULL AND p.deleted_at IS NULL
        AND p.created_at >= now() - (${days} || ' days')::interval ${condP}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  return {
    pages: pages.map(r => ({ bucket: r.bucket, source_id: r.source_id, count: Number(r.count) })),
    chunks: chunks.map(r => ({ bucket: r.bucket, count: Number(r.count) })),
    // Frontend's TrendBucket carries the coverage ratio in `count` (its y-axis
    // formats it as a percent) — map coverage → count to honor that contract.
    embedding_coverage: embeddingCoverage.map(r => ({ bucket: r.bucket, count: Number(r.coverage) })),
    chunkless: chunkless.map(r => ({ bucket: r.bucket, count: Number(r.count) })),
  };
}

export const trendsRoute = new Hono();

trendsRoute.get('/trends', async c => {
  const granularityParam = c.req.query('granularity') ?? 'day';
  if (!GRANULARITIES.has(granularityParam)) {
    return c.json({ error: "granularity must be 'day' or 'week'" }, 400);
  }
  const granularity = granularityParam as 'day' | 'week';

  const daysParam = c.req.query('days');
  let days = DEFAULT_DAYS;
  if (daysParam !== undefined) {
    const parsed = Number(daysParam);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
      return c.json({ error: 'days must be a positive integer' }, 400);
    }
    days = Math.min(parsed, MAX_DAYS);
  }

  const resolved = await resolveSourceFilter(c);
  if (!resolved.ok) {
    return c.json({ error: 'invalid source' }, 400);
  }

  const cacheKey = `trends:${granularity}:${days}:${resolved.source ?? 'all'}`;
  const data = await cached(cacheKey, () => loadTrends(granularity, days, resolved.source));
  return c.json(data);
});
