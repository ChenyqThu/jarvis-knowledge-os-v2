/**
 * MinionWorker — Concurrent in-process job worker with BullMQ-inspired patterns.
 *
 * Processes up to `concurrency` jobs simultaneously using a Promise pool.
 * Each job gets its own AbortController, lock renewal timer, and isolated state.
 *
 * Usage:
 *   const worker = new MinionWorker(engine);
 *   worker.register('sync', async (job) => { ... });
 *   worker.register('embed', async (job) => { ... });
 *   await worker.start(); // polls until SIGTERM
 */

import type { BrainEngine } from '../engine.ts';
import type { MinionJob, MinionJobContext, MinionHandler, MinionWorkerOpts, TokenUpdate } from './types.ts';
import { UnrecoverableError } from './types.ts';
import { MinionQueue } from './queue.ts';
import { calculateBackoff } from './backoff.ts';
import { randomUUID } from 'crypto';

/** Per-job in-flight state (isolated per job, not shared on the worker). */
interface InFlightJob {
  job: MinionJob;
  lockToken: string;
  lockTimer: ReturnType<typeof setInterval>;
  abort: AbortController;
  promise: Promise<void>;
}

export class MinionWorker {
  private queue: MinionQueue;
  private handlers = new Map<string, MinionHandler>();
  private running = false;
  private inFlight = new Map<number, InFlightJob>();
  private workerId = randomUUID();

  private opts: Required<MinionWorkerOpts>;

  constructor(
    private engine: BrainEngine,
    opts?: MinionWorkerOpts,
  ) {
    this.queue = new MinionQueue(engine);
    this.opts = {
      queue: opts?.queue ?? 'default',
      concurrency: opts?.concurrency ?? 1,
      lockDuration: opts?.lockDuration ?? 30000,
      stalledInterval: opts?.stalledInterval ?? 30000,
      maxStalledCount: opts?.maxStalledCount ?? 1,
      pollInterval: opts?.pollInterval ?? 5000,
    };
  }

  /** Register a handler for a job type. */
  register(name: string, handler: MinionHandler): void {
    this.handlers.set(name, handler);
  }

