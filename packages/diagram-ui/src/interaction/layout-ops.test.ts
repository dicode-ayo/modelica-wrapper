import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import { applyEdgeSegmentDrag } from "./layout-ops.js";

function baseLayout(waypoints: [number, number][]): DiagramLayout {
  return {
    kind: "diagram",
    className: "T",
    source: { file: "T.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {},
    components: {},
    connectors: {},
    connections: [
      {
        lhs: { component: "A", port: "p" },
        rhs: { component: "B", port: "n" },
        waypoints,
      },
    ],
  };
}

describe("applyEdgeSegmentDrag", () => {
  it("returns the same layout reference for a zero-length grabbed segment", () => {
    // Segment 0 ([5,5]→[5,5]) is zero-length; grab at its position selects
    // it first (strict-< in closestSegmentIndex keeps the earliest tie).
    const layout = baseLayout([
      [5, 5],
      [5, 5],
      [10, 5],
    ]);
    const result = applyEdgeSegmentDrag(layout, 0, { x: 5, y: 5 }, 3, 7);
    expect(result).toBe(layout);
  });

  it("moves a horizontal segment vertically (dy applied, anchors fixed)", () => {
    const layout = baseLayout([
      [0, 0],
      [10, 0],
    ]);
    const result = applyEdgeSegmentDrag(layout, 0, { x: 5, y: 0 }, 0, 5);
    const conn = result.connections[0];
    if (conn === undefined) throw new Error("missing connection");
    expect(conn.waypoints).toEqual([
      [0, 0],
      [0, 5],
      [10, 5],
      [10, 0],
    ]);
  });

  it("moves a vertical segment horizontally (dx applied, anchors fixed)", () => {
    const layout = baseLayout([
      [0, 0],
      [0, 10],
    ]);
    const result = applyEdgeSegmentDrag(layout, 0, { x: 0, y: 5 }, 3, 0);
    const conn = result.connections[0];
    if (conn === undefined) throw new Error("missing connection");
    expect(conn.waypoints).toEqual([
      [0, 0],
      [3, 0],
      [3, 10],
      [0, 10],
    ]);
  });

  it("returns the same layout reference when dx and dy are both zero", () => {
    const layout = baseLayout([
      [0, 0],
      [10, 0],
    ]);
    expect(applyEdgeSegmentDrag(layout, 0, { x: 5, y: 0 }, 0, 0)).toBe(layout);
  });
});
