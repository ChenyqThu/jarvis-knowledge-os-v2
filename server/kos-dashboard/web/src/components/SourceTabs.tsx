import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ALL_SOURCES } from '../api';
import { useDashboard } from '../dashboard-context';

/** Global source filter (design.md §2): "全部" + the 4 real sources, driving
 * `?source=` on every page's requests via DashboardContext. A source change
 * does not re-render this component's own animation (design.md §3, tabs are
 * high-frequency) — it only flips context state, which pages pick up via
 * their effect dependency arrays. */
export function SourceTabs() {
  const { source, setSource, sourceIds } = useDashboard();
  return (
    <Tabs value={source} onValueChange={setSource}>
      <TabsList>
        <TabsTrigger value={ALL_SOURCES}>全部</TabsTrigger>
        {sourceIds.map(id => (
          <TabsTrigger key={id} value={id}>
            {id}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
