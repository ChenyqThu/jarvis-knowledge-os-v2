# Next-session handoff — Step 2.3 (dream cron) queued

> 2026-04-23 late-night | updated after a double-prefix hotfix session.
> Previous handoff wrote at commit `aceb838`; current HEAD is `051ae74`
> on master (main repo, fast-forwarded from the now-dead worktree
> branch). **Read this first.** Then `docs/STEP-2-BRAIN-DIR-DESIGN.md
> §4 Step 2.3 block`, then `skills/kos-jarvis/TODO.md`, then
> `CLAUDE.md`.
>
> **Worktree policy for next session:** you don't need one. Single
> maintainer, self-use, and today's bug (double-prefix) was caused by
> the worktree→main-repo propagation gap — launchd binds to the main
> repo path, so worktree commits don't reach production until
> fast-forward. Work directly on `master` unless a future task
> explicitly benefits from isolation. Per OMC/CLAUDE.md rule:
> "EnterWorktree ONLY when explicitly instructed."

---

## 0. 中文速读（2 分钟扫完）

**这次干完的事**（合并了两轮 session）：
- ✅ Step 2.2 落地：`/ingest` 改成 filesystem-canonical（写 `~/brain/<kind>/<slug>.md` → git commit → `gbrain sync`），`/status` 直读 PGLite（修了 100-cap bug），`agent/` → `.agent/` 隐藏避免污染 sync
- ✅ Upstream 同步到 **v0.18.2**（schema 16→24, sources table 注册, 1862 页全保留）
- ✅ v0.18 升级阻塞用 1 行 fork patch 解除（`pglite-schema.ts:63` 一个 `CREATE INDEX` 引用了 `CREATE TABLE IF NOT EXISTS` 跳过的列）
- ✅ 已 file 上游 [garrytan/gbrain#370](https://github.com/garrytan/gbrain/issues/370)；patch 全档案在 `docs/UPSTREAM-PATCHES/v018-pglite-upgrade-fix.md`
- ✅ **双层 `sources/sources/notion/` 嵌套 hotfix**（`051ae74`）：poller 的 slug 原本写 `sources/notion/...`，compat-api 又拼了一次 `kindToDir('source')='sources'`，导致新 ingest 落到 `~/brain/sources/sources/notion/`。poller 改成只写 `notion/<slug>-<id>`，让 server 独占 kind→dir 映射。71 个误放文件通过 git rename 迁回正确路径（`gbrain sync` 识别为 R71，零重嵌入）；`sources/sources/` 目录已消失，DB 1929 页保留

**下次干什么**：**Step 2.3 = `gbrain dream` 夜跑**。
1-2h focused session，前置全就绪（schema v24 / sources 已注册 / `~/brain` 是 git repo / filesystem-canonical 生产化）。runbook 在 `docs/STEP-2-BRAIN-DIR-DESIGN.md §4 Step 2.3 block`。

**冷启动 5 行命令**（粘到终端，在主仓 `~/Projects/jarvis-knowledge-os-v2` 跑，不开 worktree）：
```bash
git log --oneline -5                       # 期望 051ae74 在 HEAD (双层 sources hotfix)
gbrain --version                           # 期望 0.18.2
gbrain stats | head -3                     # 期望 1929+ 页, schema v24
ls ~/brain/sources/notion/ | wc -l         # 期望 71+（新落地全在这里；sources/sources/ 应已消失）
launchctl list | grep jarvis | head        # 期望 7 服务正常 (kos-patrol 仍 -/1，已知)
```

**rollback 锚点**（不出意外用不到）：
- DB：`~/.gbrain/brain.pglite.pre-v018-1776967072` (292MB, schema v16)
- Code：`git tag pre-sync-v0.18`
- 服务：`launchctl bootout` → `cp -R backup` → `launchctl bootstrap` 协议同 §6.11

**还在追的事**（次要）：
- gbrain#370 等上游 review；merge 后删 fork patch（5 行 diff）
- kos-patrol launchd cron 4 天 exit-1（subprocess WASM bug + `gbrain list` 100-cap）—— 独立 1-2h fix（migrate 到 `BrainDb`）
- gbrain#332 cosmetic（v0.13.0 orchestrator partial 永久）

---

## 1. What recent sessions shipped

**Hotfix session (today late-night)** — 1 commit on main repo master:
```
051ae74 fix(notion-poller): drop 'sources/' prefix from slug — server owns kind→dir
```
Plus in `~/brain` git: `bc93e34` (R71 renames sources/sources/notion → sources/notion),
`5ba267f` (overwrite of leaked 16:02 ingest at correct path). Worktree branch
`claude/gallant-bartik-f6ac21` fast-forwarded into master; branch is **dead,
safe to delete** (`git branch -D claude/gallant-bartik-f6ac21` + `git worktree
remove .claude/worktrees/gallant-bartik-f6ac21` if the worktree dir is still
on disk).

**v0.18 sync + Step 2.2 session** — 5 commits (the original handoff body):
```
aceb838 chore: sync upstream v0.17.0 → v0.18.2 + fork patch for PGLite upgrade blocker
0808cdb docs: link upstream gbrain#370 — v0.18 PGLite upgrade blocker
d81d3e9 docs(kos-jarvis): Step 2.2 landed — arch §6.11 + TODO update + handoff retire
b7212db feat(kos-jarvis): Step 2.2 — /ingest filesystem-canonical flip + .agent rename + /status direct-DB
79331b7 docs(kos-jarvis): v0.18 sync preflight — Path A blocked, Step 2.2 back on v0.17
```

Net: filesystem-canonical `/ingest` live, upstream synced to v0.18.2
with a 1-line fork patch (documented under `docs/UPSTREAM-PATCHES/`),
production DB advanced from schema v16 to v24, sources table seeded
with 1860 pages scoped to `default`. Story in `docs/JARVIS-ARCHITECTURE.md §§6.11-6.12`.

---

## 2. Current state (runtime)

### Versions / git

- Fork master: `051ae74` (verify `git log --oneline -5`)
- gbrain version: **0.18.2** (`gbrain --version`)
- Rollback tags: `pre-sync-v0.18`, `pre-sync-v0.17`, `pre-sync-v0.15.1`, `pre-sync-v0.14`
- `@electric-sql/pglite: 0.4.4` pin preserved

### Services (all 7 green, same pattern as before)

`launchctl list | grep jarvis`:
- `com.jarvis.kos-compat-api` UP (serves `kos.chenge.ink` on :7220,
  now speaks filesystem-canonical + direct-DB on `sources.default`)
- `com.jarvis.gemini-embed-shim` UP (port 7222)
- `com.jarvis.cloudflared` UP (tunnel)
- `com.jarvis.notion-poller` loaded, PID `-` (5-min `StartInterval`)
- `com.jarvis.kos-patrol` / `enrich-sweep` / `kos-deep-lint` loaded,
  PID `-` (cron-driven; **kos-patrol still exits 1 — documented
  follow-up, see §4**)

### Database

- `~/.gbrain/brain.pglite` — **schema v24** (was v16 at session start),
  1860+ pages (growing via 5-min Notion poll), sources table seeded
  with one row: `default federated` scoping all pages. Rolling backup:
  `~/.gbrain/brain.pglite.pre-v018-1776967072` (292 MB, schema v16,
  pre-upgrade state). Kept until next DB-write operation evicts it
  (Step 2.3 start → new backup `pre-step2.3-<ts>`).

### `~/brain/` layout

```
~/brain/
├── .git/                  ← initialized during Step 2.2 (branch=main)
├── .agent/                ← renamed from agent/ in Step 2.2
│   ├── dashboards/   (2× md)
│   ├── digests/      (3× md — 2026-04-18, 19, 23)
│   ├── reports/      (5× md)
│   ├── notion-poller-state.json
│   └── pending-enrich.jsonl
└── sources/
    ├── 2026-04-21-ai-economy-disruption-dual-jarvis.md (Step 2.2 upgrade)
    └── notion/           ← auto-created by new /ingest path
        └── …              ← 2+ Notion pages ingested this session via v0.18 path
```

git log under `~/brain/`: seed commit (`6ed6653`) + per-ingest commits.

### `kos.chenge.ink` contract

External shape unchanged: same endpoints (`/health`, `/status`,
`/digest`, `/query`, `/ingest`), same Bearer auth, same JSON shapes
(with richer `/status` fields: `by_kind` + `by_confidence`). Notion
Knowledge Agent + feishu bridge callers need no updates.

---

## 3. Recommended next session — Step 2.3 execution

**Step 2.3 = `gbrain dream` cron wiring + first overnight cycle
observation.** 1-2 h focused session. Preconditions met; no preflight
blockers identified at session close.

### Authoritative runbook

`docs/STEP-2-BRAIN-DIR-DESIGN.md §4 Step 2.3 block` — unchanged from
Step 2.1 locked design. Summary:

1. **Safety protocol** (identical to prior steps):
   ```bash
   for svc in notion-poller kos-compat-api kos-patrol enrich-sweep \
              kos-deep-lint gemini-embed-shim cloudflared; do
     launchctl disable user/$UID/com.jarvis.$svc
     launchctl bootout gui/$UID/com.jarvis.$svc 2>/dev/null || true
   done
   lsof ~/.gbrain/brain.pglite                   # must be empty
   rm -rf ~/.gbrain/brain.pglite.pre-v018-*
   cp -R ~/.gbrain/brain.pglite \
         ~/.gbrain/brain.pglite.pre-step2.3-$(date +%s)
   ```

2. **Create dream wrapper skill** — `skills/kos-jarvis/dream-wrap/run.ts`:
   - `gbrain dream --json` → archive output to
     `~/brain/.agent/dream-cycles/<date>.json`
   - Handle phase-level errors (emit kos-patrol-style digest entry)

3. **Create plist** — `scripts/launchd/com.jarvis.dream-cycle.plist.template`:
   - `StartCalendarInterval`: daily 03:00 local
   - Runs the wrap via `bun run skills/kos-jarvis/dream-wrap/run.ts`
   - Standard stdout/stderr logs under `skills/kos-jarvis/dream-wrap/`

4. **First overnight run** — observe:
   - Lint phase: does upstream `gbrain lint` flag KOS frontmatter
     (`kind:`, `evidence_summary`, `source_refs`)? Known: it shouldn't
     (per Step 1.6 validation), but dream's inline lint is a fresh
     code path we haven't exercised.
   - Backlinks phase: if it writes `.md` updates, verify
     idempotency + sync-safety.
   - Embed phase: on 1860-page brain, likely near-zero (Gemini shim
     embeds on ingest). Predicted cost: <5 min, <1MB API calls.
   - Orphans phase: surfaces pages with zero inbound wikilinks;
     feeds the orphan-reducer follow-up.

5. **Sanity**:
   ```bash
   ls ~/brain/.agent/dream-cycles/                # expect <date>.json
   gbrain doctor --fast                            # schema_version stays 24
   tail workers/notion-poller/poller.stdout.log   # poll cycle unaffected
   ```

6. **Commit** (single):
   ```
   feat(kos-jarvis): Step 2.3 — gbrain dream cron + first overnight cycle
   ```

### Edge cases to decide at Step 2.3 start

- **`dream --pull`**: our `~/brain` git has no remote. Default is
  `--no-pull`, so safe. If Step 2.4 adds a remote, re-evaluate.
- **Dream phase selection**: if lint phase surfaces noise on KOS
  frontmatter, fall back to `gbrain dream --phase backlinks,sync,extract,embed,orphans`
  (skip lint) in the wrap script. Don't patch upstream `lint.ts`.
- **Cycle interaction with 5-min notion-poller**: dream at 03:00
  local, poll cadence 5 min. If both run simultaneously they race the
  PGLite write lock. Dream should win (exclusive cycle lock in
  v0.17's `gbrain_cycle_locks` table). Verify on first cycle.

### Verification before declaring Step 2.3 done

- `dream-cycles/<date>.json` exists and lists 6 phases
- All 6 phases either `status: "ok"` or a clear `status: "warn"` with
  readable reason
- `gbrain doctor --fast` still 70+
- notion-poller cycle that fires during 03:00 dream slot completes
  without lock errors (can force by manually kickstarting during
  dream run on Step 2.3 day 2)

---

## 4. Other P1/P2 items live in TODO.md

### Active blockers (none — all paths forward are clear)

### Watching / documented

- **[garrytan/gbrain#370](https://github.com/garrytan/gbrain/issues/370)**
  — awaiting upstream response. When fixed, remove our fork patch
  on `src/core/pglite-schema.ts:63` + delete the provenance comment
  block. 5-line conflict resolution at next upstream merge.
- **kos-patrol cron exit-1** (pre-existing, 2026-04-19+) — subprocess
  WASM bug + 100-row `gbrain list` cap. Fix path: migrate
  kos-patrol's `listAll` to `BrainDb` direct-read. ~30 LOC, 1-2 h.
  Tracked in TODO.md P1. Not a Step 2.3 prerequisite.
- **garrytan/gbrain#332** (orchestrator `process.execPath` bug) —
  cosmetic, v0.13.0 orchestrator stays `partial`. v0.18.2 migration
  hardening doesn't touch it. Watch upstream.

### Deferred to Step 2.4 (+14d)

- Explicit multi-source: `gbrain sources add jarvis --path ~/brain`
  if we ever split `jarvis-wiki` vs `jarvis-notes`. Currently on
  `default`, works fine.
- Git remote for ~/brain + push batching at dream-cycle end.
- Commit-batching wrapper to reduce per-ingest git-log noise.

---

## 5. Safety tripwires (cumulative, unchanged from Step 2.2)

- **`launchctl bootout` needs `gui/$UID/…` domain** for user-level
  LaunchAgents. `user/$UID/…` reports success but leaves PIDs alive.
- **`launchctl bootstrap` on already-loaded services** returns
  `Input/output error 5`. Benign. Check state via `launchctl list |
  grep jarvis`, not the bootstrap exit code.
- **`launchctl disable ≠ bootout ≠ unload`.** `disable` prevents future
  cron fires, doesn't stop current PID. `bootout` stops PID. Always use
  both + check `lsof ~/.gbrain/brain.pglite` before DB writes.
- **PGLite WASM `Aborted()`** = data dir corruption (or #223 bug).
  Restore from rolling backup immediately.
- **`bun install`** auto-runs `gbrain apply-migrations --yes` via
  postinstall. Back up + disable services first. **This session
  we verified the postinstall path works end-to-end on our PGLite
  brain with the fork patch in place.**
- **`gbrain list --limit`** is silently capped at 100 rows by upstream.
  For full counts use `gbrain stats` or direct `BrainDb.listAllPages()`.
- **Config keys in DB** are lost on DB restore. After any
  `brain.pglite` restore, re-run:
  - `gbrain config set writer.lint_on_put_page true`
  - `gbrain config set sync.repo_path /Users/chenyuanquan/brain`
  (both set during Step 2.2; both persist only in the DB).
- **Never SIGTERM a PGLite writer.**
- **Step 2.3 also needs `lsof ~/.gbrain/brain.pglite` empty** BEFORE
  running first dream cycle. Dream acquires `gbrain_cycle_locks` but
  the cycle lock doesn't rescue a poll running mid-write.

---

## 6. Bootstrap checklist (first commands in fresh session)

Run these in the main repo path (`~/Projects/jarvis-knowledge-os-v2`), not
a worktree. No worktree is needed for Step 2.3.

```bash
# 1. Environment sanity
git log --oneline -5            # expect 051ae74 at HEAD (hotfix)
git status                      # clean
git branch                      # expect only `master`; if you see
                                # `claude/gallant-bartik-f6ac21`, delete
                                # it — fully merged into master

# 2. Versions
gbrain --version                # expect 0.18.2
gbrain doctor | grep -E "schema_version|brain_score"
# expect: schema_version OK (Version 24), brain_score 56/100

# 3. DB health
gbrain stats | head -5          # 1860+ pages, schema v24
gbrain sources list             # expect: default federated <N> pages

# 4. Services all loaded
launchctl list | grep jarvis    # 7 services, kos-patrol may show "1"

# 5. Live Notion ingest
tail -5 workers/notion-poller/poller.stdout.log
# expect recent cycle with possibly "X ingested" if new Notion pages dropped

# 6. Filesystem-canonical working
ls ~/brain/sources/notion/      # expect .md files from recent ingest
git -C ~/brain log --oneline -3 # expect recent "ingest: <slug>" commits

# 7. /status endpoint
TOKEN=$(grep -oE '[a-f0-9]{64}' ~/Library/LaunchAgents/com.jarvis.kos-compat-api.plist | head -1)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:7220/status | head -5
# expect total_pages: 1860+
```

Any failure → stop and diagnose. Recovery points documented in §6.12
rollback matrix.

---

## 7. Explicit don'ts

- **Don't modify `src/*` casually.** The one fork-local patch on
  `pglite-schema.ts` is the exception (upstream #370); document any
  new patch under `docs/UPSTREAM-PATCHES/`.
- **Don't skip Step 2.3's overnight observation.** Let the first
  dream cycle fully complete + next morning's notion-poller cycle
  land cleanly before claiming Step 2.3 done.
- **Don't bundle Step 2.3 (dream cron) with Step 2.4 (git remote) in
  one session.** Let dream soak for 14 days.
- **Don't run `bun install`** without the full safety protocol
  (services disable + backup), even though it happened to work this
  session with the patch pre-applied.
- **Don't SIGTERM PGLite writers.**
- **Don't `git push` the fork to `origin` yet.** 27 commits ahead;
  decide push cadence separately from Step 2.3 work.

---

## 8. When finished with next session

1. Update `skills/kos-jarvis/TODO.md` — mark Step 2.3 done, keep
   Step 2.4 open.
2. Append `docs/JARVIS-ARCHITECTURE.md §6.13` recording the Step 2.3
   execution (lessons, first-cycle outcomes, any dream-phase behaviors
   worth documenting for Step 2.4).
3. **Delete this file** (`docs/SESSION-HANDOFF-STEP-2.3.md`). Context
   that survives migrates to arch §6.13 + design doc.
4. Single commit for code + plist + wrap skill. Docs in a second
   commit if substantial.
5. Write new handoff only if Step 2.4 prep has fresh context; a
   14-day soak with no interventions may mean no handoff needed.

Exactly one rolling backup in `~/.gbrain/` at any time (per policy).
