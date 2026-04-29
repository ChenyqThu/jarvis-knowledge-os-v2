# Session Handoff — Post v0.22.8 Sync

> **Date**: 2026-04-29 (early morning, ~03:45 local)
> **From**: Lucien × Claude (post-v0.22.4 sync execution)
> **To**: next Claude Code session picking up Jarvis KOS v2
> **Supersedes**: [`SESSION-HANDOFF-2026-04-27-evening-sweep-complete.md`](SESSION-HANDOFF-2026-04-27-evening-sweep-complete.md)

---

## 0. 速读

上一 session 把上游 9 个 minor (v0.20.4 → v0.22.8) 全部 sync 到 fork
master,production schema 从 v24 → v29,brain 在 v0.22.8 baseline 下健康
运行。**fork 三个 patch 中有一个被关闭** (`pglite-schema.ts` #370 / v0.22.6.1),
`pglite-engine.ts` 的 WAL patch + `cli.ts` 的 +x 保留。

合并 commit: `811c266`。Phase A→D 全部完成,新 TODO.md 写完。

**This session's surprise findings** (新 P1):
- 6 个 zombie `gbrain sync` 子进程持有 PGLite lock 长达 4-12 小时,
  累计 200-700 min CPU。SIGTERM 不响应,SIGKILL 才释放。**这解释了
  之前 kos-compat-api `/ingest` 偶发 500 timeout 的根因** — production
  cron 的某个 wrapper 没回收子进程。
- v0.21.0 后 doctor 的 `graph_coverage` 报 0%(尽管实际 8229 links +
  11084 timeline 条目都在),可能新指标走 `code_edges_*` 表,需要 `gbrain
  link-extract` 重建。

---

## 1. Current state (2026-04-29 03:45 local)

| Layer | Status |
|---|---|
| Engine | PGLite 0.4.4 (fork-pinned), schema **v29** |
| Pages | 2117 (was 2118 morning of 4-27, -1 drift over 2 days) |
| Chunks | 4023 (100% embedded) |
| Links | 8229 (+4 since 4-27 evening close) |
| Timeline | 11084 |
| Orphans | unchanged from 4-27 close (732); not re-counted today |
| brain_score | 85/100 stable |
| doctor health | 85/100 (3 PGLite-quirk WARN + new graph_coverage WARN, no FAIL) |
| Upstream sync | **v0.22.8** (was v0.20.4); commit `811c266` |
| Production endpoint | `kos.chenge.ink` → cloudflared → :7225 (kos-compat-api PID 72344) |
| Embed shim | :7222 gemini-embedding-2-preview (PID 2502) |

### Running services (`launchctl print gui/$UID`)

All 9 services healthy:
- `com.jarvis.kos-compat-api` PID 72344 (re-bootstrapped post-cutover)
- `com.jarvis.gemini-embed-shim` PID 2502
- `com.jarvis.cloudflared` PID 2505
- `com.jarvis.notion-poller` (idle, will fire next 5min cron)
- `com.jarvis.dream-cycle` (idle, daily 03:11 — already ran today at 03:11Z = 4-29 03:11)
- `com.jarvis.kos-patrol` (idle, daily)
- `com.jarvis.enrich-sweep` (idle)
- `com.jarvis.kos-deep-lint` (idle, weekly Mon)
- `com.jarvis.star-office-ui-backend` (unrelated)

### Fork-local patches state

| File | What | Status |
|---|---|---|
| `src/core/pglite-schema.ts` idx_pages_source_id | **DROPPED** (closed by v0.22.6.1) | upstream verbatim restored |
| `src/core/pglite-engine.ts:89` `pg_switch_wal()` | RETAINED | macOS 26.3 WASM persistence — upstream doesn't address |
| `src/cli.ts` mode 0755 | RETAINED | bun shim symlink |

---

## 2. What the previous session did

[`docs/JARVIS-ARCHITECTURE.md §6.17`](JARVIS-ARCHITECTURE.md#617-upstream-v0228-sync-2026-04-29-commit-811c266)
has the full story. Summary:

- **Phase 0 (5 min)** — diagnosed kos-compat-api `-9` from launchctl print
  as the legitimate `:7220 → :7225` cutover sequence (commit `05046c4`).
  Not a bug.
- **Phase A (15 min)** — `/tmp/gbrain-changelog-peek` smoke against a
  453MB copy of production brain.pglite. Confirmed v0.22.6.1's
  `applyForwardReferenceBootstrap()` walks v24 → v29 cleanly. Side
  effect discovered: v0.11.0's autopilot orchestrator unconditionally
  installs `com.gbrain.autopilot` launchd which conflicts with our
  brain dir. Mitigation: not needed today (v0.11.0 ledger was already
  `complete` from 2026-04-22), but for future first-runs set
  `gbrain config set minion_mode off` BEFORE `apply-migrations`.
- **Phase B (~20 min)** — `git merge upstream/master`. 7 files
  auto-merged, 3 manual (package.json, bun.lock, pglite-schema.ts).
  Commit `811c266`. **Surprise**: `bun install` to regenerate
  `bun.lock` triggered `postinstall` hook = `gbrain apply-migrations
  --yes --non-interactive` against PRODUCTION brain. Worked fine
  thanks to v0.22.6.1 bootstrap; production schema went 24 → 29
  inside Phase B (v0.21.0 + v0.22.4 ledger entries at 07:13:32 UTC).
- **Phase C (~30 min)** — bootouted 6 jarvis services, took
  550MB PGLite snapshot at `~/.gbrain/brain.pglite.pre-sync-v0.22.8-1777447016`,
  ran doctor (schema=29 ✓), bootstrapped services back. **Surprise**:
  `gbrain stats` initially timed out on lock — investigation surfaced
  6 zombie `gbrain sync` subprocesses (PIDs 23625/36238/57969/58201/62243/70599)
  with 200-700 min CPU each. SIGTERM ignored; SIGKILL released. Production
  /status 200 in 298ms, /query (Chinese) 200 in 11.7s.
- **Phase D (~10 min)** — wrote `§6.17`, this handoff, new TODO.md,
  updated `v018-pglite-upgrade-fix.md` with closed-by-v0.22.6.1
  status check.

---

## 3. Next session: what to do

### Step 1: production health re-check

```bash
TOKEN=$(grep -o '[a-f0-9]\{64\}' ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist | head -1)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7225/status | jq .total_pages
# expect: 2117 + N (N depends on hours since handoff; notion-poller writes ~1-3/cycle)

bun run src/cli.ts doctor 2>&1 | grep -E "Health score|FAIL|WARN"
# expect: 85/100, 0 FAIL, ~3-4 WARN (pgvector/jsonb_integrity = PGLite-quirk; graph_coverage = NEW, see TODO P2)

ls -t ~/brain/.agent/dream-cycles/ | head -1
# expect: 2026-04-29T10:11:xxZ (today's 03:11 local cycle)
```

### Step 2: address new P1 — zombie sync subprocesses

The 6 zombies SIGKILLed during Phase C are gone, but the **source** that
spawns them is still active. Hunt:

```bash
# A. Check whether new zombies are accumulating
pgrep -lf 'gbrain sync.*--no-pull' | head

# B. Find what cron / launchd job spawns them (check time-of-day pattern)
launchctl print gui/$UID 2>&1 | grep -E "kos-deep-lint|notion-poller|dream-cycle" | head -5
# Look for the one that calls `gbrain sync` directly without timeout

# C. Read each cron's wrapper script
cat scripts/launchd/com.jarvis.kos-deep-lint.plist.template
ls scripts/launchd/ | grep -v plist
```

Hypothesis ordered by likelihood:
1. **`com.jarvis.kos-deep-lint`** — it's the OLDEST cron (weekly Monday).
   The wrapper may shell `gbrain sync --no-pull` somewhere; if it hangs
   on lock contention, launchd's StartCalendarInterval re-fires next
   week, accumulating zombies.
2. **`workers/notion-poller/run.ts`** — Path B retired the minion-wrap,
   but the run.ts itself may shell `gbrain sync` for cleanup. With
   2026-04-23 commit `444cc81` it should NOT, but verify.
3. **OpenClaw cron** in `~/.openclaw/workspace/` — outside this repo,
   but worth checking. `~/.openclaw/workspace/skills/knowledge-os/SKILL.md`
   may issue `gbrain sync --no-pull` from a cron entry.

Fix: add `timeout 600 gbrain sync ...` (or wrapper-level Promise.race)
to whichever site is the leak. Monitor 1 week.

### Step 3: graph_coverage 0% mystery

doctor reports `graph_coverage: Entity link coverage 0%, timeline 0%.
Run: gbrain link-extract && gbrain timeline-extract` despite 8229 links
+ 11084 timeline entries existing in DB. v0.21.0 added new `code_edges_*`
tables; the metric may have re-defined. Try the suggested commands and
see if the metric updates:

```bash
bun run src/cli.ts link-extract 2>&1 | tail -10
bun run src/cli.ts timeline-extract 2>&1 | tail -10
bun run src/cli.ts doctor 2>&1 | grep graph_coverage
```

If still 0% after extract, file upstream issue (probably new metric
counts only the v0.21.0 chunk-level edges, not page-level frontmatter
edges).

### Step 4 (optional): CHUNKER_VERSION 3→4 cost preview

```bash
bun run src/cli.ts reindex-code --dry-run 2>&1 | tail -20
```

The `sources.chunker_version` gate forces a full re-walk on next
`gbrain sync`. Markdown bodies likely cache-hit on embedding (we have
4023 chunks already embedded), so cost should be small. Run preview
when you have time to know in advance.

### Step 5 (optional): unfinished calendar checkpoints

| Date | Action |
|---|---|
| 2026-05-04 (5 days) | Stage 4 v1 archive: move `com.jarvis.kos-api.plist.bak` to `~/Library/LaunchAgents/_archive/`, archive v1 GitHub repo |
| 2026-05-07 (8 days) | Step 2.4 commit-batching review |
| 2026-05-25 (26 days) | Re-evaluate Gemini 3072-dim embeddings vs current 1536-dim truncation |
| Trigger-based | PGLite → Postgres switch — `docs/UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md` |

---

## 4. Where to look (file map)

### Entry points
- [`CLAUDE.md`](../CLAUDE.md) — fork preamble + upstream context
- [`skills/kos-jarvis/README.md`](../skills/kos-jarvis/README.md) — extension pack scope
- **THIS FILE** — start here
- [`skills/kos-jarvis/TODO.md`](../skills/kos-jarvis/TODO.md) — fresh post-v0.22.8 TODO
- [`docs/JARVIS-ARCHITECTURE.md`](JARVIS-ARCHITECTURE.md) — full architecture, **§6.17 = most recent**

### Recent decision artifacts
- [`docs/UPSTREAM-PATCHES/v018-pglite-upgrade-fix.md`](UPSTREAM-PATCHES/v018-pglite-upgrade-fix.md) — annotated CLOSED 2026-04-29
- [`docs/UPSTREAM-PATCHES/v018-pglite-wal-durability-fix.md`](UPSTREAM-PATCHES/v018-pglite-wal-durability-fix.md) — still active
- [`docs/UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md`](UPSTREAM-PATCHES/v020-pglite-postgres-evaluation.md) — read before Postgres switch

---

## 5. Day-zero checks (sandbox-aware)

```bash
# 1. service health
launchctl print gui/$(id -u) 2>&1 | grep com.jarvis | head -10

# 2. brain stats (run in fork repo dir, with sandbox bypass if needed)
bun run src/cli.ts stats 2>&1 | head -10

# 3. doctor health
bun run src/cli.ts doctor 2>&1 | grep -E "Health score|FAIL"

# 4. fork patch sanity
grep -n "pg_switch_wal" src/core/pglite-engine.ts                   # ~line 89
grep -n "applyForwardReferenceBootstrap" src/core/pglite-engine.ts  # ~line 137 (upstream, not fork)
grep -n "idx_pages_source_id" src/core/pglite-schema.ts             # exists at line ~66 (RESTORED upstream verbatim)
ls -l src/cli.ts | awk '{print $1}'                                 # -rwxr-xr-x

# 5. zombie sync subprocess check
pgrep -lf 'gbrain sync.*--no-pull' || echo "no zombies (good)"

# 6. config sanity
cat ~/.gbrain/config.json
```

---

## 6. Things off the plate (still)

- v0.22.6 schema self-healing — Postgres + PgBouncer, PGLite no-op
- v0.22.7 built-in HTTP MCP transport — we use stdio MCP
- v0.22.8 doctor integrity batch-load — Postgres-only path
- v0.22.0 source-aware boost tune-up — defer 1 week to observe baseline

---

## 7. Open upstream issues to watch

| Issue | Status | Action when merged |
|---|---|---|
| ~~[#370](https://github.com/garrytan/gbrain/issues/370)~~ | **CLOSED 2026-04-26 (v0.22.6.1 / PR #440)** | done — fork patch already dropped |
| [#394](https://github.com/garrytan/gbrain/issues/394) `gbrain dream --json` stdout pollution | open as of v0.22.8 | remove defensive slice in `dream-wrap/run.ts` |
| WAL durability bug | not filed | file when repro is scriptable |

---

## End of handoff

Production is on v0.22.8, schema v29, healthy. Next session should hunt
the zombie-sync source and decide whether to push the merge commit
`811c266` to `origin/master`. Fork master is **NOT yet pushed** —
`git push origin master` is the user's call.
