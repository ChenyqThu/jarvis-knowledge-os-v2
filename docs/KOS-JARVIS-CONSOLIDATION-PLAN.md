# KOS-Jarvis ↔ GBrain v0.25.0 Consolidation Plan

> **Owner**: Lucien
> **Created**: 2026-05-02 (post v0.25.0 sync)
> **Cadence**: Re-evaluate after every upstream sync that lands a feature
> potentially overlapping a fork skill (next checkpoint: v0.26.0)
> **Companion docs**: [`skills/kos-jarvis/README.md`](../skills/kos-jarvis/README.md)
> (fork-local boundary), [`JARVIS-ARCHITECTURE.md §6.20`](JARVIS-ARCHITECTURE.md#620-upstream-v0250-sync-2026-05-01)
> (v0.25.0 sync story)

## 1. Why this exists

`skills/kos-jarvis/` started as a 16-dir extension pack on top of GBrain
to bring KOS v1 capabilities forward (DIKW compile, E0-E4 evidence
gates, 9 KOS page kinds, lint, patrol, MEMORY reflux to OpenClaw, bulk
entity sweep, Feishu/Notion bridges, Gemini embedding shim). Three
months and 12 upstream releases later, GBrain itself shipped a lot
that overlaps. This document maps each fork skill to its v0.25.0
upstream counterpart, classifies the overlap, and lays out a
deprecation timeline with risk register so the fork shrinks instead
of bloats.

The fork README itself codifies the rule: **"扩展应随时间自愿退场,
而非永久膨胀"** (`skills/kos-jarvis/README.md:84`). This plan operationalizes
that rule for the v0.25.0 baseline.

## 2. Scope

In-scope: every directory under `skills/kos-jarvis/` (16 with
SKILL.md + 2 helpers `_lib/` and `templates/`), the deployed launchd
plists that reference them, and the 32 upstream skills shipped in
v0.25.0.

Out-of-scope:
- `kos-compat-api` (`server/kos-compat-api.ts`) — that's the stable
  external HTTP boundary, governed by the [`SESSION-HANDOFF`](.) docs
  separately.
- `workers/notion-poller/` — implementation of `notion-ingest-delta`
  contract; lives outside the skill pack by design.
- `dream-wrap` deletion — even if upstream `gbrain dream` covers most
  of the cycle work, the launchd archive symlink + exit-code
  translation contract is still fork-unique value (see §4 row 4).

## 3. Executive summary

| Bucket | Count | Action |
|---|---|---|
| **Keep — fork-unique** | 7 | Permanent or until upstream abstracts the gap |
| **Keep — partial overlap, fork value justified** | 3 | Trim to KOS-unique surface; lean on upstream for the rest |
| **Archive — one-shot done** | 2 | Move to `skills/kos-jarvis/_archive/` after acceptance check |
| **Pilot retire — upstream covers ≥80%** | 1 | Run pilot test, then retire if regression-clean |
| **Spec-only, code lives elsewhere** | 1 | Cross-link to actual implementation, drop SKILL.md |
| **Helpers (no SKILL.md)** | 2 | `_lib/` + `templates/` keep |

Net target: **16 active skill dirs → 11 active + 2 archived + 1 retired**
by next sync (v0.26.0 window).

## 4. Inventory matrix

Columns:
- **Fork skill** — directory under `skills/kos-jarvis/`
- **Wired** — `launchd` (cron), `imported` (TS import), `manual` (CLI
  only), `docs` (no runtime), `one-shot` (already executed once)
- **Upstream cover** — ✓ full / ◐ partial / ○ none
- **Upstream feature** — closest GBrain v0.25.0 equivalent
- **Decision** — see §5 categories
- **Notes** — key tension or rationale

| # | Fork skill | Wired | Cover | Upstream feature | Decision | Notes |
|---|---|---|---|---|---|---|
| 1 | `gemini-embed-shim` | launchd persistent (PID 63403, port 7222) | ○ | none — `src/core/embedding.ts` hardcodes `new OpenAI()` | **KEEP** unique | Provider-neutrality bridge. Retire only if upstream adds an embedding provider abstraction (no signal yet — file an issue?) |
| 2 | `_lib/brain-db.ts` | imported by 9 fork callers | ○ | `BrainEngine` interface (but heavyweight, MCP-bounded) | **KEEP** unique | Direct PGLite/Postgres reader, bypasses MCP 100-row cap. v0.25.0 added 5 eval-method mirrors as safety net (§6.20). |
| 3 | `feishu-bridge` | docs only | ○ | none — OpenClaw integration is fork-specific | **KEEP** unique | Migration manifest for `~/.openclaw/workspace/skills/knowledge-os/`. No runtime; doesn't bloat. |
| 4 | `dream-wrap` | launchd daily 03:11 | ◐ | `gbrain dream --json` (v0.17+, 8 phases in v0.23) writes its own archive | **KEEP** partial — fork value is launchd-glue + exit-code translation + `latest.json` symlink | Wrap is ~100 lines and survives clean. Fold the archive logic into upstream as a `gbrain dream --archive-dir` flag in a follow-up PR. |
| 5 | `url-fetcher` | imported by `server/kos-compat-api.ts` | ○ | none — upstream `ingest` skill assumes caller fetches | **KEEP** unique | UltimateSearchSkill bridge for X/Twitter + FlareSolverr-protected sites. kos-compat-api specific. |
| 6 | `pending-enrich` | docs (queue schema) — producer = OpenClaw, consumer = `enrich-sweep` | ○ | upstream `signal-detector` is per-message inline | **KEEP** unique | OpenClaw Feishu bridge contract; deferred-batch mode is the inverse of upstream's per-message inline. |
| 7 | `digest-to-memory` | manual (planned weekly Sun 22:00, not yet wired in cron) | ○ | none — KOS → OpenClaw `MEMORY.md` 回流 | **KEEP** unique | Cross-system reflux; upstream has no equivalent because OpenClaw is a downstream of the fork. |
| 8 | `enrich-sweep` | launchd weekly Sun 22:13 | ◐ | upstream `enrich` covers per-entity (Tier 1/2/3 via Tavily) | **KEEP** partial — bulk-mode value | SKILL.md self-acknowledges "IS the bulk-mode variant; does not fork the logic, wraps it". Justified. |
| 9 | `orphan-reducer` | manual weekly | ◐ | `gbrain orphans` only **detects**; v0.23 `patterns` phase finds themes, not edges | **KEEP** partial — Haiku-classified active reduction | Different concept from upstream patterns phase; reduces orphan count by inserting typed edges. |
| 10 | `dikw-compile` | manual (designed to run after ingest skills, **not wired**) | ◐ | upstream `auto-link` post-hook on `put_page` exists but uses generic `link_type='related'` | **KEEP** partial — KOS-unique 4 link types (supplements/contrasts/implements/extends) + A/B/C/F compile grade | **Action**: verify wire status; if dormant, decide whether to revive or archive. |
| 11 | `evidence-gate` | manual (designed as `put_page` interceptor, **not wired**) | ◐ | upstream uses `confidence: high\|med\|low` frontmatter | **KEEP** partial — 5-level (E0-E4) per-claim + per-kind threshold is finer-grained | **Action**: same wire-status check as #10. Likely advisory-only today. |
| 12 | `confidence-score` | manual (called by dikw-compile + kos-patrol, both partially wired) | ◐ | overlapping; upstream `enrich` writes `confidence: high\|med\|low` | **KEEP** partial — KOS 4-input formula + compile-grade rollup | Lightweight; keeps as opt-in formula. |
| 13 | `kos-patrol` | launchd daily 08:07 | ◐ | upstream `maintain` covers stale/orphan/dead-link/cross-ref/backlinks/citations/filing/tags; `gbrain doctor` covers health score | **KEEP** trimmed — Phase 5 (dashboard MD) + Phase 6 (digest emit) are fork-unique outputs | Phases 1-4 (inventory/lint/staleness/gap) ~70% covered by `gbrain doctor` + `gbrain orphans` + `maintain`. Migrate where redundant. |
| 14 | `kos-lint` | called by `kos-patrol`; manual standalone | ◐ | 4 of 6 checks covered: frontmatter (`frontmatter-guard`), dup-id (TBD), dead-links (`gbrain doctor`), orphans (`gbrain orphans`) | **PILOT RETIRE** — checks 1+3+4 fold into upstream; checks 5 (weak links) + 6 (evidence gap) are KOS-unique | See §6 pilot plan |
| 15 | `frontmatter-ref-fix` | one-shot manual (already executed, ERRORs 4→0 per TODO) | ◐ | `frontmatter-guard` covers 7 mechanical classes; `gbrain doctor --fix` exists | **ARCHIVE** — task done | `frontmatter-guard` does NOT cover v1-wiki legacy `../X/Y.md` style. Keep dormant in `_archive/` for any future v1-import re-runs. |
| 16 | `slug-normalize` | one-shot manual (already executed, 7 strays renamed) | ✓ | `gbrain frontmatter audit` flags `SLUG_MISMATCH`; `gbrain put` renames | **ARCHIVE** — task done | Backup-safety protocol in SKILL.md is generic, worth preserving as historical reference. |
| 17 | `notion-ingest-delta` | docs (contract only — actual code in `workers/notion-poller/`) | ○ | upstream `ingest` is a router; no Notion-specific delta | **REWRITE-AS-LINK** | SKILL.md is design contract, not runtime. Replace with a 5-line cross-link to `workers/notion-poller/run.ts` + `kos-compat-api /ingest` extension docs. |
| 18 | `templates/` (helper) | reference | ○ | upstream `_brain-filing-rules.md` covers 20-dir MECE | **KEEP** as reference | KOS 9-type page templates; complementary to upstream filing rules. |

## 5. Decision categories

### 5.1 KEEP — unique value (7)

`gemini-embed-shim`, `_lib/brain-db.ts`, `feishu-bridge`,
`url-fetcher`, `pending-enrich`, `digest-to-memory`, `templates/`.

These exist because upstream has zero equivalent, AND that gap is
unlikely to close near-term (provider-abstracted embed needs core
refactor; OpenClaw integration is fork-specific by definition;
templates are KOS-flavor). No timeline action; revisit if upstream
ever lands a competing feature.

### 5.2 KEEP — partial overlap, justified (4)

`dream-wrap`, `enrich-sweep`, `orphan-reducer`, `dikw-compile` /
`evidence-gate` / `confidence-score` (the KOS quality triad).

Each adds a layer upstream doesn't: launchd glue + exit-code map for
dream-wrap; bulk-mode for enrich-sweep; active reduction (not just
detection) for orphan-reducer; KOS 4-link-type vocabulary + 5-level
evidence + compile-grade for the quality triad.

**Required action for the quality triad**: verify they're actually
wired into the ingest pipeline. Fork README (`README.md:30-40`)
claims dikw-compile "Runs after idea-ingest / media-ingest /
meeting-ingestion", but the upstream `ingest` skill is unaware of
fork skills. Either (a) wire via a cron post-step, (b) wire via a
local CLAUDE.md hook, or (c) downgrade to "advisory only, run on
demand". Decision pending.

### 5.3 ARCHIVE — one-shot done (2)

`frontmatter-ref-fix`, `slug-normalize`.

Both ran once, achieved their goal, and have no recurring schedule.
Move to `skills/kos-jarvis/_archive/<skill>/` (preserve git history)
+ add a one-line README pointer at `skills/kos-jarvis/README.md`. If
a similar v1-import wave ever happens again, restore from archive.

### 5.4 PILOT RETIRE — upstream covers ≥80% (1)

`kos-lint`. See §6 for the pilot plan. Net: retire if pilot proves
upstream + small KOS-specific shim covers ≥95% of current ERROR/WARN
output without regression.

### 5.5 REWRITE-AS-LINK — spec migrated (1)

`notion-ingest-delta`. Convert SKILL.md to a 5-line redirect
pointing at `workers/notion-poller/run.ts` (actual implementation)
and `server/kos-compat-api.ts` `/ingest` (the extended endpoint).
The current SKILL.md is just frozen design notes; the code lives
elsewhere.

## 6. Pilot test plan: `kos-lint` ↔ `gbrain doctor` + `frontmatter-guard`

### 6.1 Hypothesis

`kos-lint` 6-check output can be reproduced by:
- Check 1 (frontmatter required fields) → `gbrain frontmatter audit --json`
- Check 2 (duplicate id) → currently no upstream coverage; needs TODO
- Check 3 (dead internal links) → `gbrain doctor` `dead-links` component
  + `gbrain extract links` pass
- Check 4 (orphans) → `gbrain orphans --count`
- Check 5 (weak links) → **NO upstream coverage** — KOS-specific
  (link budget 2-5 / page, type annotation requirement)
- Check 6 (evidence gap) → **NO upstream coverage** — KOS-specific
  (E0-E4 frontmatter)

If checks 5+6 are extracted to a tiny `kos-quality` shim (~150 LOC),
the rest can route to upstream commands.

### 6.2 Pilot procedure

1. **Baseline capture**: run current `kos-lint` (full 6-check) on
   the live brain. Store JSON output: `~/brain/.agent/reports/kos-lint-baseline-<ISO>.json`.
2. **Upstream coverage capture**: run `gbrain frontmatter audit --json`
   + `gbrain doctor --json` + `gbrain orphans --json --count`. Store
   to `~/brain/.agent/reports/upstream-coverage-<ISO>.json`.
3. **Diff analysis**: for each ERROR + WARN in baseline, find the
   corresponding signal in upstream coverage. Tag each as
   `covered_identical` / `covered_equivalent` / `covered_drift` /
   `not_covered`.
4. **Decision matrix**:
   - If `not_covered` ⊆ {check 5, check 6}: extract those two checks
     into `skills/kos-jarvis/kos-quality/` (~150 LOC), retire
     `kos-lint/`.
   - If `not_covered` includes anything else: file the gap as an
     upstream issue (or fork PR), do NOT retire `kos-lint` until
     resolved.
   - If `covered_drift` is significant (different counts on same
     check): investigate which is correct; likely upstream is
     authoritative now.

### 6.3 Pilot acceptance

- Pilot complete when `~/brain/.agent/reports/kos-lint-pilot-decision.md`
  exists, naming the decision (retire / partial / abort) with evidence.
- If retire: `kos-patrol` rewires Phase 2 to call `kos-quality`
  instead of `kos-lint`; SKILL.md updated; old `kos-lint/` archived.

### 6.4 Estimated effort

- Pilot run: 1 h
- Extract `kos-quality` shim (if pilot passes): 2-3 h
- Cron rewire + smoke: 30 min
- Total: ~4 h

## 7. Deprecation timeline

Tied to upstream sync cadence. Each milestone is conditional on
the upstream sync landing cleanly first (no rush).

### Milestone M1 — v0.25.0 baseline (this plan)

- [x] Audit complete (this doc)
- [ ] Wire-status check for `dikw-compile`, `evidence-gate`,
  `confidence-score` (1 h research + decision)
- [ ] Pilot test for `kos-lint` retirement (4 h, see §6)
- [ ] Archive `frontmatter-ref-fix` + `slug-normalize` to
  `skills/kos-jarvis/_archive/` (30 min)
- [ ] Rewrite `notion-ingest-delta/SKILL.md` as 5-line redirect (15 min)

Total fresh effort: ~6 h research + 30 min cleanup. Spread over 1-2
sessions.

### Milestone M2 — next upstream sync (v0.26.x window, est 2-3 weeks)

- [ ] Re-evaluate any KEEP-partial that gained upstream coverage in
  the new release
- [ ] If `kos-lint` pilot passed at M1, retire it; cron rewire
- [ ] If `dikw-compile`/`evidence-gate` chose "advisory only" path:
  remove cron-mention from kos-patrol Phase 2; document opt-in CLI
  invocation
- [ ] Audit M2 deltas vs this plan; update §4 matrix

### Milestone M3 — provider abstraction probe (no fixed date)

- [ ] If upstream lands an embedding provider abstraction (not in v0.25.0
  roadmap signals; would be a major refactor), retire
  `gemini-embed-shim` in the next sync after the abstraction lands.
- [ ] Until then: `gemini-embed-shim` is permanent.

### Milestone M4 — v0.26.0 +60d retro

- [ ] Was the consolidation worth it? Compare line counts, cron
  failure rates, and "do I remember what this skill does" check
  before/after.
- [ ] Update fork README's `当前状态` section.

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pilot retire of `kos-lint` misses a check upstream silently dropped | Medium | Medium | Diff JSON output rigorously; do not retire if `not_covered` includes anything outside checks 5+6 |
| `dream-wrap` archive logic + upstream's CycleReport diverge after a future `gbrain dream` revision | Low | Low | Wrap reads the documented JSON shape (`CycleReport.schema_version: "1"` is stable per §6.20); add a regression test that pins archive shape |
| Archived `frontmatter-ref-fix` or `slug-normalize` not findable when next v1-import wave happens | Low | Low | Symlink the archived dirs from `skills/kos-jarvis/README.md` "前置工具" section |
| Wire-check on dikw-compile reveals it never ran in production → KOS quality story is fictional | Medium | High | If true, openly document the gap. Either (a) revive via cron, (b) honestly downgrade to "designed but unwired", (c) remove. **Don't pretend it works.** |
| Fork drift on a KEEP skill that becomes unmaintainable | Low | Medium | Cap fork-skill TS to ≤500 LOC; if exceeded, refactor or merge upstream PR |
| Notion-ingest-delta SKILL.md redirect loses design rationale that future contributor needs | Low | Low | Move the design rationale to a brief comment in `workers/notion-poller/run.ts` header before deleting SKILL.md |
| OpenClaw side breaks if `digest-to-memory` schedule slips | Low | Low | OpenClaw's MEMORY 近期层 is append-only; missing a week is invisible. Wire via cron-scheduler when convenient. |

## 9. Out of scope (intentional non-goals)

- **Upstream PR submissions**. This plan identifies overlap; pushing
  fork value back upstream (e.g. a `gbrain dream --archive-dir` flag)
  is a separate workstream gated on PR-acceptance bandwidth.
- **OpenClaw skill refactor**. Even if the fork shrinks, the
  OpenClaw side at `~/.openclaw/workspace/skills/knowledge-os/` is
  governed by `feishu-bridge/SKILL.md` separately.
- **Schema migrations**. Fork doesn't ship its own DB migrations;
  all schema follows `garrytan/gbrain` `src/core/migrate.ts`.
- **`brain-db.ts` extraction to upstream**. The 5 eval-method mirror
  in `_lib/brain-db.ts` (added v0.25.0) is fork-internal safety net;
  no plan to push upstream because upstream's `BrainEngine` is the
  canonical surface and BrainDb is consciously the
  bypass-MCP-100-row-cap escape hatch.

## 10. Acceptance criteria

This plan is "complete" when:

- [ ] §4 matrix is reviewed by Lucien (1-pass eyeball, 15 min)
- [ ] M1 milestone TODO checkboxes are filed in
  `skills/kos-jarvis/TODO.md` as P1 items (5 entries)
- [ ] Each KEEP-partial's "wire status verification" has a result
  written into `skills/kos-jarvis/README.md`'s `当前状态` section
- [ ] `kos-lint` pilot decision lands at
  `~/brain/.agent/reports/kos-lint-pilot-decision.md`
- [ ] At least one item from §5.3 (archive) actually moved to
  `skills/kos-jarvis/_archive/`
- [ ] Next session-handoff note links back to this plan as the
  governing document for fork shape decisions

## 11. References

- `skills/kos-jarvis/README.md` — fork-local boundary statement
- `skills/kos-jarvis/PLAN-ADJUSTMENTS.md` — early migration deviations
- `skills/kos-jarvis/TODO.md` — live work tracker
- [`docs/JARVIS-ARCHITECTURE.md §6.20`](JARVIS-ARCHITECTURE.md#620-upstream-v0250-sync-2026-05-01)
  — v0.25.0 sync story (capture decision, BrainDb safety net)
- `CLAUDE.md` (project root) — fork upstream policy + fork-specific rules
- `garrytan/gbrain` upstream `CLAUDE.md` — canonical Key Files list,
  consumed via cherry-pick + monthly sync (per `CLAUDE.md` policy)

---

*This plan is a living document. Re-evaluate after every upstream
sync that lands a feature potentially overlapping a fork skill.
Each evaluation should append a dated entry to §7 Milestone log
showing what was reconsidered and why.*
