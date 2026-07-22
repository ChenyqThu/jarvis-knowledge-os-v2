import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { SourceRow } from '../types';
import { formatPercent } from '../constants';
import { formatTimestampPT } from '../lib/time';

function coverageBadgeClass(coverage: number): string {
  if (coverage >= 0.9) return 'border-success/40 text-success';
  if (coverage >= 0.7) return 'border-warning/40 text-warning';
  return 'border-danger/40 text-danger';
}

export function SourceTable({ rows }: { rows: SourceRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">页数</TableHead>
          <TableHead className="text-right">Chunks</TableHead>
          <TableHead className="text-right">Chunk 覆盖率</TableHead>
          <TableHead className="text-right">页级覆盖率</TableHead>
          <TableHead className="text-right">最新内容时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => (
          <TableRow key={r.source_id}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-right tabular-nums">{r.pages.toLocaleString('zh-CN')}</TableCell>
            <TableCell className="text-right tabular-nums">{r.chunks.toLocaleString('zh-CN')}</TableCell>
            <TableCell className="text-right">
              <Badge variant="outline" className={coverageBadgeClass(r.chunk_coverage)}>
                {formatPercent(r.chunk_coverage)}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <Badge variant="outline" className={coverageBadgeClass(r.page_coverage)}>
                {formatPercent(r.page_coverage)}
              </Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {formatTimestampPT(r.newest_content_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
