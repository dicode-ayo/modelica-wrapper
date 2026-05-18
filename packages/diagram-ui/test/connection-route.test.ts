import { describe, expect, it } from "vitest";

import { orthogonalRoute } from "../src/interaction/connection-route.js";

describe("orthogonalRoute", () => {
  it("returns a straight 2-point segment for horizontally-aligned endpoints", () => {
    expect(orthogonalRoute({ x: 0, y: 5 }, { x: 100, y: 5 })).toEqual([
      [0, 5],
      [100, 5],
    ]);
  });

  it("returns a straight 2-point segment for vertically-aligned endpoints", () => {
    expect(orthogonalRoute({ x: 10, y: 0 }, { x: 10, y: 50 })).toEqual([
      [10, 0],
      [10, 50],
    ]);
  });

  it("Z-routes horizontally first when dx >= dy", () => {
    expect(orthogonalRoute({ x: 0, y: 0 }, { x: 100, y: 40 })).toEqual([
      [0, 0],
      [50, 0],
      [50, 40],
      [100, 40],
    ]);
  });

  it("Z-routes vertically first when dy > dx", () => {
    expect(orthogonalRoute({ x: 0, y: 0 }, { x: 40, y: 100 })).toEqual([
      [0, 0],
      [0, 50],
      [40, 50],
      [40, 100],
    ]);
  });
});
