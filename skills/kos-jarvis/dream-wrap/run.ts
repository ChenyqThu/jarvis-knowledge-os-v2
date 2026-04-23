#!/usr/bin/env bun
/**
 * dream-wrap/run.ts — nightly `gbrain dream` runner with archived JSON
 * reports under `~/brain/.agent/dream-cycles/`. Step 2.3 of the
 * filesystem-canonical track.
 *
 * Contract:
 *   - Spawns `gbrain dream --json`, captures stdout (the CycleReport).
 *   - Writes the report to `<brain>/.agent/dream-cycles/<ISO>.json`
 *     (UTC timestamp, never overwrites a prior cycle).
 *   - Updates `latest.json` symlink atomically (next /status revision
 *     can read this without scanning).
 *   - Stderr from gbrain (progress lines) is forwarded to our stderr so
 *     launchd captures it in the .stderr.log.
 *   - Exit 0 when CycleStatus ∈ {clean, ok, partial, skipped}.
 *     `partial` is the normal state when lint flags issues but other
 *     phases succeeded — not page-worthy.
 *   - Exit 1 when CycleStatus=failed (cycle aborted; page-worthy).
 *   - Exit 2 on wrapper-level failure (binary missing, archive write
 *     failed, JSON parse failed). Distinct so launchd retries surface.
 *
 * Brain dir: read from `gbrain config get sync.repo_path`. Set by
 * Step 2.2 / 2.3 via `gbrain init --pglite --repo ~/brain`. We do not
 * accept a CLI override here — cron invocations should be config-driven.
 *
 * Usage:
 *   bun run skills/kos-jarvis/dream-wrap/run.ts            # full cycle
 *   bun run skills/kos-jarvis/dream-wrap/run.ts --dry-run  # preview only
 *   bun run skills/kos-jarvis/dream-wrap/run.ts --phase lint
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

const GBRAIN_BIN = process.env.GBRAIN_BIN ?? "gbrain";

function resolveBrainDir(): string {
  const explicit = process.env.GBRAIN_HOME;
  if (explicit && existsSync(explicit)) return explicit;

  const r = spawnSync(GBRAIN_BIN, ["config", "get", "sync.repo_path"], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(
      `[dream-wrap] cannot resolve brain dir: gbrain config get sync.repo_path exited ${r.status}`,
    );
    console.error(r.stderr);
    process.exit(2);
  }
  const path = r.stdout.trim();
  if (!path || !existsSync(path)) {
    console.error(
      `[dream-wrap] sync.repo_path is empty or missing on disk: "${path}"`,
    );
    console.error(
      `             run \`gbrain init --pglite --repo ~/brain\` to set it.`,
    );
    process.exit(2);
  }
  return path;
}

function isoStamp(d = new Date()): string {
  // 2026-04-23T19-42-07Z — colon-free, sortable, file-system-safe
  return d.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
}

function archiveReport(brainDir: string, json: string): string {
  const dir = join(brainDir, ".agent", "dream-cycles");
  mkdirSync(dir, { recursive: true });

  const stamp = isoStamp();
  const target = join(dir, `${stamp}.json`);
  writeFileSync(target, json);

  // Atomic symlink swap: write to .tmp then rename onto latest.json.
  const latest = join(dir, "latest.json");
  const tmp = join(dir, ".latest.json.tmp");
  if (existsSync(tmp)) unlinkSync(tmp);
  symlinkSync(`${stamp}.json`, tmp);
  renameSync(tmp, latest);

  return target;
}

function exitForStatus(status: string): number {
  // CycleStatus = 'ok' | 'clean' | 'partial' | 'skipped' | 'failed'
  // (src/core/cycle.ts). `warn` is a phase-level status, never a cycle status.
  switch (status) {
    case "clean":
    case "ok":
    case "partial":
    case "skipped":
      return 0;
    case "failed":
      return 1;
    default:
      console.error(`[dream-wrap] unknown cycle status: ${status}`);
      return 1;
  }
}

function main() {
  const passthrough = process.argv.slice(2);
  const brainDir = resolveBrainDir();

  console.error(`[dream-wrap] brain=${brainDir}`);
  console.error(
    `[dream-wrap] invoking: ${GBRAIN_BIN} dream --json --dir ${brainDir}${
      passthrough.length ? " " + passthrough.join(" ") : ""
    }`,
  );

  const t0 = Date.now();
  const r = spawnSync(
    GBRAIN_BIN,
    ["dream", "--json", "--dir", brainDir, ...passthrough],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024, // 64MB ceiling for the JSON report
    },
  );
  const elapsedMs = Date.now() - t0;

  // Forward gbrain's progress lines to launchd's .stderr.log
  if (r.stderr) process.stderr.write(r.stderr);

  if (r.status === null) {
    console.error(
      `[dream-wrap] gbrain dream killed by signal: ${r.signal} after ${elapsedMs}ms`,
    );
    process.exit(2);
  }

  if (!r.stdout || !r.stdout.trim()) {
    console.error(
      `[dream-wrap] gbrain dream produced no JSON on stdout (exit=${r.status}, elapsed=${elapsedMs}ms)`,
    );
    process.exit(2);
  }

  // Some phases (notably embed --dry-run) print human-readable lines to
  // stdout before the JSON report. Extract the JSON object by locating
  // the first `{` and the matching closing `}`. CycleReport is a single
  // top-level object so this is unambiguous. See open question:
  // upstream gbrain dream should keep stdout JSON-clean in --json mode.
  const jsonStart = r.stdout.indexOf("{");
  const jsonEnd = r.stdout.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    console.error(
      `[dream-wrap] could not locate JSON object in stdout (start=${jsonStart}, end=${jsonEnd})`,
    );
    console.error(`[dream-wrap] raw stdout (first 4kb):`);
    console.error(r.stdout.slice(0, 4096));
    process.exit(2);
  }
  const jsonText = r.stdout.slice(jsonStart, jsonEnd + 1);
  if (jsonStart > 0) {
    const noise = r.stdout.slice(0, jsonStart).trim();
    if (noise) {
      console.error(`[dream-wrap] stdout noise before JSON: ${noise}`);
    }
  }

  let report: { status: string; duration_ms?: number; phases?: unknown[] };
  try {
    report = JSON.parse(jsonText);
  } catch (err) {
    console.error(
      `[dream-wrap] JSON.parse failed on dream output: ${(err as Error).message}`,
    );
    console.error(`[dream-wrap] extracted JSON (first 4kb):`);
    console.error(jsonText.slice(0, 4096));
    process.exit(2);
  }

  let archivePath: string;
  try {
    archivePath = archiveReport(brainDir, jsonText);
  } catch (err) {
    console.error(
      `[dream-wrap] archive write failed: ${(err as Error).message}`,
    );
    process.exit(2);
  }

  const phaseCount = Array.isArray(report.phases) ? report.phases.length : 0;
  console.error(
    `[dream-wrap] status=${report.status} phases=${phaseCount} elapsed=${elapsedMs}ms archive=${archivePath}`,
  );

  process.exit(exitForStatus(report.status));
}

main();
