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
    // Route: [5,5]→[5,5]→[10,5] — segment 0 is zero-length.
    // Grabbing at (5,5) selects segment 0 (closest by index tie-break).
    const layout = baseLayout([
      [5, 5],
      [5, 5],
      [10, 5],
    ]);
    const result = applyEdgeSegmentDrag(layout, 0, { x: 5, y: 5 }, 3, 7);
    expect(result).toBe(layout);
  });

  it("moves a horizontal segment vertically (dy applied, anchors fixed)", () => {
    // Route: [0,0]→[10,0] — single horizontal segment. Dragging by dy=5
    // keeps the connector anchors fixed and inserts jog waypoints at the
    // new y-level, producing [[0,0],[0,5],[10,5],[10,0]].
    const layout = baseLayout([
      [0, 0],
      [10, 0],
    ]);
    const result = applyEdgeSegmentDrag(layout, 0, { x: 5, y: 0 }, 0, 5);
    const conn = result.connections[0];
    expect(conn).toBeDefined();
    expect(conn!.waypoints).toEqual([
      [0, 0],
      [0, 5],
      [10, 5],
      [10, 0],
    ]);
  });

  it("moves a vertical segment horizontally (dx applied, anchors fixed)", () => {
    // Route: [0,0]→[0,10] — single vertical segment. Dragging by dx=3
    // keeps anchors fixed and inserts jog waypoints, producing
    // [[0,0],[3,0],[3,10],[0,10]].
    const layout = baseLayout([
      [0, 0],
      [0, 10],
    ]);
    const result = applyEdgeSegmentDrag(layout, 0, { x: 0, y: 5 }, 3, 0);
    const conn = result.connections[0];
    expect(conn).toBeDefined();
    expect(conn!.waypoints).toEqual([
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
