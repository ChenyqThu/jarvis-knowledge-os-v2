/**
 * tavily.ts — Tier 2 web augmentation via Tavily Search API.
 *
 * Reference: https://docs.tavily.com/docs/rest-api/api-reference
 * We use the minimal /search endpoint with `max_results: 2` so each
 * Tier 2 stub costs a single API call.
 */

export type TavilyHit = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export type TavilyResult = {
  query: string;
  answer?: string;
  results: TavilyHit[];
};

const ENDPOINT = "https://api.tavily.com/search";

export async function tavilySearch(
  query: string,
  opts: { maxResults?: number; timeoutMs?: number } = {},
): Promise<TavilyResult | null> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);

  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        include_answer: true,
        max_results: opts.maxResults ?? 2,
      }),
    });
    if (!resp.ok) {
      console.error(`tavily: HTTP ${resp.status} for "${query}"`);
      return null;
    }
    const data = (await resp.json()) as {
      query?: string;
      answer?: string;
      results?: TavilyHit[];
    };
    return {
      query: data.query ?? query,
      answer: data.answer,
      results: data.results ?? [],
    };
  } catch (err) {
    console.error(`tavily: fetch error for "${query}":`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a Tavily query for an entity. Tuned to pull the "what they
 * do / where they're based" bio-sentence that goes into the State
 * section of a stub.
 */
export function buildEntityQuery(name: string, kind: "person" | "company"): string {
  if (kind === "person") return `${name} biography role company`;
  return `${name} company what they do industry`;
}

/**
 * Condense a TavilyResult into a single ~400-char block suitable for
 * the stub's State section.
 */
export function condense(result: TavilyResult | null): string {
  if (!result) return "";
  const pieces: string[] = [];
  if (result.answer) pieces.push(result.answer.trim());
  for (const hit of result.results.slice(0, 2)) {
    pieces.push(`- ${hit.title} — ${hit.content.slice(0, 180).trim()} (${hit.url})`);
  }
  return pieces.join("\n").slice(0, 1200);
}
