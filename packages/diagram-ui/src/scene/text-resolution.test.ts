import { describe, expect, it } from "vitest";

import { targetTextureEdge, worldPerPixel } from "./text-resolution.js";

const BOUNDS = { minEdge: 32, maxEdge: 2048 };

describe("worldPerPixel", () => {
  it("is the ortho width divided by the render width", () => {
    expect(worldPerPixel(-100, 100, 400)).toBeCloseTo(0.5);
  });

  it("shrinks as the visible extent shrinks (zoom in)", () => {
    const wide = worldPerPixel(-100, 100, 400);
    const tight = worldPerPixel(-25, 25, 400);
    expect(tight).toBeLessThan(wide);
  });

  it("returns Infinity for a zero render width", () => {
    expect(worldPerPixel(-100, 100, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("targetTextureEdge", () => {
  it("matches the on-screen device-pixel span at 1 texel/pixel", () => {
    // 40 icon units, scale 1, 0.5 world/pixel → 80 screen px → 80 texels.
    expect(targetTextureEdge(40, 1, 0.5, BOUNDS)).toBe(80);
  });

  it("scales the edge by the parent world scale", () => {
    const unscaled = targetTextureEdge(40, 1, 0.5, BOUNDS);
    const doubled = targetTextureEdge(40, 2, 0.5, BOUNDS);
    expect(doubled).toBe(2 * unscaled);
  });

  it("rounds up so texel count never dips below the pixel count", () => {
    // 33 px would round down to 33 anyway; use a fractional span.
    expect(targetTextureEdge(40.5, 1, 0.5, BOUNDS)).toBe(81);
    expect(targetTextureEdge(50.4, 1, 1, BOUNDS)).toBe(51);
  });

  it("clamps to minEdge for tiny labels", () => {
    expect(targetTextureEdge(2, 1, 0.5, BOUNDS)).toBe(BOUNDS.minEdge);
  });

  it("clamps to maxEdge to cap runaway allocation on deep zoom", () => {
    expect(targetTextureEdge(40, 1, 0.0001, BOUNDS)).toBe(BOUNDS.maxEdge);
  });

  it("rises monotonically as zoom increases (worldPerPixel shrinks)", () => {
    const zoomLevels = [4, 2, 1, 0.5, 0.25, 0.05];
    const edges = zoomLevels.map((wpp) =>
      targetTextureEdge(200, 1, wpp, BOUNDS),
    );
    for (let i = 1; i < edges.length; i++) {
      const prev = edges[i - 1];
      const curr = edges[i];
      if (prev === undefined || curr === undefined) {
        continue;
      }
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
    // 200 / 0.05 = 4000, past the cap.
    expect(edges.at(-1)).toBe(BOUNDS.maxEdge);
  });

  it("falls back to minEdge when worldPerPixel is non-finite", () => {
    expect(targetTextureEdge(40, 1, Number.POSITIVE_INFINITY, BOUNDS)).toBe(
      BOUNDS.minEdge,
    );
    expect(targetTextureEdge(40, 1, 0, BOUNDS)).toBe(BOUNDS.minEdge);
  });
});
