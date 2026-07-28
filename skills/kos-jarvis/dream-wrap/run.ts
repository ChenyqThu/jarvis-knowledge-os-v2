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
 *
 * ⚠️ GBRAIN_BIN and pack-gated phases (found 2026-07-23): do NOT point
 * GBRAIN_BIN at the COMPILED binary (bin/gbrain) for dream runs. Inside the
 * compiled artifact the schema-pack load throws, and packDeclaresPhase's
 * `catch { return false }` silently reports "active pack does not declare
 * this phase" — extract_atoms + synthesize_concepts get SKIPPED with no
 * error (verified: bin/gbrain skipped; src-entrypoint ran `ok`, 2630
 * concepts). launchd is safe (PATH resolves ~/.bun/bin/gbrain → src/cli.ts);
 * manual runs should use the default PATH resolution or
 * GBRAIN_BIN=$HOME/.bun/bin/gbrain. Upstream (src/) quirk — fork no-go.
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

const GBRAIN_BIN = process.env.GBRAIN_BIN ?? "gbrain";

// §6.41 iron rule: the embed path must never carry a relay base URL, and an
// inherited ANTHROPIC_BASE_URL 404s gbrain's chat path (see memory pitfall).
// launchd's env is already clean — this protects manual shell invocations.
// Captured BEFORE the delete: reading process.env.OPENAI_BASE_URL after this
// point always yields undefined, so a guard that checks it there is dead code
// (same shape as the MIN_QUERY_EMBED_BUDGET_MS floor defeated by an
// already-fired AbortSignal, §6.42). embedPathDirectFailure() reads this.
const INHERITED_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;

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

const EMBED_PROBE_URL = "https://api.openai.com/v1/embeddings";

/**
 * §6.41 iron-rule enforcement, added 2026-07-27.
 *
 * The `delete process.env.OPENAI_BASE_URL` above only cleans THIS process.
 * The child is a bun script, and bun re-loads `.env` / `.env.local` from cwd
 * (our WorkingDirectory is the repo root), so an uncommented relay line in
 * either file lands back in the child's env after we cleared it. Deleting a
 * var makes it *absent*, which is exactly the state bun's .env loader fills.
 *
 * Nothing errors when that happens — the embed just silently changes
 * provider. Four cycles (2026-07-24..27) died at synthesize_concepts against
 * a relay that no config plane admitted to, and the only visible symptom was
 * `无可用渠道（distributor）` buried in stderr.
 *
 * So assert both halves before spending a cycle: (a) nothing can re-inject a
 * base URL into the child, and (b) the key actually works against the
 * official endpoint at the configured width. Returns a reason on failure,
 * null when the path is provably direct.
 */
