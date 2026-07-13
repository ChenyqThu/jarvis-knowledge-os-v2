#!/usr/bin/env bun
/**
 * entity-dedup — merge within-source entity-variant pages into one canonical
 * node (repoint links + facts + aliases, soft-delete the alias pages).
 *
 * SCOPE (per Lucien 2026-07-13): WITHIN-SOURCE only. Cross-source same-slug
 * pages are legitimately separate under the two-axis design (CLAUDE.md +
 * REFINEMENT-BACKLOG R1/R2) and are never touched. Complements orphan-reducer
 * (it adds inbound links to orphans; this merges duplicate nodes) — no overlap.
 *
 * Pipeline:
 *   A. loadClusters   — same-source/dir trigram-similar variant clusters
 *   B. classify       — LLM says merge / ambiguous / distinct per cluster
 *   C. build specs    — accept merges with confidence ≥ --min-confidence
 *   D. mergeCluster   — transactional primitive; --dry rolls back, --apply commits
 *   E. writeReport    — markdown + JSON rollback manifest
 *
 * Default is --dry (classify + simulate + report; zero DB changes).
 *
 * Usage:
 *   bun run skills/kos-jarvis/entity-dedup/run.ts [flags]
 */
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrainDb } from "../_lib/brain-db.ts";
import { loadClusters, type VariantCluster } from "./lib/candidates.ts";
import {
  classifyWithRetry,
  ClassifierCallStats,
  estimateCostUsd,
  CLASSIFIER_MODEL,
  makeClient,
} from "./lib/classifier.ts";
import { openClient, mergeCluster, type MergeSpec, type MergeResult } from "./lib/merge.ts";
import { writeReport, type ClusterRecord, type RunSummary } from "./lib/report.ts";

type Flags = {
  dryRun: boolean;
  apply: boolean;
  limit: number;
  minSim: number;
  minConfidence: number;
  source: string | null;
  iKnow: boolean;
  json: boolean;
  help: boolean;
};

