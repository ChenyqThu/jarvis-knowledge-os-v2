import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { REPO_ROOT } from './registry.ts';
import { curatedChildEnv } from './env.ts';

// Where per-job logs + the audit trail live. The dashboard's SQL role is
// SELECT-only, so the audit CANNOT go to a DB table — it's an append-only file,
// mirroring how the launchd crons log (design.md §2 / PRD F7 "留审计记录").
const OPS_DIR =
  process.env.KOS_DASH_OPS_LOG_DIR ?? resolve(homedir(), 'Library', 'Logs', 'com.jarvis.kos-dashboard.ops');
const AUDIT_PATH = resolve(OPS_DIR, 'audit.jsonl');

// Wall-clock ceiling: a hung child (a stuck embed) would otherwise hold the
// single-flight lock forever. Kill the whole process group + free the lock after
// this. chunkless-backfill caps itself at 3000 pages/run, which fits.
const MAX_JOB_MS = Number(process.env.KOS_DASH_OPS_MAX_JOB_MS ?? 60 * 60 * 1000);
const HISTORY_LIMIT = 50;
// Bound on-disk job logs so a token holder can't fill the disk with repeated
// noisy runs (codex MEDIUM). In-memory history is separately capped above.
const LOG_RETENTION = 60;

mkdirSync(OPS_DIR, { recursive: true });

export type JobStatus = 'running' | 'done' | 'error';

export interface JobState {
  id: string;
  action: string;
  /** Sanitized for display (e.g. {source, count}) — never raw secrets. */
  params?: Record<string, unknown>;
  status: JobStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  /** Set when the job was killed by the wall-clock ceiling. */
  timedOut?: boolean;
  logPath: string;
}

