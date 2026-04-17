---
name: notion-ingest-delta
version: 1.0.0
description: |
  New Week-3 capability. Adds Notion → GBrain incremental ingest via the
  existing kos-worker's @notionhq/workers backfill+delta pattern. Pulls
  Notion pages tagged #ingest-to-wiki (or under a specific database),
  converts to markdown, and calls kos-compat-api /ingest. Replaces KOS v1's
  "weekly manual scan" with a 5-minute delta sync.
triggers:
  - "sync notion"
  - "notion delta"
  - "pull from notion"
tools:
  - put_page
  - get_page
mutating: true
---

# notion-ingest-delta Skill

**This skill is implemented in the Notion Worker repo, not here.** What
lives in this directory is the design/contract — the actual TypeScript
sync belongs in
`~/Projects/jarvis-knowledge-os/workers/kos-worker/src/index.ts` as a
new capability named `notionToBrain` using the @notionhq/workers
backfill+delta pattern.

## Two-sync architecture (per @notionhq/workers best practice)

| Sync | Mode | Schedule | Purpose |
|------|------|----------|---------|
| `notionBackfill` | replace | manual | One-time full crawl of target database, cleans drift |
| `notionDelta` | incremental | 5m | Uses `last_edited_time > cursor` for changes |

Both syncs share a database handle + pacer, per standard worker layout.

## Trigger filter

Only pages with:
- property `Ingest` = `to-wiki` OR tag `#ingest-to-wiki` in title/body
- property `Status` != `archived`

## Payload shape (Notion → gbrain)

Each changed Notion page becomes:
```json
{
  "url": "https://www.notion.so/<page-id>",
  "slug": "<derived-slug>",
  "markdown": "<notion page rendered as markdown>",
  "source": "notion",
  "notion_id": "<page-id>",
  "last_edited": "<ISO timestamp>"
}
```

The sync's `execute()` handler:
1. Calls `notion.pages.retrieve(id)` via SDK
2. Renders blocks → markdown (use existing worker helper if present)
3. POSTs to `${KOS_API_BASE}/ingest` with the payload
4. Upserts a record in a local Notion DB ("KOS Ingest Log") tracking sync state

## kos-compat-api extension

`/ingest` endpoint needs to accept a `markdown` field in addition to
`url`. When `markdown` is present, skip the fetch step and write it
directly to staging with the Notion-sourced frontmatter:
```yaml
id: source-notion-<slug>
kind: source
source_of_truth: notion
source_refs:
  - <notion URL>
  - notion_id: <page-id>
tags: [notion-ingest]
```

## Failure modes to handle

- Notion page references other Notion pages → unfurl as plain text links
- Large pages (>100 blocks) → paginate fetch via `has_more` cursor
- Rate limits → share pacer with kos-worker's other syncs
- Deletes in Notion → don't delete from gbrain (sources are immutable);
  mark status=deprecated on the source page instead

## Implementation checklist (Week 3.2)

- [ ] Add `notionToBrain` database + backfill + delta in kos-worker src/index.ts
- [ ] Extend kos-compat-api `/ingest` to accept `markdown` payload
- [ ] Test backfill with a single Notion page tagged #ingest-to-wiki
- [ ] Test delta: edit the page, wait 5m, verify gbrain page updates
- [ ] Wire into autopilot (5-min schedule)
