/**
 * writer.ts — source-safe DB link inserts by page id (via BrainDb.
 * addLinkByIds), plus markdown-sentinel upsert on candidate files that
 * exist on disk.
 *
 * Why by-id (2026-07-13 fix): the previous design shelled out to
 * `gbrain link <from-slug> <to-slug>`, which resolves both slugs in the
 * DEFAULT source only. On this multi-source brain (default / mailagent-
 * emails / omada / gbrain-docs) ~75% of writes failed with
 * `page "…"(source=default) not found` because the real orphan/candidate
 * lives in a non-default source. We now thread each page's globally-unique
 * id through the pipeline (candidates.ts) and write the edge directly by
 * (from_page_id, to_page_id) — no slug resolution, source-agnostic.
 *
 * Concurrency: production is Postgres (post-Path-3), which allows multiple
 * concurrent clients via MVCC — the old PGLite single-writer-lock dance
 * (close BrainDb before writing) is obsolete, so run.ts keeps one BrainDb
 * handle open across classify + write. See _lib/brain-db.ts header.
 *
 * link_source='orphan-reducer' (set in addLinkByIds) so these programmatic
 * edges are self-identifying and reversible; they are not put_page
 * reconciliation-managed, so they persist.
 *
 * Filesystem-canonical reality: only ~95 pages live as .md files under
 * ~/brain/; the rest are DB-only. For those we fall through to DB-only
 * writes; markdown_written is recorded in the sidecar for a future backfill.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { BrainDb } from "../../_lib/brain-db.ts";
import type { Relation } from "./haiku-classifier.ts";

const BRAIN_ROOT = process.env.KOS_BRAIN_ROOT ?? join(homedir(), "brain");
const SENTINEL_OPEN = "<!-- orphan-reducer-inbound -->";
const SENTINEL_CLOSE = "<!-- /orphan-reducer-inbound -->";

export type WriteTuple = {
  from: string; // candidate slug (source of reference) — for markdown + reporting
  to: string; // orphan slug (target) — for markdown + reporting
  fromId: number; // candidate page id — the source-safe write key
  toId: number; // orphan page id — the source-safe write key
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

/**
 * Write the inbound edge candidate→orphan by page id (source-safe). ON
 * CONFLICT in addLinkByIds makes this idempotent, so a re-run is a no-op
 * rather than an error.
 */
async function dbLink(
  db: BrainDb,
  tuple: WriteTuple
): Promise<{ ok: boolean; error: string | null }> {
  try {
    await db.addLinkByIds(tuple.fromId, tuple.toId, {
      linkType: "related",
      context: linkContext(tuple.relation, tuple.excerpt),
      linkSource: "orphan-reducer",
    });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 500) };
  }
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

export async function applyTuple(
  db: BrainDb,
  tuple: WriteTuple
): Promise<WriteResult> {
  const filePath = candidateFilePath(tuple.from);
  const link = await dbLink(db, tuple);

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