export interface StartOptions {
  /** State-changing actions require a DURABLE audit line before the child is
   * spawned — if the audit append fails, the job is rejected rather than run
   * unlogged (codex MEDIUM: audit was fail-open). */
  requireAudit: boolean;
  /** Optional post-completion check that runs only after a clean exit(0). Lets
   * embed-selected confirm its target pages are actually embedded, so an
   * upstream per-page-error-swallowing embed can't be reported as success
   * (codex HIGH). Returning {ok:false} flips the job to 'error'. */
  verify?: () => Promise<{ ok: boolean; detail: string }>;
  /** Runs exactly once when the job finalizes (any terminal state) — used to
   * release a cross-process lock the caller acquired for this job. */
  onFinalize?: () => void;
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// One-at-a-time. Two concurrent embeds would double-spend and contend on the
// same rows; a single global slot is the simplest correct in-process bound. The
// check + set is synchronous (no await between), so two racing requests can't
// both acquire it. NOTE: this does NOT coordinate with the launchd crons — the
// chunkless-backfill script takes its own cross-process mkdir lock for that.
let running: JobState | null = null;
const history: JobState[] = [];

function record(job: JobState) {
  if (history.includes(job)) return;
  history.unshift(job);
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
}

/** Delete the oldest job logs beyond LOG_RETENTION (best-effort). */
function pruneOldLogs() {
  try {
    const logs = readdirSync(OPS_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const p = resolve(OPS_DIR, f);
        try {
          return { p, mtime: statSync(p).mtimeMs };
        } catch {
          return { p, mtime: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const { p } of logs.slice(LOG_RETENTION)) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Append a start line. Throws when `required` and the append fails, so a
 * state-changing job never runs without a durable audit record. */
function auditStart(job: JobState, argv: string[], required: boolean) {
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'start',
      jobId: job.id,
      action: job.action,
      params: job.params ?? null,
      argv, // fixed-template command; no secrets (env is separate)
      logPath: job.logPath,
    }) + '\n';
  try {
    appendFileSync(AUDIT_PATH, line);
  } catch (e) {
    if (required) throw new Error(`audit unwritable, refusing to run: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function auditEnd(job: JobState) {
  try {
    appendFileSync(
      AUDIT_PATH,
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'end',
        jobId: job.id,
        action: job.action,
        params: job.params ?? null,
        status: job.status,
        exitCode: job.exitCode ?? null,
        timedOut: job.timedOut ?? false,
        logPath: job.logPath,
      }) + '\n',
    );
  } catch {
    /* end-audit is best-effort; the job already ran */
  }
}

export class JobBusyError extends Error {
  constructor() {
    super('another ops job is already running');
    this.name = 'JobBusyError';
  }
}

/**
 * Spawn a fixed-template command as a tracked job. `argv` is assembled by the
 * caller from registry.ts (never free text). Synchronously acquires the
 * single-flight lock or throws JobBusyError. All setup (log open, audit, spawn)
 * is transactional: any failure releases the lock and closes descriptors, so a
 * setup error can't wedge the panel (codex MEDIUM). Returns the job id
 * immediately; the child runs in the background.
 */
export function startJob(
  action: string,
  argv: string[],
  params: Record<string, unknown> | undefined,
  opts: StartOptions,
): JobState {
  if (running) throw new JobBusyError();

  const id = randomUUID();
  const logPath = resolve(OPS_DIR, `${id}.log`);
  const job: JobState = {
    id,
    action,
    params,
    status: 'running',
    startedAt: new Date().toISOString(),
    logPath,
  };
  running = job;

  let fd: number | undefined;
  let settled = false;
  const finalize = (status: JobStatus, exitCode: number, extraLog: string) => {
    if (settled) return;
    settled = true;
    job.exitCode = exitCode;
    job.endedAt = new Date().toISOString();
    job.status = status;
    try {
      appendFileSync(logPath, `# ${job.endedAt} exit=${exitCode}${job.timedOut ? ' (killed: wall-clock timeout)' : ''}${extraLog}\n`);
    } catch {
      /* ignore */
    }
    if (running?.id === job.id) running = null;
    auditEnd(job);
    try {
      opts.onFinalize?.();
    } catch {
      /* lock release is best-effort */
    }
  };

  // Hoisted so a post-spawn setup exception (below) can still reap the child.
  let child: ReturnType<typeof spawn> | undefined;
  try {
    pruneOldLogs();
    fd = openSync(logPath, 'a');
    // Header + start-audit BEFORE spawn. auditStart throws for state-changing
    // actions if the audit is unwritable → caught below, lock released.
    appendFileSync(logPath, `# ${job.startedAt} action=${action} argv=${JSON.stringify(argv)}\n`);
    auditStart(job, argv, opts.requireAudit);

    // detached:true makes the child a process-group leader, so the wall-clock
    // killer can SIGKILL the WHOLE tree (bash → psql/gbrain grandchildren),
    // not just the immediate child (codex HIGH: orphaned spend after timeout).
    child = spawn(argv[0], argv.slice(1), {
      cwd: REPO_ROOT,
      env: curatedChildEnv(),
      stdio: ['ignore', fd, fd],
      detached: true,
    });
    // The child holds its own dup of the log fd now; drop ours so it can't leak.
    closeSync(fd);
    fd = undefined;
    record(job);

    const killGroup = () => {
      try {
        if (child?.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child?.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    };

    const killTimer = setTimeout(() => {
      job.timedOut = true;
      killGroup();
    }, MAX_JOB_MS);

    child.on('error', err => {
      clearTimeout(killTimer);
      finalize('error', -1, `\n# spawn error: ${err instanceof Error ? err.message : String(err)}`);
    });

    child.on('exit', async (code, signal) => {
      clearTimeout(killTimer);
      killGroup();
      // On a FORCED kill, give the group a moment to actually die, then reap
      // again, before releasing exclusivity — so a just-SIGKILLed embed
      // grandchild can't overlap the next job (codex MEDIUM: kill was signalled
      // but not awaited). A clean exit already waited for its own children.
      if (job.timedOut) {
        await delay(300);
        killGroup();
        await delay(200);
      }
      const exitCode = code ?? (signal ? -1 : 0);
      const status: JobStatus = job.timedOut || exitCode !== 0 ? 'error' : 'done';
      if (status === 'done' && opts.verify) {
        try {
          const v = await opts.verify();
          finalize(
            v.ok ? 'done' : 'error',
            exitCode,
            v.ok ? `\n# verify ok: ${v.detail}` : `\n# verify FAILED: ${v.detail}`,
          );
        } catch (e) {
          finalize('error', exitCode, `\n# verify errored: ${e instanceof Error ? e.message : String(e)}`);
        }
        return;
      }
      finalize(status, exitCode, '');
    });

    return job;
  } catch (e) {
    // Setup failed — release the lock + fd, mark the job errored, and rethrow so
    // the route surfaces a 500. The lock is NOT left dangling.
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    // If the child already spawned (a post-spawn sync step threw), kill its whole
    // group so a detached embed can't keep running unowned after we release the
    // lock (codex MEDIUM).
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
    record(job);
    finalize('error', -1, `\n# setup failed: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

export function currentJob(): JobState | null {
  return running;
}

export function getJob(id: string): JobState | undefined {
  return history.find(j => j.id === id);
}

export function listJobs(): JobState[] {
  return history.slice();
}

/** Last `maxBytes` of a job's combined log, for the live-tail UI. */
export function tailJobLog(job: JobState, maxBytes = 16_384): string {
  try {
    const st = statSync(job.logPath);
    const start = Math.max(0, st.size - maxBytes);
    const len = st.size - start;
    if (len <= 0) return '';
    const fd = openSync(job.logPath, 'r');
    try {
      const buf = Buffer.allocUnsafe(len);
      // Honor the actual bytes read: allocUnsafe leaves the buffer uninitialized,
      // and a short read (the child is mid-write) would otherwise stringify the
      // uninitialized tail as garbage.
      const n = readSync(fd, buf, 0, len, start);
      let s = buf.subarray(0, n).toString('utf8');
      // When we started mid-file, the first line is partial (and can begin in
      // the middle of a multi-byte char) — drop it so the tail begins on a clean
      // line boundary, which also keeps the JSON response well-formed.
      if (start > 0) {
        const nl = s.indexOf('\n');
        s = nl >= 0 ? s.slice(nl + 1) : s;
      }
      return s;
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}
