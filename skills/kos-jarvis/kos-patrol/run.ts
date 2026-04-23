#!/usr/bin/env bun
/**
 * kos-patrol/run.ts — daily brain health check.
 *
 * Implements the six-phase protocol in ./SKILL.md:
 *   1. Inventory (counts by kind / confidence / status)
 *   2. Lint (delegate to kos-lint/run.ts)
 *   3. Staleness (decision/protocol/project updated >180d, status=active)
 *   4. Gap detection (entity mentions ≥3 across pages, no page exists)
 *   5. Dashboard → ~/brain/.agent/dashboards/knowledge-health-<date>.md
 *   6. Digest → ~/brain/.agent/digests/patrol-<date>.md
 *
 * Exit: 0 clean | 1 ERROR from lint | 2 WARN-only
 *
 * This is the P0 TODO from skills/kos-jarvis/TODO.md. It's a read-only
 * patrol — it does NOT write to the brain. Only report files under
 * ~/brain/.agent/ are created.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const BRAIN = process.env.GBRAIN_HOME ?? join(homedir(), "brain");
const DASH_DIR = join(BRAIN, ".agent", "dashboards");
const DIGEST_DIR = join(BRAIN, ".agent", "digests");
const REPO_ROOT = join(import.meta.dirname ?? ".", "..", "..", "..");
const KOS_LINT = join(REPO_ROOT, "skills/kos-jarvis/kos-lint/run.ts");

const TODAY = new Date().toISOString().slice(0, 10);
const STALE_DAYS = 180;

type ListRow = { slug: string; type: string; updated: string; title: string };

type Page = {
  slug: string;
  listed_type: string;
  kind?: string;
  title?: string;
  status?: string;
  confidence?: string;
  updated?: string;
  review_after?: string;
  body: string;
};

type Severity = "ERROR" | "WARN";
type Finding = { check: number; severity: Severity; slug?: string; message: string };
type LintSummary = { rows: number; findings: Finding[]; errors: number; warns: number };

// ─────────────────────────── helpers ───────────────────────────

function gbrain(args: string[], opts: { allowFail?: boolean } = {}): string {
  const r = spawnSync("gbrain", args, { encoding: "utf-8" });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`gbrain ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r.stdout;
}

function listAll(): ListRow[] {
  const out = gbrain(["list", "--limit", "10000"]);
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      return {
        slug: parts[0],
        type: parts[1] ?? "",
        updated: parts[2] ?? "",
        title: parts.slice(3).join("\t") ?? "",
      };
    });
}

function parseFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^([a-z_]+):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return fm;
}

function loadPage(row: ListRow): Page {
  const body = gbrain(["get", row.slug], { allowFail: true });
  const fm = parseFrontmatter(body);
  return {
    slug: row.slug,
    listed_type: row.type,
    kind: fm.kind,
    title: fm.title,
    status: fm.status,
    confidence: fm.confidence,
    updated: fm.updated,
    review_after: fm.review_after,
    body,
  };
}

function daysAgo(dateStr: string | undefined): number | undefined {
  if (!dateStr) return undefined;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return undefined;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function writeFileMk(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

// ─────────────────────────── Phase 1: Inventory ───────────────────────────

type Inventory = {
  total: number;
  byKind: Record<string, number>;
  byConfidence: Record<string, number>;
  byStatus: Record<string, number>;
};

function phase1(pages: Page[]): Inventory {
  const inv: Inventory = {
    total: pages.length,
    byKind: {},
    byConfidence: {},
    byStatus: {},
  };
  for (const p of pages) {
    const k = p.kind ?? p.listed_type ?? "unknown";
    inv.byKind[k] = (inv.byKind[k] ?? 0) + 1;
    const c = p.confidence ?? "unspecified";
    inv.byConfidence[c] = (inv.byConfidence[c] ?? 0) + 1;
    const s = p.status ?? "unspecified";
    inv.byStatus[s] = (inv.byStatus[s] ?? 0) + 1;
  }
  return inv;
}

// ─────────────────────────── Phase 2: Lint ───────────────────────────

function phase2(): LintSummary {
  const r = spawnSync("bun", ["run", KOS_LINT, "--json"], { encoding: "utf-8" });
  // kos-lint prints progress on stdout before the JSON block; the top-level
  // "{" is the first one at column 0 (nested braces are indented)
  const out = r.stdout || "";
  const start = out.indexOf("\n{\n");
  try {
    const slice = start >= 0 ? out.slice(start + 1) : out;
    const parsed = JSON.parse(slice);
    return {
      rows: parsed.rows ?? 0,
      findings: parsed.findings ?? [],
      errors: parsed.errors ?? 0,
      warns: parsed.warns ?? 0,
    };
  } catch (e) {
    console.error(`[2] kos-lint JSON parse failed; exit=${r.status}`);
    return { rows: 0, findings: [], errors: 0, warns: 0 };
  }
}

// ─────────────────────────── Phase 3: Staleness ───────────────────────────

type StaleHit = { slug: string; kind: string; days: number; reason: string };

const STALE_KINDS = new Set(["decision", "protocol", "project"]);

function phase3(pages: Page[]): StaleHit[] {
  const hits: StaleHit[] = [];
  for (const p of pages) {
    const kind = p.kind ?? p.listed_type;
    if (!kind || !STALE_KINDS.has(kind)) continue;
    if (p.status !== "active") continue;
    const ago = daysAgo(p.updated);
    if (ago !== undefined && ago > STALE_DAYS) {
      hits.push({ slug: p.slug, kind, days: ago, reason: `updated ${ago}d ago` });
    }
    if (p.review_after) {
      const overdue = daysAgo(p.review_after);
      if (overdue !== undefined && overdue > 0) {
        hits.push({
          slug: p.slug,
          kind,
          days: overdue,
          reason: `review_after overdue by ${overdue}d`,
        });
      }
    }
  }
  return hits;
}

// ─────────────────────────── Phase 4: Gaps ───────────────────────────

type Gap = { entity: string; mentions: number; sample_pages: string[] };

const GAP_THRESHOLD = 3;

/**
 * Coarse gap detection: find "ProperName LikeThis" tokens that appear
 * ≥ 3 times across pages but don't match any existing slug/title.
 * Intentionally approximate — the enrich-sweep skill does the real
 * work. This is a cheap signal for the dashboard.
 */
