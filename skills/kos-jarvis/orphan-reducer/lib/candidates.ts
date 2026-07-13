/**
 * candidates.ts — orphan discovery + vector-similar candidate fetching.
 *
 * Mirrors the `gbrain orphans` shouldExclude rules (src/commands/orphans.ts)
 * so we don't try to "fix" pseudo-pages or auto-generated roots. Copies the
 * filter constants verbatim rather than importing from src/ to keep the
 * fork boundary clean (per CLAUDE.md — don't reach into src/*).
 */
import type { BrainDb } from "../../_lib/brain-db.ts";

export type OrphanCandidate = {
  id: number;
  slug: string;
  title: string;
  domain: string;
};

export type CandidateMatch = {
  id: number;
  slug: string;
  title: string;
  compiled_truth: string;
  distance: number;
  similarity: number;
};

const AUTO_SUFFIX_PATTERNS = ["/_index", "/log"];
const PSEUDO_SLUGS = new Set([
  "_atlas",
  "_index",
  "_stats",
  "_orphans",
  "_scratch",
  "claude",
]);
const RAW_SEGMENT = "/raw/";
const DENY_PREFIXES = [
  "output/",
  "dashboards/",
  "scripts/",
  "templates/",
  "openclaw/config/",
];
const FIRST_SEGMENT_EXCLUSIONS = new Set([
  "scratch",
  "thoughts",
  "catalog",
  "entities",
]);

/** Filter rule from src/commands/orphans.ts:shouldExclude. */
export function shouldExclude(slug: string): boolean {
  if (PSEUDO_SLUGS.has(slug)) return true;
  for (const suffix of AUTO_SUFFIX_PATTERNS) {
    if (slug.endsWith(suffix)) return true;
  }
  if (slug.includes(RAW_SEGMENT)) return true;
  for (const prefix of DENY_PREFIXES) {
    if (slug.startsWith(prefix)) return true;
  }
  const firstSegment = slug.split("/")[0];
  if (FIRST_SEGMENT_EXCLUSIONS.has(firstSegment)) return true;
  return false;
}

export function deriveDomain(
  frontmatterDomain: string | null | undefined,
  slug: string
): string {
  if (
    frontmatterDomain &&
    typeof frontmatterDomain === "string" &&
    frontmatterDomain.trim()
  ) {
    return frontmatterDomain.trim();
  }
  return slug.split("/")[0] || "root";
}

export async function loadOrphans(
  db: BrainDb,
  opts: { domain?: string; limit?: number } = {}
): Promise<OrphanCandidate[]> {
  const raw = await db.listOrphans();
  const filtered: OrphanCandidate[] = [];
  for (const r of raw) {
    if (shouldExclude(r.slug)) continue;
    const domain = deriveDomain(r.domain, r.slug);
    if (opts.domain && domain !== opts.domain) continue;
    filtered.push({ id: r.id, slug: r.slug, title: r.title, domain });
    if (opts.limit && filtered.length >= opts.limit) break;
  }
  return filtered;
}

export async function fetchCandidates(
  db: BrainDb,
  orphanId: number,
  k: number
): Promise<CandidateMatch[]> {
  // Anchor on the orphan's page id (source-unambiguous). Over-fetch, then
  // dedup by slug keeping the nearest page per slug — rows are distance-
  // ordered, so the first occurrence is closest. This keeps candidate slugs
  // unique within the set (the classifier maps its output back by slug) while
  // preserving each candidate's exact page id for a source-safe write.
  const rows = await db.findSimilarByPageId(orphanId, Math.max(k * 2, k));
  const seen = new Set<string>();
  const out: CandidateMatch[] = [];
  for (const r of rows) {
    if (shouldExclude(r.slug)) continue;
    if (seen.has(r.slug)) continue;
    seen.add(r.slug);
    out.push({
      id: r.id,
      slug: r.slug,
      title: r.title,
      compiled_truth: r.compiled_truth ?? "",
      distance: r.distance,
      similarity: 1 - r.distance,
    });
    if (out.length >= k) break;
  }
  return out;
}
