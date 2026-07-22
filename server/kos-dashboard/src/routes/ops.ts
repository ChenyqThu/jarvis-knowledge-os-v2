import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { sql } from '../db.ts';
import { ACTIONS, buildEmbedArgv } from '../ops/registry.ts';
import { validateEmbedTargets } from '../ops/slugs.ts';
import { acquireEmbedLock, type LockHandle } from '../ops/lock.ts';
import { JobBusyError, currentJob, getJob, listJobs, startJob, tailJobLog } from '../ops/jobs.ts';

// F7 ops panel API. Every action is a fixed command template from the registry
// (ops/registry.ts); the ONLY caller-supplied values are embed-selected's
// (source, slugs), re-validated server-side against the live chunkless set.
// All routes sit behind the same bearerAuth as the rest of /api/v1 (index.ts).

export const opsRoute = new Hono();

/** Public shape of a job (drops nothing sensitive — logPath is a local path). */
function jobView(j: ReturnType<typeof listJobs>[number]) {
  return {
    id: j.id,
    action: j.action,
    params: j.params ?? null,
    status: j.status,
    started_at: j.startedAt,
    ended_at: j.endedAt ?? null,
    exit_code: j.exitCode ?? null,
    timed_out: j.timedOut ?? false,
  };
}

// GET /ops/actions — the action catalog for the UI (no argv exposed; the client
// only needs id/label/desc/danger/confirm/needsParams to render cards).
opsRoute.get('/ops/actions', c =>
  c.json({
    actions: Object.values(ACTIONS).map(a => ({
      id: a.id,
      label: a.label,
      desc: a.desc,
      danger: a.danger,
      confirm: a.confirm,
      needs_params: a.needsParams,
    })),
    running: currentJob() ? jobView(currentJob()!) : null,
  }),
);

// GET /ops/jobs — recent job history (newest first).
opsRoute.get('/ops/jobs', c => c.json({ jobs: listJobs().map(jobView) }));

// GET /ops/jobs/:id — one job + a tail of its combined log for the live view.
opsRoute.get('/ops/jobs/:id', c => {
  const job = getJob(c.req.param('id'));
  if (!job) return c.json({ error: 'not found' }, 404);
  return c.json({ job: jobView(job), log: tailJobLog(job) });
});

// Cap on the /ops/run request body — the only large field is embed's slug array,
// itself bounded to 100, so a legitimate body is tiny. bodyLimit enforces this
// while READING the stream, so it also covers chunked / omitted-Content-Length
// requests (codex MEDIUM: a trusted Content-Length check was bypassable).
const MAX_RUN_BODY_BYTES = 64 * 1024;
opsRoute.use(
  '/ops/run',
  bodyLimit({ maxSize: MAX_RUN_BODY_BYTES, onError: c => c.json({ error: 'payload too large' }, 413) }),
);

