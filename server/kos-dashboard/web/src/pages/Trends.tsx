import { useEffect, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import type { TrendsResponse } from '../types';
import { EChart } from '../components/EChart';
import { MetricCard } from '../components/MetricCard';
import { lineChartOption, type LineSeriesSpec } from '../chart-options';
import { zeroFillDaily, zeroFillWeekly, type Bucket } from '../lib/zero-fill';
import { bucketToAxisLabel } from '../lib/time';
import { COLOR_PRIMARY, COLOR_SUCCESS, CHART_SERIES_COLORS, formatPercent } from '../constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type Granularity = 'day' | 'week';
const RANGE_DAYS = [30, 90, 365] as const;

function zeroFill(granularity: Granularity, buckets: Bucket[], days: number): Bucket[] {
  return granularity === 'day' ? zeroFillDaily(buckets, days) : zeroFillWeekly(buckets, days);
}

/** Pages growth is the only trend row that currently carries `source_id`
 * (trends.ts groups `pages` by bucket+source unconditionally) — when the
 * global filter is "全部" and more than one source appears, stack them as a
 * multi-series area chart; a single source (either because one is selected,
 * or because only one has data in-window) renders as a plain line. */
function buildPagesSeries(rows: { bucket: string; source_id: string; count: number }[], granularity: Granularity, days: number) {
  const bySource = new Map<string, Bucket[]>();
  for (const r of rows) {
    const list = bySource.get(r.source_id) ?? [];
    list.push({ bucket: r.bucket, count: r.count });
    bySource.set(r.source_id, list);
  }
  const sourceIds = [...bySource.keys()].sort();
  const filled = sourceIds.map(id => zeroFill(granularity, bySource.get(id) ?? [], days));
  const categories = (filled[0] ?? zeroFill(granularity, [], days)).map(b => bucketToAxisLabel(b.bucket));
  const stacked = sourceIds.length > 1;
  const series: LineSeriesSpec[] = sourceIds.map((id, i) => ({
    name: id,
    data: filled[i].map(b => b.count),
    color: CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length],
    area: stacked,
    stack: stacked ? 'pages' : undefined,
  }));
  return { categories, series };
}

/** chunks/embedding_coverage/chunkless are always a single series — trends.ts
 * does not (yet) group chunks by source_id at all (see implement-frontend.md
 * "deviations"), so there is nothing to stack regardless of the source
 * filter. */
function buildSingleSeries(rows: Bucket[], granularity: Granularity, days: number, name: string, color: string, area = false) {
  const filled = zeroFill(granularity, rows, days);
  return {
    categories: filled.map(b => bucketToAxisLabel(b.bucket)),
    series: [{ name, data: filled.map(b => b.count), color, area }] as LineSeriesSpec[],
  };
}

export function Trends() {
  const { request, refreshKey, notifyLoaded, source } = useDashboard();
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [days, setDays] = useState<(typeof RANGE_DAYS)[number]>(90);
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    request<TrendsResponse>(`/trends?granularity=${granularity}&days=${days}`)
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
  }, [refreshKey, source, granularity, days, retryTick]);

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

  const controls = (
    <div className="flex items-center gap-4">
      <Select value={granularity} onValueChange={v => setGranularity(v as Granularity)}>
        <SelectTrigger size="sm" className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="day">按天</SelectItem>
          <SelectItem value="week">按周</SelectItem>
        </SelectContent>
      </Select>
      <Tabs value={String(days)} onValueChange={v => setDays(Number(v) as (typeof RANGE_DAYS)[number])}>
        <TabsList>
          {RANGE_DAYS.map(d => (
            <TabsTrigger key={d} value={String(d)}>
              {d} 天
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        {controls}
        <Skeleton className="h-[320px] rounded-xl" />
        <Skeleton className="h-[320px] rounded-xl" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    );
  }

  const pagesChart = buildPagesSeries(data.pages, granularity, days);
  const chunksChart = buildSingleSeries(data.chunks, granularity, days, '总 Chunks', COLOR_SUCCESS, true);

  // chunkless "current value" is always today's PT count, independent of the
  // page's chosen granularity/range — zero-fill a 1-day window so a missing
  // (i.e. zero) bucket for today reads as 0 rather than "no data".
  const chunklessToday = data.chunkless ? zeroFillDaily(data.chunkless, 1)[0].count : null;

  return (
    <div className="flex flex-col gap-6">
      {controls}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            页面增长{pagesChart.series.length > 1 ? '（按 source 堆叠）' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EChart option={lineChartOption(pagesChart.categories, pagesChart.series)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Chunk 增长（trends 契约暂无按 source 分组，恒为单线 — 见 implement-frontend.md）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EChart option={lineChartOption(chunksChart.categories, chunksChart.series)} />
        </CardContent>
      </Card>

      {data.embedding_coverage || data.chunkless ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {data.embedding_coverage && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Embedding 覆盖趋势</CardTitle>
              </CardHeader>
              <CardContent>
                <EChart
                  option={lineChartOption(
                    zeroFill(granularity, data.embedding_coverage, days).map(b => bucketToAxisLabel(b.bucket)),
                    [
                      {
                        name: '覆盖率',
                        data: zeroFill(granularity, data.embedding_coverage, days).map(b => b.count),
                        color: COLOR_PRIMARY,
                      },
                    ],
                    { yAxisFormatter: v => formatPercent(v) },
                  )}
                />
              </CardContent>
            </Card>
          )}
          {chunklessToday !== null && (
            <MetricCard
              label="Chunkless 哨兵（今日 PT）"
              value={chunklessToday}
              tone={chunklessToday > 0 ? 'warning' : 'success'}
              sublabel={chunklessToday > 0 ? '存在未 chunk 的页面' : '全部页面已 chunk'}
            />
          )}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-6 text-sm text-muted-foreground">
            Embedding 覆盖趋势 / Chunkless 哨兵：trends 契约暂未提供 embedding_coverage / chunkless
            字段，后端上线后自动显示（见 implement-frontend.md「假设与偏差」）。
          </CardContent>
        </Card>
      )}
    </div>
  );
}
