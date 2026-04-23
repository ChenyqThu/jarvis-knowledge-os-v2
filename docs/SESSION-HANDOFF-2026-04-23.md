# Next-session handoff — post filesystem-canonical Step 1 audit

> 2026-04-22 end-of-session (late night) | written for the next fresh Claude session.
> **Read this first.** Then `docs/JARVIS-ARCHITECTURE.md` §6.8, then
> `docs/FILESYSTEM-CANONICAL-EXPORT-AUDIT.md`, then `skills/kos-jarvis/TODO.md`,
> then `CLAUDE.md`.

---

## 1. What last session shipped

Two commits on top of `3684a91` (the prior handoff):

1. **`bf7e794`** — `docs(kos-jarvis): filesystem-canonical step 1 audit (GO with 4 blockers)`
   - Ran `gbrain export` on the full 1786-page brain (read-only, 0 data risk).
   - Produced `docs/FILESYSTEM-CANONICAL-EXPORT-AUDIT.md` (298+ lines).
   - Added architecture §6.8; updated TODO + §7 P1 anchor.
   - Retired `docs/SESSION-HANDOFF-2026-04-22.md`.

2. **`<pending commit at handoff time>`** — `docs(kos-jarvis): correct audit §5.2 — lint shim plan withdrawn, step renumbering`
   - Discovered mid-session that the "placeholder-date false-positive on `[E3]`/`[10]+`"
     analysis was wrong. Real rule matches literal `YYYY-MM-DD` / `XX-XX` only
     (`src/commands/lint.ts:70`). Real footprint ~3-5 legitimate template-string
     hits, not a system-wide problem.
   - Also confirmed `gbrain dream` invokes lint via inline dynamic import
     (`src/core/cycle.ts:349-352`), so CLI wrappers don't intercept it anyway.
   - Result: Step 1.5 "lint shim" plan withdrawn. Step numbering collapsed
     from 1.5/1.6/1.7/2 → 1.5/1.6/2.

Net change: **3 real blockers + cleaner plan**, not 4. And the plan is tighter.

---

## 2. Current state (runtime)

### Versions
- Fork master: **(two commits ahead of `3684a91`)** — verify with `git log --oneline -3`.
- Rollback tags: `pre-sync-v0.17`, `pre-sync-v0.15.1`, `pre-sync-v0.14`.
- `gbrain --version` → `0.17.0`.
- `@electric-sql/pglite`: 0.4.4 (fork override).

### Services (all green)
`launchctl list | grep jarvis` — expect:
- `com.jarvis.kos-compat-api` UP (serves `kos.chenge.ink`)
- `com.jarvis.gemini-embed-shim` UP (port 7222)
- `com.jarvis.cloudflared` UP (tunnel)
- `com.jarvis.notion-poller` UP (Path B direct-bun)
- `com.jarvis.kos-patrol` / `enrich-sweep` / `kos-deep-lint` idle-between-cron (PID `-`, exit 0)

### Database
- `~/.gbrain/brain.pglite` schema v16
- Pages: **1786+** (growing via 5-min Notion poll)
- Chunks: ~3304, Embedded: 100%
- Links: ~385 (0 strong links yet — dikw-compile phase 2 not done)
- Timeline: ~5443 entries
- Brain score: **56/100** (embed 35/35, links 5/25, timeline 4/15, orphans 2/15, dead-links 10/10)
- Rolling backup: `~/.gbrain/brain.pglite.pre-v0.17-sync-1776896571` (schema v4, pre-migration — per "one rolling backup" policy)

### Quality gate helpers (all green)
All three `run.ts` helpers iterate the full brain via `_lib/brain-db.ts`:
```bash
bun run skills/kos-jarvis/evidence-gate/run.ts sweep --json | jq '.total'   # ~1786
bun run skills/kos-jarvis/confidence-score/run.ts sweep | head -4            # all low (expected)
bun run skills/kos-jarvis/dikw-compile/run.ts sweep | head -4                # 907 source, 0 A/B (expected)
```

---

## 3. Real outstanding blockers (3, not 4)

From audit report §5 after correction:

### 5.1 Slug hygiene (7 root-level strays + 262 `id: >-` legacy pages)
- `ai-jarvis`, `ingest-1776470181089`, 5× `<domain>-<path>` slug URLs → belong under `concepts/` or `sources/`.
- 262 pages carry legacy YAML block-scalar `id: >-` from pre-fix Notion poller. Parseable, ugly, causes diff churn on round-trip.
- **Fix scope**: one-time script to rewrite slugs + clean id field, then re-extract links. ~100 LOC + careful DB write.

### 5.3 type/kind 27% drift (487 pages)
- Upstream `PageType` enum doesn't carry `person`/`company`/etc — we encode them via `kind:`.
- 375 people have `type: entity, kind: person`; 85 companies `type: entity, kind: company`; 27 misc.
- Not a bug. Just needs a round-trip verification that re-importing markdown preserves `kind:` (upstream only reads `type:`).

### 5.4 Legacy `id: >-` (folded into 5.1 for practical rewrite)
Same rewrite pass handles slugs and `id:` cleanup together.

**Not blockers (despite what an earlier draft of the audit claimed):**
- ~3-5 legitimate `placeholder-date` findings — hand-patch the bodies, no shim needed.
- `gbrain dream` needing brain-dir — that IS the migration, not a separable blocker.

---

## 4. Recommended next-session starting move

**Step 1.5 — Slug + `id: >-` bulk normalization.** ~1-2 h. DB write, so
safety protocol matters.

