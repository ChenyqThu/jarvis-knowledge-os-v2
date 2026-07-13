---
name: entity-dedup
version: 1.0.0
description: |
  Merge WITHIN-SOURCE duplicate entity-variant pages (e.g. people/lucien +
  people/lucien-chen, companies/tp-link-system-inc + tp-link-systems-inc) into
  one canonical node: repoint links + facts + display-name aliases, register a
  slug redirect, soft-delete the alias pages. An LLM disambiguates each cluster
  (merge / ambiguous / distinct); ambiguous first-name-vs-multiple-full-names
  cases are quarantined, never merged. Default --dry (simulate + report, zero
  writes). Cross-source pages are NEVER touched — the two-axis design keeps
  them legitimately separate.
triggers:
  - "entity dedup"
  - "deduplicate entities"
  - "merge duplicate entities"
  - "entity merge"
  - "canonicalize entity"
tools:
  - list_pages
  - get_page
  - query
mutating: true
---

# entity-dedup

Collapse duplicate entity pages that the enrich pipeline + external writers
created for the SAME real entity in the SAME source. Motivated by the
2026-07-13 graph audit: `people/lucien` (2176 indeg) vs `people/lucien-chen`
(2534) in `default`; the `tp-link-system-inc` / `tp-link-systems-inc` /
`tp-link-systems` triple; etc.

## Scope — read this first

**WITHIN-SOURCE only.** The audit's headline "512 overlapping slugs" is 511
cross-source + 1 same-source. Cross-source same-slug pages (`default:people/
lucien-chen` vs `mailagent-emails:people/lucien-chen`) are **legitimately
separate** under the two-axis design (CLAUDE.md) and were explicitly retracted
from dedup in `REFINEMENT-BACKLOG.md` R1/R2. `slug_aliases` is `(source_id,
alias_slug, canonical_slug)` — it *cannot* express a cross-source merge, by
design. This skill therefore only merges variants that share a source; the SQL
is source-scoped on every statement, so cross-source is impossible by
construction.

Complements `orphan-reducer` (adds inbound links to orphans). No overlap: that
skill *adds edges*, this one *merges nodes*.

## Pipeline

1. **loadClusters** (`lib/candidates.ts`) — same-source, same-first-dir,
   trigram-similar entity/person/company pages, single-linkage clustered.
   High recall, low precision (the candidate set mixes true dups, first-name
   ambiguity, and same-first-name-different-surname false positives).
2. **classify** (`lib/classifier.ts`) — an LLM sorts each cluster into
   `merges` / `ambiguous` / `distinct`. Conservative by construction:
   different surnames → distinct; a first name matching ≥2 full names →
   ambiguous (never merged).
3. **build specs** — accept a merge only at/above `--min-confidence` (0.85).
4. **mergeCluster** (`lib/merge.ts`) — one transaction per cluster:
   repoint inbound + outbound `links` (dropping unique-constraint collisions
   and self-loops first), migrate `facts.entity_slug`, copy `page_aliases`,
   insert `slug_aliases` (read-time `[[old]]` redirect), drop alias-page
   `content_chunks`, soft-delete the alias pages. `--dry` executes then rolls
   back; `--apply` commits.
5. **report** (`lib/report.ts`) — markdown + JSON rollback manifest under
   `~/brain/.agent/reports/`.

## Prerequisites

- `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL` in env. The classifier strips a
  trailing `/v1` from the base itself (CRS proxy carries `/v1`; the official SDK
  appends `/v1/messages`, so a raw client would 404 on `/v1/v1` — cf. the
  `orphan-reducer-bugs` memo), so the normal `.env.local` CRS base works as-is.
  If a Claude Code shell injected `ANTHROPIC_BASE_URL=https://api.anthropic.com`,
  that path needs a real Anthropic key (not the CRS key).
- `~/.gbrain/config.json` with `engine: "postgres"` + `database_url`. The skill
  refuses to run on PGLite/unknown engine.
- Model: `KOS_DEDUP_MODEL` (default `claude-haiku-4-5-20251001`, CRS-routable).
  Set a stronger model for production sweeps; human review of the dry-run report
  is the real precision gate regardless.

## Usage

```bash
# Dry-run 5 clusters in default source (classify + simulate + report; no writes)
bun run skills/kos-jarvis/entity-dedup/run.ts --source default --limit 5 --dry

# Review the report, then apply the confirmed merges (needs a fresh pg_dump)
pg_dump postgresql://chenyuanquan@127.0.0.1:5432/gbrain | gzip > /tmp/pre-dedup-$(date +%F).dump.gz
bun run skills/kos-jarvis/entity-dedup/run.ts --source default --limit 5 --apply --i-know
```

Flags: `bun run skills/kos-jarvis/entity-dedup/run.ts --help`.

## Safety

- **Default is `--dry`** — simulates every merge inside a transaction and rolls
  back, so the report shows exactly what `--apply` would change (validated
  2026-07-13: the sample dry-run left the DB byte-identical).
- **`--apply` requires `--i-know`** and prints the pg_dump command. Take the
  backup.
- **Ambiguous clusters are never merged** — they land in the report's
  quarantine section for a human call.
- **Per-cluster atomicity** — each merge is one transaction; a failure rolls
  back that cluster only.
- **Auto-mode classifier**: `--apply` is a production write; expect the harness
  to prompt for confirmation.

## Known limits & regeneration caveat

- **Merges are one-time cleanup, not a permanent fix.** `putPage`/`import-file`
  do NOT resolve `slug_aliases` before creating a page, and the `(source_id,
  slug)` unique constraint counts soft-deleted rows — so if mailagent/enrich
  re-`putPage`s a merged alias slug it will resurrect the page. Durable fixes
  are upstream of the merge: align the writer pipelines' type/slug conventions,
  or teach `putPage` to redirect via `resolveSlugWithAlias` (candidate upstream
  issue). Until then, re-run this skill periodically (kos-patrol could host a
  low-frequency check).
- **Candidate recall is trigram-bounded.** Name variants that don't share the
  first 3 chars (e.g. transliteration splits) won't cluster. Widen `--min-sim`
  cautiously; precision drops fast.
- **The LLM can still err.** The dry-run report + human review before `--apply`
  is the intended workflow — do not pipe `--apply` blind.

## Rollback

The JSON sidecar records every committed merge. There is no one-command undo
(soft-delete + link repoint + alias insert span four tables). The pre-run
`pg_dump` is the real rollback path. For a single merge, a manual reversal is:
un-delete the alias page (`UPDATE pages SET deleted_at=NULL`), delete its
`slug_aliases` row, and re-run `gbrain extract links` to rebuild edges — but
restoring from the dump is safer.

## Acceptance

- Dry-run makes zero DB changes (verify: `slug_aliases` count unchanged).
- `--apply` raises the canonical's inbound-link count by
  `inbound_repointed − collisions`, and `gbrain get-page <alias>` resolves to
  the canonical via the slug redirect.
- Spot-check 100% of accepted merges in the report before the first `--apply`;
  the ambiguous/distinct buckets should catch the surname/first-name traps.