// POST /ops/run {action, source?, slugs?} — start a job. Single-flight: 409 if
// one is already running.
opsRoute.post('/ops/run', async c => {
  const body = (await c.req.json().catch(() => null)) as
    | { action?: string; source?: string; slugs?: unknown }
    | null;
  const actionId = body?.action;
  if (!actionId || typeof actionId !== 'string') return c.json({ error: 'action required' }, 400);
  const spec = ACTIONS[actionId];
  if (!spec) return c.json({ error: 'unknown action', detail: `no such ops action: ${actionId}` }, 400);

  let argv: string[];
  let params: Record<string, unknown> | undefined;
  // Only embed-selected sets a post-run verifier (below).
  let verify: (() => Promise<{ ok: boolean; detail: string }>) | undefined;

  if (spec.needsParams) {
    // Only embed-selected today. Validate source exists AND is not archived,
    // then intersect the requested slugs with the live eligible-chunkless set.
    const source = body?.source;
    if (!source || typeof source !== 'string') {
      return c.json({ error: 'source required', detail: 'embed-selected needs a source' }, 400);
    }
    const known = await sql<{ ok: number }[]>`
      SELECT 1 AS ok FROM sources WHERE id = ${source} AND archived IS NOT TRUE LIMIT 1
    `;
    if (known.length === 0) return c.json({ error: 'invalid source', detail: 'unknown or archived source' }, 400);

    const validated = await validateEmbedTargets(source, body?.slugs);
    if (!validated.ok) return c.json({ error: validated.error, detail: validated.detail }, validated.status);

    try {
      argv = buildEmbedArgv(source, validated.slugs);
    } catch (e) {
      // Defense-in-depth: buildEmbedArgv re-asserts the iron rules.
      return c.json({ error: 'embed rejected', detail: e instanceof Error ? e.message : String(e) }, 400);
    }
    params = { source, count: validated.slugs.length };
    const targets = validated.slugs;
    // Baseline content hashes, captured NOW, to detect a concurrent put_page
    // (F5 save/revert or an external MCP writer) rewriting a target's content
    // DURING the embed. That's a pre-existing upstream race — `gbrain embed`
    // snapshots then upserts with no revision guard, so a stale write can leave
    // a page's search chunks desynced from its current content (codex HIGH,
    // pass 4). The real fix is an expected-content-hash guard inside upstream's
    // embed/upsert transaction (src/*, a fork no-go) and would be needed by the
    // chunkless-backfill CRON too, which runs the identical operation. We can't
    // PREVENT it from here, but we DETECT it so the job never falsely reports
    // clean success.
    const baseRows = await sql<{ slug: string; content_hash: string | null }[]>`
      SELECT slug, content_hash FROM pages WHERE source_id = ${source} AND slug IN ${sql(targets)}
    `;
    const baseHashes = new Map(baseRows.map(r => [r.slug, r.content_hash]));
    verify = async () => {
      // Post-run truth check. `gbrain embed` swallows per-page errors upstream
      // and creates chunk ROWS before the OpenAI call, so it can exit 0 with
      // chunks whose embedding IS NULL — require a NON-NULL embedding per target
      // AND that the page wasn't rewritten out from under the embed.
      const rows = await sql<{ slug: string; content_hash: string | null; embedded: boolean }[]>`
        SELECT p.slug, p.content_hash,
               EXISTS (SELECT 1 FROM content_chunks cc WHERE cc.page_id = p.id AND cc.embedding IS NOT NULL) AS embedded
        FROM pages p
        WHERE p.deleted_at IS NULL AND p.source_id = ${source} AND p.slug IN ${sql(targets)}
      `;
      const notEmbedded = rows.filter(r => !r.embedded).length;
      const drifted = rows.filter(r => (baseHashes.get(r.slug) ?? null) !== (r.content_hash ?? null)).length;
      if (notEmbedded === 0 && drifted === 0) {
        return { ok: true, detail: `all ${targets.length} target(s) embedded; no concurrent rewrite` };
      }
      const parts: string[] = [];
      if (notEmbedded > 0) parts.push(`${notEmbedded}/${targets.length} have no non-NULL embedding`);
      if (drifted > 0) parts.push(`${drifted} rewritten concurrently — search index may be stale, re-run embed`);
      return { ok: false, detail: parts.join('; ') };
    };
  } else {
    if (!spec.argv) return c.json({ error: 'misconfigured action' }, 500);
    argv = spec.argv;
  }

  // embed-selected must also exclude the launchd chunkless-backfill cron (and
  // manual embeds), which write embeddings for possibly-overlapping pages. Take
  // the SAME cross-process lock the backfill script uses so no two embedding
  // writers run at once — even across a dashboard restart (codex HIGH). The
  // in-process single-flight already covers the other (non-embed) actions.
  let lock: LockHandle | null = null;
  if (spec.id === 'embed-selected') {
    lock = acquireEmbedLock();
    if (!lock) {
      return c.json({ error: 'busy', detail: '另一处 embedding 写入正在进行（backfill/手动），请稍后再试' }, 409);
    }
  }

  try {
    // State-changing actions (write/spend) require a durable audit record before
    // spawning; read-only actions don't.
    const job = startJob(spec.id, argv, params, {
      requireAudit: spec.danger !== 'read',
      verify,
      onFinalize: lock ? () => lock!.release() : undefined,
    });
    return c.json({ ok: true, job: jobView(job) }, 202);
  } catch (e) {
    lock?.release(); // startJob failed → don't strand the lock
    if (e instanceof JobBusyError) {
      const cur = currentJob();
      return c.json(
        { error: 'busy', detail: '已有任务在运行，请等它结束', running: cur ? jobView(cur) : null },
        409,
      );
    }
    return c.json({ error: 'start failed', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
