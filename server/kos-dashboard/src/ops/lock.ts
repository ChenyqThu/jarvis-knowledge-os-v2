import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';

// Cross-process embedding-write lock, shared BY PATH with the chunkless-backfill
// shell script (scripts/jarvis-chunkless-backfill.sh). Every embedding writer —
// the F7 `embed-selected` action (this module), the F7/cron/manual
// chunkless-backfill (the script), and any manual embed — contends on the same
// atomic mkdir lock, so no two writers select and pay for the same pages at
// once (codex HIGH). It also bounds cross-restart overlap: a crashed dashboard's
// in-memory single-flight is gone, but its lock persists on disk and is only
// reclaimed once its holder PID is provably dead.
//
// Steal policy (closes codex's "observe empty lock → steal → pid overwrite"
// race): a lock is stealable ONLY when its holder PID is dead, or when a
// pid-less dir is older than EMPTY_LOCK_STALE_MS (a holder that died in the
// ~1ms window between mkdir and the pid write). A FRESH pid-less dir is left
// alone, so a mid-acquisition lock is never stolen out from under its creator.
//
// KNOWN RESIDUALS — accepted for this deployment (codex pass 3, HIGH 1/2/3):
// This is a BEST-EFFORT reducer of embedding-write overlap, not a hard mutex.
//   - It does NOT cover F5 put_page (save/revert) or external MCP put_page
//     writers, which also embed — full coverage would need a DB advisory lock
//     inside upstream's embed/put_page path (src/*, a fork no-go).
//   - A detached job child can outlive a dashboard restart; the new instance
//     may reclaim the (dead-PID) lock while the orphan still runs.
//   - The dead-PID/old-empty steal has a narrow two-process race.
// Why this is acceptable: TOTAL embed spend is bounded INDEPENDENTLY of this
// lock — the ops single-flight allows one F7 job at a time, the eligible
// chunkless set is finite and shrinks as pages get embedded, and embed-selected
// is capped at 100 pages. So a lock miss is at most RARE duplicate embedding,
// never unbounded/attacker-amplifiable spend.
//
// One sharper residual (codex pass 4): if a DIFFERENT-revision put_page (F5 or
// external MCP) rewrites a target page WHILE `gbrain embed` is mid-flight, the
// stale embed can leave that page's search chunks desynced from its content —
// `gbrain embed` upserts with no revision guard. This is a PRE-EXISTING upstream
// race that the daily chunkless-backfill CRON already shares (identical
// operation); the real fix is an expected-content-hash guard inside upstream's
// embed/upsert transaction (src/*, a fork no-go). We can't prevent it here, so
// embed-selected DETECTS it (routes/ops.ts baseline content_hash + post-run
// drift check) and refuses to report clean success, prompting a re-run. The
// window is seconds, on the specific overlapping page; not observed in months of
// cron + concurrent writers.
const LOCK_DIR =
  process.env.KOS_DASH_EMBED_LOCK_DIR ?? resolve(homedir(), '.cache', 'kos-jarvis', 'embed-write.lock');
const PID_FILE = resolve(LOCK_DIR, 'pid');
const EMPTY_LOCK_STALE_MS = 120_000;

export interface LockHandle {
  release: () => void;
}

function tryCreate(): boolean {
  try {
    mkdirSync(LOCK_DIR); // atomic: fails if the dir already exists
  } catch {
    return false;
  }
  try {
    writeFileSync(PID_FILE, String(process.pid));
  } catch {
    /* best effort; ownsLock() below re-checks */
  }
  return ownsLock();
}

function ownsLock(): boolean {
  try {
    return readFileSync(PID_FILE, 'utf8').trim() === String(process.pid);
  } catch {
    return false;
  }
}

function isStealable(): boolean {
  let pid = '';
  try {
    pid = readFileSync(PID_FILE, 'utf8').trim();
  } catch {
    /* no pid file */
  }
  if (pid) {
    try {
      process.kill(Number(pid), 0);
      return false; // holder alive
    } catch {
      return true; // ESRCH → holder dead → stealable
    }
  }
  // No pid file: only steal if the dir is old enough to be a crashed acquire.
  try {
    return Date.now() - statSync(LOCK_DIR).mtimeMs > EMPTY_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

/**
 * Try to acquire the embed lock. Returns a handle, or null if another writer
 * holds it (the caller should surface a 409). `release()` is idempotent.
 */
export function acquireEmbedLock(): LockHandle | null {
  mkdirSync(dirname(LOCK_DIR), { recursive: true });
  if (tryCreate()) return makeHandle();
  if (isStealable()) {
    try {
      rmSync(LOCK_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    if (tryCreate()) return makeHandle();
  }
  return null;
}

function makeHandle(): LockHandle {
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      // Only remove the lock if we still own it (guard against a stale-takeover
      // by another process having replaced it).
      if (!ownsLock()) return;
      try {
        rmSync(LOCK_DIR, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}
