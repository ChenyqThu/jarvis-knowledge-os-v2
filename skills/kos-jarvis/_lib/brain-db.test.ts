/**
 * BrainDb eval-capture safety-net tests.
 *
 * Why this exists: v0.25.0 added 5 eval-capture methods to upstream's
 * `BrainEngine` interface. BrainDb is NOT a BrainEngine implementation
 * (it's a thin direct-DB reader + writer for kos-jarvis quality skills),
 * so the schema migration alone keeps production healthy. We mirror the
 * surface in BrainDb anyway so any future fork skill that wants to read
 * the eval_candidates / eval_capture_failures tables doesn't need to
 * import from upstream `src/core/`.
 *
 * Test setup: in-memory PGLite (no HOME, no config file dependency).
 * We bypass BrainDb.open() and inject the engine directly via a private
 * field write — same trick `_lib` uses elsewhere — so the tests don't
 * touch the developer's real ~/.gbrain config.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { BrainDb, type EvalCandidateInput } from './brain-db.ts';

let pglite: PGlite;
let db: BrainDb;

beforeAll(async () => {
  pglite = await PGlite.create({ extensions: { vector, pg_trgm } });

  // Forge minimal eval-capture schema (mirrors src/core/pglite-schema.ts v30).
  await pglite.exec(`
    CREATE TABLE IF NOT EXISTS eval_candidates (
      id                    SERIAL PRIMARY KEY,
      tool_name             TEXT         NOT NULL CHECK (tool_name IN ('query', 'search')),
      query                 TEXT         NOT NULL CHECK (length(query) <= 51200),
      retrieved_slugs       TEXT[]       NOT NULL DEFAULT '{}',
      retrieved_chunk_ids   INTEGER[]    NOT NULL DEFAULT '{}',
      source_ids            TEXT[]       NOT NULL DEFAULT '{}',
      expand_enabled        BOOLEAN,
      detail                TEXT         CHECK (detail IS NULL OR detail IN ('low', 'medium', 'high')),
      detail_resolved       TEXT         CHECK (detail_resolved IS NULL OR detail_resolved IN ('low', 'medium', 'high')),
      vector_enabled        BOOLEAN      NOT NULL,
      expansion_applied     BOOLEAN      NOT NULL,
      latency_ms            INTEGER      NOT NULL,
      remote                BOOLEAN      NOT NULL,
      job_id                INTEGER,
      subagent_id           INTEGER,
      created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS eval_capture_failures (
      id      SERIAL       PRIMARY KEY,
      ts      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      reason  TEXT         NOT NULL CHECK (reason IN ('db_down', 'rls_reject', 'check_violation', 'scrubber_exception', 'other'))
    );
  `);

  db = new BrainDb('/__test_unused__');
  // Inject the in-memory PGLite. open() would try to read ~/.gbrain/config.json
  // and pick an engine; we want neither side effect.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).pglite = pglite;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).engineKind = 'pglite';
});

afterAll(async () => {
  // Don't go through db.close() — its WAL-switch shim is for file-backed
  // PGLite; in-memory has no WAL, and closing twice via both paths errors.
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec('DELETE FROM eval_candidates; DELETE FROM eval_capture_failures;');
});

function makeInput(overrides: Partial<EvalCandidateInput> = {}): EvalCandidateInput {
  return {
    tool_name: 'query',
    query: 'who is alice-example',
    retrieved_slugs: ['people/alice-example', 'companies/acme-example'],
    retrieved_chunk_ids: [42, 43],
    source_ids: ['default'],
    expand_enabled: true,
    detail: null,
    detail_resolved: 'medium',
    vector_enabled: true,
    expansion_applied: false,
    latency_ms: 123,
    remote: true,
    job_id: null,
    subagent_id: null,
    ...overrides,
  };
}

describe('BrainDb eval-capture surface (v0.25.0 safety net)', () => {
  test('logEvalCandidate inserts and returns row id', async () => {
    const id = await db.logEvalCandidate(makeInput());
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  test('listEvalCandidates returns rows ordered created_at DESC, id DESC', async () => {
    const id1 = await db.logEvalCandidate(makeInput({ query: 'first' }));
    const id2 = await db.logEvalCandidate(makeInput({ query: 'second' }));
    const id3 = await db.logEvalCandidate(makeInput({ query: 'third' }));

    const rows = await db.listEvalCandidates();
    expect(rows).toHaveLength(3);
    // Same-millisecond inserts: id DESC tiebreaker keeps third row first.
    expect(rows[0]!.id).toBe(id3);
    expect(rows[1]!.id).toBe(id2);
    expect(rows[2]!.id).toBe(id1);
  });

  test('listEvalCandidates filters by tool_name', async () => {
    await db.logEvalCandidate(makeInput({ tool_name: 'query', query: 'a' }));
    await db.logEvalCandidate(makeInput({ tool_name: 'search', query: 'b' }));
    await db.logEvalCandidate(makeInput({ tool_name: 'query', query: 'c' }));

    const queryRows = await db.listEvalCandidates({ tool: 'query' });
    expect(queryRows).toHaveLength(2);
    expect(queryRows.every(r => r.tool_name === 'query')).toBe(true);

    const searchRows = await db.listEvalCandidates({ tool: 'search' });
    expect(searchRows).toHaveLength(1);
    expect(searchRows[0]!.tool_name).toBe('search');
  });

  test('listEvalCandidates clamps limit to [1, 100000] and defaults non-positive to 1000', async () => {
    // Seed 3 rows, then assert clamping behavior.
    await db.logEvalCandidate(makeInput({ query: 'a' }));
    await db.logEvalCandidate(makeInput({ query: 'b' }));
    await db.logEvalCandidate(makeInput({ query: 'c' }));

    expect((await db.listEvalCandidates({ limit: 2 })).length).toBe(2);
    // 0, negative, NaN → defaults
    expect((await db.listEvalCandidates({ limit: 0 })).length).toBe(3);
    expect((await db.listEvalCandidates({ limit: -1 })).length).toBe(3);
    expect((await db.listEvalCandidates({ limit: NaN })).length).toBe(3);
  });

  test('deleteEvalCandidatesBefore removes only rows older than the cutoff', async () => {
    const oldId = await db.logEvalCandidate(makeInput({ query: 'old' }));
    // Force created_at backwards on the first row, leave the second at NOW().
    await pglite.query(
      `UPDATE eval_candidates SET created_at = $1 WHERE id = $2`,
      [new Date('2020-01-01T00:00:00Z'), oldId]
    );
    await db.logEvalCandidate(makeInput({ query: 'new' }));

    const cutoff = new Date('2024-01-01T00:00:00Z');
    const deleted = await db.deleteEvalCandidatesBefore(cutoff);
    expect(deleted).toBe(1);

    const remaining = await db.listEvalCandidates();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.query).toBe('new');
  });

  test('logEvalCaptureFailure + listEvalCaptureFailures round-trip', async () => {
    await db.logEvalCaptureFailure('db_down');
    await db.logEvalCaptureFailure('scrubber_exception');
    await db.logEvalCaptureFailure('other');

    const failures = await db.listEvalCaptureFailures();
    expect(failures).toHaveLength(3);
    // Upstream contract: ORDER BY ts DESC only — no id tiebreaker on
    // eval_capture_failures (matches postgres-engine.ts:1800). Same-ms
    // inserts can return in any order, so we assert as a set.
    const reasons = failures.map(f => f.reason);
    expect(new Set(reasons)).toEqual(new Set(['db_down', 'scrubber_exception', 'other']));
  });
});
