import { describe, expect, it } from "vitest";
import type { DiagramLayout, Point, Shape } from "@dicode/omc-client";

import {
  applyAddGraphic,
  buildPolyShape,
  applyDelete,
  applyDeltaMove,
  applyEdgeSegmentDrag,
  applyWaypointDrag,
  applyFlip,
  applyResize,
  applyRotate,
  applyRotation,
  applySnapToExtents,
  applyWaypointDelete,
  applyWaypointInsert,
  buildExtentShape,
  retainExistingSelection,
  selectByDiagramRect,
  shapeCentre,
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
        placement: {
          extent: [
            [-10, -5],
            [10, 5],
          ],
        },
      },
      C1: {
        name: "C1",
        classRef: "Modelica.Electrical.Capacitor",
        placement: {
          extent: [
            [20, 20],
            [40, 30],
          ],
        },
      },
    },
    connectors: {
      p: {
        name: "p",
        classRef: "Pin",
        placement: {
          extent: [
            [-50, -2],
            [-46, 2],
          ],
        },
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

const RECT_0: Shape = {
  kind: "rectangle",
  extent: [
    [0, 0],
    [10, 10],
  ],
  lineColor: [0, 0, 0],
};
const LINE_1: Shape = {
  kind: "line",
  points: [
    [0, 0],
    [10, 0],
  ],
  color: [0, 0, 0],
};

/**
 * baseLayout() carrying host-own (`from === "Demo"`) diagram shapes, plus
 * an inherited (`from === "Base"`) layer that shape ops must never touch.
 */
function withShapes(shapes: Shape[]): DiagramLayout {
  const inherited: Shape = {
    kind: "rectangle",
    extent: [
      [-1, -1],
      [1, 1],
    ],
  };
  return {
    ...baseLayout(),
    diagramLayers: [
      { from: "Base", shapes: [inherited] },
      { from: "Demo", shapes },
    ],
  };
}

/** The host-own (`from === "Demo"`) layer's shapes after an op. */
function ownShapes(layout: DiagramLayout): Shape[] {
  return layout.diagramLayers.find((l) => l.from === "Demo")?.shapes ?? [];
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

  it("junction drag on a Z-route inserts a jog", () => {
    // 4-point Z route. waypoint[1] is the first elbow. Dragging it by
    // (3, 2) inserts in-jog and out-jog so the route stays Manhattan.
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
      [8, 2],
      [5, 2],
      [5, 10],
      [10, 10],
    ]);
  });

  it("junction drag on a Z-route via the second elbow inserts a jog", () => {
    // Drag waypoint[2] of the Z: in-jog runs along V (segment 1-2),
    // out-jog runs along H (segment 2-3). Both jogs keep the route Manhattan.
    const base = withRoute([
      [0, 0],
      [5, 0],
      [5, 10],
      [10, 10],
    ]);
    const l = applyDeltaMove(base, ["junc:0/2"], 4, 3);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [5, 0],
      [5, 13],
      [9, 13],
      [9, 10],
      [10, 10],
    ]);
  });

  it("junction drag on a degenerate L-route inserts a jog", () => {
    // 3-point L. Jog-insertion expands the route so the elbow moves freely.
    const base = withRoute([
      [0, 0],
      [5, 0],
      [5, 10],
    ]);
    const l = applyDeltaMove(base, ["junc:0/1"], 4, 3);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [9, 0],
      [9, 3],
      [5, 3],
      [5, 10],
    ]);
  });

  it("junction drag in the middle of a longer route inserts a jog", () => {
    // 5-point route. Dragging waypoint[2] inserts in-jog (V) and out-jog
    // (H) while the outer segments and anchor waypoints stay fixed.
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
      [10, 0],
      [10, 14],
      [13, 14],
      [13, 10],
      [20, 10],
      [20, 20],
    ]);
  });

  it("single junction in a multi-select still gets jog insertion", () => {
    // C1 has no connection to this route; only junc:0/1 touches it.
    // wpIdxs.size === 1 so jog-insertion runs despite the multi-select.
    const base = withRoute([
      [0, 0],
      [5, 0],
      [5, 10],
      [10, 10],
    ]);
    const l = applyDeltaMove(base, ["c:C1", "junc:0/1"], 3, 2);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [8, 0],
      [8, 2],
      [5, 2],
      [5, 10],
      [10, 10],
    ]);
  });

  it("multiple junctions on the same connection fall back to per-waypoint shift", () => {
    // Two junctions from the same connection: jog-insertion would fight
    // itself, so the plain-shift fallback runs instead.
    const base = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
      [20, 20],
    ]);
    const l = applyDeltaMove(base, ["junc:0/1", "junc:0/3"], 3, 4);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [13, 4],
      [10, 10],
      [23, 14],
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

