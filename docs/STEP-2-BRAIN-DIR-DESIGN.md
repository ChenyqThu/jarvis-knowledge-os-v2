# Step 2.1 — Brain-dir design (filesystem-canonical prep)

> 2026-04-23 | Lucien × Jarvis | read after `SESSION-HANDOFF-2026-04-23.md`,
> `FILESYSTEM-CANONICAL-EXPORT-AUDIT.md`, and `JARVIS-ARCHITECTURE.md §6.8–6.9`.
> Input: 1829-page PGLite brain at schema v16, fork master at `2372922`,
> Steps 1/1.5/1.6 green.
> Method: read-only audit + pure-design pass. Zero DB writes, zero code
> edits, zero launchd touches this session.
> Scope: lock the 5 open decisions for Step 2 (filesystem-canonical
> `/ingest` flip). Execution lives in Step 2.2+.

## Verdict: **all 5 decisions locked, Step 2.2 can start cold**

`~/brain/` as the canonical brain dir with `agent/` renamed to `.agent/`,
`/ingest` reimplemented as `write + gbrain sync` (external HTTP contract
unchanged), kos-patrol output path-constant rewrite, and git deferred to
+14-day checkpoint. One 30-minute sync-fidelity smoke stays in this doc
for Step 2.2 preflight.

---

## 1. Why this doc exists

The filesystem-canonical track (TODO.md P1 anchor) needs a brain dir on
disk so `gbrain dream` can lint + backlinks + sync + extract + embed +
orphans as one nightly verb (upstream v0.17 flagship). Today `/ingest`
writes to PGLite directly via `spawnSync("gbrain import", [/tmp/stage])`
and no .md ever lands under a canonical dir. The migration has 5 design
branches that cost more if you pick wrong than they cost to think
through. This doc pins them.

Step 1 (export audit, `FILESYSTEM-CANONICAL-EXPORT-AUDIT.md`) proved the
export materializes 1786/1786 pages with KOS frontmatter intact. Step
1.5 normalized 7 slug strays. Step 1.6 confirmed
`serializeMarkdown → parseMarkdown` round-trips the 10 KOS-critical
frontmatter fields across 1829/1829 pages with zero diffs. All three
pre-migration blockers cleared.

**This session adds exactly one deliverable**: `docs/STEP-2-BRAIN-DIR-DESIGN.md`
(this file). No code, no DB, no plist touches. Step 2.2 opens in a
separate session using this doc as the cold-start input.

---

## 2. Current state audit (what I actually observed)

### Bootstrap checklist (per handoff §6, all green)

