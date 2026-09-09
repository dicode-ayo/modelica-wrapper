import { describe, expect, it } from "vitest";

import {
  isBezierSmooth,
  smoothLinePathData,
  smoothLinePoints,
  smoothPolygonPathData,
  smoothPolygonPoints,
} from "./smooth-path.js";

type Pt = [number, number];

/** Axis-aligned bounding box of a point list. */
function bbox(points: ReadonlyArray<readonly [number, number]>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** Largest direction change, in degrees, between consecutive segments. */
function maxTurnDegrees(
  points: ReadonlyArray<readonly [number, number]>,
): number {
  let worst = 0;
  for (let i = 2; i < points.length; i++) {
    const a = points[i - 2];
    const b = points[i - 1];
    const c = points[i];
    if (a === undefined || b === undefined || c === undefined) break;
    const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(t2 - t1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    worst = Math.max(worst, (d * 180) / Math.PI);
  }
  return worst;
}

describe("isBezierSmooth", () => {
  it("selects only Smooth.Bezier", () => {
    expect(isBezierSmooth("Bezier")).toBe(true);
    expect(isBezierSmooth("None")).toBe(false);
    expect(isBezierSmooth(undefined)).toBe(false);
    expect(isBezierSmooth("bezier")).toBe(false);
  });
});

describe("smoothLinePathData", () => {
  it("draws midpoint-anchored cubics through the interior vertices", () => {
    const points: Pt[] = [
      [0, 0],
      [10, 10],
      [20, 0],
    ];
    expect(smoothLinePathData(points)).toBe(
      "M 0 0 L 5 5 C 5 5 10 10 15 5 L 20 0",
    );
  });

  it("chains one cubic per interior vertex", () => {
    const points: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
    ];
    expect(smoothLinePathData(points)).toBe(
      "M 0 0 L 5 0 C 5 0 10 0 10 5 L 10 5 C 10 5 10 10 15 10 L 20 10",
    );
  });

  it("degrades a two-point line to a straight segment", () => {
    expect(
      smoothLinePathData([
        [0, 0],
        [10, 4],
      ]),
    ).toBe("M 0 0 L 10 4");
  });

  it("emits a bare move for a single point and nothing for none", () => {
    expect(smoothLinePathData([[3, 4]])).toBe("M 3 4");
    expect(smoothLinePathData([])).toBe("");
  });

  it("rounds coordinates so binary halving does not leak into the output", () => {
    const points: Pt[] = [
      [-8.3, 0],
      [4.7, 0],
      [10, 0],
    ];
    expect(smoothLinePathData(points)).not.toContain("999999");
  });
});

describe("smoothPolygonPathData", () => {
  it("closes the ring with a wrap-around cubic back to the first midpoint", () => {
    const square: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    expect(smoothPolygonPathData(square)).toBe(
      "M 5 0 C 5 0 10 0 10 5 C 10 5 10 10 5 10 C 5 10 0 10 0 5 C 0 5 0 0 5 0 Z",
    );
  });

  it("treats an implicitly closed ring the same as an explicit one", () => {
    const open: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const closed: Pt[] = [...open, [0, 0]];
    expect(smoothPolygonPathData(open)).toBe(smoothPolygonPathData(closed));
  });

  it("degrades a triangle-less ring to straight segments", () => {
    expect(
      smoothPolygonPathData([
        [0, 0],
        [10, 0],
      ]),
    ).toBe("M 0 0 L 10 0 Z");
  });
});

describe("smoothLinePoints", () => {
  const arc: Pt[] = [
    [0, 0],
    [10, 10],
    [20, 0],
  ];

  it("keeps the original endpoints", () => {
    const sampled = smoothLinePoints(arc);
    expect(sampled[0]).toEqual([0, 0]);
    expect(sampled.at(-1)).toEqual([20, 0]);
  });

  it("stays inside the control-point hull's bounding box", () => {
    const hull = bbox(arc);
    for (const [x, y] of smoothLinePoints(arc)) {
      expect(x).toBeGreaterThanOrEqual(hull.minX);
      expect(x).toBeLessThanOrEqual(hull.maxX);
      expect(y).toBeGreaterThanOrEqual(hull.minY);
      expect(y).toBeLessThanOrEqual(hull.maxY);
    }
  });

  it("bulges off the chord that the raw polyline would draw", () => {
    const sampled = smoothLinePoints(arc);
    // The polyline passes through (10,10); the curve's apex sits lower.
    const apex = Math.max(...sampled.map(([, y]) => y));
    expect(apex).toBeLessThan(10);
    expect(apex).toBeGreaterThan(5);
  });

  it("emits no zero-length segments", () => {
    const sampled = smoothLinePoints([
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
    ]);
    for (let i = 1; i < sampled.length; i++) {
      expect(sampled[i]).not.toEqual(sampled[i - 1]);
    }
  });

  it("turns gradually where the raw polyline would kink", () => {
    // Seven points on a circle: the polyline turns a hard 30 degrees at
    // every interior vertex; the curve is C1 there, so no sample joint
    // turns anywhere near that much.
    const radius = 50;
    const onCircle = Array.from({ length: 7 }, (_, i): Pt => {
      const a = (Math.PI * i) / 6;
      return [radius * Math.cos(a), radius * Math.sin(a)];
    });
    expect(maxTurnDegrees(onCircle)).toBeCloseTo(30, 6);
    expect(maxTurnDegrees(smoothLinePoints(onCircle))).toBeLessThan(6);
  });

  it("passes a two-point line through unchanged", () => {
    expect(
      smoothLinePoints([
        [0, 0],
        [10, 4],
      ]),
    ).toEqual([
      [0, 0],
      [10, 4],
    ]);
  });
});

describe("smoothPolygonPoints", () => {
  const square: Pt[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];

  it("returns a ring whose last point repeats the first", () => {
    const sampled = smoothPolygonPoints(square);
    expect(sampled.at(-1)).toEqual(sampled[0]);
  });

  it("rounds the corners inside the control-point hull", () => {
    const hull = bbox(square);
    const sampled = smoothPolygonPoints(square);
    for (const [x, y] of sampled) {
      expect(x).toBeGreaterThanOrEqual(hull.minX);
      expect(x).toBeLessThanOrEqual(hull.maxX);
      expect(y).toBeGreaterThanOrEqual(hull.minY);
      expect(y).toBeLessThanOrEqual(hull.maxY);
    }
    // No sample lands on a corner of the source square.
    for (const corner of square) {
      expect(sampled).not.toContainEqual(corner);
    }
  });

  it("passes a degenerate ring through unchanged", () => {
    expect(
      smoothPolygonPoints([
        [0, 0],
        [10, 0],
      ]),
    ).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });
});