  /** Get registered handler names (used by claim query). */
  get registeredNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /** Start the worker loop. Blocks until stopped. */
  async start(): Promise<void> {
    if (this.handlers.size === 0) {
      throw new Error('No handlers registered. Call worker.register(name, handler) before start().');
    }

    await this.queue.ensureSchema();
    this.running = true;

    // Graceful shutdown
    const shutdown = () => {
      console.log('Minion worker shutting down...');
      this.running = false;
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Stall detection on interval
    const stalledTimer = setInterval(async () => {
      try {
        const { requeued, dead } = await this.queue.handleStalled();
        if (requeued.length > 0) console.log(`Stall detector: requeued ${requeued.length} jobs`);
        if (dead.length > 0) console.log(`Stall detector: dead-lettered ${dead.length} jobs`);
      } catch (e) {
        console.error('Stall detection error:', e instanceof Error ? e.message : String(e));
      }
    }, this.opts.stalledInterval);

    try {
      while (this.running) {
        // Promote delayed jobs
        try {
          await this.queue.promoteDelayed();
        } catch (e) {
          console.error('Promotion error:', e instanceof Error ? e.message : String(e));
        }

        // Claim jobs up to concurrency limit
        if (this.inFlight.size < this.opts.concurrency) {
          const lockToken = `${this.workerId}:${Date.now()}`;
          const job = await this.queue.claim(
            lockToken,
            this.opts.lockDuration,
            this.opts.queue,
            this.registeredNames,
          );

          if (job) {
            this.launchJob(job, lockToken);
          } else if (this.inFlight.size === 0) {
            // No jobs and nothing in flight, poll
            await new Promise(resolve => setTimeout(resolve, this.opts.pollInterval));
          } else {
            // Jobs are running but no new ones available, brief pause before re-checking
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } else {
          // At concurrency limit, wait briefly before re-checking for free slots
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } finally {
      clearInterval(stalledTimer);
      process.removeListener('SIGTERM', shutdown);
      process.removeListener('SIGINT', shutdown);

      // Graceful shutdown: wait for all in-flight jobs with timeout
      if (this.inFlight.size > 0) {
        console.log(`Waiting for ${this.inFlight.size} in-flight job(s) to finish (30s timeout)...`);
        const pending = Array.from(this.inFlight.values()).map(f => f.promise);
        await Promise.race([
          Promise.allSettled(pending),
          new Promise(resolve => setTimeout(resolve, 30000)),
        ]);
      }

      console.log('Minion worker stopped.');
    }
  }

  /** Stop the worker gracefully. */
  stop(): void {
    this.running = false;
  }

  /** Launch a job as an independent in-flight promise. */
  private launchJob(job: MinionJob, lockToken: string): void {
    const abort = new AbortController();

    // Start lock renewal (per-job timer, not shared)
    const lockTimer = setInterval(async () => {
      const renewed = await this.queue.renewLock(job.id, lockToken, this.opts.lockDuration);
      if (!renewed) {
        console.warn(`Lock lost for job ${job.id}, aborting execution`);
        clearInterval(lockTimer);
        abort.abort();
      }
    }, this.opts.lockDuration / 2);

    const promise = this.executeJob(job, lockToken, abort, lockTimer)
      .finally(() => {
        clearInterval(lockTimer);
        this.inFlight.delete(job.id);
      });

    this.inFlight.set(job.id, { job, lockToken, lockTimer, abort, promise });
  }

  private async executeJob(
    job: MinionJob,
    lockToken: string,
    abort: AbortController,
    lockTimer: ReturnType<typeof setInterval>,
  ): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      await this.queue.failJob(job.id, lockToken, `No handler for job type '${job.name}'`, 'dead');
      return;
    }

    // Build job context with per-job AbortSignal
    const context: MinionJobContext = {
      id: job.id,
      name: job.name,
      data: job.data,
      attempts_made: job.attempts_made,
      signal: abort.signal,
      updateProgress: async (progress: unknown) => {
        await this.queue.updateProgress(job.id, lockToken, progress);
      },
      updateTokens: async (tokens: TokenUpdate) => {
        await this.queue.updateTokens(job.id, lockToken, tokens);
      },
      log: async (message: string | Record<string, unknown>) => {
        const value = typeof message === 'string' ? message : JSON.stringify(message);
        await this.engine.executeRaw(
          `UPDATE minion_jobs SET stacktrace = COALESCE(stacktrace, '[]'::jsonb) || to_jsonb($1::text),
            updated_at = now()
           WHERE id = $2 AND status = 'active' AND lock_token = $3`,
          [value, job.id, lockToken]
        );
      },
      isActive: async () => {
        const rows = await this.engine.executeRaw<{ id: number }>(
          `SELECT id FROM minion_jobs WHERE id = $1 AND status = 'active' AND lock_token = $2`,
          [job.id, lockToken]
        );
        return rows.length > 0;
      },
      readInbox: async () => {
        return this.queue.readInbox(job.id, lockToken);
      },
    };

    try {
      const result = await handler(context);

      clearInterval(lockTimer);

      // Complete the job (token-fenced)
      const completed = await this.queue.completeJob(
        job.id,
        lockToken,
        result != null ? (typeof result === 'object' ? result as Record<string, unknown> : { value: result }) : undefined,
      );

      if (!completed) {
        console.warn(`Job ${job.id} completion dropped (lock token mismatch, job was reclaimed)`);
        return;
      }

      // Resolve parent if this is a child job
      if (job.parent_job_id) {
        await this.queue.resolveParent(job.parent_job_id);
      }
    } catch (err) {
      clearInterval(lockTimer);

      // If aborted (paused or lock lost), don't try to fail the job
      if (abort.signal.aborted) {
        console.log(`Job ${job.id} (${job.name}) aborted (paused or lock lost)`);
        return;
      }

      const errorText = err instanceof Error ? err.message : String(err);
      const isUnrecoverable = err instanceof UnrecoverableError;
      const attemptsExhausted = job.attempts_made + 1 >= job.max_attempts;

      let newStatus: 'delayed' | 'failed' | 'dead';
      if (isUnrecoverable || attemptsExhausted) {
        newStatus = 'dead';
      } else {
        newStatus = 'delayed';
      }

      const backoffMs = newStatus === 'delayed' ? calculateBackoff({
        backoff_type: job.backoff_type,
        backoff_delay: job.backoff_delay,
        backoff_jitter: job.backoff_jitter,
        attempts_made: job.attempts_made + 1,
      }) : 0;

      const failed = await this.queue.failJob(job.id, lockToken, errorText, newStatus, backoffMs);
      if (!failed) {
        console.warn(`Job ${job.id} failure dropped (lock token mismatch)`);
        return;
      }

      // Handle parent-child failure policies
      if (job.parent_job_id && (newStatus === 'dead' || newStatus === 'failed')) {
        const parentJob = await this.queue.getJob(job.parent_job_id);
        if (parentJob && parentJob.status === 'waiting-children') {
          switch (job.on_child_fail) {
            case 'fail_parent':
              await this.queue.failParent(job.parent_job_id, job.id, errorText);
              break;
            case 'remove_dep':
              await this.queue.removeChildDependency(job.id);
              await this.queue.resolveParent(job.parent_job_id);
              break;
            case 'ignore':
            case 'continue':
              await this.queue.resolveParent(job.parent_job_id);
              break;
          }
        }
      }

      if (newStatus === 'delayed') {
        console.log(`Job ${job.id} (${job.name}) failed, retrying in ${Math.round(backoffMs)}ms (attempt ${job.attempts_made + 1}/${job.max_attempts})`);
      } else {
        console.log(`Job ${job.id} (${job.name}) permanently failed: ${errorText}`);
      }
    }
  }
}