function phase4(pages: Page[]): Gap[] {
  const counts = new Map<string, { count: number; pages: Set<string> }>();
  const re = /\b([A-Z][a-zA-Z]{2,}(?:\s[A-Z][a-zA-Z]{2,}){1,3})\b/g;
  for (const p of pages) {
    // skip frontmatter
    const body = p.body.replace(/^---\n[\s\S]*?\n---/, "");
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const name = m[1].trim();
      if (seen.has(name)) continue;
      seen.add(name);
      const slot = counts.get(name) ?? { count: 0, pages: new Set() };
      slot.count++;
      slot.pages.add(p.slug);
      counts.set(name, slot);
    }
  }

  const knownTitles = new Set<string>();
  const knownSlugTails = new Set<string>();
  for (const p of pages) {
    if (p.title) knownTitles.add(p.title.toLowerCase());
    const tail = p.slug.split("/").pop()?.replace(/-/g, " ").toLowerCase();
    if (tail) knownSlugTails.add(tail);
  }

  const gaps: Gap[] = [];
  for (const [name, { count, pages: ps }] of counts) {
    if (count < GAP_THRESHOLD) continue;
    const lower = name.toLowerCase();
    if (knownTitles.has(lower) || knownSlugTails.has(lower)) continue;
    gaps.push({ entity: name, mentions: count, sample_pages: [...ps].slice(0, 3) });
  }
  gaps.sort((a, b) => b.mentions - a.mentions);
  return gaps.slice(0, 20); // cap for dashboard readability
}

// ─────────────────────────── Phase 5: Dashboard ───────────────────────────

