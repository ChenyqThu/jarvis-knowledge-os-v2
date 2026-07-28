#!/usr/bin/env bun
/**
 * synthesis-topup/run.ts — turn spare budget into synthesized knowledge.
 *
 * synthesis-sweep already does the work and already has the knobs
 * (--source/--kind/--limit/--token-budget/--concurrency/--plan/--resume).
 * What it does NOT do is answer "I have $N to spend tonight — on what?":
 * it takes one --source at a time, orders by neighbor count within that
 * source, and has no notion of a spend ceiling. This wrapper answers that
 * question and then calls it.
 *
 * Three things it adds, all of them lessons from 2026-07-27/28:
 *
 *   1. Cross-source ranking. The gap spans `default` + `mailagent-emails`
 *      + `omada`, and the best remaining targets are not evenly spread.
 *      Ranking per-source spends the budget on whichever source you happened
 *      to name rather than on the best pages in the brain.
 *   2. Cost from measurement, not guesswork. Per-entity spend is read out of
 *      synthesis-sweep's own checkpoint (in_tokens/out_tokens it already
 *      records), so the estimate tracks reality as the corpus grows.
 *   3. Plan by default. Writing is opt-in behind --go. A batch job that
 *      writes to 30k production pages on the strength of an unverified
 *      assumption is exactly how 614 pages got clobbered.
 *
 * Usage:
 *   bun run skills/kos-jarvis/synthesis-topup/run.ts                  # what's the gap?
 *   bun run skills/kos-jarvis/synthesis-topup/run.ts --budget-usd 50  # plan a $50 run
 *   bun run skills/kos-jarvis/synthesis-topup/run.ts --budget-usd 50 --go
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Mirrored from synthesis-sweep/run.ts — the plan is only honest if the
// candidate set is computed exactly the way the tool that runs will compute it.
const ENTITY_TYPES = ["person", "company", "concept", "project", "entity"];
const NEIGHBOR_TYPES = ["email", "source"];
const CHECKPOINT = join(homedir(), ".cache", "kos-jarvis", "synthesis-sweep", "all.jsonl");
const SWEEP = "skills/kos-jarvis/synthesis-sweep/run.ts";
const MODEL = process.env.GBRAIN_SYNTHESIS_MODEL ?? "claude-sonnet-5";

// USD per 1M tokens. Only the families this fork actually routes to.
const PRICING: Record<string, { in: number; out: number }> = {
  opus: { in: 15, out: 75 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 0.8, out: 4 },
};

function priceFor(model: string) {
  const fam = /opus/.test(model) ? "opus" : /haiku/.test(model) ? "haiku" : "sonnet";
  return { fam, ...PRICING[fam] };
}

type Flags = { budgetUsd?: number; minNeighbors: number; go: boolean; concurrency: number; help: boolean };

function parseFlags(argv: string[]): Flags {
  const f: Flags = { minNeighbors: 3, go: false, concurrency: 3, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--budget-usd") f.budgetUsd = Number(argv[++i]);
    else if (a === "--min-neighbors") f.minNeighbors = Number(argv[++i]);
    else if (a === "--concurrency") f.concurrency = Number(argv[++i]);
    else if (a === "--go") f.go = true;
    else if (a === "--help" || a === "-h") f.help = true;
  }
  return f;
}

function psql(sql: string): string[][] {
  const dbUrl = process.env.DATABASE_URL
    ?? `postgresql://${process.env.USER ?? "chenyuanquan"}@127.0.0.1:5432/gbrain`;
  const r = spawnSync("psql", [dbUrl, "-At", "-F", "\t", "-c", sql], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
}

/** Per-entity cost, measured from what synthesis-sweep actually spent. */
function measuredCost(): { usd: number; n: number; inTok: number; outTok: number } | null {
  if (!existsSync(CHECKPOINT)) return null;
  const rows = readFileSync(CHECKPOINT, "utf8").trim().split("\n")
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r): r is Record<string, number> => !!r && typeof r.in_tokens === "number");
  if (!rows.length) return null;
  const inTok = rows.reduce((a, r) => a + (r.in_tokens || 0), 0) / rows.length;
  const outTok = rows.reduce((a, r) => a + (r.out_tokens || 0), 0) / rows.length;
  const p = priceFor(MODEL);
  return { usd: (inTok * p.in + outTok * p.out) / 1e6, n: rows.length, inTok, outTok };
}

/** Pairs already synthesized, keyed exactly as synthesis-sweep keys them. */
function doneSet(): Set<string> {
  const done = new Set<string>();
  if (!existsSync(CHECKPOINT)) return done;
  for (const line of readFileSync(CHECKPOINT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.slug && r.source_id) done.add(`${r.source_id}\t${r.slug}`);
    } catch { /* skip malformed */ }
  }
  return done;
}

