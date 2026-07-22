import type { ChartOption } from './components/EChart';
import { COLOR_PRIMARY } from './constants';

// zinc-400 / zinc-800 (design.md §1: "轴线/分割线 zinc-800，文字 zinc-400").
const AXIS_TEXT_COLOR = '#a1a1aa';
const GRID_LINE_COLOR = '#27272a';

/** Horizontal bar chart: dark/transparent background, muted grid, single
 * restrained color series (blue by default) — per the dashboard's chart
 * style rules (no 3D, no gradients, no shadows). `colors[i]`, if provided,
 * overrides the bar color per-category (used for coverage-health charts). */
export function horizontalBarOption(categories: string[], values: number[], colors?: string[]): ChartOption {
  return {
    backgroundColor: 'transparent',
    animationDuration: 300,
    grid: { left: 160, right: 32, top: 8, bottom: 24, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: GRID_LINE_COLOR } },
      axisLabel: { color: AXIS_TEXT_COLOR },
      splitLine: { lineStyle: { color: GRID_LINE_COLOR } },
    },
    yAxis: {
      type: 'category',
      data: categories,
      inverse: true,
      axisLine: { lineStyle: { color: GRID_LINE_COLOR } },
      axisTick: { show: false },
      axisLabel: { color: AXIS_TEXT_COLOR },
    },
    series: [
      {
        type: 'bar',
        data: values.map((value, i) => ({
          value,
          itemStyle: { color: colors?.[i] ?? COLOR_PRIMARY },
        })),
        barMaxWidth: 18,
      },
    ],
  };
}

export interface LineSeriesSpec {
  name: string;
  data: number[];
  color: string;
  /** Renders a translucent area fill under the line (design.md §5: source
   * stacking on the trends page). */
  area?: boolean;
  /** ECharts stack group id — series sharing one id stack on top of each
   * other (used for the "全部" per-source stacked view). */
  stack?: string;
}

/** Line/stacked-area chart for the trends page — pages/chunks growth,
 * embedding coverage, chunkless sentinel. `categories` are axis labels
 * already formatted by `bucketToAxisLabel` (opaque `MM-DD` strings, no
 * Date parsing — design.md §5 item 0). */
export function lineChartOption(
  categories: string[],
  series: LineSeriesSpec[],
  opts?: { yAxisFormatter?: (value: number) => string },
): ChartOption {
  const showLegend = series.length > 1;
  return {
    backgroundColor: 'transparent',
    animationDuration: 300,
    grid: { left: 48, right: 24, top: showLegend ? 32 : 16, bottom: 32, containLabel: true },
    legend: showLegend
      ? { top: 0, textStyle: { color: AXIS_TEXT_COLOR }, itemWidth: 12, itemHeight: 8 }
      : undefined,
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: false,
      axisLine: { lineStyle: { color: GRID_LINE_COLOR } },
      axisLabel: { color: AXIS_TEXT_COLOR },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: AXIS_TEXT_COLOR, formatter: opts?.yAxisFormatter },
      splitLine: { lineStyle: { color: GRID_LINE_COLOR } },
    },
    series: series.map(s => ({
      type: 'line',
      name: s.name,
      data: s.data,
      color: s.color,
      showSymbol: false,
      smooth: false,
      stack: s.stack,
      areaStyle: s.area ? { opacity: 0.22 } : undefined,
      lineStyle: { width: 2 },
    })),
  };
}
