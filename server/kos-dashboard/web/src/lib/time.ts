// All dates/times in this dashboard are PT (America/Los_Angeles), not
// Beijing/local time — see design.md §5 item 0 (Lucien, 2026-07-21 spec
// change). Two distinct concerns live here:
//
// 1. Trend bucket strings (`YYYY-MM-DD`) are already PT-local, pre-bucketed
//    by the backend. They are OPAQUE strings for axis-label purposes —
//    never round-trip them through `new Date(...)`, which parses bare date
//    strings as UTC midnight and then renders in the browser's local zone,
//    silently shifting the displayed day by ±1.
// 2. Absolute timestamps (e.g. `updated_at`) are real instants and must be
//    explicitly formatted in the PT zone via `Intl.DateTimeFormat`.

export const PT_TIME_ZONE = 'America/Los_Angeles';

const ptDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: PT_TIME_ZONE });

const ptDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: PT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Today's date as observed in PT, `YYYY-MM-DD` (en-CA locale formats dates
 * in ISO order). Accepts an injectable `now` for tests — production
 * callers should rely on the default. */
export function todayPT(now: Date = new Date()): string {
  return ptDateFormatter.format(now);
}

/** Formats an absolute ISO timestamp in PT, labeled `PT` per design.md §5
 * item 0. Used for table columns like "更新时间", never for bucket strings. */
export function formatTimestampPT(iso: string | null): string {
  if (!iso) return '—';
  return `${ptDateTimeFormatter.format(new Date(iso))} PT`;
}

/** Trend-chart axis label from an opaque `YYYY-MM-DD` bucket string —
 * pure substring, no `Date` parsing (design.md §5 item 0). */
export function bucketToAxisLabel(bucket: string): string {
  return bucket.slice(5);
}
