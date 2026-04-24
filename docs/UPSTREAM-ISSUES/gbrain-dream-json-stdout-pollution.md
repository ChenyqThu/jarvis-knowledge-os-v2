# Upstream issue: `gbrain dream --json` emits non-JSON preamble on stdout

> 2026-04-24 | jarvis-knowledge-os-v2 fork |
> **filed as [garrytan/gbrain#394](https://github.com/garrytan/gbrain/issues/394)**
> on 2026-04-24. Low priority (agents can defensively slice first `{`
> to last `}`). Remove the fork-local defensive slice in
> `skills/kos-jarvis/dream-wrap/run.ts` once upstream merges.

## Target repo

[garrytan/gbrain](https://github.com/garrytan/gbrain)

## Suggested title

`gbrain dream --dry-run --json` prints `[dry-run] Would embed ...` to
stdout before JSON CycleReport

## Body

### Observed

Running `gbrain dream --dry-run --json [--dir DIR]` prints a human-
readable preamble to stdout before the JSON:

```
$ gbrain dream --dry-run --json --dir ~/brain | head -3
[dry-run] Would embed 0 chunks across 1953 pages
{
  "schema_version": "1",
```

The JSON starts at byte 49 (offset varies with page/chunk counts).
Anything downstream that pipes stdout into `jq`, a JSON parser, or
`JSON.parse()` gets a parse error on the first non-whitespace char.

Reproduces on upstream 0.18.2 (release) and the current
jarvis-knowledge-os-v2 fork. Likely originates in `src/core/cycle.ts`
embed phase (or `src/commands/embed.ts`) — a `console.log` guarded
by `opts.dryRun` that didn't get the `--json` suppression treatment.

### Expected

With `--json`, stdout should be a single JSON document (or JSONL
stream). All progress / human-readable output should go to stderr.
This matches the documented contract in `docs/progress-events.md`:

> "Progress always writes to **stderr**. Stdout stays clean for data
> output (`--json` payloads, final summaries, JSON action events from
> `extract`)."

### Minimal reproducer

```bash
# Any brain with chunks that would otherwise embed.
gbrain dream --dry-run --json --dir ~/brain | python3 -c 'import sys, json; json.load(sys.stdin)'
# → json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
```

Compare `--dry-run` without `--json` — the preamble is fine there, that's
a legitimate user-facing message.

### Suggested fix

In the embed phase (src/core/cycle.ts:runPhaseEmbed or wherever the
`[dry-run] Would embed ...` line is emitted), gate the `console.log`
on `!opts.json`, matching how the rest of the cycle phases handle it.
Alternatively route the message to stderr via `process.stderr.write(...)`.

Search pattern to find the site:

```bash
rg --type ts 'Would embed' src/
```

### Why low priority for us

Our fork-local wrapper (`skills/kos-jarvis/dream-wrap/run.ts`)
defensively slices from the first `{` to the last `}` before JSON.parse,
so it tolerates the preamble. The `gbrain dream` cron runs nightly and
we consume its JSON from `~/brain/.agent/dream-cycles/latest.json` —
no production impact.

Filing this so the next agent that pipes `gbrain dream --json` doesn't
hit the same defensiveness requirement.