function renderDashboard(
  inv: Inventory,
  lint: LintSummary,
  stale: StaleHit[],
  gaps: Gap[],
): string {
  const kinds = Object.entries(inv.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");
  const confs = Object.entries(inv.byConfidence)
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");
  const statuses = Object.entries(inv.byStatus)
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");

  const lines = [
    `# Knowledge Health — ${TODAY}`,
    "",
    "## Inventory",
    `- Total pages: ${inv.total}`,
    `- By kind: ${kinds}`,
    `- Confidence: ${confs}`,
    `- Status: ${statuses}`,
    "",
    "## Lint",
    `- ${lint.errors} ERROR, ${lint.warns} WARN across ${lint.rows} pages`,
    ...(lint.findings.length > 0 && lint.findings.length <= 30
      ? ["", ...lint.findings.slice(0, 30).map((f) => `  - [${f.check}] ${f.severity} ${f.slug ?? "-"}: ${f.message}`)]
      : []),
    ...(lint.findings.length > 30
      ? ["", `  (${lint.findings.length} findings; top 15 below)`, ...lint.findings.slice(0, 15).map((f) => `  - [${f.check}] ${f.severity} ${f.slug ?? "-"}: ${f.message}`)]
      : []),
    "",
    "## Staleness",
    `- ${stale.length} pages flagged (kind ∈ {decision, protocol, project}, status=active)`,
    ...stale.slice(0, 20).map((s) => `  - [${s.kind}] ${s.slug} — ${s.reason}`),
    ...(stale.length > 20 ? [`  … and ${stale.length - 20} more`] : []),
    "",
    "## Gaps",
    `- ${gaps.length} frequently-mentioned entities without pages (threshold ${GAP_THRESHOLD}+ mentions)`,
    ...gaps.map((g) => `  - "${g.entity}" — ${g.mentions} mentions, samples: ${g.sample_pages.join(", ")}`),
    "",
    "## Next actions",
    ...(lint.errors > 0 ? ["- Fix kos-lint ERROR findings before next ingest"] : []),
    ...(stale.length > 0 ? [`- Triage ${stale.length} stale decision/protocol/project pages`] : []),
    ...(gaps.length > 0 ? [`- Run \`bun run skills/kos-jarvis/enrich-sweep/run.ts --plan\` to convert ${gaps.length} gaps into stubs`] : []),
    ...(lint.errors === 0 && stale.length === 0 && gaps.length === 0 ? ["- All green. No action."] : []),
  ];
  return lines.join("\n") + "\n";
}

// ─────────────────────────── Phase 6: Digest ───────────────────────────

function renderDigest(inv: Inventory, lint: LintSummary, stale: StaleHit[], gaps: Gap[]): string {
  return (
    `[knowledge-os] ${TODAY} patrol: ${inv.total}p / ${lint.errors}E ${lint.warns}W / ` +
    `stale=${stale.length} / gaps=${gaps.length}.\n` +
    `  Kinds: ${Object.entries(inv.byKind)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, n]) => `${k}=${n}`)
      .join(", ")}.\n` +
    (gaps.length > 0
      ? `  Top gaps: ${gaps.slice(0, 3).map((g) => `${g.entity}(${g.mentions})`).join(", ")}.\n`
      : `  No entity gaps ≥ ${GAP_THRESHOLD}.\n`)
  );
}

// ─────────────────────────── main ───────────────────────────

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry");

  console.log(`=== kos-patrol @ ${TODAY} ===`);

  console.log("[1] Inventory …");
  const rows = listAll();
  const pages = rows.map(loadPage);
  const inv = phase1(pages);
  console.log(
    `    ${inv.total} pages; kinds: ${Object.entries(inv.byKind).map(([k, n]) => `${k}=${n}`).join(", ")}`,
  );

  console.log("[2] Lint …");
  const lint = phase2();
  console.log(`    ${lint.errors} ERROR, ${lint.warns} WARN`);

  console.log("[3] Staleness …");
  const stale = phase3(pages);
  console.log(`    ${stale.length} flagged`);

  console.log("[4] Gap detection …");
  const gaps = phase4(pages);
  console.log(`    ${gaps.length} entity gaps`);

  const dashboard = renderDashboard(inv, lint, stale, gaps);
  const digest = renderDigest(inv, lint, stale, gaps);

  const dashPath = join(DASH_DIR, `knowledge-health-${TODAY}.md`);
  const digestPath = join(DIGEST_DIR, `patrol-${TODAY}.md`);

  if (dryRun) {
    console.log("\n[5/6] --dry: would write:");
    console.log(`       ${dashPath}`);
    console.log(`       ${digestPath}`);
    console.log("\n--- dashboard preview ---");
    console.log(dashboard);
    console.log("--- digest preview ---");
    console.log(digest);
  } else {
    writeFileMk(dashPath, dashboard);
    writeFileMk(digestPath, digest);
    console.log(`[5] Dashboard → ${dashPath}`);
    console.log(`[6] Digest    → ${digestPath}`);
  }

  const code = lint.errors > 0 ? 1 : lint.warns > 0 ? 2 : 0;
  console.log(`\nExit: ${code}`);
  process.exit(code);
}

main();