| Check | Actual |
|---|---|
| `git log --oneline -4` | 3 commits ahead of `3684a91`, HEAD `2372922` |
| `gbrain doctor --fast` | 70/100, known cosmetic: resolver MECE_OVERLAP warn, v0.13.0 orchestrator `partial` (#332) |
| `launchctl list \| grep jarvis` | kos-compat-api PID 81745, gemini-embed-shim PID 3135, cloudflared PID 81749, 4 crons idle with PID `-` |
| `tail workers/notion-poller/poller.stdout.log` | Active 5-min cycle, 4 pages matched most recent poll |
| `evidence-gate sweep --json` | `total: 1829` |
| `slug-normalize --verify` | 15/15 assertions pass, `ok: true` |
| Rolling backup | `~/.gbrain/brain.pglite.pre-slug-normalize-1776921434` (285 MB, schema v16) intact |

### "100 pages" mystery — resolved, with a correction

Handoff §3 asked to "搞清 100 files 来源再决定". Result: the `/status`
endpoint is **not** scanning `~/brain/*.md`. Reading
`server/kos-compat-api.ts:77`:

```typescript
function handleStatus(res: ServerResponse) {
  const list = gbrain(["list", "--limit", "10000"], 30_000);
  ...
  total_pages: rows.length,
```

The `--limit 10000` flag is silently capped at 100 by upstream
`gbrain list` (MCP row-cap default). Verified:

```
$ gbrain list --limit 10000 | wc -l
100
$ gbrain stats | head -3
Pages:     1829
```

So `total_pages: 100` in `/status` is a **cosmetic `gbrain list` bug**
surfacing as a wrong health number, not a filesystem mirror. The
annotation at `docs/JARVIS-ARCHITECTURE.md:164`
(`"/status scans /Users/chenyuanquan/brain/*.md filesystem mirror (~100 files)"`)
is incorrect — fixed as part of this Step 2.1 doc wave (§6.10 append).
Step 2.2 reimplements `/status` to query the DB directly.

### `~/brain/` actual contents (9 files, zero knowledge)

```
~/brain/
├── agent/
│   ├── dashboards/   2× knowledge-health-YYYY-MM-DD.md
│   ├── digests/      2× patrol-YYYY-MM-DD.md
│   └── reports/      4× enrich-sweep-*, slug-normalize-2026-04-23.md
└── raw/web/          1× 2026-04-21-ai-economy-disruption-dual-jarvis.md
```

None of these have KOS frontmatter. Dashboards/digests/reports begin
with `# <title>` directly; `raw/web/*.md` is an unprocessed capture.
If `gbrain sync ~/brain/` ran today without mitigation, all 9 would
fail YAML parse and pollute `~/.gbrain/sync-failures.jsonl`.

---

## 3. Five decisions

### Decision 1 — Brain-dir location

**Choice: `~/brain/`, with `agent/` renamed to `.agent/` one-shot.**

Code evidence (`src/core/sync.ts:78-98`):

```typescript
export function isSyncable(path: string): boolean {
  if (!path.endsWith('.md') && !path.endsWith('.mdx')) return false;
  if (path.split('/').some(p => p.startsWith('.'))) return false;  // hidden dirs
  if (path.includes('.raw/')) return false;
  const skipFiles = ['schema.md', 'index.md', 'log.md', 'README.md'];
  if (skipFiles.includes(basename)) return false;
  if (path.startsWith('ops/')) return false;
  return true;
}
```

A dot-prefixed directory is skipped by design, upstream convention, no
fork-local hack needed. One `mv` call makes kos-patrol / enrich-sweep
/ slug-normalize outputs invisible to `gbrain sync`.

Post-Step-2 layout:

```
~/brain/
├── .agent/           ← renamed from agent/ (sync skips dot-prefix)
│   ├── dashboards/
│   ├── digests/
│   └── reports/
├── raw/              ← 1 file; Step 2.2 decides .raw/ vs frontmatter-ify
├── people/           ← NEW knowledge (gbrain 20-dir MECE)
├── companies/
├── concepts/
├── projects/
├── decisions/
├── sources/notion/
├── syntheses/
├── comparisons/
├── protocols/
├── entities/
└── timelines/
```

**Alternatives rejected:**

- `~/brain-source/` — two "brain" namespaces long-term cognitive cost
  outweighs one `mv`
- fork-internal `knowledge/` — fork is public, KOS contains private
  people/meeting content, can't ship knowledge in a public repo

**Edge case for Step 2.2**: `~/brain/raw/web/*.md` is **not** hidden by
the `.raw/` substring check (the check matches dot-prefixed `.raw/`,
not plain `raw/`). The single existing raw file will either need to be
moved to `.raw/web/` OR have frontmatter added so it parses as a valid
`source` page. Defer to Step 2.2 implementation decision.

---

### Decision 2 — `gbrain sync` KOS frontmatter fidelity

**Choice: Step 1.6 already covers sync.ts; design a 30-minute
throwaway-dir smoke into this doc for Step 2.2 preflight, don't
execute now.**

Step 1.6 tested `serializeMarkdown → parseMarkdown` as pure functions.
Explore of `src/commands/sync.ts` + `src/core/sync.ts` confirmed sync
goes through the identical `parseMarkdown` call — no separate code
path:

```
src/commands/sync.ts → src/core/sync.ts:performSync →
  src/core/import-file.ts:importFile → importFromContent →
    parseMarkdown(content, relativePath)       ← same function Step 1.6 tested
```

Unknown frontmatter keys (`kind`, `evidence_summary`, `source_refs`,
`owners`, …) are preserved via JSONB spread (`src/core/markdown.ts:49-53`
removes only `type/title/tags/slug`). UPSERT is `INSERT ON CONFLICT
(slug) DO UPDATE` at `src/core/import-file.ts` — no duplicates, no
partial updates, hash-match skips unchanged files.

**Defense-in-depth smoke (30 min, Step 2.2 preflight)**:

```bash
# Fresh gbrain config pointing at a throwaway PGLite
export TMP_HOME=/tmp/brain-sync-smoke-$(date +%s)
mkdir -p "$TMP_HOME"
HOME="$TMP_HOME" gbrain init --pglite

# Export live brain, stage 10 pages (one per kind)
gbrain export --dir /tmp/brain-sync-export
mkdir -p /tmp/brain-sync-stage
for kind in concept project decision synthesis comparison protocol \
            entity timeline source person; do
  src=$(find /tmp/brain-sync-export -name "*.md" -path "*/$kind*" -o \
              -name "*.md" | grep "kind: $kind" -l | head -1)
  [[ -n "$src" ]] && cp --parents "$src" /tmp/brain-sync-stage/
done

# Sync stage → throwaway DB (idempotent)
HOME="$TMP_HOME" gbrain sync --repo /tmp/brain-sync-stage

# Diff kind/status/confidence columns original vs throwaway
# (one-shot SQL via gbrain query or direct PGLite probe)
```

Expected: 0 row-level diffs on `kind`, `status`, `confidence`,
`source_of_truth`, `owners`, `evidence_summary`, `source_refs`,
`related`, `aliases`, `id` for all 10 sampled pages. Failure mode:
any diff signals `sync.ts` took a code path Step 1.6 didn't cover and
blocks Step 2.2 until root-caused.

---

### Decision 3 — notion-poller refactor path

**Choice: Path (a) — keep HTTP-POST to `/ingest`, change `/ingest`
internal implementation.**

Current flow (`server/kos-compat-api.ts:handleIngest`):

```
write /tmp/gbrain-ingest-<ts>/<slug>.md  →  spawnSync("gbrain import", [stage])
```

Step-2 flow:

```
write ~/brain/<dir>/<slug>.md  →  spawnSync("gbrain sync", ["--repo", "~/brain"])
```

Why (a) over (b = "poller writes file directly, skip /ingest"):

1. `/ingest` is the single external contract point — `kos.chenge.ink`,
   Notion Knowledge Agent, feishu bridge, ad-hoc curl, all converge
   here. One write path means one place for slug derivation,
   frontmatter normalization, source_of_truth tagging, Bearer-token
   auth. Path (b) forks the write path across two files (poller +
   `/ingest`), long-term drift risk when one side adds a field and the
   other doesn't.
2. `workers/notion-poller/run.ts` doesn't change a line. External HTTP
   contract stays frozen.
3. Path C (kos-compat-api in-process import, TODO.md §P1) dissolves:
   `gbrain sync --repo` is incremental + idempotent, no outer/inner
   `spawnSync` lock collision. The original PGLite lock deadlock that
   motivated Path C goes away as a side effect.
4. `/status` gets a free upgrade alongside: replace
   `gbrain list --limit 10000` parse with a direct DB query via
   `skills/kos-jarvis/_lib/brain-db.ts`. Fixes the 100-vs-1829
   off-by-orders-of-magnitude.

Change surface:
- `server/kos-compat-api.ts:handleIngest` — swap stage logic for
  canonical-dir write + `gbrain sync`
- `server/kos-compat-api.ts:handleStatus` + `handleDigest` — direct-DB
  path via existing `BrainDb` reader
- `server/kos-compat-api.ts:BRAIN` constant — already reads
  `GBRAIN_HOME ?? ~/brain`, no change needed
- Zero changes to `workers/notion-poller/run.ts`

---

### Decision 4 — kos-patrol output path migration

**Choice: `~/brain/agent/` → `~/brain/.agent/` path-constant rewrite.**

Files touching `~/brain/agent/` today (Step 2.2 execution surface):

| File | Change |
|---|---|
| `skills/kos-jarvis/kos-patrol/run.ts` | all `~/brain/agent/` → `~/brain/.agent/` |
| `skills/kos-jarvis/enrich-sweep/run.ts` | same |
| `skills/kos-jarvis/slug-normalize/run.ts` | report output path constant |
| `workers/notion-poller/run.ts:30` | `STATE_PATH` default |
| `server/kos-compat-api.ts` | `DIGEST_DIR` const (if it references `agent/digests`) |
| One-shot `mv` | `mv ~/brain/agent ~/brain/.agent` |

No data loss: existing 8 dashboard/digest/report files move along with
the rename. Links in reports that reference siblings (e.g.
slug-normalize report →  enrich-sweep report) use relative paths that
stay valid.

`~/brain/raw/` handling deferred (see Decision 1 edge case).

---

### Decision 5 — Git-track strategy

**Choice: Step 2 landing goes out without git. Revisit at +14-day
checkpoint after filesystem-canonical soaks.**

Reasoning:

- `gbrain dream` does not require git. Only `dream --pull` does. Lint
  + backlinks + sync + extract + embed + orphans all work on a plain
  dir.
- Step 2 diff surface is already wide (ingest write path, `.agent/`
  rename, /status rewrite). Adding a commit strategy compounds failure
  modes.
- Rollback relies on `~/.gbrain/brain.pglite.pre-*` rolling backup, not
  `git revert`. Step-2-era failures are going to be
  sync-UPSERT-goes-wrong, not file-version-confusion — git doesn't
  help for the former.
- Per-ingest commit on a 5-min poll cycle is performance-fine but
  git-log-noisy. Any real git strategy needs commit-batching (e.g.
  post-dream-cycle amalgamation). That logic is worth designing once,
  after dream's own cadence is known.

**+14-day checkpoint git plan** (written here, not executed):

```bash
gh repo create jarvis-brain --private
cd ~/brain
git init
git remote add origin <url>
git add -A
git commit -m "initial canonical snapshot (post-Step-2)"
git push -u origin main

# dream-cycle-end hook (fork-local, no src/* edits)
# Add to skills/kos-jarvis/ a post-dream wrapper:
#   gbrain dream && cd ~/brain && git add -A && \
#   git commit -m "dream $(date -I)" && git push
# Wire via launchd wrapping the dream invocation.
```

---

## 4. Implementation roadmap

Each micro-step is 1-2 hours of focused work. None bundle multiple
decisions.

### Step 2.2 — `/ingest` flip + `.agent/` rename + `/status` direct-DB

Scope:
- Preflight: run the Decision-2 throwaway-dir smoke first. Block on any
  diff.
- Safety protocol: the same `launchctl disable gui/$UID/…` + fresh
  rolling backup pattern from slug-normalize (see
  `FILESYSTEM-CANONICAL-EXPORT-AUDIT.md §7`).
- One-shot `mv ~/brain/agent ~/brain/.agent`.
- Edit 5 files (see Decision 3 + 4 change surfaces).
- Reload `com.jarvis.kos-compat-api` plist.
- Sanity: curl `/status` → 1829 (not 100); curl `/ingest` with a test
  payload → file lands at `~/brain/sources/...`, DB row present.
- 1 commit: `feat(kos-jarvis): Step 2.2 — /ingest filesystem-canonical flip`

Rollback: `mv ~/brain/.agent ~/brain/agent`, restore
`server/kos-compat-api.ts` from git, restore PGLite from backup if any
sync UPSERT misbehaved (none expected on idempotent run).

### Step 2.3 — dream cron wiring + first overnight observation

Scope:
- `gbrain init --pglite --repo ~/brain` (sets `sync.repo_path` in DB
  config; verify via `gbrain config get sync.repo_path`).
- Add `com.jarvis.dream-cycle` launchd plist (daily 03:00 local).
- Wrapper script: `bun run skills/kos-jarvis/dream-wrap/run.ts` that
  calls `gbrain dream --json` and archives the cycle report to
  `~/brain/.agent/dream-cycles/<date>.json`.
- First overnight run: observe lint phase (should not flag KOS
  frontmatter; `src/commands/lint.ts` rules don't touch `kind:` or
  `[E\d]` tags — confirmed in this audit).
- If backlinks phase writes `.md` files, verify the writes are
  idempotent and sync-safe.
- 1 commit: `feat(kos-jarvis): Step 2.3 — gbrain dream cron + first cycle`

### Step 2.4 — (+14d) git init + commit-batching wrapper

Scope:
- After 14 days of stable dream cycles (check
  `~/brain/.agent/dream-cycles/*.json` for error-free runs).
- `gh repo create jarvis-brain --private`.
- `cd ~/brain && git init && git add -A && git commit -m "initial".`
- Extend dream-wrap to commit + push at cycle end.
- 1 commit: `feat(kos-jarvis): Step 2.4 — git-track brain dir`

---

## 5. Preflight smoke script (for Step 2.2)

Full version of Decision 2's smoke; save at
`skills/kos-jarvis/brain-sync-smoke/run.sh` when Step 2.2 executes.

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%s)
TMP_HOME="/tmp/brain-sync-smoke-$TS"
EXPORT_DIR="/tmp/brain-sync-export-$TS"
STAGE_DIR="/tmp/brain-sync-stage-$TS"

