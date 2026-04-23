# Filesystem-canonical migration — Step 1 audit (export dry-run)

> 2026-04-22 | Lucien × Jarvis | read after JARVIS-ARCHITECTURE §6.8
> Input: whole PGLite brain at `~/.gbrain/brain.pglite` (schema v16, 1786 pages)
> Method: `gbrain export` → `/tmp/brain-export-preview/` → structural + frontmatter audit
> Artifact cleaned after audit; numbers captured here for future sessions.

## Verdict: **GO, Steps 1.5 + 1.6 landed 2026-04-23. Only Step 2 (/ingest flip) remains.**

The upstream `gbrain export` faithfully materializes our 1829-page KOS brain to a
markdown tree. KOS-critical frontmatter is preserved end-to-end, the directory
layout is predictable (slug-prefix → dir), and there's zero DB-only data (no
`.raw/*.json` sidecars anywhere). This path is viable.

**Post-audit work completed same session (2026-04-23 UTC)**:
- **Step 1.5 — slug normalization**: 7 root-level stray pages renamed
  (`ai-jarvis` → `concepts/ai-jarvis`; 6 × `<domain>-<path>` → `sources/…`),
  1 intra-brain markdown link rewritten. All via new
  `skills/kos-jarvis/slug-normalize/` skill under the mandatory
  launchctl-disable + rolling-backup protocol. 15/15 verify assertions passed.
- **Step 1.6 — markdown round-trip**: ran `serializeMarkdown → parseMarkdown`
  on all 1829 pages, compared 10 KOS-critical frontmatter fields. **1829/1829
  clean, 0 diffs.** Upstream's `parseMarkdown` passes unknown keys (including
  `kind`) through as plain frontmatter JSONB, so re-ingest is safe.
- `id: >-` pseudo-blocker withdrawn (see §5.4 — gray-matter line-folding, not
  data damage).

**Still to do**: Step 2 (/ingest write-path flip). Multi-week. Not in the
Step-1.x audit scope.

**Correction log (2026-04-22)**: an earlier draft listed `gbrain lint`
false-positives on `[E3]` / `[10]+` KOS evidence tags as a 4th blocker.
That analysis was wrong — the `placeholder-date` rule only matches literal
`YYYY-MM-DD` / `XX-XX` tokens (see `src/commands/lint.ts:70`) and the single
finding in the sample was a legitimate `YYYY-MM-DD` string referencing a
filename template. Full correction in §5.2. The proposed "fork-local lint
shim" was withdrawn — it was solving a problem that does not exist.

---

## 1. Export mechanics

| Knob | Value |
|---|---|
| Command | `gbrain export --dir <path>` |
| Source | `src/commands/export.ts:8` (54 LOC thin wrapper; calls `engine.listPages({limit: 100000})`) |
| Iterator | In-memory array over all pages, not streaming |
| Per-page cost | 1 `getTags()` + 1 `serializeMarkdown()` + 1 `getRawData()` |
| Sidecar | JSON at `<dir>/<parent>/.raw/<slug>.json` when `rawData.length > 0` |
| Wall clock (1786 pages) | ~90-120 s (estimated from 38% stream rate) |
| Output size | 17 MB for 1786 `.md` (avg ~10 KB/page) |
| Memory ceiling | `pages.length` × (frontmatter + body + tags + raw) ≈ ~80 MB at our scale |

**Gotcha surfaced**: `gbrain export --help` is not a help dispatch — unknown flags
are silently ignored and the command exports to the default `./export/` directory
in CWD. This session accidentally wrote a full 17 MB export into the repo root
before moving it to `/tmp`. Mitigation for future: always pass explicit `--dir`.

---

## 2. Directory layout & slug-routing

Export decides file placement **by the slug alone** (not by `type:`, not by
`kind:`). `filePath = join(outDir, page.slug + '.md')`. Pages with
slash-containing slugs land in nested directories; flat slugs land in the root.

### Actual distribution across 1786 pages

