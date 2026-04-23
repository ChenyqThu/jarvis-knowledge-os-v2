# Next-session handoff — post v0.17 sync + quality gates

> 2026-04-22 end-of-session | written for the next fresh Claude session.
> **Read this first.** Then `docs/JARVIS-ARCHITECTURE.md`, then
> `skills/kos-jarvis/TODO.md`, then `CLAUDE.md`.

---

## 1. Current state snapshot (runtime)

### Versions
- Fork master: `9d410ec` (pushed / local — verify on load with `git log -1`)
- Rollback tags: `pre-sync-v0.17` (02efe73, pre-merge), `pre-sync-v0.15.1`, `pre-sync-v0.14`
- `gbrain --version` → `0.17.0`
- `@electric-sql/pglite`: **0.4.4** (fork override; upstream still pins 0.4.3)

### Services (`launchctl list | grep jarvis`)

| Plist | Port | Status | Notes |
|---|---|---|---|
| `com.jarvis.gemini-embed-shim` | 7222 | UP | Gemini embedding translator (1536-dim base64) |
| `com.jarvis.kos-compat-api` | 7220 | UP | v1 HTTP contract: `/status /query /ingest /digest` |
| `com.jarvis.cloudflared` | 7220→public | UP | `kos.chenge.ink` tunnel |
| `com.jarvis.notion-poller` | n/a | UP (Path B) | **Direct bun, no minions wrapper.** 5-min cron, `launchctl enable`'d |
| `com.jarvis.kos-patrol` | n/a | Disabled | `launchctl disable` applied this session |
| `com.jarvis.enrich-sweep` | n/a | loaded | cron-driven, not recently run |
| `com.jarvis.kos-deep-lint` | n/a | loaded | cron-driven, not recently run |

### Database
- Path: `~/.gbrain/brain.pglite` (grows with every 5-min Notion poll)
- **Schema: v16** (latest)
- Pages: **1779+**, Chunks: **3304**, Embedded: **100%**
- Links: **385** (all `mentions`/`related_to` — 0 strong links)
- Timeline: **5443** entries
- Brain score: **56/100** (embed 35/35, links 5/25, timeline 4/15, orphans 2/15, dead-links 10/10)
- Rolling backup: `~/.gbrain/brain.pglite.pre-v0.17-sync-1776896571` (schema v4, pre-migration)

### Tokens / env (do NOT commit)
- `KOS_API_TOKEN` in `~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist` (bearer for `kos.chenge.ink`)
- `OPENAI_API_KEY=stub-for-gemini-shim` (placeholder; shim ignores)
- `OPENAI_BASE_URL=http://127.0.0.1:7222/v1`
- `writer.lint_on_put_page=true` (restored this session after DB restore wiped it)

