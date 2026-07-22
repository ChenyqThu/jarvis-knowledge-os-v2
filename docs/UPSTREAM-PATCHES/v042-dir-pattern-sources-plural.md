# Upstream patch: add plural `sources` to the link-extractor `DIR_PATTERN`

**Status**: fork-local in `master`. Upstream issue filed: [garrytan/gbrain#3188](https://github.com/garrytan/gbrain/issues/3188). Drop this doc once upstream merges.

**Filed**: 2026-07-21 (§6.43-followup, KB orphan-reduction pass)
**Affected file**: `src/core/link-extraction.ts` (one const + comment)
**Scope**: +1 alternative to a whitelist regex, +comment. No logic change; strictly enables *more* matches.

## Why

`DIR_PATTERN` (`link-extraction.ts`) is the top-level slug-directory whitelist that
`ENTITY_REF_RE`, `WIKILINK_RE`, `QUALIFIED_WIKILINK_RE` and the bare-slug pass all gate on.
Upstream lists the singular **`source`** but not the plural **`sources`**:

```
(?:people|companies|meetings|concepts|deal|civic|project|projects|source|media|yc|...)
```

But gbrain files ingested source documents under the plural `sources/` directory. On this
fork that is **9,078 email pages at `sources/email/<id>`** (source `mailagent-emails`), plus
`sources/notion/*` on `default`. Because `sources` is not in the whitelist:

- `[[sources/email/1000008066]]` → `extractEntityRefs` tags it `needsResolution: true`
  (treated as a bare display-name, not a dir-qualified slug) → dropped unless
  `global_basename` is on.
- `[sources/notion/foo](...)` and bare `sources/notion/foo` slugs in body text → not matched
  at all.

Net effect: **no page under `sources/` can ever receive an inbound wikilink/markdown edge**,
so every source document stays a permanent orphan regardless of how many pages cite it. On
this fork that pinned `orphan_ratio` at ~63% (the `sources/email/*` pages were the single
largest orphan bucket — 9,078 pages, 100% orphaned) and held `graph_signals_coverage` at
~28% ("fires occasionally").

## Minimal repro (no DB needed)

```ts
import { extractEntityRefs } from './src/core/link-extraction.ts';
extractEntityRefs('见 [[sources/email/1000008066]] 和 [[people/alice]]。');
// people/alice        → needsResolution: false   (resolves — `people` is whitelisted)
// sources/email/...   → needsResolution: TRUE     (dropped — `sources` is NOT whitelisted)
//
// `[[source/email/x]]` (singular) → needsResolution: false  (would resolve, but the slug is wrong)
```

## Patch

Add `sources` immediately **before** `source` in `DIR_PATTERN` (longer prefix first so the
ordered alternation prefers it; functionally either order works because alternation
backtracks, but this is clearer):

```
...|projects|sources|source|media|...
```

## Result (this fork, 2026-07-21)

Ran `gbrain extract links --source db --source-id mailagent-emails` after the patch:

- 32,611 edges created in one pass (mostly opus dossiers' pre-existing full-slug citations,
  which were always in the bodies but never extractable).
- `sources/email/*` inbound coverage: 0 → 7,015 of 9,078 (email orphans 9,078 → 2,063).
- doctor `orphan_ratio`: **63% WARN → 29% OK**.
- doctor `graph_signals_coverage`: 28.6% → 53.6% ("fires on most queries").

## Testing

- `bun run typecheck` — clean (exit 0).
- Edge correctness spot-check: `people/wesley-gan` now links to exactly the emails it cites
  (`sources/email/1000008066`, `…/1000008072`, `…/1000005561`, …) — no over-match.

## Caveat / merge note

`DIR_PATTERN` is **already a fork-modified line** (the fork earlier appended
`tech|finance|personal|openclaw|entities`). This patch adds one more alternative to that same
line, so it does not open a new conflict surface — it rides the merge-tax the line already
carries. If upstream reorders or rewrites the whitelist, re-apply by ensuring `sources` is
present.
