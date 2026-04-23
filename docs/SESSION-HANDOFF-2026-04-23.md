# Next-session handoff — Steps 1/1.5/1.6 landed, Step 2 queued

> 2026-04-23 | written after a continuous session that executed audit +
> correction + Step 1.5 (slug normalization) + Step 1.6 (round-trip
> sanity). **Read this first.** Then `docs/JARVIS-ARCHITECTURE.md` §6.8
> + §6.9, then `docs/FILESYSTEM-CANONICAL-EXPORT-AUDIT.md`, then
> `skills/kos-jarvis/TODO.md`, then `CLAUDE.md`.

---

## 1. What last session shipped (three commits)

Continuous session; all on top of `3684a91`:

| Commit | Scope |
|---|---|
| `bf7e794` | `docs(kos-jarvis): filesystem-canonical step 1 audit (GO with 4 blockers)` — initial audit + §6.8 + TODO update. |
| `b4dd4c6` | `docs(kos-jarvis): correct audit §5.2 — lint shim withdrawn, step plan tightened` — corrected own reading of `src/commands/lint.ts`; planned "Step 1.5 lint shim" withdrawn. |
| `<pending>` | `docs + feat(kos-jarvis): slug normalize skill + Step 1.5/1.6 execution` — new `slug-normalize` skill, applied 7 slug renames + 1 body rewrite, ran round-trip-check (1829/1829 clean), wrote §6.9, this handoff. |

Net result: **all 3 pre-migration blockers for filesystem-canonical are
cleared**. Only Step 2 (multi-week /ingest flip) remains.

---

## 2. Current state (runtime)

### Versions / git
- Fork master: **(three commits ahead of `3684a91`)** — verify with
  `git log --oneline -4`.
- Rollback tags: `pre-sync-v0.17`, `pre-sync-v0.15.1`, `pre-sync-v0.14`.
- `gbrain --version` → `0.17.0`.
- `@electric-sql/pglite`: 0.4.4 (fork override vs upstream 0.4.3).

### Services (all green)
`launchctl list | grep jarvis` — expect:
- `com.jarvis.kos-compat-api` UP (PID > 0, serves `kos.chenge.ink`)
- `com.jarvis.gemini-embed-shim` UP (port 7222)
- `com.jarvis.cloudflared` UP (tunnel)
- `com.jarvis.notion-poller` loaded, PID `-` (5-min StartInterval; PID
  will appear during an active cycle)
- `com.jarvis.kos-patrol` / `enrich-sweep` / `kos-deep-lint` loaded,
  PID `-` (cron-driven, normal idle state)

### Database
- `~/.gbrain/brain.pglite` schema v16, **1829 pages** (continues to grow
  via 5-min Notion poll).
- Rolling backup: `~/.gbrain/brain.pglite.pre-slug-normalize-<ts>` (285 MB,
  pre-Step-1.5 known-good state). Per "one rolling backup" policy, keep
  until the next DB-write operation evicts it.

### New skill
- `skills/kos-jarvis/slug-normalize/` — SKILL.md + run.ts + roundtrip-check.ts.
  Single-purpose: the one-shot KOS slug normalization for Step 1.5. Not
  intended for future reuse; keep around as a reference for DB-write
  safety protocol.

---

## 3. Recommended next session — Step 2 first micro-step

**Step 2** is the actual filesystem-canonical flip. Multi-week scope.
Don't try to do it all at once. The right first micro-step is
**Step 2.1 — decide + document the brain-dir strategy**. Pure design
work, zero code/DB risk.

### Decisions needed before writing any code

1. **Brain-dir location.** Candidates:
   - `~/brain/` — simple, outside the fork; mirror of what upstream
     users do. But `~/brain/agent/{dashboards,digests,reports}/` is
     already used by kos-patrol + slug-normalize reports — naming
     collision if brain content lands at `~/brain/*.md`.
   - `~/brain-source/` or `~/.gbrain-content/` — sibling path that
     avoids the agent/ collision.
   - Inside this fork at `knowledge/` — git-track alongside the fork.
     Clean but couples the brain content's git history with the fork's.

2. **Frontmatter on `gbrain sync` re-import.** Round-trip check proved
   `kind:` survives — but does `gbrain sync`'s incremental path also
   preserve it? Step 1.6 tested the pure functions; `sync.ts` may have
   its own code path. Worth a throwaway-dir sanity: export a handful
   of pages, drop into a fresh dir, `gbrain init` + `gbrain sync`,
   check the re-imported rows.

3. **Notion-poller and /ingest target**. Once filesystem-canonical
   lands, `kos-compat-api /ingest` writes a `.md` file under
   `<brain-dir>/sources/notion/<slug>.md` and then calls
   `gbrain sync <brain-dir>`. The poller can either:
   (a) HTTP-POST to /ingest as today (server writes file), or
   (b) write the file itself and skip /ingest entirely.
   (b) removes the last in-process spawn of `gbrain import`, which is
   the Path-C P1 in §7 of the architecture doc.

4. **kos-patrol output path**. If `~/brain/` becomes canonical brain
   content, patrol's dashboards need to move elsewhere (e.g.
   `~/.gbrain/reports/` or the fork's `reports/` dir).

