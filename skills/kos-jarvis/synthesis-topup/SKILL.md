---
name: synthesis-topup
version: 1.0.0
description: |
  Spend a stated budget on the best remaining synthesis targets across every
  source. Answers "I have $N spare tonight — what should it buy?", which
  synthesis-sweep cannot: that tool takes one --source at a time and has no
  spend ceiling. Reports the gap by default; writing is opt-in behind --go.
triggers:
  - "补充综合"
  - "synthesis topup"
  - "spend budget on synthesis"
  - "把富余 token 转成知识"
mutating: true
---

# synthesis-topup

A thin wrapper over [`synthesis-sweep`](../synthesis-sweep/SKILL.md). It does
not synthesize anything itself — it decides *what* to synthesize, then calls
the sweep.

```bash
bun run skills/kos-jarvis/synthesis-topup/run.ts                  # what's the gap?
bun run skills/kos-jarvis/synthesis-topup/run.ts --budget-usd 50  # plan a $50 run
bun run skills/kos-jarvis/synthesis-topup/run.ts --budget-usd 50 --go
```

## Why it exists

`synthesis-sweep` already has the knobs. Three things it does not do:

1. **Rank across sources.** The gap is spread over `default`,
   `mailagent-emails` and `omada`, unevenly. Ranking inside one source spends
   the budget on whichever source you named, not on the best pages you own.
2. **Price the work from evidence.** Per-entity cost is read from the sweep's
   own checkpoint (`~/.cache/kos-jarvis/synthesis-sweep/all.jsonl`, which
   records `in_tokens`/`out_tokens`), so the estimate tracks reality instead
   of a number someone remembered. Measured 2026-07-28 over 2,566 past
   entities: ~87k in + 3.1k out ≈ **$0.31/entity** at `claude-sonnet-5`.
3. **Refuse to write by default.** Plan-only unless `--go`.

## Reading the output

```
gap: 2266 entities with >=3 neighbors and no dossier
     full cost if you did all of them: $699
  by source: mailagent-emails=2248  default=15  omada=3
  by type:   concept=1135  project=909  entity=221  person=1
```

`person` near zero is correct, not a bug — people and companies already sit at
~99% synthesized in both real sources. **The standing gap is `concept` and
`project`**, and it always will be until something other than the dream cycle
works on them.

## Cautions

- **`--min-neighbors` is a quality floor, not a performance knob.** Below ~3
  linked pages there is not enough material for a dossier, and the model will
  pad. Lowering it buys more pages and less knowledge.
- **Verify a small batch before a large one.** `--budget-usd 5` first. The
  cost model is an average over a heavy-tailed distribution: an entity with
  1,200 neighbors costs far more than the mean, and the top of the queue is
  exactly where those live.
- The sweep is checkpointed per `(source_id, slug)`, so re-running is cheap
  and never re-pays for a finished dossier. `--go` stops at the first source
  that exits non-zero rather than pressing on.
