# Fork-local patch: PGLite v16→v24 upgrade-path fix

> 2026-04-23 | Jarvis KOS v2 fork | filed upstream as
> [garrytan/gbrain#370](https://github.com/garrytan/gbrain/issues/370).
> Applied when syncing from upstream v0.17.0 → v0.18.2.

## What was wrong

Upstream `src/core/pglite-schema.ts` line 63 (now patched):

```sql
CREATE INDEX IF NOT EXISTS idx_pages_source_id ON pages(source_id);
```

runs *outside* the `CREATE TABLE IF NOT EXISTS pages(...)` block above
it. On a fresh install this works — the pages table is created with
the `source_id` column in the same script. On a v16→v24 upgrade,
`CREATE TABLE IF NOT EXISTS` **skips** the existing pages table (which
has no `source_id` column), yet the later `CREATE INDEX` statement
still fires and fails with `column "source_id" does not exist`. The
error aborts `engine.initSchema()` before `runMigrations()` gets a
chance to execute v21 (which would add the column).

Net effect: on any PGLite brain that already exists at schema v16,
`gbrain init --migrate-only` throws immediately, `gbrain
apply-migrations --yes` orchestrators report `status=failed`, and
`config.version` never advances past 16. Data is preserved (the
failure is clean), but the upgrade is blocked.

## What the patch does

Deletes the single offending `CREATE INDEX IF NOT EXISTS
idx_pages_source_id ...` line from `PGLITE_SCHEMA_SQL`. The v21
migration
(`src/core/migrate.ts` → `pages_source_id_composite_unique`) already
re-creates this index via `CREATE INDEX IF NOT EXISTS`, so fresh
installs still end up with the same index. The only behavior change
is that the index is now created in one place (v21 migration) instead
of two (schema + migration).

## Why not a broader fix

- Moving `initSchema()` to run migrations *before* schema.sql would
  break fresh installs (they rely on schema.sql to create new-install
  tables that no migration creates).
- Runtime column-existence gating in PGLITE_SCHEMA_SQL (`DO $$ IF ...
  THEN CREATE INDEX ... END $$`) is correct but more invasive than
  this one-liner and would need upstream review.
- The simplest correct behavior on a `CREATE INDEX IF NOT EXISTS`
  after a skipped `CREATE TABLE IF NOT EXISTS` is "don't reference
  columns that the skipped CREATE TABLE would have added." Removing
  the redundant line achieves that with zero loss of fresh-install
  functionality.

## Fork obligations

When upstream merges #370 (or equivalent), remove this fork-local
comment block and restore the original `CREATE INDEX IF NOT EXISTS
idx_pages_source_id ON pages(source_id);` line **if** upstream's fix
preserves the index declaration in schema (they may instead
keep it out of schema entirely, in which case our patch is already
aligned). Check the upstream diff before resolving merge conflicts.

**Status checks**:
- 2026-04-25 (v0.20.4 sync, commit `8665afb`): upstream `pglite-schema.ts:63`
  still emits the bare `CREATE INDEX IF NOT EXISTS idx_pages_source_id ...`
  outside the `CREATE TABLE` block. Patch retained.

## Validation

Smoke-tested against a copy of
`~/.gbrain/brain.pglite.pre-slug-normalize-1776921434` (1829 pages,
schema v16) in an isolated `$HOME`:

- `gbrain apply-migrations --yes` advances `config.version` 16 → 24
- 7 orchestrators (v0.11.0, v0.13.0, v0.13.1, v0.14.0, v0.16.0,
  v0.18.0, v0.18.1) all report `complete`
- `gbrain sources list` shows `default federated 1857 pages never synced`
- Stats: 1857 pages, 3446 chunks, 3446 embedded, 385 links, 181 tags,
  5443 timeline entries — all preserved
- `gbrain doctor` schema_version check: `OK - Version 24 (latest: 24)`

Production sync run: see `docs/JARVIS-ARCHITECTURE.md §6.12`.

## Files touched

- `src/core/pglite-schema.ts` — this patch
- `docs/UPSTREAM-PATCHES/v018-pglite-upgrade-fix.md` — this record
