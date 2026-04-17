# enrich-sweep — {{date}}

Started: {{started}}
Finished: {{finished}}
Mode: {{mode}}  (DRY | PLAN | LIVE)

## Inventory
- Source pages scanned: {{total_pages}}
- Raw extractions: {{total_extractions}}
- Unique entities after dedupe: {{unique_entities}}
- Pre-existing entity pages skipped: {{pre_existing}}
- NER errors: {{extraction_errors}}

## Tier distribution
- Tier 2 (Tavily-augmented): {{tier2_count}}
- Tier 3 (brain-only): {{tier3_count}}

## Kind distribution
- person: {{kind_person}}
- company: {{kind_company}}
- concept: {{kind_concept}}
- project: {{kind_project}}

## Stubs
- Written: {{stubs_written}}
- Failed: {{stubs_failed}}
- Tavily calls: {{tavily_calls}}

### Created slugs
{{#created_slugs}}
- `{{slug}}`
{{/created_slugs}}

### Failed slugs
{{#failed_slugs}}
- `{{slug}}`
{{/failed_slugs}}

## Tier 1 blocked (wanted Tier 1, no Crustdata key)
{{#tier1_blocked}}
- {{name}}
{{/tier1_blocked}}

## Candidate preview (top 30 by mentions)

| Tier | Kind | Slug | Mentions | Sources |
|------|------|------|----------|---------|
{{#candidates}}
| {{tier}}{{tier1_flag}} | {{kind}} | `{{slug}}` | {{mentions}} | {{sources}} |
{{/candidates}}

_`*` next to tier = wanted Tier 1, degraded due to missing Crustdata key._

## Rollback

```bash
{{#created_slugs}}
gbrain delete {{slug}}
{{/created_slugs}}
```

---

**Template note**: This file documents the shape of the generated report
for reference. `run.ts` produces the real report directly with string
concatenation (no templating engine dependency); this file is a
human-readable spec for reviewers.