| Dir | `.md` count | Notes |
|---|---:|---|
| `people/` | 375 | All `kind: person`, mostly `auto-stub` + `enrich-sweep` tags |
| `companies/` | 85 | All `kind: company`, similar shape |
| `concepts/` | 180 | Mix of `kind: concept` manual + auto-stub |
| `projects/` | 210 | All `kind: project` |
| `decisions/` | 6 | Hand-authored, `status: active`, high-confidence |
| `syntheses/` | 4 | Hand-authored v1 wiki imports |
| `comparisons/` | 3 | Hand-authored |
| `protocols/` | 4 | Hand-authored |
| `entities/` | 3 | Hand-authored (jarvis, openclaw, gbrain meta-entities) |
| `timelines/` | 1 | |
| `sources/` | 908 total | 47 flat + 860 in `sources/notion/` + 1 in `sources/` root-ish |
| `sources/feishu/` | 0 | **Empty** — signal-detector hasn't produced any |
| `sources/wiki/` | 0 | **Empty** — v1 wiki's 85 pages live at `sources/` flat, not under `wiki/` |
| root (stray) | 7 | See §5.1 |

**Total:** 1786 `.md`, 0 `.raw` JSON sidecars.

### Key structural finding

**Zero `.raw/` sidecars across 1786 pages** means `raw_data` rows in DB are
empty for every page. Our ingest architecture is 100% markdown-first (ingest
payload = rendered markdown, not structured raw). This is the strongest signal
that filesystem-canonical is viable: there's no DB-exclusive data to leave
behind. The export IS the ground truth.

---

## 3. Frontmatter fidelity across 1786 pages

```
kind            : 1786/1786 (100%)
status          : 1786/1786 (100%)
confidence      : 1779/1786  (99%)
owners          : 1752/1786  (98%)
source_of_truth : 1749/1786  (97%)
source_refs     :  920/1786  (51%)
aliases         :  832/1786  (46%)
related         :   46/1786   (2%)
evidence_summary:    0/1786   (0%)  ← DB reality, not an export bug
```

All 9 KOS-specific fields are exported verbatim when present. `evidence_summary`
being 0% across the brain is the DB state — it's the same finding that
confidence-score sweep reports (all 1785 pages score `low` because no
evidence_summary exists yet). This is orthogonal to filesystem-canonical; it's
candidate **C** on the TODO queue.

`related:` at 2% is sparse but expected — it's the hand-authored cross-link
surface, only used by ~46 high-value pages (syntheses, decisions, some
concepts). Auto-stubs don't carry `related:`.

`source_refs:` at 51% is correct — auto-generated pages (stubs) don't have
source refs, only ingest pages and hand-authored pages do.

### Typical page shapes (verified by sampling)

- **Notion-ingested source** (sources/notion/, 860): has `notion-metadata`
  HTML comment, `## Properties` section, rich body. Example:
  `/tmp/brain-export-preview/sources/notion/re-unanswered-tickets-update-…md`
  (87 lines).
- **Auto-stub person** (people/, 375): has "Auto-stub created N from M mentions"
  header, `## State / Network / Mentioned in / Timeline` sections. Example:
  `people/yaodong-li.md` (with `<!-- timeline -->` sentinel and chronological
  inbound mentions).
- **Hand-authored synthesis** (syntheses/, 4): has `confidence: high`,
  `source_of_truth: memory`, `related:` with relative paths.
- **Hand-authored decision** (decisions/, 6): has full `Context / Alternatives /
  Why this choice / Consequences` structure, `related:` with relative paths.

---

## 4. Timeline & cross-link structure

| Signal | Count |
|---|---:|
| Pages with `<!-- timeline -->` sentinel | 749 |
| Pages with `## Mentioned in` section | 832 |
| Empty-body pages (frontmatter-only) | 0 |
| Pages with YAML block-scalar id (`id: >-`) | 262 |

**Timeline compatibility**: 749 pages use gbrain's standard
`<!-- timeline -->` sentinel. The dream cycle's backlinks phase reads this
directly. No translation needed.

**`## Mentioned in`** (832 pages) is our auto-stub convention (enrich-sweep
writes it). It's not a gbrain-native concept but it doesn't conflict — gbrain's
backlinks phase builds a separate links table; these inline listings are read
by humans + evidence-gate.

**262 pages with `id: >-` YAML block-scalar** is the residue of a pre-fix Notion
poller bug (fixed 2026-04-20 per TODO.md; old pages still carry the ugly
shape). Parseable as YAML, but ugly. Candidate for a bulk slug-rewrite pass.

---

## 5. Blockers — what must happen before Step 2

### 5.1 Root-level stray pages (7 total)

Seven pages have flat slugs without a directory prefix, so they land at the
export root instead of under a `kind/` folder:

