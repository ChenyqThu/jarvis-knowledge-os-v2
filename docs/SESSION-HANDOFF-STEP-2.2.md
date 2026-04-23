# Next-session handoff — Step 2.1 design locked, Step 2.2 queued

> 2026-04-23 | written after Step 2.1 brain-dir design pinned + committed
> (`98c9bd2`). **Read this first.** Then
> `docs/STEP-2-BRAIN-DIR-DESIGN.md` §4 Step 2.2 block, then
> `skills/kos-jarvis/TODO.md`, then `CLAUDE.md`.

---

## 1. What last session shipped (one commit)

Commit `98c9bd2` on master — pure-design follow-through on
`2372922` (Steps 1.5 + 1.6). Zero code / DB / launchd touches.

| File | Net |
|---|---|
| `docs/STEP-2-BRAIN-DIR-DESIGN.md` | new, 501 lines — the cold-start design doc for Step 2 |
| `docs/JARVIS-ARCHITECTURE.md` | +74: new §6.10 recording Step 2.1 landed; §6 `/status` caveat (line 164) fixed |
| `skills/kos-jarvis/TODO.md` | +38: Step 2.1 done marker; Step 2.2 / 2.3 / 2.4 sub-bullets |
| `docs/SESSION-HANDOFF-2026-04-23.md` | deleted (§8 self-sunset; context folded into the design doc) |

Net: **all pre-execution design for filesystem-canonical locked.** Step
2.2 opens as a 1-2 h execution session.

---

## 2. Current state (runtime)

### Versions / git

- Fork master: `98c9bd2` — verify with `git log --oneline -5`.
- Rollback tags: `pre-sync-v0.17`, `pre-sync-v0.15.1`, `pre-sync-v0.14`.
- `gbrain --version` → `0.17.0`.
- `@electric-sql/pglite`: 0.4.4 (fork override vs upstream 0.4.3).

### Services (all green, same as prior session)

`launchctl list | grep jarvis` — expect:
- `com.jarvis.kos-compat-api` UP (PID > 0, serves `kos.chenge.ink`)
- `com.jarvis.gemini-embed-shim` UP (port 7222)
- `com.jarvis.cloudflared` UP (tunnel)
- `com.jarvis.notion-poller` loaded, PID `-` (5-min `StartInterval`;
  PID appears during active cycle)
- `com.jarvis.kos-patrol` / `enrich-sweep` / `kos-deep-lint` loaded,
  PID `-` (cron-driven idle)

### Database

- `~/.gbrain/brain.pglite` schema v16, **1829+ pages** (continues to
  grow via 5-min Notion poll — verify via `gbrain stats`, not
  `/status`; `/status` still shows 100 until Step 2.2 rewrites it).
- Rolling backup: `~/.gbrain/brain.pglite.pre-slug-normalize-1776921434`
  (285 MB, schema v16, 1829-page pre-Step-1.5 state). Keep until the
  next DB-write operation evicts it (expected at Step 2.2 start —
  new backup will be `pre-step2.2-<ts>`).

### Current `~/brain/` layout (critical for Step 2.2)

```
~/brain/
├── agent/                                ← will rename to .agent/
│   ├── dashboards/   2× md
│   ├── digests/      2× md
│   └── reports/      4× md
└── raw/web/          1× md (no frontmatter — decide in Step 2.2)
```

**9 total .md files, zero knowledge content.** All dashboards / digests /
reports lack frontmatter — they would pollute `sync-failures.jsonl` if
synced without the rename.

---

## 3. Recommended next session — Step 2.2 execution

**Step 2.2 = `/ingest` filesystem-canonical flip + `.agent/` rename +
`/status` direct-DB rewrite.** 1-2 h focused session. All pre-design
done. Roadmap in `docs/STEP-2-BRAIN-DIR-DESIGN.md §4` is the
authoritative runbook.

### Execution sequence (do NOT skip steps)

1. **Preflight smoke** — run the 30-min throwaway-dir sync fidelity
   test first. Script at `docs/STEP-2-BRAIN-DIR-DESIGN.md §5`. Block
   on any column diff between live DB and throwaway DB.

