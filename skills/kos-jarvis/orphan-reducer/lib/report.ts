/**
 * report.ts — markdown summary + JSON rollback sidecar.
 *
 * Output layout: ~/brain/.agent/reports/orphan-reducer-<ISO>.md
 *                ~/brain/.agent/reports/orphan-reducer-<ISO>.md.json
 *
 * The markdown is human-facing (what did we classify, what did we write).
 * The JSON sidecar is the machine-readable rollback manifest — one entry
 * per attempted write, suitable for feeding to `gbrain unlink` + markdown
 * sentinel-block cleanup.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { OrphanCandidate, CandidateMatch } from "./candidates.ts";
import type { Classification } from "./haiku-classifier.ts";
import type { WriteResult } from "./writer.ts";

const BRAIN_ROOT = process.env.KOS_BRAIN_ROOT ?? join(homedir(), "brain");
const REPORTS_DIR = join(BRAIN_ROOT, ".agent", "reports");

export type PerOrphanRecord = {
  orphan: OrphanCandidate;
  candidates: CandidateMatch[];
  classifications: Classification[];
  kept: Classification[]; // after min-confidence + per-orphan cap
  reason_dropped: string | null; // null if we kept something
};

export type RunSummary = {
  mode: "dry-run" | "apply";
  started_at: string;
  duration_ms: number;
  flags: {
    limit: number;
    per_orphan: number;
    candidates: number;
    min_confidence: number;
    domain: string | null;
    apply: boolean;
    no_commit: boolean;
  };
  totals: {
    orphans_scanned: number;
    classifications_made: number;
    edges_kept: number;
    db_written: number;
    markdown_written: number;
    skipped_no_file: number;
    skipped_existing_mention: number;
    haiku_calls: number;
    haiku_input_tokens: number;
    haiku_output_tokens: number;
    haiku_cost_usd: number;
  };
  git: { committed: boolean; sha: string | null; error: string | null } | null;
};

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function isoForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function reportPaths(): { md: string; json: string; iso: string } {
  const iso = isoForFilename();
  ensureDir(REPORTS_DIR);
  return {
    md: join(REPORTS_DIR, `orphan-reducer-${iso}.md`),
    json: join(REPORTS_DIR, `orphan-reducer-${iso}.md.json`),
    iso,
  };
}

function renderMarkdown(
  summary: RunSummary,
  records: PerOrphanRecord[],
  writes: WriteResult[]
): string {
  const lines: string[] = [];
  lines.push(`# Orphan Reducer Report — ${summary.started_at}`);
  lines.push("");
  lines.push(`Mode: **${summary.mode}**`);
  lines.push(`Duration: ${(summary.duration_ms / 1000).toFixed(1)}s`);
  lines.push("");
  lines.push("## Flags");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(summary.flags, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  const t = summary.totals;
  lines.push(`- Orphans scanned: ${t.orphans_scanned}`);
  lines.push(`- Haiku calls: ${t.haiku_calls}  (est cost $${t.haiku_cost_usd.toFixed(4)})`);
  lines.push(
    `- Haiku tokens: ${t.haiku_input_tokens} in / ${t.haiku_output_tokens} out`
  );
  lines.push(`- Classifications emitted: ${t.classifications_made}`);
  lines.push(`- Edges kept (after confidence + per-orphan cap): ${t.edges_kept}`);
  if (summary.mode === "apply") {
    lines.push(`- DB links written: ${t.db_written}`);
    lines.push(`- Markdown files updated: ${t.markdown_written}`);
    lines.push(`- Skipped (no .md on disk): ${t.skipped_no_file}`);
    lines.push(`- Skipped (orphan already mentioned): ${t.skipped_existing_mention}`);
  }
  if (summary.git) {
    lines.push(
      `- Git commit: ${summary.git.committed ? summary.git.sha : "none"}${
        summary.git.error ? ` (error: ${summary.git.error})` : ""
      }`
    );
  }
  lines.push("");
  lines.push("## Per-orphan classification");
  lines.push("");
  for (const rec of records) {
    lines.push(`### ${rec.orphan.slug}`);
    lines.push(`_title_: ${rec.orphan.title}`);
    lines.push(`_domain_: ${rec.orphan.domain}`);
    lines.push("");
    if (rec.candidates.length === 0) {
      lines.push("- no vector-similar candidates (page has no embedding?)");
      lines.push("");
      continue;
    }
    lines.push(`candidates (${rec.candidates.length}):`);
    for (const c of rec.candidates) {
      const cls = rec.classifications.find((x) => x.candidate_slug === c.slug);
      const kept = rec.kept.find((x) => x.candidate_slug === c.slug) ? "✓" : " ";
      const sim = c.similarity.toFixed(3);
      if (cls) {
        lines.push(
          `- [${kept}] \`${c.slug}\` (sim ${sim}) — **${cls.relation}** conf ${cls.confidence.toFixed(2)} — ${cls.excerpt || "_no excerpt_"}`
        );
      } else {
        lines.push(`- [ ] \`${c.slug}\` (sim ${sim}) — no classification returned`);
      }
    }
    if (rec.reason_dropped) {
      lines.push("");
      lines.push(`_dropped_: ${rec.reason_dropped}`);
    }
    lines.push("");
  }

  if (summary.mode === "apply") {
    lines.push("## Write results");
    lines.push("");
    for (const w of writes) {
      const md = w.markdown_written ? "md ✓" : `md ✗ (${w.markdown_reason})`;
      const db = w.db_written ? "db ✓" : `db ✗ (${w.db_error})`;
      lines.push(
        `- \`${w.tuple.from}\` → \`${w.tuple.to}\` (${w.tuple.relation}, conf ${w.tuple.confidence.toFixed(2)}) — ${db} · ${md}`
      );
    }
    lines.push("");
    lines.push("## Rollback");
    lines.push("");
    lines.push("The JSON sidecar next to this report is the rollback manifest.");
    lines.push(
      "For each entry: `gbrain unlink <from> <to>` undoes the DB write; the"
    );
    lines.push(
      "sentinel block in `<markdown_file>` can be reverted via `git -C ~/brain revert <sha>`."
    );
  } else {
    lines.push("## Rollback");
    lines.push("");
    lines.push("Dry-run. No DB or filesystem changes were made.");
  }
  lines.push("");
  return lines.join("\n");
}

export function writeReport(
  summary: RunSummary,
  records: PerOrphanRecord[],
  writes: WriteResult[]
): { mdPath: string; jsonPath: string } {
  const { md, json } = reportPaths();
  const markdown = renderMarkdown(summary, records, writes);
  writeFileSync(md, markdown, "utf8");
  const sidecar = {
    schema_version: "1",
    summary,
    records: records.map((r) => ({
      orphan: r.orphan,
      kept: r.kept,
      reason_dropped: r.reason_dropped,
    })),
    writes,
  };
  writeFileSync(json, JSON.stringify(sidecar, null, 2), "utf8");
  return { mdPath: md, jsonPath: json };
}
