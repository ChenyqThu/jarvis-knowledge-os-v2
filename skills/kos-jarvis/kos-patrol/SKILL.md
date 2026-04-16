---
name: kos-patrol
version: 1.0.0
description: |
  Daily sweep: runs kos-lint + staleness detection + knowledge-gap analysis,
  then produces a MEMORY-format digest ready to be appended to OpenClaw's
  MEMORY.md by the digest-to-memory skill (Sun 22:00 weekly). Also writes
  a dashboard to ~/brain/agent/dashboards/knowledge-health-<date>.md.
triggers:
  - "kos patrol"
  - "daily patrol"
  - "brain daily check"
tools:
  - list_pages
  - get_page
  - backlinks
  - query
  - put_page
mutating: true
---

# KOS Patrol Skill

Port of KOS v1 `patrol-agent` + `generate-dashboard.sh` logic.

## When to run

- Daily 08:00 local (registered via `skills/cron-scheduler`)
- On demand: `gbrain reports run kos-patrol` (once wired) or direct
  `bun run skills/kos-jarvis/kos-patrol/run.ts`

## Phases

### Phase 1 — Inventory
- `gbrain list --json` → total pages, distribution by `kind`
- Count by `confidence` (high/medium/low)
- Count pages with `status=draft` and `status=deprecated`

### Phase 2 — Lint
- Invoke `kos-lint` skill (6-check)
- Capture counts per severity

### Phase 3 — Staleness
For each page with `kind in {decision, protocol, project}`:
- If `updated > 180d ago` AND `status=active`: mark stale
- If page has `review_after` frontmatter and that date is past: mark overdue

### Phase 4 — Gap detection
Heuristic: find frequently-mentioned entities without their own page.
- `gbrain extract links --dir ~/brain` first (refresh link graph)
- For each entity name appearing ≥3 times across pages but no entity page
  exists → "missing entity" gap

### Phase 5 — Dashboard write
Write to `~/brain/agent/dashboards/knowledge-health-<YYYY-MM-DD>.md`:
```markdown
# Knowledge Health — 2026-04-16

## Inventory
- Total pages: 85
- By kind: source=57, concept=13, project=5, ... (from Phase 1)
- Compilation rate (this week): 63%
- Confidence: high=12, medium=45, low=28

## Issues
- 2 ERROR from kos-lint (see below)
- 7 stale pages (updated >180d, status=active)
- 4 overdue review triggers
- 3 missing entity pages (mentioned ≥3 times)

## Recently compiled (last 7 days)
- [concept:context-engineering] grade=A, 4 impact links
- [source:alignment-faking] grade=B, 2 impact links
- ...
```

### Phase 6 — MEMORY digest emit
Emit a **short** MEMORY-format block that `digest-to-memory` skill later
appends to `~/.openclaw/workspace/MEMORY.md`:
```
[knowledge-os] 2026-04-16 patrol: 85p / 63% compile-rate / 2 lint-ERROR.
  Recent: context-engineering (A), alignment-faking (B).
  Gaps: 3 entities missing pages. Stale: 7 pages >180d.
```

Written to `~/brain/agent/digests/patrol-<date>.md` (one block per day).
The `digest-to-memory` skill picks up the latest on Sun 22:00 and pushes
to OpenClaw MEMORY.

## Output contract

- ERROR count > 0 → exit 1 (so autopilot can halt)
- WARN count > 0 → exit 2
- Clean → exit 0
- In all cases: dashboard + digest files written

## Delegates

- `kos-lint/SKILL.md` for the six-check
- `confidence-score/SKILL.md` for per-page scoring
- `digest-to-memory/SKILL.md` for MEMORY reflux (Week 3)
