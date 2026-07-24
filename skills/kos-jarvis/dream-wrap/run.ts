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
 * Overnight-TLS resilience (2026-07-23, after 3 consecutive failed nights):
 *   07-21/22/23 all died in cycle.synthesize_concepts' embed call with
 *   UNABLE_TO_VERIFY_LEAF_SIGNATURE — something on the 03:11 network path
 *   MITMs api.openai.com at night (daytime runs never fail; the serve-http
 *   daemon embeds all day on the same key; system proxy is clean and
 *   Tailscale only OFFERS an exit node). Root cause is outside this repo,
 *   so the wrapper routes around it:
 *     - Pre-flight TLS probe against api.openai.com (any HTTP status = the
 *       chain verified; a probe failure costs 10s, not a burned cycle).
 *     - On probe failure OR a dream failure whose stderr carries a
 *       transport signature, wait RETRY_DELAY_MS and try again, up to
 *       MAX_ATTEMPTS (03:11 start → last attempt ~07:00, by which the
 *       window has always closed). Failed dream attempts are cheap
 *       (~25s — the incremental phases fly and the embed dies fast).
 *     - Non-transport failures keep the old fail-fast semantics.
 *   Tune via DREAM_WRAP_MAX_ATTEMPTS / DREAM_WRAP_RETRY_DELAY_MS
 *   (set DREAM_WRAP_MAX_ATTEMPTS=1 to restore single-shot behavior).
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

// §6.41 iron rule: the embed path must never carry a relay base URL, and an
// inherited ANTHROPIC_BASE_URL 404s gbrain's chat path (see memory pitfall).
// launchd's env is already clean — this protects manual shell invocations.
delete process.env.OPENAI_BASE_URL;
delete process.env.ANTHROPIC_BASE_URL;

const TLS_PROBE_URL = "https://api.openai.com/v1/models";
const MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.DREAM_WRAP_MAX_ATTEMPTS) || 6,
);
const RETRY_DELAY_MS = Math.max(
  1000,
  Number(process.env.DREAM_WRAP_RETRY_DELAY_MS) || 45 * 60 * 1000,
);

/**
 * TLS reachability probe. ANY HTTP response (401 expected without auth)
 * proves the handshake + certificate chain verified end-to-end; only a
 * thrown fetch (TLS/DNS/conn failure) reads as unhealthy.
 */
async function embedTransportHealthy(): Promise<boolean> {
  try {
    await fetch(TLS_PROBE_URL, { signal: AbortSignal.timeout(10_000) });
    return true;
  } catch (err) {
    console.error(
      `[dream-wrap] TLS probe to ${TLS_PROBE_URL} failed: ${(err as Error).message}`,
    );
    return false;
  }
}

/** Matches the failure shapes the ai.gateway transport retry logs emit. */
function looksLikeTransportFailure(stderr: string): boolean {
  return /UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED|embed transport gave up|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED/.test(
    stderr,
  );
}

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

type DreamOutcome =
  /** Dream produced a parseable report — archive it and exit per status. */
  | { kind: "report"; jsonText: string; report: { status: string; phases?: unknown[] }; elapsedMs: number }
  /** Failed with a transport signature in stderr — worth a delayed retry. */
  | { kind: "transport"; detail: string }
  /** Anything else — keep the old fail-fast exit code. */
  | { kind: "fatal"; code: number };

function runDreamOnce(brainDir: string, passthrough: string[]): DreamOutcome {
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
    return { kind: "fatal", code: 2 };
  }

  if (!r.stdout || !r.stdout.trim()) {
    console.error(
      `[dream-wrap] gbrain dream produced no JSON on stdout (exit=${r.status}, elapsed=${elapsedMs}ms)`,
    );
    if (looksLikeTransportFailure(r.stderr ?? "")) {
      return { kind: "transport", detail: `exit=${r.status}, no JSON, transport signature in stderr` };
    }
    return { kind: "fatal", code: 2 };
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
    return { kind: "fatal", code: 2 };
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
    return { kind: "fatal", code: 2 };
  }

  // A structured `failed` report whose stderr shows the transport signature
  // is the same nightly-MITM shape — retry it too. Non-transport `failed`
  // stays fail-now (page-worthy) via the report path below.
  if (report.status === "failed" && looksLikeTransportFailure(r.stderr ?? "")) {
    return { kind: "transport", detail: "cycle status=failed with transport signature in stderr" };
  }

  return { kind: "report", jsonText, report, elapsedMs };
}

async function main() {
  const passthrough = process.argv.slice(2);
  const brainDir = resolveBrainDir();

  console.error(`[dream-wrap] brain=${brainDir}`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const lastAttempt = attempt === MAX_ATTEMPTS;

    // Pre-flight: don't burn a cycle run into a known-bad TLS window.
    if (!(await embedTransportHealthy())) {
      if (lastAttempt) {
        console.error(
          `[dream-wrap] TLS still unhealthy on final attempt ${attempt}/${MAX_ATTEMPTS}; giving up`,
        );
        process.exit(2);
      }
      console.error(
        `[dream-wrap] attempt ${attempt}/${MAX_ATTEMPTS}: transport unhealthy, retrying in ${Math.round(RETRY_DELAY_MS / 60000)}min`,
      );
      await Bun.sleep(RETRY_DELAY_MS);
      continue;
    }

    const outcome = runDreamOnce(brainDir, passthrough);

    if (outcome.kind === "transport") {
      if (lastAttempt) {
        console.error(
          `[dream-wrap] transport failure on final attempt ${attempt}/${MAX_ATTEMPTS} (${outcome.detail}); giving up`,
        );
        process.exit(2);
      }
      console.error(
        `[dream-wrap] attempt ${attempt}/${MAX_ATTEMPTS}: ${outcome.detail}; retrying in ${Math.round(RETRY_DELAY_MS / 60000)}min`,
      );
      await Bun.sleep(RETRY_DELAY_MS);
      continue;
    }

    if (outcome.kind === "fatal") {
      process.exit(outcome.code);
    }

    // kind === "report" — archive + exit per status (pre-2026-07-23 behavior).
    let archivePath: string;
    try {
      archivePath = archiveReport(brainDir, outcome.jsonText);
    } catch (err) {
      console.error(
        `[dream-wrap] archive write failed: ${(err as Error).message}`,
      );
      process.exit(2);
    }

    const phaseCount = Array.isArray(outcome.report.phases)
      ? outcome.report.phases.length
      : 0;
    console.error(
      `[dream-wrap] status=${outcome.report.status} phases=${phaseCount} elapsed=${outcome.elapsedMs}ms attempt=${attempt}/${MAX_ATTEMPTS} archive=${archivePath}`,
    );

    process.exit(exitForStatus(outcome.report.status));
  }
}

await main();
