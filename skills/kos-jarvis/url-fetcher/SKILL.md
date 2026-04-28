---
name: url-fetcher
version: 1.0.0
description: |
  KOS-Jarvis adapter that bridges kos-compat-api `/ingest` to UltimateSearchSkill's
  Tavily Extract → FireCrawl Scrape three-tier fetcher (with native fetch
  fallback). Replaces v2 KOS's bare `fetch(url)` which had no deadline and
  caused Cloudflare 524 timeouts on slow/reflective targets like X/Twitter.
triggers:
  - "url fetcher"
  - "ingest fetch backend"
  - "kos fetch retry"
tools: []
mutating: false
---

# url-fetcher — KOS ingest fetch backend

Single export: `fetchUrl(url, { backend?, timeoutMs? }) → FetchResult`.

Routes through three strategies via `KOS_FETCH_BACKEND`:

| Backend          | Behavior                                                                   |
|------------------|----------------------------------------------------------------------------|
| `auto` (default) | UltimateSearchSkill `web-fetch.sh` (75% budget) → native `fetch` fallback. |
| `ultimate-search`| Only `web-fetch.sh`. Fails if not on disk or all tiers fail.               |
| `native`         | Bare `fetch(url, { signal: AbortSignal.timeout(...) })`. Full budget.      |

## Why

KOS v2's `server/kos-compat-api.ts` previously did `await fetch(url)` with no
deadline. X/Twitter and other reflective hosts can hang HTTPS handshake
indefinitely. Cloudflare's edge gives the origin ~100s, then returns **524**
to whoever called `kos.chenge.ink/ingest` (Notion Knowledge Agent / OpenClaw
feishu cron). Native fetch is also defenseless against FlareSolverr-protected
sites. UltimateSearchSkill already runs on the same Mac with multi-account
key aggregation, so we delegate.

## Where ultimate-search lives

`~/Projects/UltimateSearchSkill/scripts/web-fetch.sh` (override via
`ULTIMATE_SEARCH_DIR`). Script auto-loads `../.env` for Tavily / FireCrawl
keys; the adapter inherits `process.env` plus a sane PATH so spawned curl/jq
resolve under launchd.

## Failure modes (all return `FetchResult` with `ok: false`)

- spawn error (bash missing, ENOENT)
- timeout (SIGTERM → 1s grace → SIGKILL)
- non-zero exit (`{"error": "..."}` stdout from web-fetch.sh)
- empty `raw_content` from Tavily/FireCrawl
- parse failure on stdout
- native fetch network error / non-2xx status

## Integration

Imported from `server/kos-compat-api.ts` at the URL fetch path. Per the
fork rule (CLAUDE.md), all jarvis-specific logic stays under
`skills/kos-jarvis/`; the adapter exposes a TS interface so the
non-extension server file stays minimal.

## Env

| Var                    | Default                                | Notes                                          |
|------------------------|----------------------------------------|------------------------------------------------|
| `KOS_FETCH_BACKEND`    | `auto`                                 | `auto` / `ultimate-search` / `native`.         |
| `KOS_FETCH_TIMEOUT_MS` | `30000`                                | Total budget. `auto` gives 75% to ultimate.    |
| `ULTIMATE_SEARCH_DIR`  | `~/Projects/UltimateSearchSkill`       | Override if installed elsewhere.               |

## Tested boundary

- `fetchUrl("https://example.com")` returns native html (Tavily refuses
  trivial origins; auto falls back).
- `fetchUrl("https://x.com/<id>/status/<id>")` routes through Tavily/FireCrawl
  on `auto` and `ultimate-search`.
- `fetchUrl(<bad>, { backend: "native" })` returns `ok:false, timeout:true`
  after `KOS_FETCH_TIMEOUT_MS` if origin hangs.