echo "[1/5] init throwaway gbrain config at $TMP_HOME"
mkdir -p "$TMP_HOME"
HOME="$TMP_HOME" gbrain init --pglite

echo "[2/5] export live brain → $EXPORT_DIR"
gbrain export --dir "$EXPORT_DIR"

echo "[3/5] stage 10 pages (one per kind) at $STAGE_DIR"
mkdir -p "$STAGE_DIR"
for kind in concept project decision synthesis comparison \
            protocol entity timeline source person; do
  src=$(grep -rl "^kind: $kind" "$EXPORT_DIR" --include="*.md" | head -1)
  if [[ -n "$src" ]]; then
    rel=${src#$EXPORT_DIR/}
    mkdir -p "$STAGE_DIR/$(dirname "$rel")"
    cp "$src" "$STAGE_DIR/$rel"
  fi
done

echo "[4/5] sync stage → throwaway DB"
HOME="$TMP_HOME" gbrain sync --repo "$STAGE_DIR"

echo "[5/5] diff report — inspect manually or via bun helper"
ls -la "$TMP_HOME/.gbrain/" "$STAGE_DIR"
echo "compare columns: bun run skills/kos-jarvis/brain-sync-smoke/diff.ts \\"
echo "                 --live ~/.gbrain/brain.pglite \\"
echo "                 --throw $TMP_HOME/.gbrain/brain.pglite"
```

A companion `diff.ts` at the same path (to be written in Step 2.2)
opens both PGLite DBs read-only, joins on slug, diffs the 10
KOS-critical frontmatter fields. Expected: 0 diffs. Any non-zero
aborts Step 2.2.

---

## 6. Rollback matrix

| Step | Backup taken | Rollback command |
|---|---|---|
| 2.2 ingest flip | `~/.gbrain/brain.pglite.pre-step2.2-<ts>` + git state pre-commit | `mv ~/brain/.agent ~/brain/agent; git checkout HEAD -- server/ skills/ workers/; cp -R backup ~/.gbrain/brain.pglite` |
| 2.3 dream wiring | Same rolling backup + plist `.bak` | `launchctl bootout gui/$UID/com.jarvis.dream-cycle; rm plist` |
| 2.4 git init | N/A (additive) | `rm -rf ~/brain/.git` |

The one-rolling-backup policy from slug-normalize applies: each new
backup evicts the prior. Don't run Step 2.2 and Step 2.3 in the same
session — Step 2.3 needs a fresh backup after Step 2.2's first
production cycle has been observed.

---

## 7. Open questions deferred to later steps

- **`~/brain/raw/` handling** — move to `.raw/web/` (hidden), or add
  frontmatter to the one existing file so it parses as a legitimate
  `source` page? Decide in Step 2.2.
- **Dream embed phase vs 5-min poller embed** — dream runs nightly,
  poller runs every 5 min. Time windows don't overlap, but the first
  `gbrain dream` run on a 1829-page brain will re-embed anything with
  stale vectors. Likely zero (Gemini shim already embeds on ingest),
  but confirm before first cycle by running `gbrain embed --stale
  --dry-run`.
- **`/status` schema extension** — after Step 2.2's direct-DB rewrite,
  consider extending the response from `{total_pages, by_type, engine,
  brain}` to `{pages, chunks, embedded, links, timeline, orphans,
  brain_score}`. Would turn `/status` into a single-round-trip health
  probe for Notion Worker + feishu. Scope: low; value: medium.
- **Upstream `gbrain list --limit` bug** — file an issue on
  `garrytan/gbrain` per fork policy (don't patch `src/*`). 3-line repro
  available; tracking this doc as the context.
- **`gbrain dream --phase` blacklist** — today accepts exactly one
  phase name. If the lint phase surfaces the ~3-5 `placeholder-date`
  legitimate findings identified in audit §5.2, we may want to skip
  lint entirely in early dream cycles. Upstream enhancement request
  worth filing.

---

## 8. References

- `docs/SESSION-HANDOFF-2026-04-23.md` — entry-point for this session
- `docs/FILESYSTEM-CANONICAL-EXPORT-AUDIT.md` — Step 1/1.5/1.6 details,
  including the slug-normalize safety protocol that Step 2.2 reuses
- `docs/JARVIS-ARCHITECTURE.md §6.8, 6.9, 6.10` — audit + execution +
  this design lands
- `skills/kos-jarvis/TODO.md` — P1 filesystem-canonical anchor
- `skills/kos-jarvis/_lib/brain-db.ts` — direct-PGLite reader (reuse
  for Step 2.2 `/status` + `/digest` rewrite)
- `server/kos-compat-api.ts` — `/ingest` + `/status` + `/digest` +
  `/query` handlers
- `workers/notion-poller/run.ts` — Notion 5-min poller (unchanged)
- `src/core/sync.ts:78-98` — `isSyncable()` skip rules
- `src/core/markdown.ts:49-53, 123-147` — frontmatter parse/serialize
  roundtrip semantics
- `src/commands/dream.ts:92` — `getConfig('sync.repo_path')` read-site
- `src/core/cycle.ts:13-22` — dream phase order

Step 2.2 opens as a separate session. Read this doc + `TODO.md` first,
then execute the roadmap §4 Step 2.2 block.
