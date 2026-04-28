/**
 * url-fetcher — KOS-Jarvis adapter over UltimateSearchSkill.
 *
 * Why this exists: kos-compat-api.ts /ingest used to do a bare `fetch(url)`
 * with no deadline. X/Twitter and other reflective targets hang HTTPS
 * handshake silently → Cloudflare returns 524 to Notion/OpenClaw callers
 * after ~100s. Native fetch is also no match for FlareSolverr-protected
 * sites. UltimateSearchSkill (~/Projects/UltimateSearchSkill) ships a
 * Tavily Extract → FireCrawl Scrape three-tier fallback for exactly this
 * case, exposed as a shell script (`scripts/web-fetch.sh`).
 *
 * KOS_FETCH_BACKEND env (auto | ultimate-search | native) chooses the
 * strategy. Default `auto` prefers ultimate-search and falls back to
 * native fetch within the same total budget.
 *
 * Per the kos-jarvis fork rule, all jarvis-specific logic lives in
 * skills/kos-jarvis/; this is the adapter. The non-extension surface
 * (server/kos-compat-api.ts) imports `fetchUrl` from here.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type FetchBackend = "auto" | "ultimate-search" | "native";

export type FetchOk = {
  ok: true;
  backend: "ultimate-search" | "native";
  format: "markdown" | "html";
  content: string;
  url: string;
  bytes: number;
  dur_ms: number;
  /** When backend=ultimate-search, which tier ("tavily" | "firecrawl") returned content. */
  source?: string;
};

export type FetchFail = {
  ok: false;
  backend: FetchBackend | "ultimate-search" | "native";
  error: string;
  timeout: boolean;
  http_status?: number;
  dur_ms: number;
};

export type FetchResult = FetchOk | FetchFail;

const ULTIMATE_SEARCH_DIR =
  process.env.ULTIMATE_SEARCH_DIR ??
  join(homedir(), "Projects/UltimateSearchSkill");
const WEB_FETCH_SH = join(ULTIMATE_SEARCH_DIR, "scripts/web-fetch.sh");
const DEFAULT_USER_AGENT = "kos-compat-api/1.0 (gbrain-ingest)";

export function ultimateSearchAvailable(): boolean {
  return existsSync(WEB_FETCH_SH);
}

function spawnWebFetch(url: string, timeoutMs: number): Promise<FetchResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn("/bin/bash", [WEB_FETCH_SH, "--url", url], {
      env: {
        ...process.env,
        // Keep the path UltimateSearchSkill's curl/jq lookups need; launchd
        // strips PATH down to /usr/bin:/bin by default.
        PATH:
          process.env.PATH ??
          "/usr/bin:/bin:/opt/homebrew/bin:/Users/" +
            (process.env.USER ?? "") +
            "/.bun/bin",
      },
    });

    let stdout = "";
    let stderr = "";
    let killed: "timeout" | null = null;

    const timer = setTimeout(() => {
      killed = "timeout";
      child.kill("SIGTERM");
      // SIGKILL escalation if the script doesn't die in 1s.
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }, 1000);
    }, timeoutMs);

    child.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf8"); });
    child.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });

    child.on("error", (e: Error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        backend: "ultimate-search",
        error: `spawn failed: ${e.message}`,
        timeout: false,
        dur_ms: Date.now() - t0,
      });
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const dur_ms = Date.now() - t0;
      if (killed === "timeout") {
        return resolve({
          ok: false,
          backend: "ultimate-search",
          error: `web-fetch.sh timeout after ${timeoutMs}ms`,
          timeout: true,
          dur_ms,
        });
      }
      if (code !== 0) {
        // web-fetch.sh's error_exit prints `{"error": "..."}` to stdout.
        const errMsg =
          parseErrorJson(stdout) ?? stderr.trim() ?? `exit code ${code}`;
        return resolve({
          ok: false,
          backend: "ultimate-search",
          error: errMsg,
          timeout: false,
          dur_ms,
        });
      }
      try {
        const parsed = JSON.parse(stdout) as {
          source?: string;
          results?: Array<{ url?: string; raw_content?: string }>;
        };
        const r0 = parsed.results?.[0];
        const content = r0?.raw_content;
        if (!content || typeof content !== "string" || content.length === 0) {
          return resolve({
            ok: false,
            backend: "ultimate-search",
            error: "empty content from web-fetch.sh",
            timeout: false,
            dur_ms,
          });
        }
        resolve({
          ok: true,
          backend: "ultimate-search",
          format: "markdown",
          content,
          url,
          bytes: content.length,
          dur_ms,
          source: parsed.source,
        });
      } catch (e) {
        resolve({
          ok: false,
          backend: "ultimate-search",
          error: `parse stdout: ${(e as Error).message}; head=${stdout.slice(0, 200)}`,
          timeout: false,
          dur_ms,
        });
      }
    });
  });
}

