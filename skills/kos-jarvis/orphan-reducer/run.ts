#!/usr/bin/env bun
/**
 * orphan-reducer — classify vector-similar pages against each orphan and
 * add typed inbound references ("related" link_type with relation encoded
 * in context).
 *
 * Goal: chip away at the 1803/1952 orphan pile (v1 wiki flat import) by
 * having Haiku 4.5 classify each orphan's top-K pgvector neighbors as
 * supplements/contrasts/implements/extends/none, then writing the non-
 * none matches as DB links (+ markdown sentinel block on candidate pages
 * that exist on disk).
 *
 * Dry-run is default. See SKILL.md for full flag reference and
 * docs/plan/toasty-dancing-quasar.md for the plan that landed this.
 *
 * Usage:
 *   bun run skills/kos-jarvis/orphan-reducer/run.ts [flags]
 */
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrainDb } from "../_lib/brain-db.ts";
import {
  fetchCandidates,
  loadOrphans,
  type CandidateMatch,
  type OrphanCandidate,
} from "./lib/candidates.ts";
import {
  ClassifierCallStats,
  classifyWithRetry,
  estimateCostUsd,
  type Classification,
  type Relation,
} from "./lib/haiku-classifier.ts";
import {
  writeReport,
  type PerOrphanRecord,
  type RunSummary,
} from "./lib/report.ts";
import {
  applyTuple,
  gitCommitBrain,
  type WriteResult,
  type WriteTuple,
} from "./lib/writer.ts";

// ----- Flag parsing -----

type Flags = {
  dryRun: boolean;
  apply: boolean;
  limit: number;
  perOrphan: number;
  candidates: number;
  minConfidence: number;
  domain: string | null;
  noCommit: boolean;
  iKnow: boolean;
  json: boolean;
  help: boolean;
};

