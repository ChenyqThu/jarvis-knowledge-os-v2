/**
 * merge.ts — the within-source entity-merge primitive (transactional).
 *
 * Consolidates one canonical page and N alias pages that the classifier
 * confirmed are the SAME real entity in the SAME source. Steps (validated
 * 2026-07-13 via BEGIN…ROLLBACK on companies/tp-link-system(s)-inc):
 *
 *   1. inbound links (to_page_id ∈ alias): drop unique-constraint collisions
 *      + drop self-loops, then repoint to canonical
 *   2. outbound links (from_page_id ∈ alias): symmetric
 *   3. facts.entity_slug: migrate alias → canonical
 *   4. page_aliases (display-name): copy alias rows onto canonical
 *   5. slug_aliases: insert alias_slug → canonical_slug (read-time [[old]] redirect)
 *   6. content_chunks: drop alias-page vectors (soft-delete does NOT cascade)
 *   7. pages: soft-delete the alias pages (LAST — crash here is idempotent retry)
 *
 * WHY its own postgres.js client (not _lib/BrainDb): BrainDb issues single
 * ad-hoc `unsafe()` statements and exposes no transaction. A merge must be
 * atomic across 7 statements, so we open a dedicated client and use
 * postgres.js `sql.begin()`. Production is Postgres (concurrent clients are
 * safe post-Path-3, per orphan-reducer/lib/writer.ts) so this does not race
 * the daemon.
 *
 * CROSS-SOURCE IS STRUCTURALLY IMPOSSIBLE HERE: every statement is scoped by
 * a single `source` and slug_aliases is (source_id, alias_slug, canonical_slug)
 * — the two-axis design (CLAUDE.md) is respected by construction.
 *
 * The unique constraint links_from_to_type_source_origin_unique is
 * NULLS NOT DISTINCT, so a naive `UPDATE links SET to_page_id=canon` would
 * violate it on ~36% of rows (measured). Collisions are deleted first.
 */
import postgres from "postgres";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";

const CONFIG_PATH = `${homedir()}/.gbrain/config.json`;

export type Sql = ReturnType<typeof postgres>;

export type MergeSpec = {
  source: string;
  canonical: string;
  aliases: string[];
  /** Free-text provenance stamped into slug_aliases.notes. */
  notes: string;
};

export type MergeResult = {
  spec: MergeSpec;
  /** true = committed, false = rolled back (dry-run), regardless of ok. */
  applied: boolean;
  ok: boolean;
  error: string | null;
  before: { canon_indeg: number; alias_pages_live: number };
  after: { canon_indeg: number; alias_pages_live: number };
  inbound_repointed: number;
  inbound_collisions_dropped: number;
  inbound_selfloops_dropped: number;
  outbound_repointed: number;
  outbound_collisions_dropped: number;
  outbound_selfloops_dropped: number;
  facts_moved: number;
  slug_aliases_added: number;
  page_aliases_copied: number;
  chunks_dropped: number;
  pages_soft_deleted: number;
};

class DryRunRollback extends Error {}

export function databaseUrl(): string {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`entity-dedup: ${CONFIG_PATH} not found`);
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as {
    engine?: string;
    database_url?: string;
  };
  if (cfg.engine !== "postgres" || !cfg.database_url) {
    throw new Error(
      "entity-dedup requires engine=postgres with database_url in ~/.gbrain/config.json " +
        "(refusing to run against PGLite/unknown engine)"
    );
  }
  return cfg.database_url;
}

