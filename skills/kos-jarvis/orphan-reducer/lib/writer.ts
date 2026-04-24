/**
 * writer.ts — DB link inserts via `gbrain link` subprocess (so the
 * upstream PGLite lock owns the write), plus markdown-sentinel upsert
 * on candidate files that exist on disk.
 *
 * Concurrency model (confirmed 2026-04-23):
 * - `kos-compat-api` runs a long-lived bun process that opens a BrainDb
 *   handle on the same PGLite data dir. It does NOT hold the upstream
 *   `.gbrain-lock` continuously — it shells out to `gbrain ...` for each
 *   ingest and those subprocesses acquire the lock briefly.
 * - If this process keeps its own BrainDb handle open alongside, any
 *   write we attempt (via spawnSync OR in-process INSERT) races with
 *   kos-compat-api's in-memory snapshot flush — writes silently get
 *   overwritten on disk, OR land with kos-compat-api's `link_source`
 *   defaults instead of ours.
 *
 * The safe pattern: close OUR BrainDb before calling `gbrain link`,
 * acquire the upstream lock via subprocess, release, reopen if needed.
 * run.ts enforces this by running classification in Phase A (BrainDb
 * open) and writes in Phase B (BrainDb closed).
 *
 * link_source defaults to 'markdown' via upstream `gbrain link` — we
 * don't set it. Reconciliation by put_page on the FROM page can prune
 * these; since most candidates are v1-wiki imports that never get
 * re-put, that's a non-issue in practice. See plan
 * toasty-dancing-quasar.md for the full rationale.
 *
 * Filesystem-canonical reality: only ~95 pages live as .md files under
 * ~/brain/; the other 1800+ are PGLite-only v1-wiki imports. For those,
 * we fall through to DB-only writes (per user decision). markdown_written
 * is recorded in the sidecar so a future backfill can reach them.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Relation } from "./haiku-classifier.ts";

const BRAIN_ROOT = process.env.KOS_BRAIN_ROOT ?? join(homedir(), "brain");
const SENTINEL_OPEN = "<!-- orphan-reducer-inbound -->";
const SENTINEL_CLOSE = "<!-- /orphan-reducer-inbound -->";

export type WriteTuple = {
  from: string; // candidate slug (source of reference)
  to: string; // orphan slug (target)
  relation: Relation;
  confidence: number;
  excerpt: string;
};

export type WriteResult = {
  tuple: WriteTuple;
  db_written: boolean;
  db_error: string | null;
  markdown_file: string | null;
  markdown_written: boolean;
  markdown_reason: string; // "skip_exists" | "no_file" | "written" | "error:<msg>"
};

function candidateFilePath(slug: string): string {
  return join(BRAIN_ROOT, `${slug}.md`);
}

function linkContext(relation: Relation, excerpt: string): string {
  const trimmedExcerpt = excerpt.replace(/\s+/g, " ").trim();
  const prefix = `${relation}`;
  if (!trimmedExcerpt) return prefix;
  return `${prefix}: ${trimmedExcerpt}`;
}

const GBRAIN_LINK_TIMEOUT_MS = 60_000;

function dbLink(tuple: WriteTuple): { ok: boolean; error: string | null } {
  const args = [
    "link",
    tuple.from,
    tuple.to,
    "--link-type",
    "related",
    "--context",
    linkContext(tuple.relation, tuple.excerpt),
  ];
  const result = spawnSync("gbrain", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GBRAIN_LINK_TIMEOUT_MS,
  });
  if (result.error) {
    // node attaches signal='SIGTERM' when `timeout:` fires.
    const signal = (result as unknown as { signal?: string }).signal ?? "";
    const prefix = signal ? `${signal}: ` : "";
    return { ok: false, error: `${prefix}${String(result.error)}`.slice(0, 500) };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").toString().trim();
    const stdout = (result.stdout ?? "").toString().trim();
    const tail = stderr || stdout || `exit ${result.status}`;
    if (/UNIQUE|already exists|duplicate/i.test(tail)) {
      return { ok: true, error: null };
    }
    return { ok: false, error: tail.slice(0, 500) };
  }
  // upstream `gbrain link` returns {"status":"ok"} on stdout; treat any
  // non-"ok"-shaped response as success only if exit was 0.
  return { ok: true, error: null };
}

const ISO_DATE = () => new Date().toISOString().slice(0, 10);

function renderLine(tuple: WriteTuple): string {
  return `- [[${tuple.to}]] — ${tuple.relation} · ${ISO_DATE()}`;
}

/**
 * Upsert the sentinel block on the candidate page body. Idempotent:
 * - If `[[orphan]]` already appears anywhere in the file → skip.
 * - If sentinel block exists and doesn't mention this orphan → insert line.
 * - If no sentinel → append a fresh block at EOF.
 *
 * Returns { written, reason }. Reason values are stable for the sidecar.
 */
