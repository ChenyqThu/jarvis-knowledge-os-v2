import postgres from 'postgres';

// Read-only connection. ALL queries in this package MUST go through the
// `kos_dashboard_ro` Postgres role: GRANT SELECT only (no INSERT/UPDATE/
// DELETE) + BYPASSRLS (required because every table in schema.sql enables
// row-level security with zero policies defined — a non-BYPASSRLS role sees
// 0 rows everywhere, not an error, so this is not optional). See
// .trellis/tasks/07-21-m1-stats-api/implement.md for the exact GRANT/ALTER
// statements that were run once against the production database.
const DATABASE_URL =
  process.env.KOS_DASHBOARD_DATABASE_URL ?? 'postgresql://kos_dashboard_ro@127.0.0.1:5432/gbrain';

export const sql = postgres(DATABASE_URL, {
  max: 5,
  idle_timeout: 30,
});