| slug | id | kind |
|---|---|---|
| `ai-jarvis` | `concept-ai-jarvis` | concept |
| `ingest-1776470181089` | `source-ingest-1776470181089` | source |
| `x-com-omarsar0-status-2045241905227915498` | `source-…` | source |
| `www-anthropic-com-news-claude-opus-4-5` | `source-…` | source |
| `github-com-aloshdenny-reverse-synthid` | `source-…` | source |
| `arxiv-org-abs-2604-15034` | `source-…` | source |
| `colossus-com-article-inside-notion` | `source-…` | source |

These are from early-day `/ingest` calls before the `slug: sources/<...>`
convention settled. Fix: one-time script to rename slug to
`concepts/ai-jarvis` / `sources/<url-slug>` and update backlinks.

### 5.2 Upstream `gbrain lint` — false-positive footprint (corrected)

**This section supersedes an earlier incorrect analysis in the same
session.** Reading `src/commands/lint.ts:43-147` changed the picture:

**Actual rule set** (7 rules total, all in `lintContent`):
- `llm-preamble` — matches "Of course! Here is..." and similar LLM artifacts
- `code-fence-wrap` — page wrapped in ` ```markdown ` fences
- `placeholder-date` — matches **literal** `YYYY-MM-DD` / `XX-XX` / `\d{4}-XX-XX`
  ONLY. The regex is `lines[i].match(/\bYYYY-MM-DD\b/) || ...`. It does NOT
  match `[E3]`, `[10]+`, or any bracketed token.
- `missing-title` / `missing-type` / `missing-created` — YAML frontmatter gates
- `no-frontmatter` — page has no `---` block at all
- `broken-citation` — unclosed `[Source: ...` with no next-line `]`
- `empty-section` — `## Heading` followed by empty content

**Earlier-draft claim was wrong.** The first lint run hit one `placeholder-date`
finding at 26% of the 1786-page corpus:

> `concepts/user-modeling-spec.md:L42 Placeholder date found: 1. **日记层**：memory/YYYY-MM-DD.md 中的 [10]+ 条目`

I mis-attributed the trigger to `[10]+`. The real trigger is the literal
string `YYYY-MM-DD` in `memory/YYYY-MM-DD.md` (a legitimate filename-template
reference explaining the journal-layer file convention). The `[10]+` token
was context, not cause. Fix: wrap the path in a code span (`` `memory/YYYY-MM-DD.md` ``).

**Real footprint** (extrapolating from 1-in-26% sample): ~3-5 `placeholder-date`
findings total across 1786 pages, each a legitimate template-string reference
that can be hand-patched in under a minute per page. This is orders of
magnitude smaller than the "system-wide false positive" I claimed before and
does not warrant a lint shim.

**Bonus finding that matters more:** a CLI-level lint shim would not help
`gbrain dream` anyway. `src/core/cycle.ts:349-352` invokes lint via
`const { runLintCore } = await import('../commands/lint.ts')` — an inline
dynamic import, not a `spawn`. Wrapping the `gbrain lint` CLI intercepts
only human invocations and our `kos-lint/run.ts` cron; dream's lint phase
bypasses any CLI wrapper by design.

**Practical implication**: withdraw the "Step 1.5 = lint shim" plan. If we
later want dream's lint phase to skip specific findings, the options are:
1. Pre-clean the handful of legitimate `YYYY-MM-DD` template references in
   page bodies before filesystem-canonical flip (one-time fix).
2. Run `gbrain dream` without lint phase (no CLI flag today — dream's
   `--phase` accepts exactly ONE phase, not a blacklist; see `src/commands/dream.ts:45-50`).
3. Accept the ~3-5 findings as daily noise in `gbrain dream`'s JSON report;
   they're `fixable: false` so they don't mutate content.

None of these are pre-migration blockers. This is a post-migration polish
decision.

**The actual hard dependency for `gbrain dream`** (any phase, including
read-only `--phase orphans`) is a configured brain directory. Verified with
`gbrain dream --phase orphans --dry-run` on our DB-native setup:

> `No brain directory found. Pass --dir <path> or configure one via ``gbrain init``.`

See `src/commands/dream.ts:98-101`. Unblocking dream IS the filesystem-canonical
migration — not a separable blocker.

### 5.3 `type:` / `kind:` 27% drift

Of 1786 pages, 487 (27%) have `type: != kind:`:

