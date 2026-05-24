import { describe, expect, it } from "vitest";
import type { DiagramLayout, Point } from "@dicode/omc-client";

import {
  applyDelete,
  applyDeltaMove,
  applyFlip,
  applyRotate,
  selectByDiagramRect,
} from "../src/interaction/layout-ops.js";

function baseLayout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Demo",
    source: { file: "demo.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {},
    components: {
      R1: {
        name: "R1",
        classRef: "Modelica.Electrical.Resistor",
        placement: { extent: [[-10, -5], [10, 5]] },
      },
      C1: {
        name: "C1",
        classRef: "Modelica.Electrical.Capacitor",
        placement: { extent: [[20, 20], [40, 30]] },
      },
    },
    connectors: {
      p: {
        name: "p",
        classRef: "Pin",
        placement: { extent: [[-50, -2], [-46, 2]] },
      },
    },
    connections: [
      {
        lhs: { component: undefined, port: "p" },
        rhs: { component: "R1", port: "p" },
        waypoints: [
          [0, 0],
          [10, 10],
        ],
      },
    ],
  };
}

/** baseLayout() with the connection's waypoints replaced by `route`. */
function withRoute(route: Point[]): DiagramLayout {
  const base = baseLayout();
  return {
    ...base,
    connections: [{ ...base.connections[0]!, waypoints: route }],
  };
}

describe("applyDeltaMove", () => {
  it("shifts a component's placement extent", () => {
    const l = applyDeltaMove(baseLayout(), ["c:R1"], 5, -3);
    expect(l.components.R1!.placement.extent).toEqual([
      [-5, -8],
      [15, 2],
    ]);
  });

  it("leaves untouched components alone", () => {
    const l = applyDeltaMove(baseLayout(), ["c:R1"], 5, 0);
    expect(l.components.C1).toEqual(baseLayout().components.C1);
  });

  it("returns the same reference when nothing changed", () => {
    const layout = baseLayout();
    expect(applyDeltaMove(layout, [], 5, 5)).toBe(layout);
    expect(applyDeltaMove(layout, ["c:R1"], 0, 0)).toBe(layout);
  });

  it("moves multiple components in one call", () => {
    const l = applyDeltaMove(baseLayout(), ["c:R1", "c:C1"], 1, 1);
    expect(l.components.R1!.placement.extent).toEqual([
      [-9, -4],
      [11, 6],
    ]);
    expect(l.components.C1!.placement.extent).toEqual([
      [21, 21],
      [41, 31],
    ]);
  });

  it("moves connectors as well as components", () => {
    const l = applyDeltaMove(baseLayout(), ["k:p"], 100, 0);
    expect(l.connectors.p!.placement.extent).toEqual([
      [50, -2],
      [54, 2],
    ]);
  });

  it("re-routes orthogonally when the rhs endpoint's component moves", () => {
    // baseLayout has connection { lhs: p, rhs: R1.p } with waypoints
    // [[0,0], [10,10]]. Moving R1 by (5, -3) shifts the rhs to (15, 7).
    // The lhs stays at (0, 0). dx=15 > dy=7 → horizontal-first Z-route
    // through midX = 7.5. The old behaviour (just shifting the last
    // waypoint) left a diagonal kink; the new behaviour keeps every
    // segment axis-aligned.
    const l = applyDeltaMove(baseLayout(), ["c:R1"], 5, -3);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [7.5, 0],
      [7.5, 7],
      [15, 7],
    ]);
  });

  it("re-routes orthogonally when the lhs endpoint's connector moves", () => {
    // lhs (0,0) → (4,2); rhs stays at (10,10). dx=6, dy=8 → vertical-
    // first Z-route through midY = 6.
    const l = applyDeltaMove(baseLayout(), ["k:p"], 4, 2);
    expect(l.connections[0]!.waypoints).toEqual([
      [4, 2],
      [4, 6],
      [10, 6],
      [10, 10],
    ]);
  });

  it("translates the route verbatim when both endpoints move together", () => {
    // Both endpoints shift by the same (dx, dy) → the existing route
    // is preserved (including any junctions); orthogonality follows
    // because every waypoint shifted uniformly.
    const l = applyDeltaMove(baseLayout(), ["k:p", "c:R1"], 1, 1);
    expect(l.connections[0]!.waypoints).toEqual([
      [1, 1],
      [11, 11],
    ]);
  });

  it("does not touch connection waypoints when no endpoint entity moves", () => {
    const base = baseLayout();
    // Move only C1, which is not on either endpoint of the connection.
    const l = applyDeltaMove(base, ["c:C1"], 7, 7);
    expect(l.connections[0]!.waypoints).toBe(base.connections[0]!.waypoints);
  });

  it("junction drag on a Z-route slides the adjacent V segment", () => {
    // 4-point Z route. waypoint[1] is the first elbow; the segment
    // before it is horizontal (endpoint-adjacent), the segment after
    // it is vertical (internal). Dragging it by (3, 2) → dy clamps to
    // 0 (would tilt segment 0-1), dx=3 slides both elbow waypoints.
    const base = withRoute([
      [0, 0],
      [5, 0],
      [5, 10],
      [10, 10],
    ]);
    const l = applyDeltaMove(base, ["junc:0/1"], 3, 2);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [8, 0],
      [8, 10],
      [10, 10],
    ]);
  });

  it("junction drag on a Z-route slides the adjacent V segment via the second elbow", () => {
    // Drag waypoint[2] of the Z: segment 1-2 is V (internal, x=5),
    // segment 2-3 is H (endpoint-adjacent, y=10). dy is clamped to
    // 0 by the H-to-endpoint segment; dx propagates back to
    // waypoint[1] so both elbows slide together along x.
    const base = withRoute([
      [0, 0],
      [5, 0],
      [5, 10],
      [10, 10],
    ]);
    const l = applyDeltaMove(base, ["junc:0/2"], 4, 3);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [9, 0],
      [9, 10],
      [10, 10],
    ]);
  });

  it("junction drag on a degenerate L-route is fully clamped", () => {
    // 3-point L. Both adjacent segments are endpoint-adjacent, so
    // both axes are clamped — the elbow can't move without breaking
    // orthogonality. The user needs to add waypoints first.
    const base = withRoute([
      [0, 0],
      [5, 0],
      [5, 10],
    ]);
    const l = applyDeltaMove(base, ["junc:0/1"], 4, 3);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [5, 0],
      [5, 10],
    ]);
  });

  it("junction drag in the middle of a longer route propagates both ways", () => {
    // 5-point route with all-internal junctions[1,2,3]. Dragging
    // waypoint[2] (between two V/H elbows) propagates dx to waypoint[1]
    // (V segment 1-2) and dy to waypoint[3] (H segment 2-3).
    const base = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
      [20, 20],
    ]);
    const l = applyDeltaMove(base, ["junc:0/2"], 3, 4);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [13, 0],
      [13, 14],
      [20, 14],
      [20, 20],
    ]);
  });
});

