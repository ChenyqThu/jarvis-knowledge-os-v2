/**
 * report.ts — dry-run/apply report (markdown) + JSON sidecar (rollback manifest).
 *
 * Report dir mirrors orphan-reducer: ~/brain/.agent/reports/. The JSON sidecar
 * records every committed merge so a merge can be understood/undone later
 * (undo is manual — see SKILL.md Rollback; the pre-run pg_dump is the real
 * safety net).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { VariantCluster } from "./candidates.ts";
import type { ClusterVerdict } from "./classifier.ts";
import type { MergeResult } from "./merge.ts";

const REPORT_DIR = process.env.KOS_REPORT_DIR ?? join(homedir(), "brain", ".agent", "reports");

export type ClusterRecord = {
  cluster: VariantCluster;
  verdict: ClusterVerdict;
  results: MergeResult[]; // one per accepted merge decision
};

export type RunSummary = {
  isoStamp: string;
  mode: "dry-run" | "apply";
  source: string | null;
  minSim: number;
  minConfidence: number;
  model: string;
  clustersScanned: number;
  mergesProposed: number;
  mergesAccepted: number;
  mergesCommitted: number;
  ambiguousGroups: number;
  distinctGroups: number;
  aliasPagesRetired: number;
  linksRepointed: number;
  linksPruned: number;
  factsMoved: number;
  costUsd: number;
  records: ClusterRecord[];
};

function mdTable(rows: string[][], header: string[]): string {
  const line = (cols: string[]) => `| ${cols.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

export function renderMarkdown(s: RunSummary): string {
  const out: string[] = [];
  out.push(`# entity-dedup — ${s.mode} — ${s.isoStamp}`);
  out.push("");
  out.push(
    `Source: \`${s.source ?? "(all)"}\` · min-sim ${s.minSim} · min-confidence ${s.minConfidence} · model \`${s.model}\``
  );
  out.push("");
  out.push("## Summary");
  out.push("");
  out.push(
    mdTable(
      [
        ["clusters scanned", String(s.clustersScanned)],
        ["merges proposed (LLM)", String(s.mergesProposed)],
        ["merges accepted (≥ min-confidence)", String(s.mergesAccepted)],
        [s.mode === "apply" ? "merges COMMITTED" : "merges simulated (rolled back)", String(s.mergesCommitted)],
        ["ambiguous groups (quarantined, not merged)", String(s.ambiguousGroups)],
        ["distinct groups (rejected)", String(s.distinctGroups)],
        ["alias pages retired", String(s.aliasPagesRetired)],
        ["links repointed", String(s.linksRepointed)],
        ["redundant links pruned", String(s.linksPruned)],
        ["facts moved", String(s.factsMoved)],
        ["classifier cost (USD)", `$${s.costUsd.toFixed(4)}`],
      ],
      ["metric", "value"]
    )
  );
  out.push("");

  out.push("## Accepted merges");
  out.push("");
  const acc: string[][] = [];
  for (const rec of s.records) {
    for (const r of rec.results) {
      if (!r.ok) continue;
      acc.push([
        `\`${r.spec.source}\``,
        `\`${r.spec.canonical}\``,
        r.spec.aliases.map((a) => `\`${a}\``).join(", "),
        `${r.before.canon_indeg}→${r.after.canon_indeg}`,
        String(r.inbound_repointed + r.outbound_repointed),
        String(
          r.inbound_collisions_dropped +
            r.outbound_collisions_dropped +
            r.inbound_selfloops_dropped +
            r.outbound_selfloops_dropped
        ),
        String(r.facts_moved),
        r.applied ? "committed" : "dry",
      ]);
    }
  }
  out.push(
    acc.length
      ? mdTable(acc, ["source", "canonical", "aliases", "indeg", "repointed", "pruned", "facts", "state"])
      : "_none_"
  );
  out.push("");

  out.push("## Ambiguous (quarantined — needs human decision, NOT merged)");
  out.push("");
  const amb: string[] = [];
  for (const rec of s.records) {
    for (const g of rec.verdict.ambiguous) {
      amb.push(`- \`${rec.cluster.source}\` ${g.slugs.map((x) => `\`${x}\``).join(" / ")} — ${g.reason}`);
    }
  }
  out.push(amb.length ? amb.join("\n") : "_none_");
  out.push("");

  out.push("## Distinct (rejected — different real entities)");
  out.push("");
  const dis: string[] = [];
  for (const rec of s.records) {
    for (const g of rec.verdict.distinct) {
      dis.push(`- \`${rec.cluster.source}\` ${g.slugs.map((x) => `\`${x}\``).join(" / ")} — ${g.reason}`);
    }
  }
  out.push(dis.length ? dis.join("\n") : "_none_");
  out.push("");

  const errs: string[] = [];
  for (const rec of s.records) {
    for (const r of rec.results) {
      if (r.ok) continue;
      errs.push(`- \`${r.spec.canonical}\` ← ${r.spec.aliases.join(", ")}: ${r.error}`);
    }
  }
  if (errs.length) {
    out.push("## Errors");
    out.push("");
    out.push(errs.join("\n"));
    out.push("");
  }

  return out.join("\n");
}

export function writeReport(s: RunSummary): { md: string; json: string } {
  mkdirSync(REPORT_DIR, { recursive: true });
  const base = join(REPORT_DIR, `entity-dedup-${s.isoStamp}`);
  const md = `${base}.md`;
  const json = `${base}.md.json`;
  writeFileSync(md, renderMarkdown(s), "utf8");
  writeFileSync(
    json,
    JSON.stringify(
      {
        ...s,
        records: s.records.map((rec) => ({
          source: rec.cluster.source,
          dir: rec.cluster.dir,
          members: rec.cluster.members.map((m) => ({ slug: m.slug, indeg: m.indeg, facts: m.facts })),
          verdict: rec.verdict,
          results: rec.results,
        })),
      },
      null,
      2
    ),
    "utf8"
  );
  return { md, json };
}
