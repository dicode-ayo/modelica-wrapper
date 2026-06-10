import { describe, expect, it } from "vitest";

import {
  clampCornerRadius,
  roundedRectRing,
} from "../src/primitives/shape-utils.js";

describe("clampCornerRadius", () => {
  it("returns the radius untouched when it fits within half the shorter side", () => {
    expect(clampCornerRadius(10, 100, 50)).toBe(10);
  });

  it("clamps to half the shorter side so opposite corners never overlap", () => {
    // 100×50 box → half the shorter side is 25.
    expect(clampCornerRadius(40, 100, 50)).toBe(25);
    expect(clampCornerRadius(1000, 80, 80)).toBe(40);
  });

  it("yields 0 for a missing, zero, or negative radius", () => {
    expect(clampCornerRadius(undefined, 100, 50)).toBe(0);
    expect(clampCornerRadius(0, 100, 50)).toBe(0);
    expect(clampCornerRadius(-5, 100, 50)).toBe(0);
  });
});

describe("roundedRectRing", () => {
  it("returns the four sharp corners (closed) when radius is 0", () => {
    expect(roundedRectRing(0, 0, 100, 50, 0)).toEqual([
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
      [0, 0],
    ]);
  });

  it("keeps every vertex inside the box and on the inset arc centres", () => {
    const r = 10;
    const ring = roundedRectRing(0, 0, 100, 50, r);
    for (const [px, py] of ring) {
      expect(px).toBeGreaterThanOrEqual(-1e-9);
      expect(px).toBeLessThanOrEqual(100 + 1e-9);
      expect(py).toBeGreaterThanOrEqual(-1e-9);
      expect(py).toBeLessThanOrEqual(50 + 1e-9);
    }
    // Each corner vertex sits exactly `r` from its inset arc centre.
    const centres: ReadonlyArray<readonly [number, number]> = [
      [100 - r, r],
      [100 - r, 50 - r],
      [r, 50 - r],
      [r, r],
    ];
    for (const [px, py] of ring) {
      const onSomeArc = centres.some(([cx, cy]) => {
        const d = Math.hypot(px - cx, py - cy);
        return Math.abs(d - r) < 1e-9;
      });
      expect(onSomeArc).toBe(true);
    }
  });

  it("closes the ring (first vertex repeated as last)", () => {
    const ring = roundedRectRing(0, 0, 100, 50, 10);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});