describe("applyDelete", () => {
  it("removes a component", () => {
    const l = applyDelete(baseLayout(), ["c:R1"]);
    expect(Object.keys(l.components)).toEqual(["C1"]);
  });

  it("removes a connector", () => {
    const l = applyDelete(baseLayout(), ["k:p"]);
    expect(Object.keys(l.connectors)).toEqual([]);
  });

  it("removes a connection by edge index", () => {
    const l = applyDelete(baseLayout(), ["edge:0"]);
    expect(l.connections).toHaveLength(0);
  });

  it("returns the same reference when nothing to delete", () => {
    const layout = baseLayout();
    expect(applyDelete(layout, [])).toBe(layout);
  });
});

describe("applyRotate", () => {
  it("rotates ccw by 90°", () => {
    const l = applyRotate(baseLayout(), ["c:R1"], false);
    expect(l.components.R1!.placement.rotation).toBe(90);
  });

  it("rotates cw by -90° (mod 360)", () => {
    const l = applyRotate(baseLayout(), ["c:R1"], true);
    expect(l.components.R1!.placement.rotation).toBe(270);
  });

  it("stacks rotations: rotate cw twice == 180°", () => {
    let l = applyRotate(baseLayout(), ["c:R1"], true);
    l = applyRotate(l, ["c:R1"], true);
    expect(l.components.R1!.placement.rotation).toBe(180);
  });
});

describe("applyFlip", () => {
  it("negates the X axis when horizontal=true", () => {
    const l = applyFlip(baseLayout(), ["c:R1"], true);
    const ext = l.components.R1!.placement.extent;
    expect(ext[0][0]).toBe(10);
    expect(ext[1][0]).toBe(-10);
  });

  it("negates the Y axis when horizontal=false", () => {
    const l = applyFlip(baseLayout(), ["c:R1"], false);
    const ext = l.components.R1!.placement.extent;
    expect(ext[0][1]).toBe(5);
    expect(ext[1][1]).toBe(-5);
  });
});

describe("selectByDiagramRect", () => {
  it("selects components whose centre falls inside the rect", () => {
    const keys = selectByDiagramRect(baseLayout(), {
      x1: -100,
      y1: -100,
      x2: 100,
      y2: 100,
    });
    expect(keys.has("c:R1")).toBe(true);
    expect(keys.has("c:C1")).toBe(true);
    expect(keys.has("k:p")).toBe(true);
  });

  it("excludes centres outside the rect", () => {
    // Rect covers only x ∈ [-100, -20]; only the connector centre at
    // (-48, 0) qualifies. R1's centre is at (0, 0) and C1's at (30, 25).
    const keys = selectByDiagramRect(baseLayout(), {
      x1: -100,
      y1: -100,
      x2: -20,
      y2: 100,
    });
    expect(keys.has("c:R1")).toBe(false);
    expect(keys.has("c:C1")).toBe(false);
    expect(keys.has("k:p")).toBe(true);
  });

  it("normalises an inverted rect (x1>x2)", () => {
    const keys = selectByDiagramRect(baseLayout(), {
      x1: 100,
      y1: 100,
      x2: -100,
      y2: -100,
    });
    expect(keys.size).toBeGreaterThan(0);
  });
});