describe("applyWaypointInsert", () => {
  it("inserts a waypoint on the segment nearest the click", () => {
    // Z-route. A click at (8, 4) projects onto the middle vertical
    // segment (x=5) at (5, 4), landing between waypoints[1] and [2].
    const base = withRoute([
      [0, 0],
      [5, 0],
      [5, 10],
      [10, 10],
    ]);
    const l = applyWaypointInsert(base, 0, { x: 8, y: 4 });
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [5, 0],
      [5, 4],
      [5, 10],
      [10, 10],
    ]);
  });

  it("projects onto the first segment when the click is nearest to it", () => {
    // Click near the horizontal segment 0-1 (y=0): projects to (3, 0)
    // and lands between waypoints[0] and [1].
    const base = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const l = applyWaypointInsert(base, 0, { x: 3, y: 1 });
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [3, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it("clamps the projection to the segment endpoints", () => {
    // A click beyond the far end of a 2-point straight connection
    // projects onto the endpoint, not past it.
    const base = withRoute([
      [0, 0],
      [10, 0],
    ]);
    const l = applyWaypointInsert(base, 0, { x: 50, y: 0 });
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [10, 0],
      [10, 0],
    ]);
  });

  it("returns the same reference for an unknown connection index", () => {
    const layout = baseLayout();
    expect(applyWaypointInsert(layout, 9, { x: 0, y: 0 })).toBe(layout);
  });
});

describe("applyWaypointDelete", () => {
  it("removes an internal waypoint", () => {
    const base = withRoute([
      [0, 0],
      [5, 0],
      [5, 10],
      [10, 10],
    ]);
    const l = applyWaypointDelete(base, 0, 1);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [5, 10],
      [10, 10],
    ]);
  });

  it("never removes the first endpoint", () => {
    const layout = withRoute([
      [0, 0],
      [5, 0],
      [10, 10],
    ]);
    expect(applyWaypointDelete(layout, 0, 0)).toBe(layout);
  });

  it("never removes the last endpoint", () => {
    const layout = withRoute([
      [0, 0],
      [5, 0],
      [10, 10],
    ]);
    expect(applyWaypointDelete(layout, 0, 2)).toBe(layout);
  });

  it("returns the same reference for an unknown connection index", () => {
    const layout = baseLayout();
    expect(applyWaypointDelete(layout, 9, 1)).toBe(layout);
  });
});

describe("applyEdgeSegmentDrag", () => {
  it("moves an interior horizontal segment vertically, ignoring the parallel delta", () => {
    // U-route: the middle segment (1-2) is horizontal at y=5. Dragging
    // it moves only in y; the dx is discarded (Manhattan).
    const base = withRoute([
      [0, 0],
      [0, 5],
      [10, 5],
      [10, 0],
    ]);
    const l = applyEdgeSegmentDrag(base, 0, { x: 5, y: 5 }, 4, 3);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [0, 8],
      [10, 8],
      [10, 0],
    ]);
  });

  it("inserts a jog so a dragged terminal segment leaves its anchor pinned", () => {
    // L-route. Segment 0-1 is horizontal and touches the anchored
    // endpoint (0,0). Dragging it down inserts a vertical jog at the
    // anchor instead of moving the anchor.
    const base = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const l = applyEdgeSegmentDrag(base, 0, { x: 5, y: 0 }, 0, 4);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [0, 4],
      [10, 4],
      [10, 10],
    ]);
  });

  it("jogs both anchors when a straight wire is dragged sideways", () => {
    // A 2-point vertical wire: both endpoints are anchored. Dragging it
    // in x must keep both anchors and route around via two jogs.
    const base = withRoute([
      [0, 0],
      [0, 10],
    ]);
    const l = applyEdgeSegmentDrag(base, 0, { x: 0, y: 5 }, 5, 2);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [5, 0],
      [5, 10],
      [0, 10],
    ]);
  });

  it("collapses the coincident corner a drag can create", () => {
    // Dragging the L's bottom segment all the way up to the elbow's
    // height makes the corner waypoint coincide with the anchor; the
    // duplicate is dropped rather than left as a zero-length segment.
    const base = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const l = applyEdgeSegmentDrag(base, 0, { x: 5, y: 0 }, 0, 10);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [0, 10],
      [10, 10],
    ]);
  });

  it("returns the same reference for a zero delta", () => {
    const layout = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(applyEdgeSegmentDrag(layout, 0, { x: 5, y: 0 }, 0, 0)).toBe(layout);
  });

  it("returns the same reference for an unknown connection index", () => {
    const layout = baseLayout();
    expect(applyEdgeSegmentDrag(layout, 9, { x: 0, y: 0 }, 3, 3)).toBe(layout);
  });
});

