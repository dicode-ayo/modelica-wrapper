/**
 * Pure `(traces, theme) → ECharts option`. Kept separate from the Lit component
 * so it's unit-testable without a DOM or a real ECharts instance — the component
 * just hands the result to `chart.setOption`.
 */

import type { EChartsOption } from "echarts";

import type { EchartTheme } from "./echart-theme.js";
import type { TracePayload } from "./types.js";

export function buildLineChartOption(
  traces: readonly TracePayload[],
  theme: EchartTheme,
): EChartsOption {
  return {
    color: theme.palette,
    backgroundColor: "transparent",
    grid: { left: 8, right: 16, top: 36, bottom: 56, containLabel: true },
    legend: {
      type: "scroll",
      top: 4,
      textStyle: { color: theme.text },
      pageTextStyle: { color: theme.text },
    },
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
    xAxis: {
      type: "value",
      name: "time",
      nameTextStyle: { color: theme.text },
      axisLine: { lineStyle: { color: theme.axisLine } },
      axisLabel: { color: theme.text },
      splitLine: { lineStyle: { color: theme.splitLine } },
    },
    yAxis: {
      type: "value",
      axisLine: { lineStyle: { color: theme.axisLine } },
      axisLabel: { color: theme.text },
      splitLine: { lineStyle: { color: theme.splitLine } },
    },
    dataZoom: [
      { type: "inside" },
      { type: "slider", bottom: 16, height: 18 },
    ],
    series: traces.map((tr) => ({
      name: tr.name,
      type: "line" as const,
      showSymbol: false,
      // ECharts plots each series from its own [x, y] pairs, so overlaid
      // results with different time grids line up correctly on a shared axis.
      data: tr.t.map((x, i) => [x, tr.values[i] ?? null]),
    })),
  };
}
