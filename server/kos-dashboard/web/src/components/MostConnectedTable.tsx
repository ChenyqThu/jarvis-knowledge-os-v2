import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ConnectedPage } from '../types';

export function MostConnectedTable({ rows }: { rows: ConnectedPage[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>标题</TableHead>
          <TableHead>Slug</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">链接数</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => (
          <TableRow key={`${r.source_id}:${r.slug}`}>
            <TableCell className="font-medium">{r.title}</TableCell>
            <TableCell className="text-muted-foreground">{r.slug}</TableCell>
            <TableCell className="text-muted-foreground">{r.source_id}</TableCell>
            <TableCell className="text-right tabular-nums">{r.links.toLocaleString('zh-CN')}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
