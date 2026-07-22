// Chinese display labels for the 9 KOS-Jarvis page kinds (frontmatter.kind,
// see project CLAUDE.md "9 KOS page kinds coexist with GBrain's 20-dir
// MECE") plus the backend's 'unknown' bucket for NULL/legacy values. This is
// a closed enum, unlike upstream pages.type, so translating it is safe.
export const KIND_LABELS: Record<string, string> = {
  source: '来源 (source)',
  entity: '实体 (entity)',
  concept: '概念 (concept)',
  project: '项目 (project)',
  decision: '决策 (decision)',
  synthesis: '综合 (synthesis)',
  comparison: '对比 (comparison)',
  protocol: '协议 (protocol)',
  timeline: '时间线 (timeline)',
  unknown: '未知 (unknown)',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

// Semantic colors — must match the CSS variables in styles.css (design.md
// §1 token table: sky/emerald/amber/red 400). ECharts can't read CSS custom
// properties directly, so these are the same hex values duplicated for
// chart use only; app chrome should use the Tailwind/shadcn tokens instead.
export const COLOR_PRIMARY = '#38bdf8'; // sky-400
export const COLOR_SUCCESS = '#34d399'; // emerald-400
export const COLOR_WARNING = '#fbbf24'; // amber-400
export const COLOR_DANGER = '#f87171'; // red-400

// Stacked-series palette for multi-source trend charts (design.md §1).
export const CHART_SERIES_COLORS = [
  '#38bdf8', // sky-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#a78bfa', // violet-400
  '#fb7185', // rose-400
];

/** Coverage -> semantic health color, per the 0.9 / 0.7 thresholds used
 * throughout the dashboard for coverage badges and bars. */
export function coverageColor(coverage: number): string {
  if (coverage >= 0.9) return COLOR_SUCCESS;
  if (coverage >= 0.7) return COLOR_WARNING;
  return COLOR_DANGER;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
