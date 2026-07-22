// localStorage key + one-off token validation helper. The per-request fetch
// client (with 401 -> logout wiring) lives in dashboard-context.tsx since it
// needs access to React state (setToken).

export const TOKEN_STORAGE_KEY = 'kos_dashboard_token';

/** localStorage key for the selected global source tab (design.md §2). */
export const SOURCE_STORAGE_KEY = 'kos-dashboard.source';

/** Sentinel meaning "no `?source=` filter" — the "全部" tab. */
export const ALL_SOURCES = 'all';

/** Hardcoded fallback tab order (design.md §2), used until `/api/v1/sources`
 * resolves (or if it fails) so the source tabs render immediately. */
export const FALLBACK_SOURCE_IDS = ['default', 'mailagent-emails', 'omada', 'gbrain-docs'];

/** Appends `?source=<id>` (or `&source=<id>` if `path` already has a query
 * string) unless `source` is the "全部" sentinel, per the global source
 * filter contract (design.md §2, prd.md API 契约). */
export function withSourceParam(path: string, source: string): string {
  if (source === ALL_SOURCES) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}source=${encodeURIComponent(source)}`;
}

/** Probes /api/v1/overview with the given token. Used only by the token gate
 * to give immediate feedback on a bad token, before committing it to
 * localStorage and the rest of the app. */
export async function validateToken(token: string): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/overview', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