describe("applyWaypointDrag", () => {
  it("reshapes around a dragged elbow with orthogonal jogs", () => {
    // L-route; waypoint 1 is the elbow (10,0) between a horizontal and a
    // vertical segment. Dragging it diagonally keeps both segments
    // orthogonal by inserting a jog on each side of the moved corner.
    const base = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    const l = applyWaypointDrag(base, 0, 1, 5, 3);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [15, 0],
      [15, 3],
      [10, 3],
      [10, 10],
    ]);
  });

  it("keeps trailing waypoints when reshaping a mid-route corner", () => {
    const base = withRoute([
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 20],
    ]);
    const l = applyWaypointDrag(base, 0, 1, 3, 2);
    expect(l.connections[0]!.waypoints).toEqual([
      [0, 0],
      [0, 12],
      [3, 12],
      [3, 10],
      [10, 10],
      [10, 20],
    ]);
  });

  it("collapses to the same reference when a corner slides along its own segment", () => {
    // Dragging the elbow purely along its horizontal segment can't move
    // it without detaching the fixed neighbour, so the orthogonal route
    // is unchanged.
    const layout = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(applyWaypointDrag(layout, 0, 1, 5, 0)).toBe(layout);
  });

  it("never reshapes an endpoint waypoint", () => {
    const layout = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(applyWaypointDrag(layout, 0, 0, 3, 3)).toBe(layout);
    expect(applyWaypointDrag(layout, 0, 2, 3, 3)).toBe(layout);
  });

  it("returns the same reference for a zero delta", () => {
    const layout = withRoute([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(applyWaypointDrag(layout, 0, 1, 0, 0)).toBe(layout);
  });

  it("returns the same reference for an unknown connection index", () => {
    const layout = baseLayout();
    expect(applyWaypointDrag(layout, 9, 1, 3, 3)).toBe(layout);
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

describe("applyResize", () => {
  it("moves the dragged corner and holds the opposite one fixed", () => {
    // R1 extent [[-10,-5],[10,5]]. Drag the top-right corner to (20, 12).
    const out = applyResize(baseLayout(), "c:R1", "tr", 20, 12);
    expect(out.components.R1?.placement.extent).toEqual([
      [-10, -5],
      [20, 12],
    ]);
  });

  it("flips the extent when the dragged corner crosses the anchor", () => {
    // R1 extent [[-10,-5],[10,5]]. Drag BL (x1,y1) to (50,50) — past the
    // fixed TR corner (10,5) — inverts both axes → a horizontal + vertical
    // mirror, expressed as the negative-direction extent.
    const out = applyResize(baseLayout(), "c:R1", "bl", 50, 50);
    expect(out.components.R1?.placement.extent).toEqual([
      [50, 50],
      [10, 5],
    ]);
  });

  it("returns the same reference for an unknown key", () => {
    const layout = baseLayout();
    expect(applyResize(layout, "c:nope", "tl", 0, 0)).toBe(layout);
  });

  it("re-anchors a connection endpoint on the resized component", () => {
    // R1 centre (0,0), size 20×10. Drag TR to (20,12) → centre (5,3.5),
    // size 30×17. The rhs endpoint [10,10] scales about the old centre
    // by (1.5, 1.7) onto the new centre → [20, 20.5]. The lhs endpoint
    // (standalone connector p, untouched) stays at [0,0].
    const out = applyResize(baseLayout(), "c:R1", "tr", 20, 12);
    const wp = out.connections[0]?.waypoints;
    if (!wp) throw new Error("expected waypoints");
    expect(wp[0]).toEqual([0, 0]);
    expect(wp.at(-1)).toEqual([20, 20.5]);
  });
});

describe("applyRotation", () => {
  it("sets the absolute rotation, normalised to [0, 360)", () => {
    const out = applyRotation(baseLayout(), ["c:R1"], -90);
    expect(out.components.R1?.placement.rotation).toBe(270);
  });

  it("returns the same reference when the angle is unchanged", () => {
    const once = applyRotation(baseLayout(), ["c:R1"], 45);
    expect(applyRotation(once, ["c:R1"], 45)).toBe(once);
  });

  it("re-anchors a connection endpoint on the rotated component", () => {
    // R1 centre (0,0). Rotating 90° CCW carries the rhs endpoint
    // [10,10] to [-10,10] about the centre; the lhs endpoint (connector
    // p, unrotated) stays at [0,0].
    const out = applyRotation(baseLayout(), ["c:R1"], 90);
    const wp = out.connections[0]?.waypoints;
    if (!wp) throw new Error("expected waypoints");
    expect(wp[0]).toEqual([0, 0]);
    expect(wp.at(-1)).toEqual([-10, 10]);
  });
});

describe("shapeCentre", () => {
  it("returns the placement centre of a component", () => {
    expect(shapeCentre(baseLayout(), "c:R1")).toEqual([0, 0]);
  });

  it("returns null for a key that isn't in the layout", () => {
    expect(shapeCentre(baseLayout(), "c:nope")).toBeNull();
  });
});

describe("retainExistingSelection", () => {
  it("keeps keys still backed by a shape and drops the rest", () => {
    const out = retainExistingSelection(baseLayout(), [
      "c:R1",
      "c:gone",
      "k:p",
      "edge:0",
    ]);
    expect([...out].sort()).toEqual(["c:R1", "k:p"]);
  });

  it("retains a host-shape key only when its index still holds the same kind", () => {
    const layout = withShapes([RECT_0, LINE_1]);
    const out = retainExistingSelection(layout, [
      "shape:rectangle:0", // index 0 is still a rectangle → kept
      "shape:line:1", // index 1 is still a line → kept
      "shape:ellipse:0", // index 0 is a rectangle, not ellipse → dropped
      "shape:rectangle:5", // out of range → dropped
    ]);
    expect([...out].sort()).toEqual(["shape:line:1", "shape:rectangle:0"]);
  });
});

describe("host shape ops", () => {
  it("moves an extent shape by shifting its extent, poly shapes by every vertex", () => {
    const rect = applyDeltaMove(
      withShapes([RECT_0]),
      ["shape:rectangle:0"],
      5,
      -3,
    );
    expect(ownShapes(rect)[0]).toMatchObject({
      extent: [
        [5, -3],
        [15, 7],
      ],
    });

    const line = applyDeltaMove(withShapes([LINE_1]), ["shape:line:0"], 5, -3);
    expect(ownShapes(line)[0]).toMatchObject({
      points: [
        [5, -3],
        [15, -3],
      ],
    });
  });

  it("moves only the addressed shape and never an inherited layer", () => {
    const out = applyDeltaMove(
      withShapes([RECT_0, LINE_1]),
      ["shape:line:1"],
      2,
      2,
    );
    // Index 0 (rectangle) untouched; the inherited "Base" layer untouched.
    expect(ownShapes(out)[0]).toEqual(RECT_0);
    expect(out.diagramLayers.find((l) => l.from === "Base")?.shapes).toEqual([
      {
        kind: "rectangle",
        extent: [
          [-1, -1],
          [1, 1],
        ],
      },
    ]);
    expect(ownShapes(out)[1]).toMatchObject({
      points: [
        [2, 2],
        [12, 2],
      ],
    });
  });

  it("resizes an extent shape by a corner; poly resize is a no-op", () => {
    // `tr` holds the bottom-left fixed and drags the top-right corner.
    const resized = applyResize(
      withShapes([RECT_0]),
      "shape:rectangle:0",
      "tr",
      20,
      30,
    );
    expect(ownShapes(resized)[0]).toMatchObject({
      extent: [
        [0, 0],
        [20, 30],
      ],
    });

    const layout = withShapes([LINE_1]);
    expect(applyResize(layout, "shape:line:0", "tr", 99, 99)).toBe(layout);
  });

  it("rotates a shape and is idempotent at the same angle", () => {
    const once = applyRotation(
      withShapes([RECT_0]),
      ["shape:rectangle:0"],
      -90,
    );
    expect(ownShapes(once)[0]).toMatchObject({ rotation: 270 });
    expect(applyRotation(once, ["shape:rectangle:0"], 270)).toBe(once);
  });

  it("deletes a shape by position and re-indexes its siblings", () => {
    const out = applyDelete(withShapes([RECT_0, LINE_1]), [
      "shape:rectangle:0",
    ]);
    // The line, previously index 1, is now the sole own shape at index 0.
    expect(ownShapes(out)).toEqual([LINE_1]);
    // Components are untouched by a shape-only delete.
    expect(out.components.R1).toBeDefined();
  });

  it("snaps a shape's geometry to the grid on commit", () => {
    const off: Shape = {
      kind: "rectangle",
      extent: [
        [1, 1],
        [9, 9],
      ],
    };
    const out = applySnapToExtents(
      withShapes([off]),
      ["shape:rectangle:0"],
      [5, 5],
    );
    expect(ownShapes(out)[0]).toMatchObject({
      extent: [
        [0, 0],
        [10, 10],
      ],
    });
  });

  it("returns the shape centre for the rotate pivot", () => {
    expect(shapeCentre(withShapes([RECT_0]), "shape:rectangle:0")).toEqual([
      5, 5,
    ]);
    expect(shapeCentre(withShapes([LINE_1]), "shape:line:0")).toEqual([5, 0]);
  });

  it("ignores out-of-range and malformed shape keys without throwing", () => {
    const layout = withShapes([RECT_0]);
    expect(applyDeltaMove(layout, ["shape:rectangle:9"], 5, 5)).toBe(layout);
    expect(applyDelete(layout, ["shape:rectangle:"])).toBe(layout);
    expect(applyDeltaMove(layout, ["shape:rectangle:"], 5, 5)).toBe(layout);
  });
});

describe("buildExtentShape", () => {
  it("builds a rectangle / ellipse with a visible outline", () => {
    expect(
      buildExtentShape("rectangle", [
        [0, 0],
        [10, 10],
      ]),
    ).toEqual({
      kind: "rectangle",
      extent: [
        [0, 0],
        [10, 10],
      ],
      lineColor: [0, 0, 0],
    });
    expect(
      buildExtentShape("ellipse", [
        [0, 0],
        [10, 10],
      ]).kind,
    ).toBe("ellipse");
  });
});

describe("buildPolyShape", () => {
  it("builds an open line carrying its vertices and outline color", () => {
    expect(
      buildPolyShape("line", [
        [0, 0],
        [10, 0],
        [10, 10],
      ]),
    ).toEqual({
      kind: "line",
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      color: [0, 0, 0],
    });
  });

  it("builds a polygon with the distinct vertices and a line color", () => {
    const poly = buildPolyShape("polygon", [
      [0, 0],
      [10, 0],
      [5, 10],
    ]);
    expect(poly.kind).toBe("polygon");
    expect(poly).toEqual({
      kind: "polygon",
      points: [
        [0, 0],
        [10, 0],
        [5, 10],
      ],
      lineColor: [0, 0, 0],
    });
  });
});

describe("applyAddGraphic", () => {
  it("creates the host's own layer when the class has no graphics yet", () => {
    const layout = baseLayout();
    const shape = buildExtentShape("rectangle", [
      [0, 0],
      [10, 10],
    ]);
    const next = applyAddGraphic(layout, "diagram", shape);
    expect(next.diagramLayers).toEqual([{ from: "Demo", shapes: [shape] }]);
    // Pure — the input layout is untouched.
    expect(layout.diagramLayers).toEqual([]);
  });

  it("appends to the host layer, leaving inherited layers alone", () => {
    const layout = baseLayout();
    const inherited = buildExtentShape("ellipse", [
      [1, 1],
      [2, 2],
    ]);
    layout.diagramLayers = [
      { from: "Base", shapes: [inherited] },
      { from: "Demo", shapes: [] },
    ];
    const shape = buildExtentShape("rectangle", [
      [0, 0],
      [10, 10],
    ]);
    const next = applyAddGraphic(layout, "diagram", shape);
    expect(next.diagramLayers.at(0)).toEqual({
      from: "Base",
      shapes: [inherited],
    });
    expect(next.diagramLayers.at(1)?.shapes).toEqual([shape]);
  });

  it("targets the icon layer when asked", () => {
    const layout = baseLayout();
    const shape = buildExtentShape("rectangle", [
      [0, 0],
      [10, 10],
    ]);
    const next = applyAddGraphic(layout, "icon", shape);
    expect(next.iconLayers).toEqual([{ from: "Demo", shapes: [shape] }]);
    expect(next.diagramLayers).toEqual([]);
  });
});
