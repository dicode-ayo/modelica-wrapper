import { describe, expect, it } from "vitest";

import { buildLineChartOption } from "./chart-option.js";
import type { EchartTheme } from "./echart-theme.js";

const theme: EchartTheme = {
  text: "#fff",
  axisLine: "#444",
  splitLine: "#444",
  palette: ["#aaa", "#bbb"],
};

type Series = Array<{ name: string; type: string; data: Array<[number, number | null]> }>;

describe("buildLineChartOption", () => {
  it("maps each trace to a line series of [x, y] pairs", () => {
    const opt = buildLineChartOption(
      [{ t: [0, 1, 2], values: [10, 20, 30], name: "a / x" }],
      theme,
    );
    const series = opt.series as Series;
    expect(series).toHaveLength(1);
    expect(series[0]!.name).toBe("a / x");
    expect(series[0]!.type).toBe("line");
    expect(series[0]!.data).toEqual([
      [0, 10],
      [1, 20],
      [2, 30],
    ]);
  });

  it("applies the theme palette and yields no series for no traces", () => {
    const opt = buildLineChartOption([], theme);
    expect(opt.color).toEqual(["#aaa", "#bbb"]);
    expect(opt.series as Series).toHaveLength(0);
  });

  it("pads a missing y value with null so x/y stay aligned", () => {
    const opt = buildLineChartOption([{ t: [0, 1], values: [5], name: "x" }], theme);
    expect((opt.series as Series)[0]!.data).toEqual([
      [0, 5],
      [1, null],
    ]);
  });
});
