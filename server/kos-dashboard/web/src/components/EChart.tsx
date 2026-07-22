import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ComposeOption } from 'echarts/core';
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import type { GridComponentOption, LegendComponentOption, TooltipComponentOption } from 'echarts/components';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export type ChartOption = ComposeOption<
  BarSeriesOption | LineSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption
>;

interface EChartProps {
  option: ChartOption;
  height?: number;
}

/** Minimal ECharts/React binding — only the pieces this dashboard needs
 * (bar + line/area charts) are registered above, kept tree-shaken instead of
 * pulling in echarts-for-react as an extra dependency.
 *
 * `animationDurationUpdate: 0` is forced on every `setOption` call here
 * (design.md §3): refreshing or switching the source filter is a
 * high-frequency action and must never replay the chart's entrance
 * animation. The one-time initial reveal (`animationDuration`) is left to
 * each chart-options builder to set (default 300ms, per the same spec). */
export function EChart({ option, height = 320 }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(el);
    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption({ ...option, animationDurationUpdate: 0 }, true);
  }, [option]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
