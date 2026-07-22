import { useEffect, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import type { OverviewResponse } from '../types';
import { MetricCard } from '../components/MetricCard';
import { ScoreCard } from '../components/ScoreCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatPercent } from '../constants';

export function Overview() {
  const { request, refreshKey, notifyLoaded, source } = useDashboard();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    request<OverviewResponse>('/overview')
      .then(res => {
        if (cancelled) return;
        setData(res);
        notifyLoaded();
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, source, retryTick]);

  if (error) {
    return (
      <Alert variant="destructive" className="state-enter">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => setRetryTick(t => t + 1)}>
            重试
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-[260px] rounded-xl" />
          <Skeleton className="h-[260px] rounded-xl" />
          <Skeleton className="h-[260px] rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <MetricCard label="总页数" value={data.pages} />
        <MetricCard label="总 Chunks" value={data.chunks} />
        <MetricCard label="Sources 数" value={data.sources} />
        <MetricCard label="近 24h 新增" value={data.last24h_pages} />
        <MetricCard label="软删页数" value={data.deleted_pages} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ScoreCard score={data.brain_score} />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Embedding 覆盖率（双口径）
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Chunk 级覆盖率</span>
              <span className="tabular-nums">{formatPercent(data.embedding.chunk_coverage)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">页级覆盖率</span>
              <span className="tabular-nums">{formatPercent(data.embedding.page_coverage)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Chunkless 页数</span>
              <span className="tabular-nums">{data.embedding.chunkless_pages.toLocaleString('zh-CN')}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              两口径差异来自 chunkless 页（有页无 chunk，上游 #2163）：chunk 级覆盖率看不到这些页，
              页级覆盖率会把它们计入未覆盖，因此通常更低、更保守。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">孤儿页</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{data.orphans.toLocaleString('zh-CN')}</p>
            <p className="mt-2 text-xs text-muted-foreground">无入链且无出链的页面数（软删页已排除）</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