async function embedPathDirectFailure(): Promise<string | null> {
  // An inherited value is NOT fatal — the delete above already scrubbed it and
  // the child never sees it. That path is supported (manual shell runs); say so
  // and carry on, because refusing here would break a case run.ts handles.
  if (INHERITED_OPENAI_BASE_URL) {
    console.error(
      `[dream-wrap] scrubbed inherited OPENAI_BASE_URL=${INHERITED_OPENAI_BASE_URL} (child runs direct)`,
    );
  }

  // (a) The one we cannot scrub: bun re-loads these files in the CHILD, after
  // our delete. A live line here silently puts the relay back.
  for (const name of [".env", ".env.local"]) {
    const path = join(process.cwd(), name);
    if (!existsSync(path)) continue;
    const line = readFileSync(path, "utf8")
      .split("\n")
      .find((l) => /^\s*(export\s+)?OPENAI_BASE_URL\s*=/.test(l));
    if (line) {
      return `${name} carries a live OPENAI_BASE_URL line that bun re-loads into the child: ${line.trim()}`;
    }
  }

  // (b) real embed, official endpoint, configured width.
  const key = process.env.OPENAI_API_KEY;
  if (!key) return "OPENAI_API_KEY is unset";
  const want = Number(process.env.GBRAIN_EMBEDDING_DIMENSIONS) || 1536;

  let res: Response;
  try {
    res = await fetch(EMBED_PROBE_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-large",
        dimensions: want,
        input: "dream-wrap preflight",
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return `embed probe to ${EMBED_PROBE_URL} threw: ${(err as Error).message}`;
  }

  const body = await res.text();
  if (!res.ok) return `embed probe HTTP ${res.status}: ${body.slice(0, 200)}`;

  let dims: unknown;
  try {
    dims = JSON.parse(body)?.data?.[0]?.embedding?.length;
  } catch {
    return `embed probe returned non-JSON: ${body.slice(0, 200)}`;
  }
  if (dims !== want) return `embed probe returned ${dims} dims, expected ${want}`;

  return null;
}

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

/**
 * Gateway-level routing failures — a multi-channel relay (one-api/new-api
 * shape) reporting it has no upstream for the model. Distinct from the
 * connection-layer signatures below: the TLS handshake succeeded and the
 * relay answered, it just refused to route.
 *
 * Kept separate because seeing ANY of these is itself a §6.41 violation —
 * the embed path is supposed to go direct to api.openai.com, where an error
 * would never come back as Chinese distributor text.
 */
const RELAY_ROUTING_FAILURE = /无可用渠道|distributor|当前分组.*不可用|上游负载已饱和|no available channel/;

/**
 * The startup gate proves the embed path is direct BEFORE the child starts.
 * If a relay signature still shows up in the child's stderr, something put one
 * back at runtime through a plane the gate cannot see — say so explicitly,
 * because the retry below will otherwise bury it as a generic transport blip.
 */
function warnIfRelayOnEmbedPath(stderr: string): void {
  const m = stderr.match(RELAY_ROUTING_FAILURE);
  if (!m) return;
  console.error(
    `[dream-wrap] §6.41 VIOLATION: a relay answered on the embed path (matched ${JSON.stringify(m[0])}).`,
  );
  console.error(
    `[dream-wrap] The embed path must go direct to api.openai.com — api.openai.com does not emit this error shape.`,
  );
  console.error(
    `[dream-wrap] Check every plane: 4 plists, .env / .env.local, ~/.gbrain/config.json, DB config, sources.config, launchctl getenv.`,
  );
}

/** Matches the failure shapes the ai.gateway transport retry logs emit. */
function looksLikeTransportFailure(stderr: string): boolean {
  // Added 2026-07-28: the 07-27 03:11 cron died on
  // `分组 *** 下模型 text-embedding-3-large 无可用渠道（distributor）` and this
  // regex did not match it, so the run got zero retries — and because
  // archiveReport() only fires on success, it left no archive either. Six
  // consecutive nights failed inside cycle.synthesize_concepts that way while
  // latest.json kept pointing at a daytime manual run, so the cycle looked
  // healthy from every angle except the stderr log nobody was reading.
  //
  // Retrying a routing error is admittedly a coin flip — if a relay is on the
  // embed path because of a config fault, six attempts over 4.5h will not
  // un-set it. It is still strictly better than the current single-shot death:
  // the retries are logged, and a relay whose channel is merely down (avman's
  // te3 channel, §6.41) can recover within the window.
  return (
    RELAY_ROUTING_FAILURE.test(stderr) ||
    /UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED|embed transport gave up|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED/.test(
      stderr,
    )
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
    warnIfRelayOnEmbedPath(r.stderr ?? "");
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

  // Startup gate, not a per-attempt one: a relay on the embed path is a
  // configuration fault, and retrying 6 times over 4.5h will not un-set an
  // env var. Fail loudly now instead of degrading quietly mid-cycle.
  const relayReason = await embedPathDirectFailure();
  if (relayReason) {
    console.error(
      `[dream-wrap] REFUSING TO RUN — embed path is not direct-to-OpenAI: ${relayReason}`,
    );
    console.error(
      `[dream-wrap] §6.41 iron rule: no relay on the embedding path. Fix the plane above, then re-run.`,
    );
    process.exit(2);
  }

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
