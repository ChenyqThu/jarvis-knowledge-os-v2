---
name: digest-to-memory
version: 1.0.0
description: |
  KOS → OpenClaw MEMORY reflux. Port of KOS v1 `kos digest` writeback flow.
  Takes the latest kos-patrol digest and appends `[knowledge-os]` entries
  to ~/.openclaw/workspace/MEMORY.md 近期层 so daily Jarvis decisions are
  informed by what KOS compiled that week. Runs weekly Sun 22:00 via
  cron-scheduler, or on demand.
triggers:
  - "digest to memory"
  - "reflux knowledge"
  - "push to memory"
tools:
  - get_page
  - list_pages
mutating: true  # writes to MEMORY.md (outside brain/)
---

# digest-to-memory Skill

**This is the "MEMORY 回流" clarification point from the main migration
plan.** KOS v1 defined a one-way push from KOS → OpenClaw's `MEMORY.md`
近期层; GBrain doesn't ship this behavior. We preserve it so Jarvis's
daily context keeps getting enriched by compiled knowledge.

## Contract

- Runs idempotent: appending the same date's digest twice is a no-op
- Only appends, never rewrites — MEMORY.md 近期层 rule is append-only
- Fails gracefully if MEMORY.md is missing (creates a marker report
  instead; user may have reorganized OpenClaw workspace)

## Format

Each weekly digest block looks like:

```
[knowledge-os] 2026-04-16 week-ending patrol:
  - 85 pages / compile-rate 63% / 2 lint-ERROR
  - recent: context-engineering (A, 4 links), alignment-faking (B, 2 links)
  - gaps: 3 entities missing pages
  - stale: 7 pages >180d
```

The leading `[knowledge-os]` tag is what OpenClaw's MEMORY reader uses to
filter this source when relevant.

## Protocol

### Phase 1 — Locate the freshest digest
Read most recent file matching `~/brain/agent/digests/patrol-*.md`.
If none exists, invoke `kos-patrol` skill first and retry.

### Phase 2 — Dedupe check
Read `~/.openclaw/workspace/MEMORY.md`. If a block already exists for
this week's date (regex `\[knowledge-os\] \d{4}-\d{2}-\d{2}`), skip.

### Phase 3 — Append
Append block to `近期层` section (detected via heading `## 近期层` or
`## Recent`). If detector can't find the section, append to end of file
with a comment noting the fallback so the user can fix layout.

### Phase 4 — Log
Append to `~/brain/log.md`:
```
<YYYY-MM-DD> | digest-to-memory | appended <bytes> to MEMORY.md
```

## CLI

```bash
bun run skills/kos-jarvis/digest-to-memory/run.ts          # run
bun run skills/kos-jarvis/digest-to-memory/run.ts --dry    # print only
bun run skills/kos-jarvis/digest-to-memory/run.ts --week 2026-04-09  # specific week
```

## Schedule

Registered with `skills/cron-scheduler` for Sunday 22:00 local. Skips
silently if no patrol digest for the current week (autopilot may be paused).