2. **Safety protocol** (identical to slug-normalize per
   `FILESYSTEM-CANONICAL-EXPORT-AUDIT.md §7`):
   ```bash
   for svc in notion-poller kos-compat-api kos-patrol enrich-sweep \
              kos-deep-lint; do
     launchctl disable user/$UID/com.jarvis.$svc
     launchctl bootout gui/$UID/com.jarvis.$svc 2>/dev/null || true
   done
   launchctl bootout gui/$UID/com.jarvis.cloudflared
   lsof ~/.gbrain/brain.pglite                       # must be empty

   rm -rf ~/.gbrain/brain.pglite.pre-*               # evict prior
   cp -R ~/.gbrain/brain.pglite \
         ~/.gbrain/brain.pglite.pre-step2.2-$(date +%s)
   ```

3. **One-shot directory rename**:
   ```bash
   mv ~/brain/agent ~/brain/.agent
   ```

4. **Edit 5 files** (see design doc §3 Decision 3 + 4):
   - `server/kos-compat-api.ts:handleIngest` — swap
     `spawnSync("gbrain import", [stage])` for
     `writeFileSync(~/brain/<dir>/<slug>.md) + spawnSync("gbrain sync",
     ["--repo", "~/brain"])`
   - `server/kos-compat-api.ts:handleStatus` + `handleDigest` —
     replace `gbrain list` shell-out with direct `BrainDb` reads via
     `skills/kos-jarvis/_lib/brain-db.ts`
   - `skills/kos-jarvis/kos-patrol/run.ts` — `~/brain/agent/` →
     `~/brain/.agent/`
   - `skills/kos-jarvis/enrich-sweep/run.ts` — same
   - `skills/kos-jarvis/slug-normalize/run.ts` — report output path
   - `workers/notion-poller/run.ts:30` — `STATE_PATH` default

5. **First-time brain dir registration**:
   ```bash
   gbrain sync --repo ~/brain               # writes sync.repo_path to config
   gbrain config get sync.repo_path         # verify
   ```

6. **Reload services**:
   ```bash
   for svc in gemini-embed-shim kos-compat-api cloudflared \
              notion-poller kos-patrol enrich-sweep kos-deep-lint; do
     launchctl enable gui/$UID/com.jarvis.$svc
     launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.jarvis.$svc.plist
   done
   ```

7. **Sanity checks**:
   ```bash
   TOKEN=$(grep -o '[a-f0-9]\{64\}' \
           ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist | head -1)
   curl -s -H "Authorization: Bearer $TOKEN" \
     http://127.0.0.1:7220/status | jq .total_pages   # expect 1829+, not 100
   curl -s -H "Authorization: Bearer $TOKEN" \
     http://127.0.0.1:7220/ingest \
     -d '{"markdown":"# test page","title":"step-2.2-smoke","source":"manual","kind":"source"}' \
     -H "Content-Type: application/json"
   ls ~/brain/sources/                                  # expect new .md
   ```

8. **Commit** (single):
   ```
   feat(kos-jarvis): Step 2.2 — /ingest filesystem-canonical flip
   ```

### Edge case left open from Step 2.1 design

