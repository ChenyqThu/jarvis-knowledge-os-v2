// Frontend zero-fill for the trends API's sparse bucket contract (prd.md
// "API 契约"): the backend only emits a row for buckets that have data, so a
// zero-count day/week is *missing*, not present-with-0. Charts must show an
// unbroken series, so we fill the full requested window here.
//
// Bucket strings are opaque `YYYY-MM-DD` PT-local dates (design.md §5 item
// 0). All date arithmetic below is done on UTC-epoch millis constructed via
// `Date.UTC(y, m, d)` with no time-of-day component — this is a pure
// calendar-math trick, NOT a timezone conversion: since the components are
// treated as plain numbers (not "this instant in this zone"), adding/
// subtracting whole days never drifts regardless of the runtime's local
// timezone, and reading back with the UTC getters recovers the same y/m/d.
// This is what lets us avoid ever calling `new Date('YYYY-MM-DD')` and
// re-deriving fields in local time (the off-by-one trap design.md warns
// about).

import { todayPT } from './time';

export interface Bucket {
  bucket: string;
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateString(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatDateString(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Fills daily buckets for the trailing `days`-day window ending at `today`
 * (inclusive), defaulting missing days to count 0. `today` defaults to the
 * current PT date — pass it explicitly in tests. */
export function zeroFillDaily(buckets: Bucket[], days: number, today: string = todayPT()): Bucket[] {
  const countByBucket = new Map(buckets.map(b => [b.bucket, b.count]));
  const endMs = parseDateString(today);
  const result: Bucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const bucket = formatDateString(endMs - i * DAY_MS);
    result.push({ bucket, count: countByBucket.get(bucket) ?? 0 });
  }
  return result;
}

/** Monday (ISO week start) of the week containing the given UTC-epoch date. */
function isoMondayOf(ms: number): number {
  const dow = new Date(ms).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  return ms - daysSinceMonday * DAY_MS;
}

/** Fills weekly buckets (one per ISO week, keyed by that week's Monday) for
 * the trailing `days`-day window ending at `today`. Same zero/today
 * semantics as `zeroFillDaily`. */
export function zeroFillWeekly(buckets: Bucket[], days: number, today: string = todayPT()): Bucket[] {
  const countByBucket = new Map(buckets.map(b => [b.bucket, b.count]));
  const endMs = parseDateString(today);
  const startMs = endMs - (days - 1) * DAY_MS;
  const firstMonday = isoMondayOf(startMs);
  const lastMonday = isoMondayOf(endMs);
  const result: Bucket[] = [];
  for (let ms = firstMonday; ms <= lastMonday; ms += 7 * DAY_MS) {
    const bucket = formatDateString(ms);
    result.push({ bucket, count: countByBucket.get(bucket) ?? 0 });
  }
  return result;
}
