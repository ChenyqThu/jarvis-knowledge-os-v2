import type { Context } from 'hono';
import { sql } from './db.ts';
import { cached } from './cache.ts';

const VALID_SOURCE_IDS_TTL_MS = 60_000;

async function loadValidSourceIds(): Promise<Set<string>> {
  const rows = await sql<{ id: string }[]>`SELECT id FROM sources`;
  return new Set(rows.map(r => r.id));
}

export type SourceFilterResult = { ok: true; source?: string } | { ok: false };

/**
 * Resolves the optional `?source=` query param against the DB's actual set of
 * source ids (small TTL cache — new sources are rare, so a minute of staleness
 * is fine for a filter whitelist). No param means "whole brain" (`source`
 * stays undefined). An unrecognized id is rejected so routes can respond 400
 * `{error:'invalid source'}` instead of silently returning empty results for
 * a typo'd source_id.
 */
export async function resolveSourceFilter(c: Context): Promise<SourceFilterResult> {
  const requested = c.req.query('source');
  if (requested === undefined) {
    return { ok: true, source: undefined };
  }
  const validIds = await cached('valid-source-ids', loadValidSourceIds, VALID_SOURCE_IDS_TTL_MS);
  if (!validIds.has(requested)) {
    return { ok: false };
  }
  return { ok: true, source: requested };
}