| drift | count | why |
|---|---:|---|
| `entity → person` | 375 | gbrain `PageType` has no `person`; we use `type: entity, kind: person` |
| `entity → company` | 85 | same — no `company` in upstream PageType |
| `concept → source` | 6 | older ingests set `type: concept` then `kind: source` |
| `concept → decision` | 6 | hand-authored decisions came in as `type: concept` |
| `concept → synthesis` | 4 | hand-authored syntheses |
| `concept → protocol` | 4 | hand-authored protocols |
| `concept → entity` | 3 | meta-entities (jarvis/openclaw/gbrain) |
| `concept → comparison` | 3 | hand-authored comparisons |
| `concept → timeline` | 1 | the one timeline page |

This is **not an export bug** — upstream's `PageType` enum is fixed and short,
and our 9 `kind` values exceed it. The question is: does re-importing these
files from filesystem round-trip the `kind:` correctly?

Verification plan (for Step 2 or a separate dry-run): import `/tmp/brain-export-
preview` into a throwaway PGLite, then compare `kind` column vs frontmatter
`kind`. Upstream `src/core/markdown.ts:parseMarkdown` only reads `type`, so
`kind` flows through as a pass-through frontmatter field. Likely OK but needs
one end-to-end verification.

### 5.4 `id: >-` block-scalar frontmatter — **withdrawn**

**This was not a real blocker.** DB probe via `BrainDb.listAllPages()`
confirmed all 1829 pages store `frontmatter.id` as plain strings — zero
contain literal newlines. The `id: >-` shape seen in 262 export files is
`matter.stringify` / js-yaml's automatic block-scalar choice for strings
exceeding ~80 chars. It's deterministic (same input → same output), so
git-VCS won't churn. Example: `source-sources/notion/re-action-needed-
new-support-ticket-assigned-974842fa-...` at 115 chars trips the
threshold.

The only observable downside was aesthetic. No data problem, no
round-trip risk (Step 1.6 confirmed `id` field survives serialize→parse
cleanly across all 1829 pages). Not worth a bulk rewrite.

Origin of the misreading: earlier draft of this report counted 262
`id: >-` appearances in the export tree and assumed they represented
legacy poller damage. Reading `src/core/markdown.ts:serializeMarkdown`
shows gray-matter's stringifier is the source of the line-folding —
pure presentation.

---

## 6. What **didn't** show up (negative signals that strengthen GO)

| Expected issue | Actually observed |
|---|---|
| Compiled-truth loss | 0 empty-body pages; body fully preserved |
| Timeline corruption | 749 pages use standard sentinel; no mojibake |
| Chinese encoding | UTF-8 clean across sampled Chinese pages |
| Broken `related:` refs | 46 relative-path refs look valid (not verified fully) |
| `raw_data` loss | 0 sidecars = nothing to lose |
| slug collisions at dir level | None (1786 unique `.md` paths) |
| frontmatter key drop | All 9 KOS-critical keys preserved when present |

---

## 7. Recommended next steps (order-dependent)

### ✅ Step 1.5 — Slug normalization (done 2026-04-23)

Delivered via new `skills/kos-jarvis/slug-normalize/` skill (SKILL.md +
run.ts). Three-mode:
- `--plan`: read-only preview, emits JSON with target pages + collision check
- `--apply`: transactional UPDATE (7 slug renames + 1 body rewrite)
- `--verify`: 15 post-apply assertions

All 15 assertions passed on 2026-04-23. Report at
`~/brain/agent/reports/slug-normalize-2026-04-23.md`. Total pages 1829 →
1829 (no drift). `id: >-` sub-task was withdrawn — see §5.4; it was
gray-matter line-folding, not data damage.

**Safety protocol that was followed** (record for future DB-write ops):

```bash
# 1. Hard-disable DB-writing launchd services (gui domain for user agents).
for svc in notion-poller kos-compat-api kos-patrol enrich-sweep kos-deep-lint; do
  launchctl disable user/$UID/com.jarvis.$svc
  launchctl bootout gui/$UID/com.jarvis.$svc 2>/dev/null || true
done
launchctl bootout gui/$UID/com.jarvis.cloudflared   # block external ingest
lsof ~/.gbrain/brain.pglite                         # must be empty

# 2. Fresh rolling backup (delete prior; keep one).
rm -rf ~/.gbrain/brain.pglite.pre-*
cp -R ~/.gbrain/brain.pglite ~/.gbrain/brain.pglite.pre-slug-normalize-$(date +%s)