function parseFlags(argv: string[]): Flags {
  const f: Flags = {
    dryRun: true,
    apply: false,
    limit: 20,
    minSim: 0.55,
    minConfidence: 0.85,
    source: null,
    iKnow: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--help":
      case "-h":
        f.help = true;
        break;
      case "--dry-run":
      case "--dry":
        f.dryRun = true;
        f.apply = false;
        break;
      case "--apply":
        f.apply = true;
        f.dryRun = false;
        break;
      case "--i-know":
        f.iKnow = true;
        break;
      case "--json":
        f.json = true;
        break;
      case "--limit":
        f.limit = Number(argv[++i]);
        break;
      case "--min-sim":
        f.minSim = Number(argv[++i]);
        break;
      case "--min-confidence":
        f.minConfidence = Number(argv[++i]);
        break;
      case "--source":
        f.source = argv[++i] ?? null;
        break;
      default:
        if (a.startsWith("--")) {
          console.error(`unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  if (!Number.isFinite(f.limit) || f.limit <= 0) f.limit = 20;
  if (!Number.isFinite(f.minSim)) f.minSim = 0.55;
  if (!Number.isFinite(f.minConfidence)) f.minConfidence = 0.85;
  return f;
}

const USAGE = `
entity-dedup — merge within-source duplicate entity pages into one canonical node.

Usage:
  bun run skills/kos-jarvis/entity-dedup/run.ts [flags]

Flags:
  --dry, --dry-run       (default) classify + simulate merges + report; NO writes
  --apply                COMMIT accepted merges (requires --i-know)
  --limit N              max variant clusters to process       (default 20)
  --source ID            scope to one source (default, mailagent-emails, omada, ...)
  --min-sim F            trigram threshold for candidate pairs  (default 0.55)
  --min-confidence F     accept a merge only at/above this LLM confidence (default 0.85)
  --i-know               required for --apply (you have a fresh pg_dump)
  --json                 emit JSONL progress to stdout
  --help, -h             this message

Model: KOS_DEDUP_MODEL env (default ${CLASSIFIER_MODEL}). ANTHROPIC_API_KEY required.

Report: ~/brain/.agent/reports/entity-dedup-<ISO>.md (+ .json rollback manifest)
`;

// ----- Lock (mirror orphan-reducer: $TMPDIR is inside the sandbox allowlist) -----
const LOCK_DIR = join(tmpdir(), "kos-jarvis");
const LOCK_FILE = join(LOCK_DIR, "entity-dedup.lock");

function acquireLock(): boolean {
  try {
    mkdirSync(LOCK_DIR, { recursive: true });
    const fd = openSync(LOCK_FILE, "wx");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}
function releaseLock(): void {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    /* best-effort */
  }
}

function log(json: boolean, event: string, data: Record<string, unknown> = {}): void {
  if (json) console.log(JSON.stringify({ event, ...data }));
  else console.error(`[entity-dedup] ${event}${Object.keys(data).length ? " " + JSON.stringify(data) : ""}`);
}

async function main(): Promise<void> {
  const f = parseFlags(process.argv.slice(2));
  if (f.help) {
    console.log(USAGE);
    return;
  }
  if (f.apply && !f.iKnow) {
    console.error(
      "Refusing --apply without --i-know.\n" +
        "Merges soft-delete pages + rewrite links/facts. Take a backup first:\n" +
        "  pg_dump postgresql://chenyuanquan@127.0.0.1:5432/gbrain | gzip > /tmp/pre-dedup-$(date +%F).dump.gz\n" +
        "then re-run with --apply --i-know."
    );
    process.exit(2);
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error("ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN not set (classifier requires one).");
    process.exit(2);
  }
  if (!acquireLock()) {
    console.error(`another entity-dedup run appears active (${LOCK_FILE}). Remove it if stale.`);
    process.exit(1);
  }

  const isoStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stats = new ClassifierCallStats();
  const records: ClusterRecord[] = [];
  const db = new BrainDb();

  try {
    log(f.json, "start", { mode: f.apply ? "apply" : "dry-run", limit: f.limit, source: f.source });
    await db.open();

    // A. clusters
    const clusters: VariantCluster[] = await loadClusters(db, {
      source: f.source ?? undefined,
      minSim: f.minSim,
      limit: f.limit,
    });
    log(f.json, "clusters_loaded", { count: clusters.length });

    // B. classify + C. build specs
    const client = makeClient();
    const specsByCluster: { cluster: VariantCluster; specs: MergeSpec[]; verdict: ClusterRecord["verdict"] }[] = [];
    for (const cluster of clusters) {
      const verdict = await classifyWithRetry(cluster, stats, client);
      const specs: MergeSpec[] = verdict.merges
        .filter((m) => m.confidence >= f.minConfidence && m.aliases.length > 0)
        .map((m) => ({
          source: cluster.source,
          canonical: m.canonical,
          aliases: m.aliases,
          notes: `entity-dedup ${isoStamp} conf=${m.confidence.toFixed(2)} :: ${m.reason}`.slice(0, 300),
        }));
      specsByCluster.push({ cluster, specs, verdict });
      log(f.json, "classified", {
        source: cluster.source,
        members: cluster.members.map((m) => m.slug),
        accepted: specs.length,
        ambiguous: verdict.ambiguous.length,
        distinct: verdict.distinct.length,
      });
    }

    // Close the read handle before write phase (hygiene).
    await db.close();

    // D. merge (dry-run rolls back inside merge.ts; apply commits)
    const sql = openClient();
    try {
      for (const entry of specsByCluster) {
        const results: MergeResult[] = [];
        for (const spec of entry.specs) {
          const r = await mergeCluster(sql, spec, f.dryRun);
          results.push(r);
          log(f.json, r.ok ? "merged" : "merge_error", {
            canonical: spec.canonical,
            aliases: spec.aliases,
            applied: r.applied,
            indeg: `${r.before.canon_indeg}->${r.after.canon_indeg}`,
            error: r.error ?? undefined,
          });
        }
        records.push({ cluster: entry.cluster, verdict: entry.verdict, results });
      }
    } finally {
      await sql.end({ timeout: 5 });
    }

    // E. report
    const summary = summarize(isoStamp, f, records, estimateCostUsd(stats));
    const { md, json } = writeReport(summary);
    log(f.json, "report", { md, json });
    console.error(
      `\n[entity-dedup] ${f.apply ? "APPLIED" : "DRY-RUN"}: ` +
        `${summary.mergesCommitted}/${summary.mergesAccepted} merges${f.apply ? " committed" : " simulated"}, ` +
        `${summary.aliasPagesRetired} alias pages retired, ${summary.linksRepointed} links repointed, ` +
        `${summary.ambiguousGroups} ambiguous quarantined.\nReport: ${md}`
    );
  } finally {
    releaseLock();
    try {
      await db.close();
    } catch {
      /* already closed */
    }
  }
}

function summarize(
  isoStamp: string,
  f: Flags,
  records: ClusterRecord[],
  costUsd: number
): RunSummary {
  let mergesProposed = 0,
    mergesAccepted = 0,
    mergesCommitted = 0,
    ambiguousGroups = 0,
    distinctGroups = 0,
    aliasPagesRetired = 0,
    linksRepointed = 0,
    linksPruned = 0,
    factsMoved = 0;
  for (const rec of records) {
    mergesProposed += rec.verdict.merges.length;
    ambiguousGroups += rec.verdict.ambiguous.length;
    distinctGroups += rec.verdict.distinct.length;
    for (const r of rec.results) {
      mergesAccepted += 1;
      if (r.ok) {
        mergesCommitted += 1;
        aliasPagesRetired += r.pages_soft_deleted;
        linksRepointed += r.inbound_repointed + r.outbound_repointed;
        linksPruned +=
          r.inbound_collisions_dropped +
          r.outbound_collisions_dropped +
          r.inbound_selfloops_dropped +
          r.outbound_selfloops_dropped;
        factsMoved += r.facts_moved;
      }
    }
  }
  return {
    isoStamp,
    mode: f.apply ? "apply" : "dry-run",
    source: f.source,
    minSim: f.minSim,
    minConfidence: f.minConfidence,
    model: CLASSIFIER_MODEL,
    clustersScanned: records.length,
    mergesProposed,
    mergesAccepted,
    mergesCommitted,
    ambiguousGroups,
    distinctGroups,
    aliasPagesRetired,
    linksRepointed,
    linksPruned,
    factsMoved,
    costUsd,
    records,
  };
}

main().catch((e) => {
  releaseLock();
  console.error(`[entity-dedup] fatal: ${e instanceof Error ? e.stack : e}`);
  process.exit(1);
});
