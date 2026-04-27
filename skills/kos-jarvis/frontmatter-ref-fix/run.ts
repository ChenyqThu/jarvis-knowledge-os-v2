#!/usr/bin/env bun
/**
 * frontmatter-ref-fix — normalize `../X/Y.md`-style frontmatter refs to
 * canonical slug form (`X/Y`), verify each target exists on disk, leave
 * unresolved refs untouched and reported.
 *
 * v1-wiki migration legacy. See SKILL.md for context.
 *
 * Usage:
 *   bun run skills/kos-jarvis/frontmatter-ref-fix/run.ts [flags]
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { execSync } from "node:child_process";

// ---------- Flags ----------

type Flags = {
  apply: boolean;
  noCommit: boolean;
  brainDir: string;
  json: boolean;
  help: boolean;
};

function parseFlags(argv: string[]): Flags {
  const f: Flags = {
    apply: false,
    noCommit: false,
    brainDir: process.env.KOS_BRAIN_DIR ?? join(homedir(), "brain"),
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
        f.apply = false;
        break;
      case "--apply":
        f.apply = true;
        break;
      case "--no-commit":
        f.noCommit = true;
        break;
      case "--json":
        f.json = true;
        break;
      case "--brain-dir":
        f.brainDir = argv[++i] ?? f.brainDir;
        break;
      default:
        if (a.startsWith("--")) {
          console.error(`unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  return f;
}

const USAGE = `
frontmatter-ref-fix — normalize '../X/Y.md' frontmatter refs to slug form.

Usage:
  bun run skills/kos-jarvis/frontmatter-ref-fix/run.ts [flags]

Flags:
  --dry-run              (default) report-only, no writes
  --apply                rewrite resolved refs + git commit
  --no-commit            apply without git commit (testing)
  --brain-dir DIR        override ~/brain location
  --json                 JSONL events to stdout
  --help, -h             this message

Reports:
  <brain-dir>/.agent/reports/frontmatter-ref-fix-<ISO>.md
`;

// ---------- Filesystem walk ----------

function walkMarkdown(dir: string, brainDir: string): string[] {
  const out: string[] = [];
  function walk(d: string): void {
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === ".agent" || name === ".git" || name.startsWith(".")) continue;
      const full = join(d, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        walk(full);
      } else if (s.isFile() && name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  walk(dir);
  return out;
}

function pathToSlug(absPath: string, brainDir: string): string {
  const rel = relative(brainDir, absPath);
  // Normalize Windows-style sep just in case (no-op on macOS).
  const norm = rel.split(sep).join("/");
  return norm.replace(/\.md$/, "");
}

// ---------- Frontmatter splitting ----------

/**
 * Returns [frontmatterBlock, body] split. frontmatterBlock includes the
 * leading and trailing `---` lines so it round-trips byte-exact when
 * concatenated back.
 *
 * If the file does not start with `---\n`, returns [null, content].
 */
function splitFrontmatter(content: string): [string | null, string] {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return [null, content];
  }
  // Find the closing `---` on its own line.
  const lines = content.split("\n");
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---" || lines[i] === "---\r") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return [null, content];
  const fmLines = lines.slice(0, endIdx + 1);
  const bodyLines = lines.slice(endIdx + 1);
  return [fmLines.join("\n") + "\n", bodyLines.join("\n")];
}

// ---------- Ref rewriting ----------

type RewriteHit = {
  file: string;
  line: number;
  before: string;
  candidateSlug: string;
  resolved: boolean;
  field: string | null; // last seen frontmatter key, when detectable
};

/**
 * Match a frontmatter line that ends in `.md`, optionally with `../`
 * prefixes, optionally wrapped in single or double quotes, optionally a
 * yaml list dash.
 *
 * Excluded: lines containing `://` (URLs) — the only legitimate way a
 * `.md`-ending value should appear in frontmatter is as an inter-page
 * ref, not a URL.
 */
