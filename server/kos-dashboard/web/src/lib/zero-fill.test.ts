import { describe, expect, test } from 'bun:test';
import { zeroFillDaily, zeroFillWeekly } from './zero-fill';
import { todayPT } from './time';

describe('zeroFillDaily', () => {
  test('plain: fills a trailing window and zero-fills missing days', () => {
    const result = zeroFillDaily([{ bucket: '2026-07-19', count: 3 }], 5, '2026-07-21');
    expect(result).toEqual([
      { bucket: '2026-07-17', count: 0 },
      { bucket: '2026-07-18', count: 0 },
      { bucket: '2026-07-19', count: 3 },
      { bucket: '2026-07-20', count: 0 },
      { bucket: '2026-07-21', count: 0 },
    ]);
  });

  test('cross-month: window spanning July -> August rolls over correctly', () => {
    const result = zeroFillDaily([{ bucket: '2026-07-31', count: 7 }], 5, '2026-08-02');
    expect(result.map(r => r.bucket)).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
    expect(result.find(r => r.bucket === '2026-07-31')?.count).toBe(7);
    expect(result.find(r => r.bucket === '2026-08-01')?.count).toBe(0);
  });
});

describe('zeroFillWeekly', () => {
  test('week-boundary: buckets land on ISO Mondays, including a partial current week', () => {
    // 2026-07-21 is a Tuesday; the 14-day window back to 2026-07-08 spans
    // three ISO weeks (Mondays 07-06, 07-13, 07-20) — the last one only
    // partially elapsed (Mon+Tue), which must still zero-fill, not be omitted.
    const result = zeroFillWeekly([{ bucket: '2026-07-13', count: 12 }], 14, '2026-07-21');
    expect(result).toEqual([
      { bucket: '2026-07-06', count: 0 },
      { bucket: '2026-07-13', count: 12 },
      { bucket: '2026-07-20', count: 0 },
    ]);
  });
});

describe('todayPT', () => {
  test('PT date can differ from the UTC calendar date for the same instant', () => {
    // 2026-07-21T05:00:00Z is 2026-07-20 22:00 PDT (UTC-7 in July) — the PT
    // calendar date is one day behind the naive UTC date. Getting "today"
    // from `new Date().toISOString()` (or any local-tz Date parsing) would
    // silently pick the wrong bucket at exactly this kind of moment.
    const instant = new Date('2026-07-21T05:00:00Z');
    expect(todayPT(instant)).toBe('2026-07-20');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-07-21');
  });
});