export function openClient(): Sql {
  return postgres(databaseUrl(), {
    onnotice: () => {},
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
}

function zeroResult(spec: MergeSpec, applied: boolean): MergeResult {
  return {
    spec,
    applied,
    ok: false,
    error: null,
    before: { canon_indeg: 0, alias_pages_live: 0 },
    after: { canon_indeg: 0, alias_pages_live: 0 },
    inbound_repointed: 0,
    inbound_collisions_dropped: 0,
    inbound_selfloops_dropped: 0,
    outbound_repointed: 0,
    outbound_collisions_dropped: 0,
    outbound_selfloops_dropped: 0,
    facts_moved: 0,
    slug_aliases_added: 0,
    page_aliases_copied: 0,
    chunks_dropped: 0,
    pages_soft_deleted: 0,
  };
}

/**
 * Merge one cluster. When `dryRun`, all writes execute inside the
 * transaction then roll back (the returned counts reflect what WOULD change).
 * When not dry-run, the transaction commits.
 *
 * Per-cluster atomicity: each call is one transaction. A failure rolls back
 * that cluster only; the caller continues with the next.
 */
export async function mergeCluster(
  sql: Sql,
  spec: MergeSpec,
  dryRun: boolean
): Promise<MergeResult> {
  const res = zeroResult(spec, !dryRun);
  if (spec.aliases.length === 0) {
    res.ok = false;
    res.error = "no aliases in spec";
    return res;
  }
  try {
    await sql.begin(async (tx) => {
      const ids = await tx<{ id: number; slug: string; is_canon: boolean }[]>`
        SELECT id, slug, (slug = ${spec.canonical}) AS is_canon
        FROM pages
        WHERE source_id = ${spec.source} AND deleted_at IS NULL
          AND slug = ANY(${[spec.canonical, ...spec.aliases]})`;
      const canon = ids.find((r) => r.is_canon);
      const aliasIds = ids.filter((r) => !r.is_canon).map((r) => r.id);
      if (!canon) throw new Error(`canonical '${spec.canonical}' not found (live) in source '${spec.source}'`);
      if (aliasIds.length === 0) throw new Error(`no live alias pages found for ${spec.canonical}`);
      const canonId = canon.id;

      res.before.canon_indeg = Number(
        (await tx`SELECT count(*)::int AS n FROM links WHERE to_page_id = ${canonId}`)[0]!.n
      );
      res.before.alias_pages_live = aliasIds.length;

      // (1) inbound: drop collisions vs canonical, drop self-loops, drop
      //     inter-alias duplicates (keep lowest id), then repoint. The
      //     inter-alias step matters only for MULTI-alias merges: without it,
      //     two alias pages both linked from the same origin with the same key
      //     would repoint to identical (from,to,type,source,origin) rows and
      //     violate links_from_to_type_source_origin_unique.
      const inCanonDrop = (await tx`
        DELETE FROM links la WHERE la.to_page_id = ANY(${aliasIds})
          AND EXISTS (SELECT 1 FROM links lc WHERE lc.to_page_id = ${canonId}
            AND lc.from_page_id = la.from_page_id AND lc.link_type = la.link_type
            AND lc.link_source IS NOT DISTINCT FROM la.link_source
            AND lc.origin_page_id IS NOT DISTINCT FROM la.origin_page_id)`).count;
      res.inbound_selfloops_dropped = (await tx`
        DELETE FROM links WHERE to_page_id = ANY(${aliasIds}) AND from_page_id = ${canonId}`).count;
      const inInterAliasDrop = (await tx`
        DELETE FROM links la WHERE la.to_page_id = ANY(${aliasIds})
          AND EXISTS (SELECT 1 FROM links lb WHERE lb.to_page_id = ANY(${aliasIds})
            AND lb.id < la.id
            AND lb.from_page_id = la.from_page_id AND lb.link_type = la.link_type
            AND lb.link_source IS NOT DISTINCT FROM la.link_source
            AND lb.origin_page_id IS NOT DISTINCT FROM la.origin_page_id)`).count;
      res.inbound_collisions_dropped = inCanonDrop + inInterAliasDrop;
      res.inbound_repointed = (await tx`
        UPDATE links SET to_page_id = ${canonId} WHERE to_page_id = ANY(${aliasIds})`).count;

      // (2) outbound: symmetric (drop vs-canonical collisions, self-loops,
      //     inter-alias duplicates, then repoint).
      const outCanonDrop = (await tx`
        DELETE FROM links la WHERE la.from_page_id = ANY(${aliasIds})
          AND EXISTS (SELECT 1 FROM links lc WHERE lc.from_page_id = ${canonId}
            AND lc.to_page_id = la.to_page_id AND lc.link_type = la.link_type
            AND lc.link_source IS NOT DISTINCT FROM la.link_source
            AND lc.origin_page_id IS NOT DISTINCT FROM la.origin_page_id)`).count;
      res.outbound_selfloops_dropped = (await tx`
        DELETE FROM links WHERE from_page_id = ANY(${aliasIds}) AND to_page_id = ${canonId}`).count;
      const outInterAliasDrop = (await tx`
        DELETE FROM links la WHERE la.from_page_id = ANY(${aliasIds})
          AND EXISTS (SELECT 1 FROM links lb WHERE lb.from_page_id = ANY(${aliasIds})
            AND lb.id < la.id
            AND lb.to_page_id = la.to_page_id AND lb.link_type = la.link_type
            AND lb.link_source IS NOT DISTINCT FROM la.link_source
            AND lb.origin_page_id IS NOT DISTINCT FROM la.origin_page_id)`).count;
      res.outbound_collisions_dropped = outCanonDrop + outInterAliasDrop;
      res.outbound_repointed = (await tx`
        UPDATE links SET from_page_id = ${canonId} WHERE from_page_id = ANY(${aliasIds})`).count;

      // (3) facts
      res.facts_moved = (await tx`
        UPDATE facts SET entity_slug = ${spec.canonical}
        WHERE source_id = ${spec.source} AND entity_slug = ANY(${spec.aliases})
          AND expired_at IS NULL`).count;

      // (4) display-name aliases → canonical
      res.page_aliases_copied = (await tx`
        INSERT INTO page_aliases (source_id, alias_norm, slug)
        SELECT source_id, alias_norm, ${spec.canonical} FROM page_aliases
        WHERE source_id = ${spec.source} AND slug = ANY(${spec.aliases})
        ON CONFLICT DO NOTHING`).count;

      // (5) slug redirect aliases
      res.slug_aliases_added = (await tx`
        INSERT INTO slug_aliases (source_id, alias_slug, canonical_slug, notes)
        SELECT ${spec.source}, s, ${spec.canonical}, ${spec.notes}
        FROM unnest(${spec.aliases}::text[]) AS s
        ON CONFLICT DO NOTHING`).count;

      // (6) drop alias-page vector chunks
      res.chunks_dropped = (await tx`
        DELETE FROM content_chunks WHERE page_id = ANY(${aliasIds})`).count;

      // (7) soft-delete alias pages (LAST)
      res.pages_soft_deleted = (await tx`
        UPDATE pages SET deleted_at = now() WHERE id = ANY(${aliasIds})`).count;

      res.after.canon_indeg = Number(
        (await tx`SELECT count(*)::int AS n FROM links WHERE to_page_id = ${canonId}`)[0]!.n
      );
      res.after.alias_pages_live = Number(
        (await tx`SELECT count(*)::int AS n FROM pages WHERE source_id = ${spec.source}
          AND deleted_at IS NULL AND slug = ANY(${spec.aliases})`)[0]!.n
      );

      // Integrity assertion: no link may still reference an alias page.
      const dangling = Number(
        (await tx`SELECT count(*)::int AS n FROM links
          WHERE to_page_id = ANY(${aliasIds}) OR from_page_id = ANY(${aliasIds})`)[0]!.n
      );
      if (dangling > 0) throw new Error(`integrity: ${dangling} links still reference alias pages after repoint`);

      if (dryRun) throw new DryRunRollback();
    });
    res.ok = true; // committed
  } catch (e) {
    if (e instanceof DryRunRollback) {
      res.ok = true; // dry-run succeeded; changes intentionally rolled back
    } else {
      res.ok = false;
      res.error = String(e instanceof Error ? e.message : e).slice(0, 500);
    }
  }
  return res;
}
