/**
 * haiku-classifier.ts — single-shot relation classifier over K candidates.
 *
 * Pattern (parseSafe + extractWithRetry + Anthropic SDK) adapted from
 * skills/kos-jarvis/enrich-sweep/lib/ner.ts. Kept inline here rather than
 * promoted to a shared _lib/ helper because there are only two callers
 * today and their prompts differ substantially. Promote when a third
 * caller appears.
 */
import Anthropic from "@anthropic-ai/sdk";

import type { CandidateMatch } from "./candidates.ts";

export type Relation =
  | "supplements"
  | "contrasts"
  | "implements"
  | "extends"
  | "none";

export type Classification = {
  candidate_slug: string;
  relation: Relation;
  confidence: number;
  excerpt: string;
};

export type OrphanInput = {
  slug: string;
  title: string;
  compiled_truth: string;
};

const MODEL = process.env.KOS_CLASSIFIER_MODEL ?? "claude-haiku-4-5-20251001";
const VALID_RELATIONS = new Set<Relation>([
  "supplements",
  "contrasts",
  "implements",
  "extends",
  "none",
]);
const ORPHAN_TRUTH_CAP = 2000;
const CANDIDATE_TRUTH_CAP = 800;
const EXCERPT_CAP = 160;

const SYSTEM_PROMPT = `You classify relationships between knowledge-base pages.

Given one "orphan" page (has no inbound references) and K candidate pages
retrieved by vector similarity, decide for EACH candidate whether the
candidate should reference the orphan, and pick the best relation tag:

- supplements: candidate adds context or evidence that supports a claim in the orphan
- contrasts: candidate disagrees with, qualifies, or offers a counterpoint to the orphan
- implements: candidate is a concrete realization / case / instance of what the orphan describes
- extends: candidate builds on or elaborates the orphan's framework
- none: candidate is unrelated or only superficially similar — DO NOT link

Be conservative. Prefer "none" when uncertain. Low-confidence links
pollute the graph.

Return ONLY a JSON object (no prose, no markdown fences) of shape:

{"classifications":[
  {"candidate_slug":"...","relation":"supplements|contrasts|implements|extends|none","confidence":0.0-1.0,"excerpt":"<= 160 char quote or paraphrase that justifies the relation"}
]}

Output EXACTLY one entry per input candidate, preserving order. Confidence
is a self-assessment: 0.9+ = obvious, 0.7-0.9 = confident, 0.5-0.7 = shaky,
<0.5 = guess (you should usually have emitted "none" at that point).`;

function stripJsonFence(s: string): string {
  return s
    .replace(/^\s*```(?:json)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/i, "")
    .trim();
}

function parseSafe(raw: string): Classification[] {
  let text = stripJsonFence(raw);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  try {
    const parsed = JSON.parse(text) as { classifications?: unknown };
    const arr = Array.isArray(parsed?.classifications)
      ? parsed.classifications
      : [];
    const out: Classification[] = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const slug = typeof r.candidate_slug === "string" ? r.candidate_slug : "";
      const relation = typeof r.relation === "string" ? r.relation : "none";
      const confidence =
        typeof r.confidence === "number" ? r.confidence : Number(r.confidence);
      const excerpt = typeof r.excerpt === "string" ? r.excerpt : "";
      if (!slug) continue;
      if (!VALID_RELATIONS.has(relation as Relation)) continue;
      if (!Number.isFinite(confidence)) continue;
      out.push({
        candidate_slug: slug,
        relation: relation as Relation,
        confidence: Math.max(0, Math.min(1, confidence)),
        excerpt: excerpt.trim().slice(0, EXCERPT_CAP),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function truncate(s: string, cap: number): string {
  if (!s) return "";
  if (s.length <= cap) return s;
  return s.slice(0, cap) + "…";
}

function buildUserMessage(
  orphan: OrphanInput,
  candidates: CandidateMatch[]
): string {
  const orphanBlock = [
    "<orphan>",
    `slug: ${orphan.slug}`,
    `title: ${orphan.title}`,
    `compiled_truth: ${truncate(orphan.compiled_truth, ORPHAN_TRUTH_CAP)}`,
    "</orphan>",
  ].join("\n");

  const candidateBlocks = candidates
    .map((c, i) => {
      return [
        "<candidate>",
        `index: ${i}`,
        `slug: ${c.slug}`,
        `title: ${c.title}`,
        `similarity: ${c.similarity.toFixed(3)}`,
        `compiled_truth: ${truncate(c.compiled_truth, CANDIDATE_TRUTH_CAP)}`,
        "</candidate>",
      ].join("\n");
    })
    .join("\n\n");

  return `${orphanBlock}\n\n<candidates>\n${candidateBlocks}\n</candidates>\n\nReturn classifications JSON.`;
}

export class ClassifierCallStats {
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
}

export async function classifyOne(
  orphan: OrphanInput,
  candidates: CandidateMatch[],
  stats: ClassifierCallStats,
  client?: Anthropic
): Promise<Classification[]> {
  if (candidates.length === 0) return [];
  const api = client ?? new Anthropic();
  const user = buildUserMessage(orphan, candidates);

  const resp = await api.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: user }],
  });

  stats.calls += 1;
  stats.inputTokens += resp.usage?.input_tokens ?? 0;
  stats.outputTokens += resp.usage?.output_tokens ?? 0;

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = parseSafe(text);
  // Only keep classifications whose candidate_slug was actually in the
  // input set — Haiku occasionally hallucinates a slug.
  const allowed = new Set(candidates.map((c) => c.slug));
  return parsed.filter((c) => allowed.has(c.candidate_slug));
}

export async function classifyWithRetry(
  orphan: OrphanInput,
  candidates: CandidateMatch[],
  stats: ClassifierCallStats,
  client?: Anthropic,
  maxAttempts = 2
): Promise<Classification[]> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await classifyOne(orphan, candidates, stats, client);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Rough per-call cost estimate for Haiku 4.5 as of 2026-04-23 pricing.
 * Input: $0.80 / 1M tokens; Output: $4 / 1M tokens.
 * Used for budget reporting; not enforced.
 */
export function estimateCostUsd(stats: ClassifierCallStats): number {
  return (stats.inputTokens * 0.8 + stats.outputTokens * 4) / 1_000_000;
}
