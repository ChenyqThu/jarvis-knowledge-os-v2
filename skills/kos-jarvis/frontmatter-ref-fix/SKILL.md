---
name: frontmatter-ref-fix
version: 1.0.0
description: |
  Normalize relative-path `*.md` references inside KOS page frontmatter
  (`related:`, `source_refs:`, etc.) into canonical slug form. v1-wiki
  legacy left ~163 refs in `../X/Y.md` shape across the brain; gbrain's
  link-extraction DIR_PATTERN doesn't accept `sources/` (plural) so
  frontmatter refs to source pages all silently fail to resolve. This
  skill walks `~/brain/**/*.md`, drops the `../` prefix and `.md`
  suffix, and verifies each canonical slug actually points at a page on
  disk. Unresolved targets are reported (not rewritten) for human review.
triggers:
  - "frontmatter ref fix"
  - "fix dangling refs"
  - "normalize frontmatter refs"
tools:
  - list_pages
mutating: true
---

# frontmatter-ref-fix

One-shot rewrite skill for v1-wiki legacy frontmatter refs.

## Why

`gbrain extract --include-frontmatter` flagged 14 unresolved refs after
the v0.20.4 sync. Closer inspection: `~/brain` actually carries ~163
`../X/Y.md`-style refs in `related:` / `source_refs:` lists across
comparisons / decisions / concepts / projects pages. Most do resolve
(`entities/jarvis.md` → slug `entities/jarvis` exists), but the format
trips three failure modes:

1. **`sources/` plural not in `DIR_PATTERN`** (link-extraction.ts:47
   accepts singular `source` only) — ~80 refs to source pages drop on
   the floor.
2. **Targets that genuinely don't exist** — e.g. `../sources/2026-04-13-
   alchainhust-darwin-skill-release.md` has no corresponding file. v1
   migration legacy.
3. **Free-text scalars** — e.g. `source: substack` is a `source_type`
   value, not a slug. Left alone.

Cosmetic by themselves (graph dead-ends don't break queries), but they
inflate `dangling_refs` warnings and lower link-coverage. Fix is
deterministic and one-shot: drop the prefix/suffix decoration, verify
the resulting slug exists on disk, rewrite if so.

## Pipeline

1. Walk `~/brain/**/*.md` (excluding `.agent/`, `.git/`).
2. Build a slug index: every page's path-without-`.md` extension.
3. For each file: extract the leading `--- ... ---` frontmatter block,
   scan it line-by-line for refs ending in `.md`, normalize `../?path/
   slug.md` → `path/slug`, look up in the slug index.
4. **Resolved** → rewrite the ref in-place (preserving quotes/indent).
   **Unresolved** → log to report, leave original line untouched.
5. Dry-run: report-only, no writes.
6. Apply: write changed files, single git commit at the end.

## Usage

```bash
# Dry-run (default) — preview all rewrites + unresolved targets
bun run skills/kos-jarvis/frontmatter-ref-fix/run.ts --dry-run

# Apply with git commit
bun run skills/kos-jarvis/frontmatter-ref-fix/run.ts --apply

# Apply without commit (testing)
bun run skills/kos-jarvis/frontmatter-ref-fix/run.ts --apply --no-commit
```

Flags:
- `--dry-run` (default) — no writes
- `--apply` — write changes + git commit
- `--no-commit` — apply without committing
- `--brain-dir DIR` — override brain location (default `~/brain`)
- `--json` — JSONL events to stdout
- `--help`, `-h`

## Acceptance

- Report lands at `~/brain/.agent/reports/frontmatter-ref-fix-<ISO>.md`
  with two tables: rewrites applied + unresolved targets (file:line:before).
- Apply mode: subsequent `gbrain extract --include-frontmatter` flags
  zero `dangling` entries (or only those that genuinely have no on-disk
  target).
- Idempotent: a second run with no fresh v1-imports rewrites zero
  refs and reports zero unresolved targets (modulo any new dead links
  introduced by humans).

## Out of scope

- **Markdown body links** — `[text](../X/Y.md)` style links inside the
  `# ...` body are NOT rewritten. They render fine in any markdown
  viewer; only frontmatter consumers (gbrain extract) trip on them.
  A second skill could handle body refs, but it's a separate problem
  with different risk (might break rendered docs).
- **YAML re-serialization** — we use line-level regex replacement
  rather than yaml.parse + yaml.stringify because re-serializing
  rewrites field order, quote style, and list indentation, producing a
  large unrelated diff. Single-line surgical rewrites preserve the
  notion-poller's emit format.
- **Free-text scalars without `.md` suffix** — `source: substack` etc.
  are not touched. They're flagged in the report but require manual
  triage (probably want a `source_type:` field rather than a slug).