function parseFlags(argv: string[]): Flags {
  const f: Flags = {
    dryRun: true,
    apply: false,
    limit: 100,
    perOrphan: 3,
    candidates: 5,
    minConfidence: 0.7,
    domain: null,
    noCommit: false,
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
        f.dryRun = true;
        f.apply = false;
        break;
      case "--apply":
        f.apply = true;
        f.dryRun = false;
        break;
      case "--no-commit":
        f.noCommit = true;
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
      case "--per-orphan":
        f.perOrphan = Number(argv[++i]);
        break;
      case "--candidates":
        f.candidates = Number(argv[++i]);
        break;
      case "--min-confidence":
        f.minConfidence = Number(argv[++i]);
        break;
      case "--domain":
        f.domain = argv[++i] ?? null;
        break;
      default:
        if (a.startsWith("--")) {
          console.error(`unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  if (!Number.isFinite(f.limit) || f.limit <= 0) f.limit = 100;
  if (!Number.isFinite(f.perOrphan) || f.perOrphan <= 0) f.perOrphan = 3;
  if (!Number.isFinite(f.candidates) || f.candidates <= 0) f.candidates = 5;
  if (!Number.isFinite(f.minConfidence)) f.minConfidence = 0.7;
  return f;
}

const USAGE = `
orphan-reducer — classify vector-similar pages and add typed inbound refs.

Usage:
  bun run skills/kos-jarvis/orphan-reducer/run.ts [flags]

Flags:
  --dry-run              (default) classify + report; no DB or file writes
  --apply                write DB links + candidate-page markdown + git commit
  --limit N              max orphans to process this run       (default 100)
  --per-orphan N         max inbound refs per orphan            (default 3)
  --candidates N         vector candidates per orphan to classify (default 5)
  --min-confidence F     drop classifier outputs below F         (default 0.70)
  --domain D             filter orphans to one domain (companies, concepts, ...)
  --no-commit            --apply without git commit (testing)
  --i-know               required when --limit > 500
  --json                 JSONL progress events to stdout
  --help, -h             this message

Reports:
  ~/brain/.agent/reports/orphan-reducer-<ISO>.md
  ~/brain/.agent/reports/orphan-reducer-<ISO>.md.json   (rollback manifest)
`;

// ----- Lock -----

// Use os.tmpdir() (= $TMPDIR on macOS, /tmp elsewhere) so the path is
// inside Claude Code's sandbox write allowlist. Earlier choice of
// ~/.cache/kos-jarvis/ was outside the allowlist; openSync(..., "wx")
// silently failed with EACCES under sandbox and showed up as a phantom
// "another orphan-reducer run appears active" false positive (run.ts
// catches all openSync errors). Per-user $TMPDIR is stable across
// sessions on macOS (/var/folders/<hash>/T/) so lock semantics work for
// both interactive and launchd-cron invocations.
const LOCK_DIR = join(tmpdir(), "kos-jarvis");
const LOCK_FILE = join(LOCK_DIR, "orphan-reducer.lock");

function acquireLock(): boolean {
  mkdirSync(LOCK_DIR, { recursive: true });
  if (existsSync(LOCK_FILE)) return false;
  try {
    const fd = openSync(LOCK_FILE, "wx");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
  } catch {
    /* ignore */
  }
}

// ----- Event logging -----

function emit(json: boolean, event: string, payload: Record<string, unknown>): void {
  if (json) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }));
  } else {
    const pretty = Object.entries(payload)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    console.error(`[${event}] ${pretty}`);
  }
}

// ----- Filter kept edges -----

function pickKept(
  classifications: Classification[],
  minConfidence: number,
  perOrphan: number
): { kept: Classification[]; reasonDropped: string | null } {
  const usable = classifications
    .filter((c) => c.relation !== "none")
    .filter((c) => c.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, perOrphan);
  if (usable.length === 0) {
    const reason =
      classifications.length === 0
        ? "no classifications returned"
        : classifications.every((c) => c.relation === "none")
          ? "all candidates classified as none"
          : `no candidate met min-confidence ${minConfidence}`;
    return { kept: [], reasonDropped: reason };
  }
  return { kept: usable, reasonDropped: null };
}

// ----- Main -----

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (flags.limit > 500 && !flags.iKnow) {
    console.error(
      `--limit ${flags.limit} exceeds 500. Add --i-know to confirm (larger runs burn Haiku budget).`
    );
    return 2;
  }
  if (flags.apply && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY not set. Export it or run without --apply for dry-run."
    );
    return 2;
  }
  if (flags.dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY not set. Dry-run still needs Haiku to classify."
    );
    return 2;
  }

  const startedAt = new Date();
  const t0 = Date.now();

  if (!acquireLock()) {
    console.error(
      `another orphan-reducer run appears active (lock file ${LOCK_FILE}). Delete manually if stale.`
    );
    return 1;
  }

  const db = new BrainDb();
  const records: PerOrphanRecord[] = [];
  const writes: WriteResult[] = [];
  const stats = new ClassifierCallStats();
  let gitResult: RunSummary["git"] = null;

  // ============================================================
  // Phase A: read + classify (BrainDb open). Buffer results; do not
  // write here — concurrent kos-compat-api on the same PGLite data dir
  // can overwrite our in-memory writes. See writer.ts header.
  // ============================================================
  try {
    await db.open();
    const orphans = await loadOrphans(db, {
      domain: flags.domain ?? undefined,
      limit: flags.limit,
    });
    emit(flags.json, "orphans.loaded", {
      count: orphans.length,
      domain: flags.domain ?? "any",
      limit: flags.limit,
    });

    for (const orphan of orphans) {
      const candidates = await fetchCandidates(db, orphan.slug, flags.candidates);
      if (candidates.length === 0) {
        records.push({
          orphan,
          candidates: [],
          classifications: [],
          kept: [],
          reason_dropped: "no vector-similar candidates",
        });
        emit(flags.json, "orphan.skipped", {
          slug: orphan.slug,
          reason: "no candidates",
        });
        continue;
      }

      const orphanInput = await loadOrphanInput(db, orphan);
      const classifications = await classifyWithRetry(
        orphanInput,
        candidates,
        stats
      );
      const { kept, reasonDropped } = pickKept(
        classifications,
        flags.minConfidence,
        flags.perOrphan
      );

      records.push({
        orphan,
        candidates,
        classifications,
        kept,
        reason_dropped: reasonDropped,
      });

      emit(flags.json, "orphan.classified", {
        slug: orphan.slug,
        candidates: candidates.length,
        emitted: classifications.length,
        kept: kept.length,
        reason: reasonDropped ?? "ok",
      });
    }
  } finally {
    await db.close().catch(() => {});
  }

  // ============================================================
  // Phase B: write (BrainDb closed). Each `gbrain link` subprocess
  // acquires the upstream .gbrain-lock, writes, releases — plays nice
  // with kos-compat-api's concurrent subprocess ingests.
  // ============================================================
  try {
    if (flags.apply) {
      for (const rec of records) {
        for (const k of rec.kept) {
          const tuple: WriteTuple = {
            from: k.candidate_slug,
            to: rec.orphan.slug,
            relation: k.relation as Relation,
            confidence: k.confidence,
            excerpt: k.excerpt,
          };
          const result = applyTuple(tuple);
          writes.push(result);
          emit(flags.json, "edge.written", {
            from: tuple.from,
            to: tuple.to,
            relation: tuple.relation,
            db: result.db_written,
            db_error: result.db_error,
            md: result.markdown_reason,
          });
        }
      }

      if (!flags.noCommit) {
        const n = writes.filter((w) => w.markdown_written).length;
        if (n > 0) {
          const message = `chore(orphan-reducer): add ${n} inbound ref${n === 1 ? "" : "s"} across ${records.length} orphan scan${records.length === 1 ? "" : "s"}`;
          gitResult = gitCommitBrain(message);
          emit(flags.json, "git.commit", {
            committed: gitResult.committed,
            sha: gitResult.sha,
            error: gitResult.error,
          });
        } else {
          gitResult = { committed: false, sha: null, error: null };
          emit(flags.json, "git.commit", {
            committed: false,
            reason: "no markdown changes",
          });
        }
      }
    }
  } finally {
    releaseLock();
  }

  const summary: RunSummary = {
    mode: flags.apply ? "apply" : "dry-run",
    started_at: startedAt.toISOString(),
    duration_ms: Date.now() - t0,
    flags: {
      limit: flags.limit,
      per_orphan: flags.perOrphan,
      candidates: flags.candidates,
      min_confidence: flags.minConfidence,
      domain: flags.domain,
      apply: flags.apply,
      no_commit: flags.noCommit,
    },
    totals: {
      orphans_scanned: records.length,
      classifications_made: records.reduce(
        (n, r) => n + r.classifications.length,
        0
      ),
      edges_kept: records.reduce((n, r) => n + r.kept.length, 0),
      db_written: writes.filter((w) => w.db_written).length,
      markdown_written: writes.filter((w) => w.markdown_written).length,
      skipped_no_file: writes.filter((w) => w.markdown_reason === "no_file")
        .length,
      skipped_existing_mention: writes.filter(
        (w) => w.markdown_reason === "skip_exists"
      ).length,
      haiku_calls: stats.calls,
      haiku_input_tokens: stats.inputTokens,
      haiku_output_tokens: stats.outputTokens,
      haiku_cost_usd: estimateCostUsd(stats),
    },
    git: gitResult,
  };

  const { mdPath, jsonPath } = writeReport(summary, records, writes);
  emit(flags.json, "report.written", { md: mdPath, json: jsonPath });

  if (!flags.json) {
    const t = summary.totals;
    console.error("");
    console.error(`orphan-reducer ${summary.mode} done in ${(summary.duration_ms / 1000).toFixed(1)}s`);
    console.error(`  orphans scanned: ${t.orphans_scanned}`);
    console.error(`  edges kept:      ${t.edges_kept}`);
    if (summary.mode === "apply") {
      console.error(`  db writes:       ${t.db_written}`);
      console.error(`  md writes:       ${t.markdown_written} (skipped no_file: ${t.skipped_no_file})`);
      if (gitResult) {
        console.error(`  git:             ${gitResult.committed ? gitResult.sha : "no commit (no md changes)"}`);
      }
    }
    console.error(`  haiku:           ${t.haiku_calls} calls · $${t.haiku_cost_usd.toFixed(4)}`);
    console.error(`  report:          ${mdPath}`);
  }

  return 0;
}

async function loadOrphanInput(
  db: BrainDb,
  orphan: OrphanCandidate
): Promise<{ slug: string; title: string; compiled_truth: string }> {
  const page = await db.getPage(orphan.slug);
  return {
    slug: orphan.slug,
    title: orphan.title,
    compiled_truth: page?.compiled_truth ?? "",
  };
}

// Mark unused imports as intentionally kept — CandidateMatch shows up in
// per-orphan records through records.push even when candidates is empty.
void ([] as CandidateMatch[]);

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    releaseLock();
    console.error("FATAL:", err);
    process.exit(1);
  });
