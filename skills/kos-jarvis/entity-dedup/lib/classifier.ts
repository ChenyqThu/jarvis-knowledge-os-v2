/**
 * classifier.ts — LLM entity-disambiguation over one within-source cluster.
 *
 * Pattern (parseSafe + Anthropic SDK + retry) mirrors
 * orphan-reducer/lib/haiku-classifier.ts. The prompt encodes the precision
 * lessons from the 126-pair probe:
 *   - merge ONLY unambiguously-same real entities
 *   - a first-name-only slug that could match ≥2 full names in the cluster
 *     is AMBIGUOUS → never merge (this is the upstream #2723 case)
 *   - different surnames / different teams → DISTINCT
 *   - canonical = the richest node (highest indeg + facts), unless a shorter
 *     slug is clearly the intended stable name
 *
 * Default model is Haiku 4.5 (proven in this repo). Set KOS_DEDUP_MODEL to a
 * stronger model for production sweeps — human review of the dry-run report
 * is the real precision gate regardless.
 */
import Anthropic from "@anthropic-ai/sdk";

import type { VariantCluster } from "./candidates.ts";

const MODEL = process.env.KOS_DEDUP_MODEL ?? "claude-haiku-4-5-20251001";

/**
 * Build an Anthropic client. Two fork-environment quirks are handled here:
 *   1. base URL: a CRS proxy base may carry `/v1` (for gbrain's Vercel AI SDK
 *      gateway, which does NOT append it); the official @anthropic-ai/sdk
 *      appends `/v1/messages` itself, so strip a trailing `/v1` to avoid
 *      `/v1/v1` → 404 (cf. synthesis-sweep / atom-concepts-backfill).
 *   2. auth: the CRS proxy authenticates via `Authorization: Bearer`
 *      (ANTHROPIC_AUTH_TOKEN), NOT `x-api-key`. Passing the CRS token as
 *      `apiKey` yields "401 invalid x-api-key". Prefer `authToken` when
 *      ANTHROPIC_AUTH_TOKEN is set; fall back to `apiKey` for the official
 *      endpoint (cf. the orphan-reducer-bugs memo).
 */
export function makeClient(): Anthropic {
  const base = process.env.ANTHROPIC_BASE_URL?.replace(/\/v1\/?$/, "") || undefined;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (authToken) return new Anthropic({ baseURL: base, authToken, maxRetries: 8 });
  return new Anthropic({ baseURL: base, apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 8 });
}

export type MergeDecision = {
  canonical: string;
  aliases: string[];
  confidence: number;
  reason: string;
};

export type ClusterVerdict = {
  merges: MergeDecision[];
  ambiguous: { slugs: string[]; reason: string }[];
  distinct: { slugs: string[]; reason: string }[];
};

export class ClassifierCallStats {
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
}

const SYSTEM_PROMPT = `You decide whether knowledge-base pages that share a source and a name-prefix
describe the SAME real-world entity, so they can be merged into one canonical page.

You are given a CLUSTER of candidate pages (all in the same source, same
directory, trigram-similar slugs). For the cluster, output three buckets:

- "merges": groups you are confident are the SAME entity. Each group names a
  canonical slug (prefer the member with the highest indeg+facts) and its
  alias slugs. Only include a slug here if it is UNAMBIGUOUSLY the same entity.
- "ambiguous": slugs that MIGHT belong to a merge but you cannot be sure —
  especially a first-name-only slug (e.g. "people/xavier") when the cluster
  has TWO OR MORE plausible full-name matches (e.g. "people/xavier-li" AND
  "people/xavier-chen"). NEVER merge these; a wrong merge corrupts the graph.
- "distinct": slugs that are DIFFERENT real entities. Different surnames
  (crystal-cao vs crystal-he), different org sub-teams (omada-store-support vs
  omada-vip-support), or different products are distinct.

Rules:
- Be conservative. When unsure, choose "ambiguous" or "distinct", never "merges".
- A single cluster may yield multiple merge groups, plus ambiguous/distinct.
- Canonical and aliases must be slugs drawn verbatim from the input members.
- A slug appears in AT MOST one bucket.

Return ONLY a JSON object (no prose, no markdown fences):
{"merges":[{"canonical":"<slug>","aliases":["<slug>",...],"confidence":0.0-1.0,"reason":"<= 140 chars"}],
 "ambiguous":[{"slugs":["<slug>",...],"reason":"<= 140 chars"}],
 "distinct":[{"slugs":["<slug>",...],"reason":"<= 140 chars"}]}`;