function parseErrorJson(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const j = JSON.parse(trimmed) as { error?: string };
    return j.error ?? null;
  } catch {
    return null;
  }
}

async function fetchViaNative(url: string, timeoutMs: number): Promise<FetchResult> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    if (!r.ok) {
      return {
        ok: false,
        backend: "native",
        error: `http ${r.status}`,
        timeout: false,
        http_status: r.status,
        dur_ms: Date.now() - t0,
      };
    }
    return {
      ok: true,
      backend: "native",
      format: "html",
      content: text,
      url,
      bytes: text.length,
      dur_ms: Date.now() - t0,
    };
  } catch (e) {
    const isTimeout = e instanceof Error && e.name === "TimeoutError";
    return {
      ok: false,
      backend: "native",
      error: e instanceof Error ? e.message : String(e),
      timeout: isTimeout,
      dur_ms: Date.now() - t0,
    };
  }
}

/**
 * Fetch a URL using the configured strategy.
 *
 * `auto` (default): try ultimate-search first if web-fetch.sh exists on disk;
 * if it fails (or isn't available), fall back to native fetch within the
 * remaining budget. The total budget is `timeoutMs` (default 30s); we hand
 * 75% to ultimate-search and reserve 25% for fallback. Total stays well
 * under Cloudflare's ~100s edge timeout.
 */
export async function fetchUrl(
  url: string,
  opts?: { backend?: FetchBackend; timeoutMs?: number },
): Promise<FetchResult> {
  const backend: FetchBackend =
    opts?.backend ??
    (process.env.KOS_FETCH_BACKEND as FetchBackend | undefined) ??
    "auto";
  const totalMs =
    opts?.timeoutMs ??
    Number(process.env.KOS_FETCH_TIMEOUT_MS ?? 30_000);

  if (backend === "native") return fetchViaNative(url, totalMs);

  if (backend === "ultimate-search") {
    if (!ultimateSearchAvailable()) {
      return {
        ok: false,
        backend: "ultimate-search",
        error: `web-fetch.sh not found at ${WEB_FETCH_SH}`,
        timeout: false,
        dur_ms: 0,
      };
    }
    return spawnWebFetch(url, totalMs);
  }

  // auto: ultimate-search if available, fallback to native.
  if (!ultimateSearchAvailable()) {
    return fetchViaNative(url, totalMs);
  }

  const ultBudget = Math.max(Math.floor(totalMs * 0.75), 10_000);
  const ultResult = await spawnWebFetch(url, ultBudget);
  if (ultResult.ok) return ultResult;

  // Fallback budget: whatever's left, with a 5s floor.
  const fallbackMs = Math.max(totalMs - ultResult.dur_ms, 5_000);
  const nativeResult = await fetchViaNative(url, fallbackMs);
  if (nativeResult.ok) return nativeResult;

  // Both failed — return the ultimate-search error since it's the first-line
  // tool; native is descriptive of the URL but not the right primary signal.
  return ultResult;
}
