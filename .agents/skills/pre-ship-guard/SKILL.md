---
name: pre-ship-guard
description: Run the RIGHT subset of the gbrain check:* gates plus typecheck for the current diff, before /ship. Picks gates by which files changed (skills → resolver/brain-first; agent-voice/proposal → PII; admin → admin-build; AI/embedding → gateway-routed) so you get fast, relevant signal instead of reading package.json to remember 25 scripts. Use when asked to "pre-ship check", "guard check", "run the right checks", or right before shipping.
---

# pre-ship-guard

The fork has ~25 `check:*` scripts in `package.json`. Most callers don't know which
ones matter for a given change. This skill maps changed files → relevant gates, runs
them, and reports a go/no-go. It does NOT commit, push, or bump VERSION — that's `/ship`.

## Workflow

### 1. Scope the diff
```bash
git diff --name-only HEAD
git status --porcelain
```
If nothing changed, say so and audit HEAD instead.

### 2. Always run (cheap, broad)
```bash
bun run typecheck          # tsc --noEmit
```

### 3. Run gates by what changed

| Changed path(s) | Run these gates |
|---|---|
| anything (baseline integrity) | `bun run check:privacy`, `bun run check:proposal-pii`, `bun run check:test-names` |
| `skills/**` (esp. kos-jarvis) | `bun run check:skill-brain-first`, `bun run check:resolver` |
| agent-voice / proposal / corpus text | `bun run check:no-pii-agent-voice`, `bun run check:synthetic-corpus-privacy` |
| `src/core/ai/**`, embedding, plists, env | `bun run check:gateway-routed` (+ delegate to the `embedding-gateway-guard` subagent) |
| `admin/**` | `bun run check:admin-build`, `bun run check:admin-scope-drift`, `bun run check:admin-embedded` |
| DB / operations / jsonb / source-id code | `bun run check:jsonb`, `bun run check:source-id-projection`, `bun run check:source-config-leak`, `bun run check:operations-filter-bypass` |
| tests touched | `bun run check:test-isolation` |
| `src/cli.ts` / bin | `bun run check:cli-exec` |

When in doubt or the diff is broad, just run the umbrella: `bun run check:all`.

### 4. Report
- **GO** / **NO-GO**, with each failing gate's `file:line`, the rule, and a fix.
- Flag any PII / real-name / source-config-leak failure as **P0** (Chinese-first
  personal KB — leaks are the highest severity).
- List gates skipped for lack of `DATABASE_URL` (E2E) so coverage isn't overstated.

## Notes
- Respect the fork boundary: fixes go under `skills/kos-jarvis/`, never `src/*` or
  upstream `skills/*`. The fork-boundary PreToolUse hook will block stray writes anyway.
- For the full privacy battery in one shot, delegate to the `privacy-gate-reviewer`
  subagent instead of running each script inline.
