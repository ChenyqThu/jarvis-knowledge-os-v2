/**
 * ner.ts — entity extraction via Haiku 4.5.
 *
 * Input: one page's markdown body + its slug
 * Output: array of {name, kind, context} extractions
 *
 * Haiku is cheap enough that we can run full-page extraction per page
 * without chunking. For pages > 50k chars we truncate the middle,
 * keeping head+tail — the entities we care about cluster at the ends.
 */
import Anthropic from "@anthropic-ai/sdk";

export type EntityKind = "person" | "company" | "concept" | "project";

export type Extraction = {
  name: string;
  kind: EntityKind;
  context: string;
  source_slug: string;
};

const MODEL = "claude-haiku-4-5-20251001";
const MAX_CHARS = 50_000;

const SYSTEM_PROMPT = `You extract named entities from knowledge-base pages.

Return ONLY a JSON array of objects. No prose, no markdown fences.
Each object: {"name": str, "kind": "person"|"company"|"concept"|"project", "context": str}

Rules:
- name: as written in the source. Preserve casing and diacritics.
- kind: pick the best single label. If ambiguous between person/company (e.g. "Apple"), use context.
- context: a 40-200 char quote or close paraphrase from the source that
  grounds the mention. Include what the entity is or does.
- Do NOT extract: pronouns, role titles alone ("the CEO"), generic nouns,
  common first-names alone ("John"), URLs, file paths, code identifiers.
- Do NOT extract the page's own subject if the page IS about that entity
  (e.g. don't re-extract "Lucien Chen" from a page titled lucien-chen.md).
- Skip the page's own frontmatter block (between --- markers at top).
- Limit to the 30 most salient entities per page.

If nothing qualifies, return [].`;

function truncate(body: string): string {
  if (body.length <= MAX_CHARS) return body;
  const half = Math.floor(MAX_CHARS / 2);
  return body.slice(0, half) + "\n\n[...truncated...]\n\n" + body.slice(-half);
}

function stripJsonFence(s: string): string {
  // Haiku sometimes ignores "no markdown fences" instruction under pressure
  return s
    .replace(/^\s*```(?:json)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/i, "")
    .trim();
}

function parseSafe(raw: string): Array<{ name: string; kind: string; context: string }> {
  let text = stripJsonFence(raw);
  // Take from first `[` to last `]` defensively
  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x && typeof x === "object" && typeof x.name === "string");
  } catch {
    return [];
  }
}

const VALID_KINDS = new Set<EntityKind>(["person", "company", "concept", "project"]);

export async function extractEntities(
  body: string,
  source_slug: string,
  client?: Anthropic,
): Promise<Extraction[]> {
  const api = client ?? new Anthropic();
  const trimmed = truncate(body);

  const resp = await api.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Source page slug: ${source_slug}\n\nBody:\n\n${trimmed}`,
      },
    ],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const raw = parseSafe(text);
  const out: Extraction[] = [];
  for (const item of raw) {
    const kind = item.kind as EntityKind;
    if (!VALID_KINDS.has(kind)) continue;
    const name = (item.name ?? "").trim();
    if (!name || name.length < 2 || name.length > 120) continue;
    const context = (item.context ?? "").trim().slice(0, 400);
    out.push({ name, kind, context, source_slug });
  }
  return out;
}

export async function extractWithRetry(
  body: string,
  source_slug: string,
  client?: Anthropic,
  maxAttempts = 2,
): Promise<Extraction[]> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await extractEntities(body, source_slug, client);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}