### Orchestrator ledger
- `~/.gbrain/migrations/completed.jsonl` shows:
  - v0.11, v0.12, v0.12.2, v0.13.1, v0.14.0, v0.16.0 — **complete**
  - v0.13.0 — **partial** (upstream #332 — `process.execPath` resolves to bun on our install, `bun extract` fails)
- `gbrain doctor` will permanently warn `MINIONS HALF-INSTALLED (partial migration: 0.13.0)`. Cosmetic. Data side manually compensated via `gbrain extract links --source db --include-frontmatter`.

### Resolution
- `which gbrain` → `/Users/chenyuanquan/.bun/bin/gbrain` (symlink → `src/cli.ts`; bun-runtime install, not compiled binary)

---

## 2. What the last session (2026-04-22) accomplished

Two big pieces in one session:

### A. Upstream v0.17.0 sync
- Merged `garrytan/gbrain@55ca498` (v0.17.0 — `gbrain dream` + `runCycle` + schema v16 `gbrain_cycle_locks`).
- Schema v4 → v16 via **manual ALTER + `gbrain init --migrate-only`** (PGLITE_SCHEMA_SQL's `idx_links_source` index assumes v11's link_source column; chicken-and-egg on upgrade from v4).
- **WASM corruption incident mid-session** — a `launchctl unload`'d `notion-poller` service was still firing on its 5-min cron because `unload ≠ disable`. It held the PGLite lock, died ungracefully, corrupted the WASM page cache. Restored from pre-migration backup, redid manual ALTER + migrate + extract. Zero data loss.
- **Path B for notion-poller**: retired `scripts/minions-wrap/notion-poller.sh`; plist now directly invokes `bun run workers/notion-poller/run.ts`. No outer `gbrain jobs submit --follow` holder = no lock deadlock. 2 consecutive live cycles verified clean.
- `gbrain dream` **not wired** — it assumes a filesystem brain dir as source-of-truth; we're DB-native with Notion as input. See TODO P1 for the filesystem-canonical migration that would enable dream.
- Pglite pin stays 0.4.4 (upstream still 0.4.3).
- `bun test`: 1997 pass / 19 fail (all upstream tests, not fork-local).
- Docs: `§6.7` in `JARVIS-ARCHITECTURE.md` has the full post-mortem.

### B. Quality gates + kos-lint full-brain coverage
- New shared lib `skills/kos-jarvis/_lib/brain-db.ts` — direct PGLite reader (open → query → close). Bypasses the MCP `list_pages` 100-row clamp so quality skills can iterate all 1779 pages.
- `skills/kos-jarvis/evidence-gate/run.ts` — port KOS v1 E0-E4 thresholds. `check <slug>` + `sweep [--kind N]`. Draft/deprecated bypass.
- `skills/kos-jarvis/confidence-score/run.ts` — high/medium/low scoring. Currently all `low` because ~0 pages have evidence_summary populated.
- `skills/kos-jarvis/dikw-compile/run.ts` — A/B/C/F grade based on outgoing strong-link count. **Analysis-only** (doesn't write links). Current brain: 902 source pages → 0 A, 0 B, 28 C, 874 F (0% compilation — needs Haiku classifier pass).
- `skills/kos-jarvis/kos-lint/run.ts` refactor:
  - Dead-link resolver tries dir-prefixed + flat slug (fixes ../sources/foo.md false positives).
  - Migrated from `gbrain list` + `gbrain get` (100-row cap + per-page subprocess) to BrainDb cache. Covers all 1780 pages in one pass.
  - `gbrain config get` gracefully returns `""` on Config-key-not-found (DB-restore paths may not carry the key).
  - `--check 3` now truly forces the check even when BrainWriter lint is active.
  - Before → after dead-link check: **419 → 35** (-92%).
  - Full lint signal on 1780 pages: 4 frontmatter errors, 1653 orphans, 54 weak/1 over-budget links, 29 evidence gaps.

---

## 3. Direction agreed with user

**KOS v2 is the source of truth. Notion is ONE input source (alongside Feishu, manual ingest, etc.)**

This implies:
- The filesystem should be canonical (.md files on disk as knowledge primary). DB is a derived cache.
- Upstream `gbrain dream` becomes applicable once filesystem is canonical.
- Karpathy LLM-wiki pattern: markdown files as the wiki, self-maintaining via dream + git.
- We continue inheriting upstream updates.

This is the **P1 anchor** for the next few sessions. See `TODO.md` P1 "Filesystem-canonical migration" for the ~1 week sketch (multi-session, not one).

---

## 4. Outstanding work — priority queue

Pull from `skills/kos-jarvis/TODO.md` for ground truth. High-ROI candidates for next session:

### Highest ROI (pick one, don't try all)

**A. Filesystem-canonical migration — Step 1: export dry-run** (½-day)
- `gbrain export --dir /tmp/brain-export-preview` (verify command exists via `gbrain export --help`)
- Inspect resulting tree structure + frontmatter fidelity
- Note per-kind dir placement (people/ companies/ concepts/ projects/ sources/notion/ etc.)
- Identify frontmatter shape issues BEFORE committing to full migration
- Outcome: a go/no-go decision + concrete issue list

**B. Orphan reducer** (~200 LOC + Haiku calls, 1 session)
- Biggest single brain_score lever (orphans 2/15 → 10+/15 = +8 points)
- New `skills/kos-jarvis/orphan-reducer/run.ts`: use BrainDb to list orphans, query vector-similar pages, Haiku classifier proposes wikilinks, emit diff report. `--apply` flag to actually add links via `gbrain link`.
- 1653 orphans is daunting but bounded (cap 100/run, multiple passes).

**C. Evidence-tag backfill** (semi-automated)
- 76 pages flagged `warn` by evidence-gate (active/compiled status, no evidence_summary).
- Haiku pass that reads page body + proposes `evidence_summary.primary` + 1-3 claims; user reviews batch; script writes via `gbrain put-page` or direct frontmatter edit.
- Pushes evidence-gate `warn` → `pass` + lifts confidence-score coverage.

### Lower ROI but useful

- **`/ingest` HTTP 500 on password-hashing-on-omada** — reproduce, read the import error path.
- **dikw-compile phase 2-4 (Haiku-classified strong-link proposals + auto-write)** — converts current 0 A/B to some A/B. Agent-driven or batch.
- **kos-patrol refresh** — its 6-phase protocol SKILL.md still describes `~/brain/agent/dashboards/` output. Verify those paths and rollup numbers still make sense post-v0.17.

### Explicit don'ts

- **Don't attempt full filesystem-canonical migration in one session.** It's multi-day.
- **Don't modify upstream `src/*`.** Fork policy — file upstream issues instead (#332 is still open).
- **Don't re-enable `gbrain dream`** until the filesystem migration is at least through step A above.
- **Don't run `bun install` on a live brain without first backing up + unloading DB services** — postinstall hook auto-runs `gbrain apply-migrations`.
- **Don't SIGTERM a PGLite writer.** The v0.15.1 and v0.17 sync sessions both recovered from this pattern; don't repeat.

---

## 5. Safety tripwires (learned this session)

- **`launchctl unload ≠ disable`.** Unload stops current activity but the plist remains registered; its `StartInterval` keeps firing fresh instances. Use `launchctl disable user/$UID/com.jarvis.X` for any DB-adjacent migration work. Re-enable with `launchctl enable` + `launchctl bootout` + `launchctl bootstrap`.
- **PGLite WASM `Aborted()` = the data dir is toast.** Restore from backup immediately; don't attempt `gbrain doctor`, `gbrain init`, etc.
- **`gbrain list` MCP op caps at 100 rows** (`clampSearchLimit(limit, 50, 100)` in `src/core/operations.ts`). For full-brain iteration use `BrainDb.listAllPages()` or any command using `engine.listPages({ limit: 100000 })`.
- **`bun install` auto-runs `gbrain apply-migrations --yes`** via postinstall. Unload DB services + back up before.
- **Config keys in the DB** (e.g. `writer.lint_on_put_page`) are lost on DB restore. Re-run `gbrain config set writer.lint_on_put_page true` after any PGLite restore. Same for any other config set via `gbrain config set`.

---

## 6. Bootstrap checklist (first commands to run)

```bash
# 1. Confirm we're where the handoff claims
git log --oneline -1                  # expect 9d410ec or newer
git status                            # should be clean

# 2. Confirm DB opens and is at v16
gbrain doctor --fast | head -8        # schema_version: 16, 1779+ pages

# 3. Confirm Path B poller is alive
launchctl list | grep notion-poller   # last-exit 0
tail -5 workers/notion-poller/poller.stdout.log

# 4. Confirm quality gate helpers work
bun run skills/kos-jarvis/evidence-gate/run.ts sweep --json | jq '.total'  # expect 1779+
bun run skills/kos-jarvis/confidence-score/run.ts sweep | head -4
bun run skills/kos-jarvis/dikw-compile/run.ts sweep | head -4
```

If any fails, stop and diagnose before new work.

---

## 7. When finished with this session's work

1. Update `skills/kos-jarvis/TODO.md` with done markers + any new items.
2. Append a new `§6.8` section to `docs/JARVIS-ARCHITECTURE.md` describing what landed.
3. **Delete this file** — its job is done once read.
4. Single commit for the doc changes.
5. Write a new handoff doc if the next session has its own context.

Exactly one rolling backup in `~/.gbrain/` at any time per user policy. If you take a new one, delete the previous.
