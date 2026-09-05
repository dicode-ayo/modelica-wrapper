import { describe, expect, it } from "vitest";

import {
  MAX_TEXT_RESOLUTION,
  MIN_TEXT_RESOLUTION,
  fitFontSize,
  quantizeTextResolution,
} from "../src/primitives/text-sizing.js";

describe("fitFontSize", () => {
  it("fits the height when the string is short", () => {
    // Measured 50×110 at trial 100: width allows ×2, height allows
    // 20/110 — the height constrains.
    expect(fitFontSize(100, 20, 50, 110, 100)).toBeCloseTo(100 * (20 / 110));
  });

  it("fits the width when the string is long — it shrinks instead of overflowing", () => {
    // A long %name: measured 1000×110 at trial 100. A height-only fit
    // would keep ~18 units and overflow the 100-unit box; the width fit
    // shrinks to 10.
    const fitted = fitFontSize(100, 20, 1000, 110, 100);
    expect(fitted).toBeCloseTo(10);
    const heightOnly = 100 * (20 / 110);
    expect(fitted).toBeLessThan(heightOnly);
  });

  it("uses one uniform scale — the smaller of the two ratios — never a per-axis stretch", () => {
    const fitted = fitFontSize(300, 40, 600, 100, 100);
    expect(fitted).toBeCloseTo(100 * Math.min(300 / 600, 40 / 100));
  });

  it("scales linearly with the trial size", () => {
    const a = fitFontSize(100, 20, 500, 110, 100);
    const b = fitFontSize(100, 20, 250, 55, 50);
    if (a === null || b === null) throw new Error("expected fits");
    expect(a).toBeCloseTo(b);
  });

  it("returns null for degenerate inputs", () => {
    expect(fitFontSize(0, 20, 50, 110)).toBeNull();
    expect(fitFontSize(100, -1, 50, 110)).toBeNull();
    expect(fitFontSize(100, 20, 0, 110)).toBeNull();
    expect(fitFontSize(100, 20, 50, Number.NaN)).toBeNull();
    expect(fitFontSize(100, 20, 50, 110, 0)).toBeNull();
  });
});

describe("quantizeTextResolution", () => {
  it("rounds magnification up to whole densities, capped at the ceiling", () => {
    expect(quantizeTextResolution(1)).toBe(1);
    expect(quantizeTextResolution(2.3)).toBe(3);
    expect(quantizeTextResolution(100)).toBe(MAX_TEXT_RESOLUTION);
  });

  it("lowers the resolution under minification (power-of-two steps)", () => {
    // A resolution floored at 1 would make a heavily minified label
    // sample a full-size atlas with no mip chain.
    expect(quantizeTextResolution(0.6)).toBe(1);
    expect(quantizeTextResolution(0.5)).toBe(0.5);
    expect(quantizeTextResolution(0.3)).toBe(0.5);
    expect(quantizeTextResolution(0.09)).toBe(0.125);
  });

  it("floors deep minification at MIN_TEXT_RESOLUTION", () => {
    expect(quantizeTextResolution(0.0001)).toBe(MIN_TEXT_RESOLUTION);
  });

  it("never targets below the on-screen density (always rounds up)", () => {
    for (const d of [0.07, 0.3, 0.9, 1.2, 4.5]) {
      expect(quantizeTextResolution(d)).toBeGreaterThanOrEqual(
        Math.min(d, MAX_TEXT_RESOLUTION),
      );
    }
  });

  it("yields the neutral 1 for a degenerate density", () => {
    expect(quantizeTextResolution(0)).toBe(1);
    expect(quantizeTextResolution(Number.NaN)).toBe(1);
    expect(quantizeTextResolution(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