`~/brain/raw/web/2026-04-21-ai-economy-disruption-dual-jarvis.md` has
no frontmatter. `isSyncable()` only skips **dot-prefixed** `.raw/` —
plain `raw/` passes through and would YAML-parse-fail. Two choices
(decide at Step 2.2 start, don't defer):
- (a) `mv ~/brain/raw ~/brain/.raw` — symmetric with `.agent/`, hides
  the file from sync. Simplest.
- (b) add frontmatter to the file making it a valid `kind: source` page.
  Preserves the signal but more effort.

### Verification before declaring Step 2.2 done

- `/status` returns `total_pages: 1829+` (not 100)
- `/ingest` smoke payload creates file at `~/brain/sources/...` +
  DB row visible in `gbrain list | grep <slug>`
- notion-poller's next 5-min cycle lands pages at
  `~/brain/sources/notion/<slug>.md` (check filesystem after
  poll fires)
- `gbrain doctor --fast` score stays 70+ (no new failures; only the
  known cosmetic resolver + v0.13.0 partial warnings)
- `~/.gbrain/sync-failures.jsonl` remains empty or only has
  pre-existing entries

---

## 4. Other P1/P2 live in TODO.md (unchanged from last session)

- **P1** — kos-compat-api `/ingest` HTTP 500 on some Notion pages
  (e.g. `password-hashing-on-omada`). Still unreproduced; Step 2.2's
  file-write path may change the failure signature — re-test after
  the flip.
- **P1** — upstream `gbrain#332` orchestrator bug (cosmetic doctor
  warning; data side correct). Watch for upstream merge.
- ~~**P1** — Path C: refactor `kos-compat-api` to import in-process.~~
  **Solved by Step 2.2** — switching from `gbrain import` to
  `gbrain sync` eliminates the lock-contention root cause.
- Candidates still open: orphan reducer (brain_score lever),
  evidence-tag backfill (unblocks confidence-score from all-low
  floor). Both one-session scope, independent of filesystem-canonical.

---

## 5. Safety tripwires (cumulative)

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
- **`gbrain list --limit`** is silently capped at 100 rows by upstream.
  For full counts use `gbrain stats` or direct `BrainDb.listAllPages()`.
- **Config keys in DB** are lost on DB restore. After any
  `brain.pglite` restore, re-run
  `gbrain config set writer.lint_on_put_page true` +
  `gbrain config set sync.repo_path ~/brain` (post-Step-2.2).
- **Never SIGTERM a PGLite writer.** If something looks wedged, `^C`
  the top-level command, not the downstream process.
- **Step 2.2 also needs `lsof ~/.gbrain/brain.pglite` empty** BEFORE
  running `gbrain sync --repo ~/brain` the first time. The poll cycle
  may hold the lock if services aren't bootout'd.

---

## 6. Bootstrap checklist (first commands in fresh session)

```bash
# 1. Environment sanity
git log --oneline -5                # 98c9bd2 at HEAD, four commits after 3684a91
git status                          # clean

# 2. DB health (same known-good cosmetic warnings as before)
gbrain doctor --fast | head -12     # schema v16, ~70/100

# 3. Live Notion ingest still flowing
tail -5 workers/notion-poller/poller.stdout.log
launchctl list | grep notion-poller # last-exit 0

# 4. Quality gates
bun run skills/kos-jarvis/evidence-gate/run.ts sweep --json | \
  python3 -c "import json,sys; print('total:', json.load(sys.stdin)['total'])"
# expect: 1829+ (growing)

# 5. slug-normalize idempotent verify
bun run skills/kos-jarvis/slug-normalize/run.ts --verify
# expect: "ok": true

# 6. Directional docs
head -25 docs/STEP-2-BRAIN-DIR-DESIGN.md
head -20 skills/kos-jarvis/TODO.md

# 7. Current ~/brain/ state (must match §2 above before Step 2.2)
find ~/brain -maxdepth 2 -type d
find ~/brain -name "*.md" | wc -l   # expect 9
```

If any step fails, stop and diagnose. Rolling backup
`~/.gbrain/brain.pglite.pre-slug-normalize-1776921434` is the
documented recovery point.

---

## 7. Explicit don'ts

- **Don't modify upstream `src/*`.** Fork policy.
- **Don't skip Step 2.2's preflight smoke** — a surprise sync frontmatter
  regression after the `/ingest` flip costs much more than 30 min of
  upfront testing.
- **Don't bundle Step 2.2 (execute) with Step 2.3 (dream cron) in one
  session.** Let Step 2.2 live through one full notion-poller cycle
  + one kos-patrol cycle before adding dream on top.
- **Don't run `bun install`** without the full safety protocol
  (disable services + backup).
- **Don't SIGTERM PGLite writers.**
- **Don't re-run slug-normalize `--apply`** — idempotent but wastes
  the rolling backup. `--verify` is safe.
- **Don't `git commit` per ingest** — git is deferred to the +14-day
  Step 2.4 checkpoint, with batched-commit strategy designed then.
- **Don't use `/status` for page count** until Step 2.2 rewrites it —
  use `gbrain stats` or the evidence-gate sweep.

---

## 8. When finished with next session

1. Update `skills/kos-jarvis/TODO.md` — mark Step 2.2 done, keep Step
   2.3 + 2.4 open.
2. Append `docs/JARVIS-ARCHITECTURE.md §6.11` recording the Step 2.2
   execution (lessons learned, any protocol drift captured).
3. **Delete this file** (`docs/SESSION-HANDOFF-STEP-2.2.md`) — its
   job is done once read. Context that survives migrates to the
   design doc or architecture doc.
4. Single commit for the code changes; a second commit only if docs
   drifted during execution.
5. Write a new handoff only if Step 2.3 prep has fresh context.

Exactly one rolling backup in `~/.gbrain/` at any time per user policy.
