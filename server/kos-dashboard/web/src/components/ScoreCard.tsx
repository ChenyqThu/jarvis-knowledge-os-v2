import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BrainScoreComponents } from '../types';

const COMPONENTS: { key: keyof BrainScoreComponents; label: string; max: number }[] = [
  { key: 'embed_coverage', label: 'Embedding 覆盖率', max: 35 },
  { key: 'link_density', label: '链接密度', max: 25 },
  { key: 'timeline_coverage', label: '时间线覆盖率', max: 15 },
  { key: 'no_orphans', label: '无孤儿', max: 15 },
  { key: 'no_dead_links', label: '无死链', max: 10 },
];

function tierFor(total: number): { label: string; className: string } {
  if (total >= 90) return { label: '优秀', className: 'border-success/40 text-success' };
  if (total >= 70) return { label: '良好', className: 'border-warning/40 text-warning' };
  return { label: '待改进', className: 'border-danger/40 text-danger' };
}

function barColorClass(ratio: number): string {
  if (ratio >= 0.9) return 'bg-success';
  if (ratio >= 0.7) return 'bg-warning';
  return 'bg-danger';
}

interface ScoreCardProps {
  score: {
    total: number;
    components: BrainScoreComponents;
  };
}

/** Self-drawn segment bars (design.md §4: "Card + 自绘分项条，语义色 + Badge
 * 分档"). Bar widths are set once on data load, never transitioned
 * (design.md §3 global motion rule: only transform/opacity animate, never
 * width/height/margin). */
export function ScoreCard({ score }: ScoreCardProps) {
  const tier = tierFor(score.total);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Brain Score
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums">{score.total}</span>
          <span className="text-lg text-muted-foreground tabular-nums">/100</span>
          <Badge variant="outline" className={cn('ml-2', tier.className)}>
            {tier.label}
          </Badge>
        </div>
        <div className="flex flex-col gap-3">
          {COMPONENTS.map(c => {
            const value = score.components[c.key];
            const ratio = value / c.max;
            const pct = Math.max(0, Math.min(100, ratio * 100));
            return (
              <div key={c.key} className="grid grid-cols-[140px_1fr_60px] items-center gap-3">
                <span className="text-sm text-muted-foreground">{c.label}</span>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full', barColorClass(ratio))} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-right text-sm tabular-nums text-muted-foreground">
                  {value}/{c.max}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