# 3. Apply + verify.
bun run skills/kos-jarvis/slug-normalize/run.ts --plan    # must show check.clean=true
bun run skills/kos-jarvis/slug-normalize/run.ts --apply
bun run skills/kos-jarvis/slug-normalize/run.ts --verify  # must show ok=true

# 4. Re-enable services.
for svc in notion-poller kos-compat-api cloudflared kos-patrol enrich-sweep kos-deep-lint; do
  launchctl enable gui/$UID/com.jarvis.$svc
  launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.jarvis.$svc.plist
done
```

Two lessons captured:
- `launchctl bootout` requires `gui/$UID/…` domain for user-level
  LaunchAgents (not `user/$UID/…`). The latter reports success but
  doesn't actually kill the process.
- `gbrain export --help` has no help dispatch — unknown flags are
  silently ignored and it writes to default `./export/`. Always pass
  `--dir <path>` explicitly.
- Re-running `launchctl bootstrap` on services that `launchctl enable`
  already auto-loaded returns `Bootstrap failed: 5: Input/output error`.
  The service is actually in the correct state (loaded, awaiting
  StartInterval/Calendar). Verify via `launchctl list | grep jarvis`
  showing the service name, not by relying on bootstrap exit code.

### ✅ Step 1.6 — Markdown round-trip sanity (done 2026-04-23)

Delivered as `skills/kos-jarvis/slug-normalize/roundtrip-check.ts`
(TypeScript probe, no DB writes). Runs `serializeMarkdown → parseMarkdown`
on every page and compares 10 KOS-critical frontmatter fields
(`kind`, `status`, `confidence`, `source_of_truth`, `owners`,
`evidence_summary`, `source_refs`, `related`, `aliases`, `id`).

**Result**: 1829/1829 clean. 0 diffs across any field. Confirmed
`kind:` (and other KOS-specific keys) survive the upstream markdown
round-trip as pass-through frontmatter JSONB. The 27% type/kind drift
noted in §5.3 is safe to preserve as-is through filesystem-canonical flip.

Rejected the original plan of "throwaway PGLite via `gbrain init --path`
+ `gbrain import`" — `gbrain import` has no `--path` override, so it
would have required swapping `~/.gbrain/config.json.database_path` and
disabling all DB-writing services for the full window. Pure-function
round-trip gives equivalent confidence at zero DB risk.

### Step 2 — Flip `/ingest` to filesystem-first (next major anchor)

Only safe to start now that 1.5 + 1.6 are green. `server/kos-compat-api.ts`
/ingest handler changes from `spawnSync gbrain import <stdin>` to
file-write → `gbrain sync`; poller similarly. Configure
`sync.repo_path` so `gbrain dream` resolves without `--dir`. Git-track
the brain dir. Cut over launchd, verify, monitor one live Notion cycle.

Scope is multi-week. Not one session. See the new handoff doc for the
recommended first micro-step.

**Note on the post-migration lint phase**: once `gbrain dream` is wired,
its lint phase will surface ~3-5 legitimate `placeholder-date` findings
(see §5.2). Options at that point: (a) patch the bodies to wrap filename
templates in code spans, (b) accept the findings as non-fixable noise in
the nightly JSON report, (c) skip lint phase via `gbrain dream --phase
<not-lint>` (needs upstream enhancement for blacklist; today `--phase`
accepts a single phase only). Decide at that time, not now.

---

## 8. Appendix — raw numbers

Directory distribution:
```
people         375
companies       85
concepts       180
projects       210
decisions        6
sources        908   (47 flat + 860 notion + 1 ingest)
syntheses        4
comparisons      3
protocols        4
entities         3
timelines        1
root(stray)      7
—— total —— 1786
```

Artifact (deleted after audit):
- `/tmp/brain-export-preview/` — 17 MB, 1786 `.md`
- `./export/` — accidental same-content sibling, moved to /tmp then deleted

Commands used (reproducible):
```bash
gbrain export --dir /tmp/brain-export-preview   # ~2 min, 1786 pages
find /tmp/brain-export-preview -name "*.md" | wc -l
grep -rl "^kind:" /tmp/brain-export-preview --include="*.md" | wc -l
gbrain lint /tmp/brain-export-preview             # surfaces placeholder-date false positives
```