5. **git strategy for the brain dir.** Private repo? Part of this
   fork? Symlinked-in-fork pattern? Affects whether `gbrain dream
   --pull` makes sense.

### Recommended first session's deliverable

Write `docs/STEP-2-BRAIN-DIR-DESIGN.md` covering the 5 decisions above,
a migration runbook sketch (not executed), and a minimal end-to-end
smoke: export 10 sample pages to a throwaway dir, `gbrain sync` them,
diff the re-imported rows against the originals. Use this to validate
the sync path before committing to a real cutover.

**Do NOT execute the /ingest flip yet**. That's Step 2.2+ and spans
multiple sessions.

---

## 4. Other P1/P2 live in TODO.md (unchanged this session)

- **P1** — kos-compat-api `/ingest` HTTP 500 on some Notion pages
  (e.g. `password-hashing-on-omada`). Still unreproduced; run a targeted
  curl + read `gbrain import` error path.
- **P1** — upstream `gbrain#332` orchestrator bug (cosmetic doctor
  warning; data side is correct).
- **P1** — Path C: refactor `kos-compat-api` to import in-process.
  Naturally solved if Step 2 goes filesystem-canonical; can be deferred
  until that decision lands.
- Candidates from handoff §4 of the prior generation that are
  still open: orphan reducer (brain_score lever), evidence-tag
  backfill (unblocks confidence-score from all-low floor). Both are
  one-session scope and independent of the filesystem-canonical track.

---

## 5. Safety tripwires (cumulative learnings)

- **`launchctl bootout` needs `gui/$UID/…` domain** for user-level
  LaunchAgents. `user/$UID/…` reports success but leaves PIDs alive.
- **`launchctl bootstrap` on already-loaded services** returns
  `Input/output error 5`. Benign. Check state via `launchctl list |
  grep jarvis`, not the bootstrap exit code.
- **`launchctl disable ≠ bootout ≠ unload`.** `disable` prevents future
  cron fires, doesn't stop current PID. `bootout` stops PID. Always use
  both + check `lsof ~/.gbrain/brain.pglite` before DB writes.
- **PGLite WASM `Aborted()`** = data dir corruption. Restore from
  rolling backup immediately; don't attempt `gbrain doctor` or `gbrain
  init` first.
- **`bun install`** auto-runs `gbrain apply-migrations --yes` via
  postinstall. Back up + disable services first.
- **`gbrain export --help`** has no help dispatch — unknown flags
  silently ignored. Always pass `--dir <path>` explicitly.
- **Config keys in DB** are lost on DB restore. After any
  `brain.pglite` restore, re-run `gbrain config set writer.lint_on_put_page true`.
- **Never SIGTERM a PGLite writer.** If something looks wedged, `^C`
  the top-level command, not the downstream process.

---

## 6. Bootstrap checklist (first commands in fresh session)

```bash
# 1. Environment sanity
git log --oneline -4                # three commits after 3684a91
git status                          # clean

# 2. DB health (same known-good cosmetic warnings as before)
gbrain doctor --fast | head -12     # schema v16, ~70/100

# 3. Live Notion ingest still flowing
tail -5 workers/notion-poller/poller.stdout.log
launchctl list | grep notion-poller   # last-exit 0

# 4. Quality gates
bun run skills/kos-jarvis/evidence-gate/run.ts sweep --json | python3 -c "import json,sys; print('total:', json.load(sys.stdin)['total'])"   # 1829+ (growing)

# 5. slug-normalize is idempotent — verifying it re-runs clean proves DB state
bun run skills/kos-jarvis/slug-normalize/run.ts --verify   # should print "ok": true

# 6. Quick read of the directional doc
head -25 docs/FILESYSTEM-CANONICAL-EXPORT-AUDIT.md
```

If any step fails, stop and diagnose. The rolling backup
`~/.gbrain/brain.pglite.pre-slug-normalize-<ts>` is the documented
recovery point.

---

## 7. Explicit don'ts

- **Don't modify upstream `src/*`.** Fork policy.
- **Don't execute Step 2 (/ingest flip) without writing the design doc
  first** (Step 2.1 per §3 above). The design has 5 open decisions;
  getting any wrong costs more than the design session saves.
- **Don't re-run slug-normalize `--apply`** — it's idempotent and will
  report "SKIP already applied" for every row, but the rolling backup
  gets overwritten if you re-run the safety protocol. Waste of the
  known-good recovery point.
- **Don't run `bun install`** without the full safety protocol
  (disable services + backup).
- **Don't SIGTERM PGLite writers.**
- **Don't bundle Step 2.1 (design) with Step 2.2 (execute) in one
  session.** They're separate for a reason — design decisions deserve
  an uninterrupted window.

---

## 8. When finished with next session

1. Update `skills/kos-jarvis/TODO.md` with Step 2.1 results + new
   follow-ups discovered.
2. If the design doc produces architectural-level decisions, append
   a §6.10 section to `docs/JARVIS-ARCHITECTURE.md`.
3. **Delete this file** — its job is done once read.
4. Single commit for the doc changes.
5. Write a new handoff only if the next session has fresh context.

Exactly one rolling backup in `~/.gbrain/` at any time per user policy.
