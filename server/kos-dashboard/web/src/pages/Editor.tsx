import { useEffect, useState } from 'react';
import { LockIcon } from 'lucide-react';
import { useDashboard } from '../dashboard-context';
import type { PageListItem, PageListResponse } from '../types';
import { kindLabel } from '../constants';
import { formatTimestampPT } from '../lib/time';
import { cn } from '@/lib/utils';
import { PageDetailPane } from '../components/PageDetailPane';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALL_KINDS = 'all';
// The 9 KOS-Jarvis page kinds (constants.ts / project CLAUDE.md), a closed
// enum — 'unknown'/legacy buckets aren't offered as an explicit filter.
const KIND_OPTIONS = [
  'source',
  'entity',
  'concept',
  'project',
  'decision',
  'synthesis',
  'comparison',
  'protocol',
  'timeline',
] as const;

const LIMIT = 50;

/** Editor page (F5): a browse list on the left (honors the global `?source=`
 * tab via `request()`), a page editor on the right (targets each page's own
 * source_id via `authFetch` — design.md §3 correctness rule). List-row select
 * and search are high-frequency → no animation (design.md §3). */
export function Editor() {
  const { request, refreshKey, notifyLoaded, source } = useDashboard();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [kind, setKind] = useState<string>(ALL_KINDS);
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<PageListResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [selected, setSelected] = useState<PageListItem | null>(null);

  // Debounce the search box (~300ms) so keystrokes don't each hit the API.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(searchInput), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Snap back to page 0 whenever a filter changes (identical value → React
  // bails out of the re-render, so no redundant fetch on the common path).
  useEffect(() => {
    setOffset(0);
  }, [source, debouncedQ, kind]);

  useEffect(() => {
    let cancelled = false;
    setListError(null);
    const params = new URLSearchParams();
    const q = debouncedQ.trim();
    if (q) params.set('q', q);
    if (kind !== ALL_KINDS) params.set('kind', kind);
    params.set('limit', String(LIMIT));
    params.set('offset', String(offset));
    request<PageListResponse>(`/pages?${params.toString()}`)
      .then(res => {
        if (cancelled) return;
        setList(res);
        notifyLoaded();
      })
      .catch(err => {
        if (!cancelled) setListError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, source, debouncedQ, kind, offset, retryTick]);

  const total = list?.total ?? 0;

  const listBody = listError ? (
    <Alert variant="destructive" className="state-enter">
      <AlertTitle>加载失败</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>{listError}</span>
        <Button variant="outline" size="sm" onClick={() => setRetryTick(t => t + 1)}>
          重试
        </Button>
      </AlertDescription>
    </Alert>
  ) : !list ? (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-14 rounded-md" />
      ))}
    </div>
  ) : list.pages.length === 0 ? (
    <p className="py-12 text-center text-sm text-muted-foreground">没有匹配的页面。</p>
  ) : (
    <ul className="flex max-h-[calc(78vh-9rem)] flex-col gap-1 overflow-y-auto pr-1">
      {list.pages.map(row => {
        const isSelected = selected?.source_id === row.source_id && selected?.slug === row.slug;
        return (
          <li key={`${row.source_id}:${row.slug}`}>
            <button
              type="button"
              onClick={() => setSelected(row)}
              aria-current={isSelected}
              className={cn(
                'flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left outline-none',
                'hover-row focus-visible:ring-[3px] focus-visible:ring-ring/50',
                isSelected && 'bg-muted',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="mono truncate text-xs text-muted-foreground">{row.slug}</span>
                {!row.editable && (
                  <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
                    <LockIcon />
                    锁定
                  </Badge>
                )}
              </div>
              <span className="truncate text-sm font-medium">{row.title || '（无标题）'}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatTimestampPT(row.updated_at)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
      <Card className="gap-4 py-4">
        <CardContent className="flex flex-col gap-3">
          <Input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="搜索 slug / 标题…"
            aria-label="搜索页面"
          />
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_KINDS}>全部</SelectItem>
              {KIND_OPTIONS.map(k => (
                <SelectItem key={k} value={k}>
                  {kindLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {listBody}

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {total === 0
                ? '共 0 条'
                : `${offset + 1}–${Math.min(offset + LIMIT, total)} / 共 ${total.toLocaleString('zh-CN')} 条`}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + LIMIT >= total}
                onClick={() => setOffset(o => o + LIMIT)}
              >
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <PageDetailPane selected={selected} />
    </div>
  );
}