const REF_LINE_REGEX =
  /^(\s*(?:-\s+|[A-Za-z_][A-Za-z0-9_-]*:\s*))(['"]?)((?:\.\.\/)+)?([A-Za-z0-9][A-Za-z0-9_./-]*?)\.md\2\s*$/;

const KEY_LINE_REGEX = /^([A-Za-z_][A-Za-z0-9_-]*):\s*$/;
const KEY_INLINE_REGEX = /^([A-Za-z_][A-Za-z0-9_-]*):\s+/;

function rewriteFrontmatter(
  fm: string,
  slugs: Set<string>,
  filePath: string
): { newFm: string; hits: RewriteHit[] } {
  const hits: RewriteHit[] = [];
  const lines = fm.split("\n");
  let lastKey: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track the most recent yaml key for context.
    const keyOnly = line.match(KEY_LINE_REGEX);
    if (keyOnly) {
      lastKey = keyOnly[1];
    } else {
      const inline = line.match(KEY_INLINE_REGEX);
      if (inline) lastKey = inline[1];
    }

    // Skip URLs.
    if (line.includes("://")) continue;

    const m = line.match(REF_LINE_REGEX);
    if (!m) continue;

    const [, prefix, quote, , slugBody] = m;
    const candidateSlug = slugBody;
    const resolved = slugs.has(candidateSlug);

    hits.push({
      file: filePath,
      line: i + 1,
      before: line,
      candidateSlug,
      resolved,
      field: lastKey,
    });

    if (resolved) {
      // Preserve original prefix (list dash + indent or `key: `) and
      // quote style.
      lines[i] = `${prefix}${quote}${candidateSlug}${quote}`;
    }
    // Unresolved: leave line untouched.
  }

  return { newFm: lines.join("\n"), hits };
}

// ---------- Reporting ----------

type Summary = {
  startedAt: string;
  durationMs: number;
  mode: "dry-run" | "apply";
  brainDir: string;
  totals: {
    files_scanned: number;
    files_with_frontmatter: number;
    files_rewritten: number;
    refs_found: number;
    refs_rewritten: number;
    refs_unresolved: number;
  };
  git: { committed: boolean; sha: string | null; error: string | null } | null;
};

function buildReport(summary: Summary, hits: RewriteHit[]): string {
  const resolved = hits.filter((h) => h.resolved);
  const unresolved = hits.filter((h) => !h.resolved);

  // Group unresolved by candidate slug (so we see "10x ../entities/jarvis.md" type patterns).
  const unresolvedBySlug = new Map<string, RewriteHit[]>();
  for (const h of unresolved) {
    const arr = unresolvedBySlug.get(h.candidateSlug) ?? [];
    arr.push(h);
    unresolvedBySlug.set(h.candidateSlug, arr);
  }

  const lines: string[] = [];
  lines.push(`# Frontmatter Ref Fix — ${summary.startedAt}`);
  lines.push("");
  lines.push(`**Mode**: ${summary.mode}`);
  lines.push(`**Brain dir**: ${summary.brainDir}`);
  lines.push(`**Duration**: ${(summary.durationMs / 1000).toFixed(2)}s`);
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  lines.push(`- Files scanned: ${summary.totals.files_scanned}`);
  lines.push(`- Files with frontmatter: ${summary.totals.files_with_frontmatter}`);
  lines.push(`- Files rewritten: ${summary.totals.files_rewritten}`);
  lines.push(`- Refs found: ${summary.totals.refs_found}`);
  lines.push(`- Refs rewritten (resolved): ${summary.totals.refs_rewritten}`);
  lines.push(`- Refs unresolved (left alone): ${summary.totals.refs_unresolved}`);
  if (summary.git) {
    lines.push(
      `- Git: ${summary.git.committed ? `committed ${summary.git.sha}` : `not committed${summary.git.error ? ` (${summary.git.error})` : ""}`}`
    );
  }
  lines.push("");

  lines.push("## Unresolved targets (grouped)");
  lines.push("");
  if (unresolvedBySlug.size === 0) {
    lines.push("_None — every ref resolved to an on-disk page._");
  } else {
    const keys = [...unresolvedBySlug.keys()].sort();
    for (const slug of keys) {
      const arr = unresolvedBySlug.get(slug)!;
      lines.push(`### \`${slug}\` (${arr.length}×)`);
      lines.push("");
      for (const h of arr) {
        lines.push(
          `- ${h.file.replace(summary.brainDir + "/", "")}:${h.line}${h.field ? ` (key: \`${h.field}\`)` : ""}`
        );
        lines.push(`  - before: \`${h.before.trim()}\``);
      }
      lines.push("");
    }
  }

  lines.push("## Resolved rewrites");
  lines.push("");
  if (resolved.length === 0) {
    lines.push("_None — no refs needed normalization._");
  } else {
    lines.push(`${resolved.length} refs rewritten across ${
      new Set(resolved.map((h) => h.file)).size
    } files.`);
    lines.push("");
    lines.push("Sample (first 30):");
    lines.push("");
    for (const h of resolved.slice(0, 30)) {
      lines.push(
        `- ${h.file.replace(summary.brainDir + "/", "")}:${h.line} → \`${h.candidateSlug}\``
      );
    }
    if (resolved.length > 30) lines.push(`- ... +${resolved.length - 30} more`);
  }
  lines.push("");

  return lines.join("\n");
}

function writeReport(summary: Summary, hits: RewriteHit[]): string {
  const reportsDir = join(summary.brainDir, ".agent", "reports");
  mkdirSync(reportsDir, { recursive: true });
  const iso = summary.startedAt.replace(/[:.]/g, "-");
  const mdPath = join(reportsDir, `frontmatter-ref-fix-${iso}.md`);
  const md = buildReport(summary, hits);
  writeFileSync(mdPath, md, "utf8");
  return mdPath;
}

// ---------- Git commit ----------

function gitCommitBrain(
  brainDir: string,
  message: string
): { committed: boolean; sha: string | null; error: string | null } {
  try {
    execSync(`git -C "${brainDir}" add -A`, { stdio: "pipe" });
    const status = execSync(`git -C "${brainDir}" status --porcelain`, {
      stdio: "pipe",
    })
      .toString()
      .trim();
    if (status === "") {
      return { committed: false, sha: null, error: null };
    }
    execSync(`git -C "${brainDir}" commit -m "${message.replace(/"/g, '\\"')}"`, {
      stdio: "pipe",
    });
    const sha = execSync(`git -C "${brainDir}" rev-parse HEAD`, { stdio: "pipe" })
      .toString()
      .trim();
    return { committed: true, sha, error: null };
  } catch (e) {
    return {
      committed: false,
      sha: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------- Event logging ----------

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

// ---------- Main ----------

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  if (!existsSync(flags.brainDir)) {
    console.error(`brain dir does not exist: ${flags.brainDir}`);
    return 2;
  }

  const startedAt = new Date();
  const t0 = Date.now();

  const allFiles = walkMarkdown(flags.brainDir, flags.brainDir);
  const slugs = new Set<string>(
    allFiles.map((f) => pathToSlug(f, flags.brainDir))
  );

  emit(flags.json, "scan.start", {
    brain_dir: flags.brainDir,
    files: allFiles.length,
    slugs: slugs.size,
  });

  const allHits: RewriteHit[] = [];
  let filesWithFm = 0;
  const filesToWrite = new Map<string, string>();

  for (const file of allFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const [fm, body] = splitFrontmatter(content);
    if (fm === null) continue;
    filesWithFm += 1;

    const { newFm, hits } = rewriteFrontmatter(fm, slugs, file);
    if (hits.length === 0) continue;
    allHits.push(...hits);

    if (newFm !== fm) {
      filesToWrite.set(file, newFm + body);
    }
  }

  emit(flags.json, "scan.complete", {
    refs_found: allHits.length,
    refs_to_rewrite: allHits.filter((h) => h.resolved).length,
    refs_unresolved: allHits.filter((h) => !h.resolved).length,
    files_to_rewrite: filesToWrite.size,
  });

  let gitResult: Summary["git"] = null;

  if (flags.apply) {
    for (const [file, content] of filesToWrite) {
      writeFileSync(file, content, "utf8");
    }
    if (!flags.noCommit && filesToWrite.size > 0) {
      const message = `chore(frontmatter-ref-fix): normalize ${
        allHits.filter((h) => h.resolved).length
      } refs across ${filesToWrite.size} files`;
      gitResult = gitCommitBrain(flags.brainDir, message);
      emit(flags.json, "git.commit", {
        committed: gitResult.committed,
        sha: gitResult.sha,
        error: gitResult.error,
      });
    }
  }

  const summary: Summary = {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - t0,
    mode: flags.apply ? "apply" : "dry-run",
    brainDir: flags.brainDir,
    totals: {
      files_scanned: allFiles.length,
      files_with_frontmatter: filesWithFm,
      files_rewritten: filesToWrite.size,
      refs_found: allHits.length,
      refs_rewritten: allHits.filter((h) => h.resolved).length,
      refs_unresolved: allHits.filter((h) => !h.resolved).length,
    },
    git: gitResult,
  };

  const mdPath = writeReport(summary, allHits);
  emit(flags.json, "report.written", { path: mdPath });

  if (!flags.json) {
    console.error("");
    console.error(
      `frontmatter-ref-fix ${summary.mode} done in ${(summary.durationMs / 1000).toFixed(2)}s`
    );
    console.error(`  files scanned:   ${summary.totals.files_scanned}`);
    console.error(`  refs found:      ${summary.totals.refs_found}`);
    console.error(`  refs rewritten:  ${summary.totals.refs_rewritten}`);
    console.error(`  refs unresolved: ${summary.totals.refs_unresolved}`);
    if (summary.mode === "apply") {
      console.error(`  files written:   ${summary.totals.files_rewritten}`);
      if (gitResult) {
        console.error(
          `  git:             ${gitResult.committed ? gitResult.sha : `no commit${gitResult.error ? ` (${gitResult.error})` : ""}`}`
        );
      }
    }
    console.error(`  report:          ${mdPath}`);
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