function main() {
  const f = parseFlags(process.argv.slice(2));
  if (f.help) {
    console.log(`synthesis-topup — spend a budget on the best remaining synthesis targets

  --budget-usd N     How much to spend. Without it, this only reports the gap.
  --min-neighbors N  Minimum linked email/source pages (default 3). Below ~3
                     there is too little material to synthesize from.
  --concurrency N    Passed through to synthesis-sweep (default 3).
  --go               Actually run. Default is plan-only.
`);
    return;
  }

  const cost = measuredCost();
  const p = priceFor(MODEL);
  if (!cost) {
    console.error(`✗ no checkpoint at ${CHECKPOINT} — run synthesis-sweep --plan once first.`);
    process.exit(1);
  }
  console.log(`model: ${MODEL} (${p.fam} pricing $${p.in}/$${p.out} per 1M)`);
  console.log(`measured from ${cost.n} past entities: ~${Math.round(cost.inTok)} in + ${Math.round(cost.outTok)} out tokens = $${cost.usd.toFixed(2)}/entity\n`);

  // Same shape as synthesis-sweep's target query, minus its --source scoping.
  const rows = psql(`
    SELECT e.source_id, e.type, e.slug, count(DISTINCT nb.id) AS n
    FROM pages e
    JOIN links l ON (l.to_page_id = e.id OR l.from_page_id = e.id)
    JOIN pages nb ON nb.id = (CASE WHEN l.from_page_id = e.id THEN l.to_page_id ELSE l.from_page_id END)
    WHERE e.deleted_at IS NULL
      AND e.source_id <> 'gbrain-docs'
      AND e.type = ANY(ARRAY[${ENTITY_TYPES.map((t) => `'${t}'`).join(",")}])
      AND nb.type = ANY(ARRAY[${NEIGHBOR_TYPES.map((t) => `'${t}'`).join(",")}])
      AND nb.deleted_at IS NULL
    GROUP BY e.source_id, e.type, e.slug
    HAVING count(DISTINCT nb.id) >= ${f.minNeighbors}
    ORDER BY n DESC;`);

  const done = doneSet();
  const todo = rows
    .map(([source_id, type, slug, n]) => ({ source_id, type, slug, n: Number(n) }))
    .filter((r) => !done.has(`${r.source_id}\t${r.slug}`));

  console.log(`gap: ${todo.length} entities with >=${f.minNeighbors} neighbors and no dossier`);
  console.log(`     full cost if you did all of them: $${(todo.length * cost.usd).toFixed(0)}\n`);

  const bySource = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const r of todo) {
    bySource.set(r.source_id, (bySource.get(r.source_id) ?? 0) + 1);
    byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  }
  console.log("  by source: " + [...bySource].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));
  console.log("  by type:   " + [...byType].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));

  if (f.budgetUsd === undefined) {
    console.log(`\n(no --budget-usd given — reporting only. Top 10 remaining targets:)`);
    for (const r of todo.slice(0, 10)) console.log(`  ${String(r.n).padStart(5)} nb  ${r.source_id}/${r.slug}`);
    return;
  }

  const affordable = Math.floor(f.budgetUsd / cost.usd);
  const batch = todo.slice(0, affordable);
  if (!batch.length) {
    console.log(`\n$${f.budgetUsd} buys ${affordable} entities — nothing to do.`);
    return;
  }

  // synthesis-sweep takes one --source per invocation and orders by neighbor
  // count within it, so a global top-N becomes one call per source with a
  // --limit sized to that source's share of the batch. Ordering matches
  // (both DESC by neighbors), so the per-source prefix IS the global pick.
  const share = new Map<string, number>();
  for (const r of batch) share.set(r.source_id, (share.get(r.source_id) ?? 0) + 1);

  console.log(`\n=== plan: $${f.budgetUsd} → ${batch.length} entities (neighbors ${batch[batch.length - 1].n}..${batch[0].n}) ===`);
  const cmds: string[][] = [];
  for (const [src, count] of [...share].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${count} entities  ~$${(count * cost.usd).toFixed(0)}`);
    cmds.push(["run", SWEEP, "--source", src, "--limit", String(count),
               "--min-neighbors", String(f.minNeighbors), "--concurrency", String(f.concurrency), "--resume"]);
  }

  if (!f.go) {
    console.log(`\n(plan only — re-run with --go to execute, or run these directly:)`);
    for (const c of cmds) console.log(`  bun ${c.join(" ")}`);
    return;
  }

  for (const c of cmds) {
    console.log(`\n$ bun ${c.join(" ")}`);
    const r = spawnSync("bun", c, { stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`✗ sweep exited ${r.status} — stopping (later sources not run).`);
      process.exit(r.status ?? 1);
    }
  }
}

main();
