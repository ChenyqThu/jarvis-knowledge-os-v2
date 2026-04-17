/**
 * stub.ts — render entity stub markdown and persist via `gbrain put`.
 *
 * Templates follow docs/GBRAIN_RECOMMENDED_SCHEMA.md §Person and §Company.
 * Concepts/projects use simpler templates (no State/Network sections).
 */
import { spawnSync } from "node:child_process";
import type { EntityKind } from "./ner.ts";

export type Tier = 2 | 3;

export type StubInput = {
  slug: string;              // e.g. "people/sarah-guo"
  name: string;
  aliases: string[];          // canonical + observed variants
  kind: EntityKind;
  tier: Tier;
  mention_count: number;
  source_slugs: string[];     // pages that mention this entity
  first_mention_date?: string; // YYYY-MM-DD
  tavily_block?: string;      // pre-condensed Tier 2 web snippet
  seed_context: string;       // 1-2 quotes from source pages
  tier1_blocked?: boolean;    // mention ≥ 8 but no Crustdata
};

export type WriteResult = {
  slug: string;
  ok: boolean;
  message: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // diacritics
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function chooseSlug(name: string, kind: EntityKind): string {
  const base = slugify(name);
  const dir = {
    person: "people",
    company: "companies",
    concept: "concepts",
    project: "projects",
  }[kind];
  return `${dir}/${base}`;
}

function yamlList(items: string[]): string {
  if (items.length === 0) return "[]";
  return "\n" + items.map((i) => `  - ${JSON.stringify(i)}`).join("\n");
}

function escapeYamlValue(s: string): string {
  if (/[:#\n"']/.test(s) || s.trim() !== s) return JSON.stringify(s);
  return s;
}

export function renderFrontmatter(input: StubInput): string {
  const created = today();
  const sot = input.tier === 2 && input.tavily_block ? "tavily+brain" : "brain-synthesis";
  const confidence = input.tier === 2 ? "medium" : "low";
  const id = `${input.kind}-${slugify(input.name)}`;

  const tags = ["auto-stub", "enrich-sweep"];
  if (input.tier1_blocked) tags.push("wants-tier1");

  const lines = [
    "---",
    `type: ${input.kind === "person" || input.kind === "company" ? "entity" : input.kind}`,
    `kind: ${input.kind}`,
    `id: ${id}`,
    `title: ${escapeYamlValue(input.name)}`,
    `owners:`,
    `  - jarvis`,
    `status: draft`,
    `created: '${created}'`,
    `updated: '${created}'`,
    `confidence: ${confidence}`,
    `source_of_truth: ${sot}`,
    `aliases:${yamlList(input.aliases)}`,
    `tags:${yamlList(tags)}`,
    "---",
  ];
  return lines.join("\n");
}

function personBody(input: StubInput): string {
  const firstMention = input.first_mention_date ?? today();
  const timelineEntries = input.source_slugs.map(
    (s) => `- **${firstMention}** | [${s}](${s}.md) — mentioned`,
  );
  const related = input.source_slugs.map((s) => `- [${s}](${s}.md)`);

  const state = input.tavily_block?.trim()
    ? input.tavily_block.trim()
    : `- Role: unknown (stub auto-created from ${input.mention_count} brain mentions)
- Company: unknown
- Relationship: unknown
- Key context: ${input.seed_context.slice(0, 240)}`;

  return [
    `# ${input.name}`,
    "",
    `> Auto-stub created ${today()} from ${input.mention_count} mention${input.mention_count === 1 ? "" : "s"} across ${input.source_slugs.length} source${input.source_slugs.length === 1 ? "" : "s"}. Needs human review before confidence is raised.`,
    "",
    "## State",
    state,
    "",
    "## What They Believe",
    "_unknown — enrich later_",
    "",
    "## What They're Building",
    "_unknown — enrich later_",
    "",
    "## Assessment",
    "- Confidence: low",
    `- Last assessed: ${today()} (auto-stub)`,
    "",
    "## Network",
    "_connections to populate during manual review_",
    "",
    "## Open Threads",
    `- [ ] Verify name and role (stub created from brain mentions only${input.tavily_block ? ", augmented with Tavily snippet" : ""})`,
    input.tier1_blocked ? "- [ ] Candidate for Tier 1 enrichment (mention≥8); blocked on missing Crustdata key" : "",
    "",
    "## Mentioned in",
    ...related,
    "",
    "---",
    "",
    "## Timeline",
    ...timelineEntries,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

function companyBody(input: StubInput): string {
  const firstMention = input.first_mention_date ?? today();
  const timelineEntries = input.source_slugs.map(
    (s) => `- **${firstMention}** | [${s}](${s}.md) — mentioned`,
  );
  const related = input.source_slugs.map((s) => `- [${s}](${s}.md)`);

  const state = input.tavily_block?.trim()
    ? input.tavily_block.trim()
    : `- What: unknown (stub auto-created from ${input.mention_count} brain mentions)
- Stage: unknown
- Key people: unknown
- Connection: ${input.seed_context.slice(0, 240)}`;

  return [
    `# ${input.name}`,
    "",
    `> Auto-stub created ${today()} from ${input.mention_count} mention${input.mention_count === 1 ? "" : "s"} across ${input.source_slugs.length} source${input.source_slugs.length === 1 ? "" : "s"}. Needs human review before confidence is raised.`,
    "",
    "## State",
    state,
    "",
    "## Open Threads",
    "- [ ] Verify company name and identity (stub from brain mentions only)",
    input.tier1_blocked ? "- [ ] Candidate for Tier 1 enrichment (mention≥8); blocked on missing Crustdata key" : "",
    "",
    "## Mentioned in",
    ...related,
    "",
    "---",
    "",
    "## Timeline",
    ...timelineEntries,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

function conceptOrProjectBody(input: StubInput): string {
  const related = input.source_slugs.map((s) => `- [${s}](${s}.md)`);
  return [
    `# ${input.name}`,
    "",
    `> Auto-stub created ${today()} from ${input.mention_count} brain mention${input.mention_count === 1 ? "" : "s"}.`,
    "",
    "## Context",
    input.seed_context,
    "",
    "## Mentioned in",
    ...related,
  ].join("\n");
}

export function renderStub(input: StubInput): string {
  const fm = renderFrontmatter(input);
  let body: string;
  if (input.kind === "person") body = personBody(input);
  else if (input.kind === "company") body = companyBody(input);
  else body = conceptOrProjectBody(input);
  return `${fm}\n\n${body}\n`;
}

export function writeStub(input: StubInput, dryRun: boolean): WriteResult {
  const md = renderStub(input);
  if (dryRun) {
    return { slug: input.slug, ok: true, message: `[dry] would write ${md.length}B to ${input.slug}` };
  }
  const r = spawnSync("gbrain", ["put", input.slug, "--content", md], {
    encoding: "utf-8",
  });
  if (r.status === 0) {
    return { slug: input.slug, ok: true, message: r.stdout.trim().slice(0, 200) || "ok" };
  }
  return {
    slug: input.slug,
    ok: false,
    message: `gbrain put failed (exit ${r.status}): ${(r.stderr || r.stdout).trim().slice(0, 300)}`,
  };
}
