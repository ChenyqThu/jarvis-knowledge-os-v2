import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<Tone, string> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

interface MetricCardProps {
  label: string;
  value: number;
  /** Semantic color for the value — e.g. chunkless_total uses danger/success
   * depending on whether it's >0 (design.md §5). */
  tone?: Tone;
  sublabel?: string;
}

export function MetricCard({ label, value, tone = 'default', sublabel }: MetricCardProps) {
  return (
    <Card>
      <CardHeader>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardHeader>
      <CardContent>
        <p className={cn('text-3xl font-semibold tabular-nums', TONE_CLASSES[tone])}>
          {value.toLocaleString('zh-CN')}
        </p>
        {sublabel && <p className="mt-1 text-sm text-muted-foreground">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}
