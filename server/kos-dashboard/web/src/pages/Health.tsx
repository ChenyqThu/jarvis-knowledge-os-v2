import { useEffect, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import type { HealthResponse, OverviewResponse } from '../types';
import { MetricCard } from '../components/MetricCard';
import { summarizeDoctor } from '../lib/doctor';
import { formatTimestampPT } from '../lib/time';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function tone(value: number): 'success' | 'warning' {
  return value > 0 ? 'warning' : 'success';
}

/** Disabled row-action slot reserved for M3 (design.md §5: 行尾预留「编辑」
 * 按钮位). Wrapped in a `<span>` because Radix Tooltip needs a focusable/
 * hoverable trigger element, and a disabled <button> fires neither. */
function EditSlot() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block">
          <Button variant="ghost" size="sm" disabled>
            编辑
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>M3 开放</TooltipContent>
    </Tooltip>
  );
}

export function Health() {
  const { request, refreshKey, notifyLoaded, source } = useDashboard();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([request<HealthResponse>('/health'), request<OverviewResponse>('/overview')])
      .then(([healthRes, overviewRes]) => {
        if (cancelled) return;
        setHealth(healthRes);
        setOverview(overviewRes);
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

  if (!health || !overview) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[280px] rounded-xl" />
        <Skeleton className="h-[280px] rounded-xl" />
      </div>
    );
  }

  const doctor = summarizeDoctor(overview.brain_score.components);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <MetricCard label="Doctor Fail" value={doctor.fail} tone="danger" />
        <MetricCard label="Doctor Warn" value={doctor.warn} tone="warning" />
        <MetricCard label="Mislabel Chunks" value={health.mislabeled_chunks} tone={tone(health.mislabeled_chunks)} />
        <MetricCard label="Chunkless 总数" value={health.chunkless_total} tone={tone(health.chunkless_total)} />
        <MetricCard label="孤儿页总数" value={health.orphans_total} tone={tone(health.orphans_total)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            孤儿页（显示 {health.orphan_pages.length} / 共 {health.orphans_total.toLocaleString('zh-CN')}）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className="text-right">更新时间</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.orphan_pages.map(r => (
                <TableRow key={`${r.source_id}:${r.slug}`}>
                  <TableCell className="text-muted-foreground">{r.slug}</TableCell>
                  <TableCell className="text-muted-foreground">{r.source_id}</TableCell>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatTimestampPT(r.updated_at)}
                  </TableCell>
                  <TableCell>
                    <EditSlot />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Chunkless 页（显示 {health.chunkless.length} / 共 {health.chunkless_total.toLocaleString('zh-CN')}）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className="text-right">创建时间</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {health.chunkless.map(r => (
                <TableRow key={`${r.source_id}:${r.slug}`}>
                  <TableCell className="text-muted-foreground">{r.slug}</TableCell>
                  <TableCell className="text-muted-foreground">{r.source_id}</TableCell>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatTimestampPT(r.created_at)}
                  </TableCell>
                  <TableCell>
                    <EditSlot />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
