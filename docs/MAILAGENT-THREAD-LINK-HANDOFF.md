# MailAgent handoff — emit thread links in KOS page payloads

**Date**: 2026-07-23 · **From**: KOS (jarvis-knowledge-os-v2) · **To**: mailagent
**Status**: requested · **KOS-side changes required**: none (pipeline already live)

## TL;DR

Add a tiny `## Thread` section to the markdown page `build_kos_page_payload()`
produces, containing root-relative markdown links to the **direct parent**
(In-Reply-To) and the **thread root** email. That is the whole ask. KOS's
daily link sweep (07:40, `com.jarvis.email-link-sweep`, live since
2026-07-23) extracts them automatically into graph edges — no KOS code
change, no new API, no schema coordination.

## Why (KOS-side context)

- `put_page` deliberately skips auto-link for remote MCP callers (security
  gate against prompt-injected edges). Edges for email pages are created
  after the fact by a daily KOS-side extraction sweep over page **content**.
- The sweep has two passes:
  1. **markdown-link pass** — extracts `[text](slug.md)` / `[[slug]]`
     syntax from the body. Today your v4 payloads contain **zero** such
     syntax, so this pass yields nothing for new emails.
  2. **entity-mention pass** — gazetteer match of entity display names in
     the body. Your metadata blockquote (From/To/CC display names) already
     feeds this well: 30,419 edges were built from it on 2026-07-23.
     **Nothing to do on your side for entities. Do NOT emit `people/...`
     links — entity slug/alias resolution is KOS's job.**
- The gap is **thread structure**: 1,199 threads in the corpus have ≥2
  emails (7,654 emails, ~60%), and only mailagent knows the
  In-Reply-To/References parent relationship at write time. KOS frontmatter
  carries `thread_id` but no parent pointer, so reply-chain edges cannot be
  reconstructed KOS-side with confidence (thread_id gives a bag, not a
  chain).

## The ask (payload change in `build_kos_page_payload()`)

1. Resolve, from mailagent SQLite at payload-build time:
   - `parent_id` — internal_id of the email this one replies to
     (via In-Reply-To → message_id lookup), if any and if that email was
     itself pushed to KOS *or ever will be* (see "dangling is safe" below —
     you do NOT need to check).
   - `root_id` — internal_id of the thread's first email, if ≠ parent and
     ≠ self.
2. Append a `## Thread` section to the body (after the metadata blockquote
   is fine):

   ```markdown
   ## Thread

   - In reply to: [RE: subject of parent](sources/email/{parent_id}.md)
   - Thread root: [subject of root](sources/email/{root_id}.md)
   ```

   Omit lines that don't apply (first email of a thread ⇒ no section at
   all). Link text is free-form; the **target must be exactly
   `sources/email/{internal_id}.md`** (root-relative, `.md` suffix,
   markdown-link form). `[[sources/email/{id}]]` wikilink form also
   resolves, but the markdown form is the one proven at scale (46,913
   historical edges).
3. Optionally also add `in_reply_to_email_id: {parent_id}` inside the
   `mailagent:` frontmatter block for auditability. KOS does not parse it
   today; it is provenance only.

## Constraints / guarantees

- **Dangling targets are safe.** If the parent was never ingested (priority
  floor, pre-history), the extractor silently drops the link — no error, no
  broken edge, nothing to check on your side.
- **Parent + root only.** Do not emit the full sibling list (the old
  digest-page pattern) — graph traversal reconstructs chains, and sibling
  lists bloat the 49KB budget.
- **Trim hierarchy**: the section is ~2 lines (~150 bytes). Keep it OUT of
  the first-to-trim tiers (attachments/AI-analysis) — treat it like
  metadata. Frontmatter rules unchanged.
- **Do NOT backfill by re-pushing old emails.** A content change re-chunks
  and re-embeds the page KOS-side; 12.7k re-pushes is real embedding spend.
  Forward-only. (If historical thread edges are ever wanted, KOS can build
  them from the `thread_id` frontmatter it already has, without touching
  content.)
- **Keep From/To/CC display names in the metadata blockquote** exactly as
  today — that is the entity-edge feed.

## Verification (KOS side will confirm)

After the change ships, any new reply email should show, the morning after
ingest (sweep runs 07:40 America/Los_Angeles):

```sql
-- on KOS prod
SELECT tp.slug, l.link_source FROM links l
JOIN pages fp ON fp.id = l.from_page_id
JOIN pages tp ON tp.id = l.to_page_id
WHERE fp.slug = 'sources/email/<new_id>' AND l.link_source = 'markdown';
-- expect: the parent/root email slugs
```

Ping Lucien / the KOS session with the first ingested reply's internal_id
and KOS will verify the edge landed.
