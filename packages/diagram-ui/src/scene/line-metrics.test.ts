import { describe, expect, it } from "vitest";

import {
  DEFAULT_LINE_THICKNESS_SCALE,
  SPEC_DEFAULT_THICKNESS,
  polylineLength,
  screenDashCount,
  strokeWorldWidth,
  worldPerPixel,
} from "./line-metrics.js";

describe("worldPerPixel", () => {
  it("divides the ortho extent by the canvas width", () => {
    expect(worldPerPixel(-100, 100, 400)).toBeCloseTo(0.5);
  });

  it("halves when zooming in halves the extent", () => {
    const out = worldPerPixel(-50, 50, 400);
    const inn = worldPerPixel(-25, 25, 400);
    expect(inn).toBeCloseTo(out / 2);
  });

  it("collapses a degenerate extent or canvas to 1", () => {
    expect(worldPerPixel(10, 10, 400)).toBe(1);
    expect(worldPerPixel(-100, 100, 0)).toBe(1);
  });
});

describe("polylineLength", () => {
  it("sums segment lengths", () => {
    expect(
      polylineLength([
        [0, 0],
        [3, 4],
        [3, 9],
      ]),
    ).toBeCloseTo(10);
  });

  it("is zero for fewer than two points", () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([[1, 1]])).toBe(0);
  });
});

describe("screenDashCount", () => {
  it("yields a constant on-screen period independent of zoom", () => {
    // Same world line at two zooms: dash count scales so one period
    // stays at `periodPx` pixels.
    const worldLength = 100;
    const periodPx = 10;
    const zoomedOut = screenDashCount(worldLength, 1, periodPx); // 100px → 10
    const zoomedIn = screenDashCount(worldLength, 0.5, periodPx); // 200px → 20
    expect(zoomedOut).toBe(10);
    expect(zoomedIn).toBe(20);
  });

  it("never collapses below a single dash", () => {
    expect(screenDashCount(1, 1000, 10)).toBe(1);
    expect(screenDashCount(0, 1, 10)).toBe(1);
  });
});

describe("strokeWorldWidth", () => {
  it("multiplies explicit thickness by the scale", () => {
    expect(strokeWorldWidth(2, 10)).toBeCloseTo(20);
  });

  it("falls back to the spec default thickness when omitted", () => {
    expect(strokeWorldWidth(undefined, 1)).toBeCloseTo(SPEC_DEFAULT_THICKNESS);
  });

  it("falls back to the default scale when omitted or non-positive", () => {
    const expected = SPEC_DEFAULT_THICKNESS * DEFAULT_LINE_THICKNESS_SCALE;
    expect(strokeWorldWidth(undefined, undefined)).toBeCloseTo(expected);
    expect(strokeWorldWidth(undefined, 0)).toBeCloseTo(expected);
    expect(strokeWorldWidth(undefined, -5)).toBeCloseTo(expected);
  });
});