function upsertMarkdown(
  filePath: string,
  tuple: WriteTuple
): { written: boolean; reason: string } {
  if (!existsSync(filePath)) return { written: false, reason: "no_file" };

  const body = readFileSync(filePath, "utf8");
  // Cheap existence check: any mention of the orphan as wikilink means
  // we've already referenced it — no-op.
  const needle = `[[${tuple.to}]]`;
  if (body.includes(needle)) return { written: false, reason: "skip_exists" };

  const openIdx = body.indexOf(SENTINEL_OPEN);
  const closeIdx = body.indexOf(SENTINEL_CLOSE);
  const newLine = renderLine(tuple);

  let updated: string;
  if (openIdx >= 0 && closeIdx > openIdx) {
    // Insert into existing block, before the closing sentinel.
    const before = body.slice(0, closeIdx);
    const after = body.slice(closeIdx);
    const trimmedBefore = before.replace(/\s+$/, "") + "\n";
    updated = `${trimmedBefore}${newLine}\n${after}`;
  } else {
    // Append fresh block at EOF, preceded by exactly one blank line.
    const trimmed = body.replace(/\s+$/, "");
    const block = [
      SENTINEL_OPEN,
      "## Related (auto)",
      newLine,
      SENTINEL_CLOSE,
      "",
    ].join("\n");
    updated = `${trimmed}\n\n${block}`;
  }

  try {
    writeFileSync(filePath, updated, "utf8");
    return { written: true, reason: "written" };
  } catch (e) {
    return { written: false, reason: `error:${String(e).slice(0, 160)}` };
  }
}

export function applyTuple(tuple: WriteTuple): WriteResult {
  const filePath = candidateFilePath(tuple.from);
  const link = dbLink(tuple);

  const result: WriteResult = {
    tuple,
    db_written: link.ok,
    db_error: link.error,
    markdown_file: null,
    markdown_written: false,
    markdown_reason: "skipped_due_to_db_error",
  };

  if (!link.ok) return result;

  const md = upsertMarkdown(filePath, tuple);
  result.markdown_file = filePath;
  result.markdown_written = md.written;
  result.markdown_reason = md.reason;
  return result;
}

/** Stage + commit ~/brain edits if there's anything staged. No-op otherwise. */
export function gitCommitBrain(message: string): {
  committed: boolean;
  sha: string | null;
  error: string | null;
} {
  try {
    execFileSync("git", ["-C", BRAIN_ROOT, "add", "-A"], { stdio: "ignore" });
    const status = execFileSync(
      "git",
      ["-C", BRAIN_ROOT, "status", "--porcelain"],
      { encoding: "utf8" }
    );
    if (!status.trim()) {
      return { committed: false, sha: null, error: null };
    }
    execFileSync("git", ["-C", BRAIN_ROOT, "commit", "-m", message], {
      stdio: "ignore",
    });
    const sha = execFileSync(
      "git",
      ["-C", BRAIN_ROOT, "rev-parse", "HEAD"],
      { encoding: "utf8" }
    ).trim();
    return { committed: true, sha, error: null };
  } catch (e) {
    return {
      committed: false,
      sha: null,
      error: String(e).slice(0, 500),
    };
  }
}
