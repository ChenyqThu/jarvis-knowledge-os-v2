import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type TabId = 'overview' | 'distribution' | 'trends' | 'health' | 'editor' | 'ops';

export const TAB_IDS: readonly TabId[] = [
  'overview',
  'distribution',
  'trends',
  'health',
  'editor',
  'ops',
];

const TAB_LABELS: Record<TabId, string> = {
  overview: '概览',
  distribution: '分布',
  trends: '趋势',
  health: '健康',
  editor: '编辑',
  ops: '操作',
};

interface PageTabsProps {
  active: TabId;
  onChange: (id: TabId) => void;
}

/** Page-level nav tabs (概览/分布/趋势/健康). Tab switching is a high-frequency
 * action, so the underlying shadcn Tabs primitive has had its transitions
 * stripped (design.md §3) — this only drives which page component App
 * renders, it has no TabsContent panels of its own. */
export function PageTabs({ active, onChange }: PageTabsProps) {
  return (
    <Tabs value={active} onValueChange={value => onChange(value as TabId)}>
      <TabsList variant="line">
        {TAB_IDS.map(id => (
          <TabsTrigger key={id} value={id}>
            {TAB_LABELS[id]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
