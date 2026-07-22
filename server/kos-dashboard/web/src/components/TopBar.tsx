import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SourceTabs } from './SourceTabs';
import { PageTabs, type TabId } from './PageTabs';
import { formatTimestampPT } from '../lib/time';

interface TopBarProps {
  lastUpdated: Date | null;
  onRefresh: () => void;
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
}

/** Sticky top bar (design.md §2): title + brain badge (Tooltip explains the
 * brain/source two-axis model) + source filter tabs + refresh on row 1, page
 * nav tabs on row 2. Page tabs are the primary nav (underline style); source
 * tabs are a filter (pill/segmented) — kept visually distinct per spec. */
export function TopBar({ lastUpdated, onRefresh, activeTab, onTabChange }: TopBarProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background">
      <div className="flex items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">KOS 知识库看板</h1>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline">brain: host</Badge>
            </TooltipTrigger>
            <TooltipContent>
              两轴组织：brain=哪个库（本部署仅 host，无挂载脑）；source=库内哪个仓。
              切换下方 source tabs 过滤所有视图。
            </TooltipContent>
          </Tooltip>
        </div>
        <SourceTabs />
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-muted-foreground">
            {lastUpdated ? `最后刷新 ${formatTimestampPT(lastUpdated.toISOString())}` : '尚未加载'}
          </span>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            刷新
          </Button>
        </div>
      </div>
      <div className="px-6 pb-2">
        <PageTabs active={activeTab} onChange={onTabChange} />
      </div>
    </header>
  );
}
