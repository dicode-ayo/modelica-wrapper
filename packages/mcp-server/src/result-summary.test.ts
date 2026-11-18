import { describe, expect, it } from "vitest";

import {
  decimatedIndices,
  resultMatrix,
  summarizeResult,
} from "./result-summary.js";

describe("summarizeResult", () => {
  it("reports each variable's endpoints, extremes and the first time it hits each", () => {
    const summary = summarizeResult(
      [0, 0.5, 1, 1.5, 2],
      [{ name: "x", values: [1, -3, 4, -3, 4] }],
    );

    expect(summary).toEqual({
      time: { start: 0, stop: 2, rows: 5 },
      variables: {
        x: { initial: 1, final: 4, min: -3, max: 4, minAt: 0.5, maxAt: 1 },
      },
    });
  });

  it("omits the series unless points were asked for", () => {
    const summary = summarizeResult([0, 1], [{ name: "x", values: [0, 1] }]);

    expect(summary).not.toHaveProperty("series");
  });

  it("rounds values to 6 significant digits but leaves times exact", () => {
    // At 6 digits these timestamps collapse into one another.
    const time = [1000.0000001, 1000.0000002, 1000.0000003];
    const summary = summarizeResult(
      time,
      [{ name: "i", values: [0.1 + 0.2, 1.23456789e-9, 7.0000000001] }],
      3,
    );

    expect(summary.time).toEqual({ start: time[0], stop: time[2], rows: 3 });
    expect(summary.variables["i"]).toEqual({
      initial: 0.3,
      final: 7,
      min: 1.23457e-9,
      max: 7,
      minAt: time[1],
      maxAt: time[2],
    });
    expect(summary.series).toEqual({ time, i: [0.3, 1.23457e-9, 7] });
  });

  it("places an extreme by the unrounded value, not a rounding tie", () => {
    const summary = summarizeResult(
      [0, 1, 9],
      [{ name: "x", values: [0, 0.9999999, 0.99999999] }],
    );

    expect(summary.variables["x"]).toMatchObject({ max: 1, maxAt: 9 });
  });

  it("ranges min and max over finite values and counts the rest", () => {
    const summary = summarizeResult(
      [0, 1, 2, 3],
      [
        { name: "x", values: [NaN, 2, Infinity, -1] },
        { name: "y", values: [1, 2] },
      ],
      4,
    );

    expect(summary.variables["x"]).toEqual({
      initial: null,
      final: -1,
      min: -1,
      max: 2,
      minAt: 3,
      maxAt: 1,
      nonFinite: 2,
    });
    expect(summary.variables["y"]).not.toHaveProperty("nonFinite");
    expect(summary.series?.["x"]).toEqual([null, 2, null, -1]);
  });

  it("answers null extremes when no value is finite", () => {
    const summary = summarizeResult(
      [0, 1],
      [{ name: "x", values: [NaN, NaN] }],
    );

    expect(summary.variables["x"]).toEqual({
      initial: null,
      final: null,
      min: null,
      max: null,
      minAt: null,
      maxAt: null,
      nonFinite: 2,
    });
  });

  it("answers nulls rather than NaN or a throw for a result with no rows", () => {
    const summary = summarizeResult([], [{ name: "x", values: [] }], 10);

    expect(summary).toEqual({
      time: { start: null, stop: null, rows: 0 },
      variables: {
        x: {
          initial: null,
          final: null,
          min: null,
          max: null,
          minAt: null,
          maxAt: null,
        },
      },
      series: { time: [], x: [] },
    });
    expect(JSON.stringify(summary)).not.toContain("NaN");
  });

  it("thins every series at the same rows as time", () => {
    const time = Array.from({ length: 101 }, (_, i) => i / 100);
    const summary = summarizeResult(
      time,
      [{ name: "y", values: time.map((t) => 2 * t) }],
      5,
    );

    expect(summary.series).toEqual({
      time: [0, 0.25, 0.5, 0.75, 1],
      y: [0, 0.5, 1, 1.5, 2],
    });
  });
});

describe("decimatedIndices", () => {
  it("has exactly `points` entries, first and last row included, strictly increasing", () => {
    for (const [rows, points] of [
      [1004, 50],
      [1004, 2],
      [11, 10],
      [1001, 1000],
    ] as const) {
      const indices = decimatedIndices(rows, points);

      expect(indices).toHaveLength(points);
      expect(indices.at(0)).toBe(0);
      expect(indices.at(-1)).toBe(rows - 1);
      expect(
        indices.every((v, i) => i === 0 || v > (indices[i - 1] ?? v)),
      ).toBe(true);
    }
  });

  it("is every row when there are no more rows than points", () => {
    expect(decimatedIndices(3, 10)).toEqual([0, 1, 2]);
    expect(decimatedIndices(10, 10)).toEqual([...Array(10).keys()]);
    expect(decimatedIndices(0, 10)).toEqual([]);
  });
});

describe("resultMatrix", () => {
  it("splits one equal-length row of numbers per variable into time and the rest", () => {
    expect(
      resultMatrix(
        {
          result: [
            [0, 1],
            [2, 3],
          ],
        },
        2,
      ),
    ).toEqual({ time: [0, 1], rows: [[2, 3]] });
  });

  it.each([
    ["no result field", { ok: true }],
    ["a scalar", 42],
    ["null", null],
    ["too few rows", { result: [[0, 1]] }],
    ["no rows", { result: [] }],
    [
      "a non-numeric value",
      {
        result: [
          [0, 1],
          [2, "x"],
        ],
      },
    ],
    ["ragged rows", { result: [[0, 1], [2]] }],
  ])("refuses %s", (_label, output) => {
    expect(resultMatrix(output, 2)).toBeUndefined();
  });
});
