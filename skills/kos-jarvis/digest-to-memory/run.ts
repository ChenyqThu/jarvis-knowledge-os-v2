#!/usr/bin/env bun
/**
 * digest-to-memory/run.ts — push latest kos-patrol digest to OpenClaw MEMORY.md
 *
 * See ./SKILL.md for protocol details. This is the KOS → OpenClaw reflux
 * bridge that KOS v1 had as `kos digest | append-to-memory` and that the
 * migration plan explicitly preserves.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BRAIN = process.env.GBRAIN_HOME ?? join(homedir(), "brain");
const DIGEST_DIR = join(BRAIN, ".agent", "digests");
const LOG = join(BRAIN, "log.md");
const MEMORY = join(homedir(), ".openclaw", "workspace", "MEMORY.md");

function usage() {
  console.log("usage: bun run run.ts [--dry] [--week YYYY-MM-DD]");
}

function latestDigest(weekFilter?: string): { path: string; content: string } | null {
  if (!existsSync(DIGEST_DIR)) return null;
  const files = readdirSync(DIGEST_DIR)
    .filter((f) => f.startsWith("patrol-") && f.endsWith(".md"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  let pick = files[0];
  if (weekFilter) {
    const match = files.find((f) => f.includes(weekFilter));
    if (!match) {
      console.error(`no digest found for week ${weekFilter}`);
      process.exit(1);
    }
    pick = match;
  }
  const path = join(DIGEST_DIR, pick);
  return { path, content: readFileSync(path, "utf-8") };
}

function extractKnowledgeBlock(raw: string, dateStr: string): string {
  // If the digest already has a formatted [knowledge-os] block, grab it.
  const m = raw.match(/\[knowledge-os\][\s\S]*?(?=\n\n|\n##|$)/);
  if (m) return m[0].trim() + "\n";
  // Otherwise synthesize a minimal block from the dashboard text.
  const head = raw.split("\n").slice(0, 40).join("\n");
  return `[knowledge-os] ${dateStr} digest (auto-synthesized):\n${head
    .split("\n")
    .map((l) => "  " + l)
    .join("\n")}\n`;
}

function main() {
  const dry = process.argv.includes("--dry");
  const weekIdx = process.argv.indexOf("--week");
  const week = weekIdx >= 0 ? process.argv[weekIdx + 1] : undefined;
  if (process.argv.includes("--help") || process.argv.includes("-h")) return usage();

  const digest = latestDigest(week);
  if (!digest) {
    console.error(`no patrol digest found in ${DIGEST_DIR}`);
    console.error("run `gbrain exec kos-patrol` (or the wrapped script) first");
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const block = extractKnowledgeBlock(digest.content, today);

  if (!existsSync(MEMORY)) {
    console.error(`MEMORY.md not found at ${MEMORY}`);
    console.error("appending to local marker instead");
    const marker = join(BRAIN, ".agent", "memory-marker.md");
    if (!dry) appendFileSync(marker, `\n${block}\n`);
    console.log(`wrote marker to ${marker} (dry=${dry})`);
    process.exit(0);
  }

  const existing = readFileSync(MEMORY, "utf-8");
  // Dedupe: skip if an entry for this date already exists
  if (existing.includes(`[knowledge-os] ${today}`)) {
    console.log(`already appended for ${today}; skipping`);
    return;
  }

  // Find 近期层 section; fallback: end of file
  const marker = /^##\s+(近期层|Recent)\s*$/m;
  let newContent: string;
  if (marker.test(existing)) {
    newContent = existing.replace(marker, (m) => `${m}\n\n${block}`);
  } else {
    newContent = existing.trimEnd() + `\n\n${block}`;
  }

  if (dry) {
    console.log("--- DRY RUN: would append ---");
    console.log(block);
    console.log("--- end ---");
    return;
  }

  writeFileSync(MEMORY, newContent, "utf-8");
  const bytes = Buffer.byteLength(block, "utf-8");
  console.log(`appended ${bytes} bytes to ${MEMORY}`);
  if (existsSync(LOG)) {
    appendFileSync(LOG, `${today} | digest-to-memory | appended ${bytes} bytes to MEMORY.md\n`);
  }
}

main();
