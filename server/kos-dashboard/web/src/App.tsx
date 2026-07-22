import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { TokenGate } from './components/TokenGate';
import { TopBar } from './components/TopBar';
import { TAB_IDS, type TabId } from './components/PageTabs';
import { Overview } from './pages/Overview';
import { Distribution } from './pages/Distribution';
import { Trends } from './pages/Trends';
import { Health } from './pages/Health';
import { Ops } from './pages/Ops';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardContext, type DashboardContextValue } from './dashboard-context';

// Lazy-loaded so CodeMirror (only the editor needs it) is code-split into its
// own async chunk instead of bloating the initial bundle — the other pages'
// echarts stays in the main chunk, the editor's CodeMirror stays out of it.
const Editor = lazy(() => import('./pages/Editor').then(m => ({ default: m.Editor })));
import {
  ALL_SOURCES,
  FALLBACK_SOURCE_IDS,
  SOURCE_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
  withSourceParam,
} from './api';
import type { SourceRow } from './types';

function tabFromHash(): TabId {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return (TAB_IDS as readonly string[]).includes(raw) ? (raw as TabId) : 'overview';
}

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [source, setSourceState] = useState<string>(
    () => localStorage.getItem(SOURCE_STORAGE_KEY) ?? ALL_SOURCES,
  );
  const [sourceIds, setSourceIds] = useState<string[]>(FALLBACK_SOURCE_IDS);

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
  }, []);

  const setSource = useCallback((id: string) => {
    localStorage.setItem(SOURCE_STORAGE_KEY, id);
    setSourceState(id);
  }, []);

  // Source catalog for the tab bar (design.md §2) — deliberately NOT routed
  // through `request()`, which auto-applies the *current* source filter:
  // fetching the catalog itself must always be unfiltered, otherwise a
  // previously-persisted non-"全部" selection would ask the backend to
  // filter the very list of sources by itself. Falls back to
  // FALLBACK_SOURCE_IDS (already the initial state) on any failure.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch('/api/v1/sources', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? (res.json() as Promise<SourceRow[]>) : Promise.reject(res.status)))
      .then(rows => {
        if (!cancelled && rows.length > 0) setSourceIds(rows.map(r => r.source_id));
      })
      .catch(() => {
        /* keep FALLBACK_SOURCE_IDS */
      });
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey]);

  const dashboardValue = useMemo<DashboardContextValue | null>(() => {
    if (!token) return null;
    return {
      async request<T>(path: string): Promise<T> {
        const res = await fetch(`/api/v1${withSourceParam(path, source)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          handleUnauthorized();
          throw new Error('登录已失效，请重新输入 Token');
        }
        if (!res.ok) {
          throw new Error(`请求失败（HTTP ${res.status}）`);
        }
        return (await res.json()) as T;
      },
      // Same auth + 401 handling as request(), but NO withSourceParam: the
      // Editor's detail/versions/save/revert must carry the page's own
      // source_id explicitly (design.md §3 correctness rule), so `path` is
      // used verbatim. Surfaces the server's `{error, detail}` JSON message on
      // failure so save/revert errors are actionable.
      async authFetch<T>(path: string, init?: RequestInit): Promise<T> {
        const res = await fetch(`/api/v1${path}`, {
          ...init,
          // Bound every request so a hung fetch surfaces as an error instead of
          // leaving the editor stuck (e.g. read-only during a stuck save) — codex.
          signal: init?.signal ?? AbortSignal.timeout(30_000),
          headers: { Authorization: `Bearer ${token}`, ...init?.headers },
        });
        if (res.status === 401) {
          handleUnauthorized();
          throw new Error('登录已失效，请重新输入 Token');
        }
        if (!res.ok) {
          let message = `请求失败（HTTP ${res.status}）`;
          try {
            const body = (await res.json()) as { error?: string; detail?: string };
            message = body.detail ?? body.error ?? message;
          } catch {
            /* non-JSON error body — keep the HTTP-status default */
          }
          throw new Error(message);
        }
        return (await res.json()) as T;
      },
      refreshKey,
      notifyLoaded: () => setLastUpdated(new Date()),
      source,
      setSource,
      sourceIds,
    };
  }, [token, refreshKey, handleUnauthorized, source, setSource, sourceIds]);

  if (!token || !dashboardValue) {
    return (
      <TokenGate
        onAuthenticated={t => {
          localStorage.setItem(TOKEN_STORAGE_KEY, t);
          setToken(t);
        }}
      />
    );
  }

  const changeTab = (id: TabId) => {
    window.location.hash = `/${id}`;
    setTab(id);
  };

  return (
    <DashboardContext.Provider value={dashboardValue}>
      <div className="min-h-svh">
        <TopBar
          lastUpdated={lastUpdated}
          onRefresh={() => setRefreshKey(k => k + 1)}
          activeTab={tab}
          onTabChange={changeTab}
        />
        <main className="mx-auto max-w-7xl px-6 py-6">
          {tab === 'overview' && <Overview />}
          {tab === 'distribution' && <Distribution />}
          {tab === 'trends' && <Trends />}
          {tab === 'health' && <Health />}
          {tab === 'editor' && (
            <Suspense fallback={<Skeleton className="h-[70vh] rounded-xl" />}>
              <Editor />
            </Suspense>
          )}
          {tab === 'ops' && <Ops />}
        </main>
      </div>
    </DashboardContext.Provider>
  );
}
