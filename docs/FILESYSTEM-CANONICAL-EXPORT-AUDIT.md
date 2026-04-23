# Filesystem-canonical migration — Step 1 audit (export dry-run)

> 2026-04-22 | Lucien × Jarvis | read after JARVIS-ARCHITECTURE §6.8
> Input: whole PGLite brain at `~/.gbrain/brain.pglite` (schema v16, 1786 pages)
> Method: `gbrain export` → `/tmp/brain-export-preview/` → structural + frontmatter audit
> Artifact cleaned after audit; numbers captured here for future sessions.

## Verdict: **GO, with 4 pre-migration blockers**

The upstream `gbrain export` faithfully materializes our 1786-page KOS brain to a
markdown tree. KOS-critical frontmatter is preserved end-to-end, the directory
layout is predictable (slug-prefix → dir), and there's zero DB-only data (no
`.raw/*.json` sidecars anywhere). This path is viable.

Four blockers that must be solved before flipping the `/ingest` write path to
filesystem-first are detailed in §5. None of them are deal-breakers — they're
known scope, ~1 week of focused work total.

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

### 5.2 Upstream `gbrain lint` flags KOS evidence tags as `placeholder-date`

Running `gbrain lint /tmp/brain-export-preview` fires `placeholder-date` on
pages using KOS evidence-tag syntax like `[E3]` or `[10]+`. Example from the
first 26% of the lint run (cut short by timeout):

> `concepts/user-modeling-spec.md:L42 placeholder-date: Placeholder date found: 1. **日记层**：`memory/YYYY-MM-DD.md` 中的 [10]+ 条目`

The detector interprets bracketed tokens as unfilled date placeholders. This
would produce thousands of false positives when `gbrain dream` runs its lint
phase nightly.

Options:
1. **Fork-local lint plugin** — skip `placeholder-date` when the tag matches
   `[E\d]`, `[\d+]+`, `[E\d]:`. Lives in `skills/kos-jarvis/*`, wraps
   `gbrain lint` via a CLI shim. No src/* edit. ~40 LOC.
2. **Upstream lint carve-out** — file issue, add config key
   `lint.placeholder_date.exclude_patterns: ["\\[E\\d\\]", ...]`.
   Merge-conflict tax on every sync.
3. **Pre-process** — run a `.md` normalizer before lint that escapes KOS tags
   to `\[E3\]`. Dirty and reversible.

Option 1 is the right one per fork policy. Tracked below as the real P1 blocker.

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

### 5.4 `id: >-` block-scalar frontmatter (262 pages)

Ugly legacy from the pre-fix Notion poller. Each affected page has:
```yaml
id: >-
  source-sources/notion/re-unanswered-tickets-update-33c15375830d81dba5d0f51fe9c2b41d
```
instead of a quoted one-liner. Parseable YAML, but any re-export → re-import
round-trip may reformat and diff-churn. Candidate for one-time bulk rewrite
before filesystem-canonical flip.

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

1. **Step 1.5 — KOS lint shim** (the real P1 before any migration).
   Write `skills/kos-jarvis/kos-lint-shim/run.ts` that wraps `gbrain lint` and
   filters false-positive `placeholder-date` for `[E\d]` / `[\d+]+` tokens.
   ~40 LOC. No src/* touch. Unblocks dream.

2. **Step 1.6 — Slug normalization pass**. One-time bulk rewrite:
   - 7 root stray → prefix with `concepts/` or `sources/`
   - 262 `id: >-` → quoted one-liner
   - (optional) v1 wiki 85 pages → move into `sources/wiki/`
   Needs DB-side slug rewrite + new `gbrain extract links` pass.

3. **Step 1.7 — Round-trip sanity check**. `gbrain export` →
   `gbrain import --dry-run` into throwaway PGLite → diff `kind` / `status` /
   `confidence` columns to prove nothing is lost on re-ingest. This is the
   last gate before Step 2.

4. **Step 2 — Flip `/ingest` to filesystem-first**. Only after 1.5/1.6/1.7.

Steps 1.5 + 1.6 + 1.7 fit in **one session each**. Full migration stays
multi-week per TODO estimate.

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
