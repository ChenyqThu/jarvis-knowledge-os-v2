import { createContext, useContext } from 'react';

export interface DashboardContextValue {
  /** Authenticated fetch against /api/v1<path>. Throws on non-2xx; on 401
   * it also clears the stored token and flips the app back to the token
   * gate (see App.tsx) before throwing. Automatically applies the current
   * global source filter (`?source=`), per design.md §2 — "全部" sends no
   * param. */
  request<T>(path: string): Promise<T>;
  /** Authenticated fetch that does the SAME Bearer-auth + 401→logout handling
   * as `request()` but does NOT auto-append the global `?source=` filter — the
   * caller owns the full `path` (incl. any `?source=`). Editor detail/versions/
   * save/revert MUST target a page's OWN `source_id` explicitly, not the global
   * tab (design.md §3 correctness rule), so they use this instead of `request`.
   * Accepts a `RequestInit` for POST bodies; on a non-2xx JSON error body it
   * throws `detail ?? error` so save/revert failures surface the server reason. */
  authFetch<T>(path: string, init?: RequestInit): Promise<T>;
  /** Bumped by the manual refresh button; pages depend on it in their
   * data-loading effects to re-fetch. */
  refreshKey: number;
  /** Pages call this after a successful load so the top bar can show an
   * accurate "last refreshed" timestamp. */
  notifyLoaded(): void;
  /** Currently selected global source tab ("all" = 全部, no filter).
   * Pages must include this in their data-loading effect's dependency
   * array so a source-tab change refetches (design.md §2). */
  source: string;
  /** Sets the global source filter and persists it to localStorage. */
  setSource(id: string): void;
  /** Source-tab options, in display order: 全部 sentinel is implicit
   * (rendered by TopBar itself), this is just the 4 real source ids —
   * from `/api/v1/sources` once loaded, hardcoded fallback order until
   * then (design.md §2). */
  sourceIds: string[];
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error('useDashboard must be used within a DashboardContext.Provider');
  }
  return ctx;
}