### Mandatory safety protocol (learned from v0.17 WASM incident)

```bash
# 1. Hard-disable every DB-writing launchd service (not just unload).
for svc in notion-poller kos-compat-api kos-patrol enrich-sweep kos-deep-lint; do
  launchctl disable user/$UID/com.jarvis.$svc
  launchctl bootout user/$UID/com.jarvis.$svc 2>/dev/null
done
launchctl list | grep jarvis   # only gemini-embed-shim + cloudflared should remain

# 2. Fresh rolling backup (deletes prior backup per "one rolling backup" policy).
ts=$(date +%s)
rm -f ~/.gbrain/brain.pglite.pre-*
cp -R ~/.gbrain/brain.pglite ~/.gbrain/brain.pglite.pre-slug-normalize-$ts

# 3. Verify no live process holding the lock.
lsof ~/.gbrain/brain.pglite | head -5   # should be empty or at most the backup
```

### The rewrite itself

Write `skills/kos-jarvis/slug-normalize/run.ts` (new skill dir) that:
1. Opens PGLite via `_lib/brain-db.ts` (direct reader) then a direct write handle.
2. Reads all pages with flat slug (no `/`) or frontmatter `id: >-` form.
3. For each, computes normalized slug + id:
   - Root strays: `ai-jarvis` → `concepts/ai-jarvis`, ingest URLs → `sources/<url-slug>`.
   - `id: >-` cleanup: unwrap the multiline block-scalar to a quoted one-liner.
4. Runs `UPDATE pages SET slug=... , frontmatter=jsonb_set(...)` in a transaction.
5. Emits a diff report to `~/brain/agent/reports/slug-normalize-<date>.md`.
6. `--dry-run` prints plan without writing. `--apply` actually writes.

Pair with body rewrites: every `[[old-slug]]` wikilink pointing to a renamed
page needs updating too. Use `gbrain extract links --source db --dry-run`
pre + post to audit link breakage.

### Re-enable services (only after verification)

```bash
# Sanity: DB opens + page count preserved
gbrain doctor --fast | head -8
bun run skills/kos-jarvis/evidence-gate/run.ts sweep --json | jq '.total'   # should still be 1786+

# Re-enable everything
for svc in notion-poller kos-compat-api kos-patrol enrich-sweep kos-deep-lint; do
  launchctl enable user/$UID/com.jarvis.$svc
  launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.jarvis.$svc.plist
done
launchctl list | grep jarvis   # all green
```

### Rollback plan if anything goes sideways

```bash
launchctl disable user/$UID/com.jarvis.{notion-poller,kos-compat-api,kos-patrol,enrich-sweep,kos-deep-lint}
mv ~/.gbrain/brain.pglite ~/.gbrain/brain.pglite.failed-$ts
mv ~/.gbrain/brain.pglite.pre-slug-normalize-$ts ~/.gbrain/brain.pglite
# verify, then re-enable services
```

---

## 5. Step 1.6 (next-next session) — round-trip sanity

After slug normalization lands:
```bash
gbrain export --dir /tmp/rt-test
gbrain init --pglite --path /tmp/rt-pglite   # throwaway
# ... import /tmp/rt-test, then SQL diff kind/status/confidence/source_of_truth
```
Proves `kind:` survives round-trip. ~1 h.

**Don't merge this session's TODO with Step 1.6 — keep them separate.** The
whole point of the audit was to bound risk per step.

---

## 6. Bootstrap checklist (first commands in fresh session)

```bash
# 1. Environment sanity
git log --oneline -3                  # two commits after 3684a91
git status                            # clean

# 2. DB health
gbrain doctor --fast | head -12       # schema v16, known-good cosmetic warnings

# 3. Live Notion ingest still flowing
tail -5 workers/notion-poller/poller.stdout.log
launchctl list | grep notion-poller   # last-exit 0

# 4. Quality gates still work
bun run skills/kos-jarvis/evidence-gate/run.ts sweep --json | jq '.total'  # 1786+
bun run skills/kos-jarvis/kos-lint/run.ts 2>&1 | tail -10                  # no new ERRORs

# 5. Quick read
head -60 docs/FILESYSTEM-CANONICAL-EXPORT-AUDIT.md   # verdict + 3 blockers
```

If any step fails, stop and diagnose before new work.

---

## 7. Explicit don'ts (same as prior handoff + new ones)

- **Don't modify upstream `src/*`.** Fork policy — file upstream issues instead.
- **Don't re-enable `gbrain dream`** until Step 2 /ingest flip lands.
- **Don't run `bun install` on a live brain** without first `launchctl disable`-ing DB services + taking backup (postinstall auto-runs `gbrain apply-migrations`).
- **Don't SIGTERM a PGLite writer.** If a migration seems wedged, interrupt from the top (Ctrl-C the foreground command), not with `kill -9` on downstream processes.
- **Don't attempt Step 1.5 without the full safety protocol in §4.** v0.17 sync session lost 6 hours to a WASM corruption from skipping the `launchctl disable` step.
- **Don't try to bundle Step 1.5 + 1.6 in one session.** They're separate for a reason — each needs its own verification window.

---

## 8. When finished with next session

1. Update `skills/kos-jarvis/TODO.md` — check off Step 1.5, add Step 1.6 details.
2. If the work produced architectural drift, append a §6.9 to `docs/JARVIS-ARCHITECTURE.md`.
3. **Delete this file** — its job is done once read.
4. Single commit for the doc changes.
5. Write a new handoff doc only if the next session carries fresh context.

Exactly one rolling backup in `~/.gbrain/` at any time per user policy.
