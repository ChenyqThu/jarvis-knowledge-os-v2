import { useEffect, useState } from 'react';
import { useDashboard } from '../dashboard-context';
import type { KindsResponse, SourceRow } from '../types';
import { EChart } from '../components/EChart';
import { SourceTable } from '../components/SourceTable';
import { MostConnectedTable } from '../components/MostConnectedTable';
import { horizontalBarOption } from '../chart-options';
import { coverageColor, kindLabel } from '../constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const ROW_HEIGHT = 36;
const MIN_CHART_HEIGHT = 200;

export function Distribution() {
  const { request, refreshKey, notifyLoaded, source } = useDashboard();
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [kinds, setKinds] = useState<KindsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([request<SourceRow[]>('/sources'), request<KindsResponse>('/kinds')])
      .then(([sourcesRes, kindsRes]) => {
        if (cancelled) return;
        setSources(sourcesRes);
        setKinds(kindsRes);
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

  if (!sources || !kinds) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-[320px] rounded-xl" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-[280px] rounded-xl" />
          <Skeleton className="h-[280px] rounded-xl" />
        </div>
        <Skeleton className="h-[280px] rounded-xl" />
        <Skeleton className="h-[240px] rounded-xl" />
      </div>
    );
  }

  const sourceChart = horizontalBarOption(
    sources.map(s => s.name),
    sources.map(s => s.pages),
    sources.map(s => coverageColor(s.page_coverage)),
  );

  const kindChart = horizontalBarOption(
    kinds.kos_kinds.map(k => kindLabel(k.kind)),
    kinds.kos_kinds.map(k => k.count),
  );

  const typeChart = horizontalBarOption(
    kinds.page_types.map(t => t.type),
    kinds.page_types.map(t => t.count),
  );

  const tagChart = horizontalBarOption(
    kinds.top_tags.map(t => t.tag),
    kinds.top_tags.map(t => t.count),
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Per-Source 分布（条形按页级覆盖率着色：绿≥90% / 黄≥70% / 红&lt;70%）
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <EChart option={sourceChart} height={Math.max(MIN_CHART_HEIGHT, sources.length * ROW_HEIGHT + 40)} />
          <SourceTable rows={sources} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              KOS Kind 分布（frontmatter.kind，九分类）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EChart
              option={kindChart}
              height={Math.max(MIN_CHART_HEIGHT, kinds.kos_kinds.length * ROW_HEIGHT + 40)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pages Type 分布（上游口径，与 kind 是两套口径，不混用）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EChart
              option={typeChart}
              height={Math.max(MIN_CHART_HEIGHT, kinds.page_types.length * ROW_HEIGHT + 40)}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Top Tags（Top 20）</CardTitle>
        </CardHeader>
        <CardContent>
          <EChart option={tagChart} height={Math.max(MIN_CHART_HEIGHT, kinds.top_tags.length * ROW_HEIGHT + 40)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">链接最多的页面（Top 10）</CardTitle>
        </CardHeader>
        <CardContent>
          <MostConnectedTable rows={kinds.most_connected} />
        </CardContent>
      </Card>
    </div>
  );
}
