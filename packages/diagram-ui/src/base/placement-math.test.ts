import { describe, expect, it } from "vitest";
import type { Placement } from "@dicode/omc-client";

import { applyPlacement, coordSystemSize } from "./placement-math.js";

describe("coordSystemSize", () => {
  it("defaults to [-100, 100]² when extent is missing", () => {
    expect(coordSystemSize(undefined)).toEqual({
      width: 200,
      height: 200,
      cx: 0,
      cy: 0,
    });
  });

  it("respects an explicit coordinate system extent", () => {
    const cs = {
      extent: [
        [0, 0],
        [40, 30],
      ],
    };
    expect(coordSystemSize(cs)).toEqual({
      width: 40,
      height: 30,
      cx: 20,
      cy: 15,
    });
  });
});

describe("applyPlacement", () => {
  it("centres the TransformNode on the placement extent", () => {
    const p: Placement = {
      extent: [
        [-10, -5],
        [10, 5],
      ],
    };
    const t = applyPlacement(p, undefined);
    expect(t.position.x).toBe(0);
    expect(t.position.y).toBe(0);
    expect(t.position.z).toBe(0);
  });

  it("offsets by placement.origin when present", () => {
    const p: Placement = {
      extent: [
        [-10, -5],
        [10, 5],
      ],
      origin: [30, 20],
    };
    const t = applyPlacement(p, undefined);
    expect(t.position.x).toBe(30);
    expect(t.position.y).toBe(20);
  });

  it("converts placement rotation from degrees CCW to radians around Z", () => {
    const p: Placement = {
      extent: [
        [0, 0],
        [10, 10],
      ],
      rotation: 90,
    };
    const t = applyPlacement(p, undefined);
    expect(t.rotationZ).toBeCloseTo(Math.PI / 2);
  });

  it("derives scaling from placementSize / coordSystemSize", () => {
    const p: Placement = {
      extent: [
        [-20, -10],
        [20, 10],
      ],
    };
    const t = applyPlacement(p, {
      extent: [
        [-100, -100],
        [100, 100],
      ],
    });
    // 40 wide / 200 = 0.2; 20 tall / 200 = 0.1
    expect(t.scale.x).toBeCloseTo(0.2);
    expect(t.scale.y).toBeCloseTo(0.1);
  });

  it("places the mesh at the icon coord-system centre (local space)", () => {
    const p: Placement = {
      extent: [
        [-10, -10],
        [10, 10],
      ],
    };
    const t = applyPlacement(p, {
      extent: [
        [0, 0],
        [200, 200],
      ],
    });
    expect(t.meshLocal.x).toBe(100);
    expect(t.meshLocal.y).toBe(100);
  });
});

describe("applyPlacement: mirrored extents (flip)", () => {
  it("produces negative scaleX when x2 < x1 (horizontal flip)", () => {
    const p: Placement = {
      extent: [
        [10, -10],
        [-10, 10],
      ],
    };
    const t = applyPlacement(p, undefined);
    expect(t.scale.x).toBeLessThan(0);
    expect(t.scale.y).toBeGreaterThan(0);
  });

  it("produces negative scaleY when y2 < y1 (vertical flip)", () => {
    const p: Placement = {
      extent: [
        [-10, 10],
        [10, -10],
      ],
    };
    const t = applyPlacement(p, undefined);
    expect(t.scale.x).toBeGreaterThan(0);
    expect(t.scale.y).toBeLessThan(0);
  });

  it("computes signed scale magnitude correctly for a doubly-flipped extent", () => {
    // Extent [20,-20] → [-20,20]: both axes flipped, 40 units wide/tall.
    const p: Placement = {
      extent: [
        [20, -20],
        [-20, 20],
      ],
    };
    const t = applyPlacement(p, {
      extent: [
        [-100, -100],
        [100, 100],
      ],
    });
    // 40 wide / 200 = 0.2 (negative); 40 tall / 200 = 0.2 (positive).
    expect(t.scale.x).toBeCloseTo(-0.2);
    expect(t.scale.y).toBeCloseTo(0.2);
  });

  it("position is still at the extent centre regardless of flip direction", () => {
    const p: Placement = {
      extent: [
        [10, -5],
        [-10, 5],
      ],
    };
    const t = applyPlacement(p, undefined);
    // centre of [10,-10] is x=0, centre of [-5,5] is y=0
    expect(t.position.x).toBe(0);
    expect(t.position.y).toBe(0);
  });
});