function stripJsonFence(s: string): string {
  return s.replace(/^\s*```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "").trim();
}

function buildUserMessage(cluster: VariantCluster): string {
  const lines = cluster.members.map((m, i) =>
    [
      "<member>",
      `index: ${i}`,
      `slug: ${m.slug}`,
      `type: ${m.type}`,
      `title: ${m.title}`,
      `inbound_links: ${m.indeg}`,
      `facts: ${m.facts}`,
      `excerpt: ${m.excerpt.replace(/\s+/g, " ").slice(0, 300)}`,
      "</member>",
    ].join("\n")
  );
  return `source: ${cluster.source}\ndirectory: ${cluster.dir}\n\n<cluster>\n${lines.join("\n\n")}\n</cluster>\n\nReturn the verdict JSON.`;
}

function parseVerdict(raw: string, allowed: Set<string>): ClusterVerdict {
  let text = stripJsonFence(raw);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  const empty: ClusterVerdict = { merges: [], ambiguous: [], distinct: [] };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return empty;
  }
  const validSlug = (s: unknown): s is string => typeof s === "string" && allowed.has(s);
  const seen = new Set<string>();
  const take = (s: string): boolean => {
    if (seen.has(s)) return false; // a slug may appear in at most one bucket
    seen.add(s);
    return true;
  };

  const merges: MergeDecision[] = [];
  for (const m of Array.isArray(parsed.merges) ? parsed.merges : []) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const canonical = r.canonical;
    const aliasesRaw = Array.isArray(r.aliases) ? r.aliases : [];
    if (!validSlug(canonical)) continue;
    const aliases = aliasesRaw.filter(validSlug).filter((a) => a !== canonical);
    // Reserve canonical + aliases; skip any already claimed by an earlier bucket.
    if (seen.has(canonical) || aliases.some((a) => seen.has(a))) continue;
    if (aliases.length === 0) continue;
    take(canonical);
    for (const a of aliases) take(a);
    const conf = typeof r.confidence === "number" ? r.confidence : Number(r.confidence);
    merges.push({
      canonical,
      aliases,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
      reason: (typeof r.reason === "string" ? r.reason : "").slice(0, 140),
    });
  }

  const bucket = (arrRaw: unknown): { slugs: string[]; reason: string }[] => {
    const out: { slugs: string[]; reason: string }[] = [];
    for (const g of Array.isArray(arrRaw) ? arrRaw : []) {
      if (!g || typeof g !== "object") continue;
      const r = g as Record<string, unknown>;
      const slugs = (Array.isArray(r.slugs) ? r.slugs : []).filter(validSlug).filter(take);
      if (slugs.length === 0) continue;
      out.push({ slugs, reason: (typeof r.reason === "string" ? r.reason : "").slice(0, 140) });
    }
    return out;
  };

  return { merges, ambiguous: bucket(parsed.ambiguous), distinct: bucket(parsed.distinct) };
}

export async function classifyCluster(
  cluster: VariantCluster,
  stats: ClassifierCallStats,
  client?: Anthropic
): Promise<ClusterVerdict> {
  const api = client ?? makeClient();
  const resp = await api.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(cluster) }],
  });
  stats.calls += 1;
  stats.inputTokens += resp.usage?.input_tokens ?? 0;
  stats.outputTokens += resp.usage?.output_tokens ?? 0;
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const allowed = new Set(cluster.members.map((m) => m.slug));
  return parseVerdict(text, allowed);
}

export async function classifyWithRetry(
  cluster: VariantCluster,
  stats: ClassifierCallStats,
  client?: Anthropic,
  maxAttempts = 2
): Promise<ClusterVerdict> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await classifyCluster(cluster, stats, client);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Haiku 4.5 pricing (2026): $0.80/1M in, $4/1M out. Reporting only. */
export function estimateCostUsd(stats: ClassifierCallStats): number {
  return (stats.inputTokens * 0.8 + stats.outputTokens * 4) / 1_000_000;
}

export { MODEL as CLASSIFIER_MODEL };
