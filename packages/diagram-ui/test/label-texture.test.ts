import { describe, expect, it } from "vitest";

import { resolveRenderScale } from "../src/label/label-texture.js";

describe("resolveRenderScale: targets the device pixel grid once", () => {
  it("collapses to 1 when adaptToDeviceRatio already applied DPR", () => {
    // adaptToDeviceRatio: true → hardwareScalingLevel = 1/DPR.
    expect(resolveRenderScale(2, 0.5)).toBe(1);
    expect(resolveRenderScale(3, 1 / 3)).toBeCloseTo(1);
  });

  it("equals DPR when hardware scaling is neutral", () => {
    expect(resolveRenderScale(2, 1)).toBe(2);
    expect(resolveRenderScale(1, 1)).toBe(1);
  });

  it("falls back to 1 for a missing devicePixelRatio", () => {
    expect(resolveRenderScale(undefined, 1)).toBe(1);
  });

  it("falls back to 1 for non-finite or non-positive readings", () => {
    expect(resolveRenderScale(NaN, 1)).toBe(1);
    expect(resolveRenderScale(Infinity, 1)).toBe(1);
    expect(resolveRenderScale(0, 1)).toBe(1);
    expect(resolveRenderScale(-2, 1)).toBe(1);
  });

  it("falls back to 1 for an invalid hardware scaling level", () => {
    expect(resolveRenderScale(2, 0)).toBe(1);
    expect(resolveRenderScale(2, NaN)).toBe(1);
    expect(resolveRenderScale(2, -1)).toBe(1);
  });
});
