import { describe, expect, it } from "vitest";
import type { DiagramLayout, Point, Shape } from "@dicode/omc-client";

import {
  applyAddGraphic,
  applyShapeReorder,
  buildPolyShape,
  ownShapeCount,
  zOrderTarget,
  applyDelete,
  applyDeltaMove,
  applyFlip,
  applyResize,
  applyRotate,
  applyRotation,
  applyShapeSmoothToggle,
  applyShapeVertexDelete,
  applyShapeVertexDrag,
  applyShapeVertexInsert,
  applySnapToExtents,
  buildExtentShape,
  shapeCentre,
} from "../src/interaction/layout-ops.js";
import {
  baseLayout,
  LINE_1,
  ownShapes,
  RECT_0,
  withRoute,
  withShapes,
} from "./harness/layout-fixtures.js";

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
    // C1 is not connected to this route; only the one junction key touches it.
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

describe("applySnapToExtents — connection re-anchor", () => {
  const GRID: [number, number] = [2, 2];

  // Component A off-grid on x: extent [[-9,-4],[1,6]] snaps to [[-8,-4],[2,6]]
  // on the {2,2} grid — centre (-4,1) → (-3,1), a +1 x-translation.
  function withComponentA(waypoints: Point[]): DiagramLayout {
    return {
      ...baseLayout(),
      components: {
        A: {
          name: "A",
          classRef: "K",
          placement: {
            extent: [
              [-9, -4],
              [1, 6],
            ],
          },
        },
      },
      connectors: {},
      connections: [
        {
          lhs: { component: "A", port: "y" },
          rhs: { component: "ground", port: "u" },
          waypoints,
        },
      ],
    };
  }

  it("shifts the endpoint on the snapped component, keeping internal waypoints", () => {
    // Without the re-anchor the port moves +1 but the wire's first point stays
    // put, so the connection detaches from the block on commit.
    const out = applySnapToExtents(
      withComponentA([
        [1, 1],
        [5, 1],
        [5, 20],
      ]),
      ["c:A"],
      GRID,
    );
    expect(out.connections[0]?.waypoints).toEqual([
      [2, 1],
      [5, 1],
      [5, 20],
    ]);
  });

  it("snaps the component placement itself onto the grid", () => {
    const out = applySnapToExtents(
      withComponentA([
        [1, 1],
        [5, 20],
      ]),
      ["c:A"],
      GRID,
    );
    expect(out.components.A?.placement.extent).toEqual([
      [-8, -4],
      [2, 6],
    ]);
  });

  it("leaves a connection untouched when neither endpoint sits on a snapped entity", () => {
    const layout: DiagramLayout = {
      ...baseLayout(),
      components: {
        A: {
          name: "A",
          classRef: "K",
          placement: {
            extent: [
              [-9, -4],
              [1, 6],
            ],
          },
        },
      },
      connectors: {},
      connections: [
        {
          lhs: { component: "B", port: "y" },
          rhs: { component: "ground", port: "u" },
          waypoints: [
            [0, 0],
            [10, 0],
          ],
        },
      ],
    };
    const out = applySnapToExtents(layout, ["c:A"], GRID);
    expect(out.connections[0]?.waypoints).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it("shifts the last waypoint when the snapped component is the rhs endpoint", () => {
    const layout: DiagramLayout = {
      ...baseLayout(),
      components: {
        A: {
          name: "A",
          classRef: "K",
          placement: {
            extent: [
              [-9, -4],
              [1, 6],
            ],
          },
        },
      },
      connectors: {},
      connections: [
        {
          lhs: { component: "source", port: "y" },
          rhs: { component: "A", port: "u" },
          waypoints: [
            [5, 20],
            [5, 1],
            [1, 1],
          ],
        },
      ],
    };
    const out = applySnapToExtents(layout, ["c:A"], GRID);
    // rhs (on A) follows +1; the lhs end and the internal junction stay put.
    expect(out.connections[0]?.waypoints).toEqual([
      [5, 20],
      [5, 1],
      [2, 1],
    ]);
  });

  it("re-anchors an endpoint on a snapped standalone connector", () => {
    // Off-grid connector q: extent [[-51,-2],[-47,2]] snaps to [[-50,-2],[-46,2]]
    // — centre (-49,0) → (-48,0), a +1 x-translation. The endpoint references it
    // via `component: undefined, port: "q"`, exercising the connectorXf path.
    const layout: DiagramLayout = {
      ...baseLayout(),
      connectors: {
        q: {
          name: "q",
          classRef: "Pin",
          placement: {
            extent: [
              [-51, -2],
              [-47, 2],
            ],
          },
        },
      },
      connections: [
        {
          lhs: { component: undefined, port: "q" },
          rhs: { component: "R1", port: "p" },
          waypoints: [
            [-47, 0],
            [0, 0],
          ],
        },
      ],
    };
    const out = applySnapToExtents(layout, ["k:q"], GRID);
    expect(out.connections[0]?.waypoints).toEqual([
      [-46, 0],
      [0, 0],
    ]);
    expect(out.connectors.q?.placement.extent).toEqual([
      [-50, -2],
      [-46, 2],
    ]);
  });

  it("returns the same layout reference when the component is already on-grid", () => {
    const layout = withComponentA([
      [2, 1],
      [5, 1],
    ]);
    layout.components.A!.placement = {
      extent: [
        [-8, -4],
        [2, 6],
      ],
    };
    expect(applySnapToExtents(layout, ["c:A"], GRID)).toBe(layout);
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

  it("resizes by the visual corner even when the extent is stored top-first", () => {
    // Authored top-left → bottom-right: extent[0] holds the TOP (max y),
    // extent[1] the BOTTOM — the order OMEdit annotations commonly use.
    const topFirst: Shape = {
      kind: "rectangle",
      extent: [
        [-10, 10],
        [10, -10],
      ],
    };
    // Drag the visual top-right corner to (20, 20): the right edge → x=20 and
    // the top edge → y=20, holding left/bottom. A fixed-index map would move
    // the bottom edge instead and collapse the shape.
    const out = applyResize(
      withShapes([topFirst]),
      "shape:rectangle:0",
      "tr",
      20,
      20,
    );
    expect(ownShapes(out)[0]).toMatchObject({
      extent: [
        [-10, 20],
        [20, -10],
      ],
    });
  });

  it("rotates about the visual centre by rebasing origin (in place, not the diagram origin)", () => {
    // RECT_0 extent [[0,0],[10,10]] with no origin → visual centre (5,5).
    const out = applyRotation(withShapes([RECT_0]), ["shape:rectangle:0"], 90);
    expect(ownShapes(out)[0]).toMatchObject({
      origin: [5, 5],
      extent: [
        [-5, -5],
        [5, 5],
      ],
      rotation: 90,
    });
  });

  it("is idempotent at the same angle once the origin is already centred", () => {
    const once = applyRotation(withShapes([RECT_0]), ["shape:rectangle:0"], 90);
    expect(applyRotation(once, ["shape:rectangle:0"], 90)).toBe(once);
  });

  it("moves a rotated shape via origin so it translates along diagram axes", () => {
    const rotated: Shape = {
      kind: "rectangle",
      extent: [
        [-5, -5],
        [5, 5],
      ],
      origin: [5, 5],
      rotation: 90,
    };
    const out = applyDeltaMove(
      withShapes([rotated]),
      ["shape:rectangle:0"],
      10,
      -3,
    );
    // Origin shifts by the raw delta; extent (inside the rotation) is left be.
    expect(ownShapes(out)[0]).toMatchObject({
      origin: [15, 2],
      extent: [
        [-5, -5],
        [5, 5],
      ],
      rotation: 90,
    });
  });

  it("shapeCentre is the visual centre, including origin", () => {
    const centred: Shape = {
      kind: "rectangle",
      extent: [
        [-5, -5],
        [5, 5],
      ],
      origin: [5, 5],
    };
    expect(shapeCentre(withShapes([centred]), "shape:rectangle:0")).toEqual([
      5, 5,
    ]);
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

  it("context-menu rotate turns a shape ±90° about its centre", () => {
    const cw = applyRotate(withShapes([RECT_0]), ["shape:rectangle:0"], true);
    expect(ownShapes(cw)[0]).toMatchObject({
      origin: [5, 5],
      extent: [
        [-5, -5],
        [5, 5],
      ],
      rotation: 270,
    });
  });

  it("context-menu flip mirrors an extent shape and a poly in place", () => {
    const rect = applyFlip(withShapes([RECT_0]), ["shape:rectangle:0"], true);
    expect(ownShapes(rect)[0]).toMatchObject({
      extent: [
        [10, 0],
        [0, 10],
      ],
    });

    // LINE_1 points [[0,0],[10,0]] → bbox centre x=5; horizontal mirror swaps.
    const line = applyFlip(withShapes([LINE_1]), ["shape:line:0"], true);
    expect(ownShapes(line)[0]).toMatchObject({
      points: [
        [10, 0],
        [0, 0],
      ],
    });
  });

  it("ignores out-of-range and malformed shape keys without throwing", () => {
    const layout = withShapes([RECT_0]);
    expect(applyDeltaMove(layout, ["shape:rectangle:9"], 5, 5)).toBe(layout);
    expect(applyDelete(layout, ["shape:rectangle:"])).toBe(layout);
    expect(applyDeltaMove(layout, ["shape:rectangle:"], 5, 5)).toBe(layout);
  });
});

describe("poly vertex ops", () => {
  const POLY_3: Shape = {
    kind: "polygon",
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    lineColor: [0, 0, 0],
  };

  it("drags a vertex to a diagram point (origin-aware)", () => {
    const out = applyShapeVertexDrag(
      withShapes([LINE_1]),
      "shape:line:0",
      1,
      7,
      4,
    );
    expect(ownShapes(out)[0]).toMatchObject({
      points: [
        [0, 0],
        [7, 4],
      ],
    });
  });

  it("is a no-op dragging to the same spot or an out-of-range vertex", () => {
    const layout = withShapes([LINE_1]);
    expect(applyShapeVertexDrag(layout, "shape:line:0", 1, 10, 0)).toBe(layout);
    expect(applyShapeVertexDrag(layout, "shape:line:0", 9, 1, 1)).toBe(layout);
  });

  it("un-rotates the pointer when dragging a vertex on a rotated poly", () => {
    const rotated: Shape = {
      kind: "line",
      points: [
        [0, 0],
        [10, 0],
      ],
      rotation: 90,
    };
    // Vertex 1 renders at world (0,10) under the 90° rotation; dragging it to
    // (0,20) must map back to local (20,0), not the un-rotated (0,20).
    const out = applyShapeVertexDrag(
      withShapes([rotated]),
      "shape:line:0",
      1,
      0,
      20,
    );
    const moved = (ownShapes(out)[0] as { points: Point[] }).points[1];
    if (!moved) throw new Error("expected a moved vertex");
    expect(moved[0]).toBeCloseTo(20);
    expect(moved[1]).toBeCloseTo(0);
  });

  it("inserts a vertex on the nearest segment, splitting it", () => {
    // LINE_1 [[0,0],[10,0]]; a point near (5,1) projects onto the only segment.
    const out = applyShapeVertexInsert(withShapes([LINE_1]), "shape:line:0", {
      x: 5,
      y: 1,
    });
    expect(ownShapes(out)[0]).toMatchObject({
      points: [
        [0, 0],
        [5, 0],
        [10, 0],
      ],
    });
  });

  it("considers a polygon's closing edge when inserting", () => {
    // Near the closing edge (10,10)→(0,0); midpoint ~ (5,5).
    const out = applyShapeVertexInsert(
      withShapes([POLY_3]),
      "shape:polygon:0",
      {
        x: 5,
        y: 5,
      },
    );
    expect(ownShapes(out)[0]).toMatchObject({
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [5, 5],
      ],
    });
  });

  it("deletes a vertex but refuses to drop below the kind's minimum", () => {
    const poly4: Shape = {
      kind: "polygon",
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    };
    const out = applyShapeVertexDelete(
      withShapes([poly4]),
      "shape:polygon:0",
      1,
    );
    expect(ownShapes(out)[0]).toMatchObject({
      points: [
        [0, 0],
        [10, 10],
        [0, 10],
      ],
    });
    // A 3-vertex polygon is at its floor — deleting is refused.
    const atFloor = withShapes([POLY_3]);
    expect(applyShapeVertexDelete(atFloor, "shape:polygon:0", 0)).toBe(atFloor);
    // A line floors at 2.
    const line = withShapes([LINE_1]);
    expect(applyShapeVertexDelete(line, "shape:line:0", 0)).toBe(line);
  });

  it("toggles smooth between Bezier and straight", () => {
    const on = applyShapeSmoothToggle(withShapes([LINE_1]), "shape:line:0");
    expect(ownShapes(on)[0]).toMatchObject({ smooth: "Bezier" });
    const off = applyShapeSmoothToggle(on, "shape:line:0");
    expect(ownShapes(off)[0]).toMatchObject({ smooth: "None" });
  });

  it("no-ops on a non-poly or unresolvable key", () => {
    const layout = withShapes([RECT_0]);
    expect(applyShapeVertexDrag(layout, "shape:rectangle:0", 0, 1, 1)).toBe(
      layout,
    );
    expect(applyShapeVertexInsert(layout, "shape:line:9", { x: 0, y: 0 })).toBe(
      layout,
    );
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
    const { layout: next, key } = applyAddGraphic(layout, shape);
    expect(next.diagramLayers).toEqual([{ from: "Demo", shapes: [shape] }]);
    // Pure — the input layout is untouched.
    expect(layout.diagramLayers).toEqual([]);
    expect(key).toBe("shape:rectangle:0");
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
    const { layout: next, key } = applyAddGraphic(layout, shape);
    expect(next.diagramLayers.at(0)).toEqual({
      from: "Base",
      shapes: [inherited],
    });
    expect(next.diagramLayers.at(1)?.shapes).toEqual([shape]);
    expect(key).toBe("shape:rectangle:0");
  });

  it("keys the new shape past the host layer's existing shapes", () => {
    const layout = baseLayout();
    const existing = buildExtentShape("ellipse", [
      [1, 1],
      [2, 2],
    ]);
    layout.diagramLayers = [{ from: "Demo", shapes: [existing] }];
    const shape = buildExtentShape("rectangle", [
      [0, 0],
      [10, 10],
    ]);
    const { key } = applyAddGraphic(layout, shape);
    expect(key).toBe("shape:rectangle:1");
  });

  it("targets the layer the view edits", () => {
    // The layer follows `layout.kind`, so an icon view's draw cannot land on
    // the diagram layer by a caller passing the wrong one.
    const layout = { ...baseLayout(), kind: "icon" as const };
    const shape = buildExtentShape("rectangle", [
      [0, 0],
      [10, 10],
    ]);
    const { layout: next } = applyAddGraphic(layout, shape);
    expect(next.iconLayers).toEqual([{ from: "Demo", shapes: [shape] }]);
    expect(next.diagramLayers).toEqual([]);
  });
});

describe("applyDelete and attached connections", () => {
  it("deletes the wires attached to a deleted component", () => {
    // baseLayout's connection runs p -> R1.p. Nothing ever selects an edge
    // key, so leaving the wire behind orphans a `connect()` on a declaration
    // that no longer exists — invalid Modelica that OMC accepts silently.
    const next = applyDelete(baseLayout(), ["c:R1"]);
    expect(next.connections).toEqual([]);
  });

  it("deletes the wires attached to a deleted connector", () => {
    const next = applyDelete(baseLayout(), ["k:p"]);
    expect(next.connections).toEqual([]);
  });

  it("keeps a wire whose endpoints both survive", () => {
    const base = baseLayout();
    const next = applyDelete(base, ["c:C1"]);
    expect(next.connections).toHaveLength(1);
    expect(next.connections).toEqual(base.connections);
  });

  it("still honors an explicitly selected edge", () => {
    expect(applyDelete(baseLayout(), ["edge:0"]).connections).toEqual([]);
  });
});

describe("z-order", () => {
  const A: Shape = {
    kind: "rectangle",
    extent: [
      [0, 0],
      [1, 1],
    ],
  };
  const B: Shape = {
    kind: "rectangle",
    extent: [
      [2, 2],
      [3, 3],
    ],
  };
  const C: Shape = {
    kind: "rectangle",
    extent: [
      [4, 4],
      [5, 5],
    ],
  };

  describe("zOrderTarget", () => {
    it("sends front to the end and back to the start", () => {
      expect(zOrderTarget("front", 0, 3)).toBe(2);
      expect(zOrderTarget("back", 2, 3)).toBe(0);
    });

    it("steps one slot for forward and backward", () => {
      expect(zOrderTarget("forward", 0, 3)).toBe(1);
      expect(zOrderTarget("backward", 2, 3)).toBe(1);
    });

    it("returns null at the end a move would push past", () => {
      expect(zOrderTarget("front", 2, 3)).toBeNull();
      expect(zOrderTarget("forward", 2, 3)).toBeNull();
      expect(zOrderTarget("back", 0, 3)).toBeNull();
      expect(zOrderTarget("backward", 0, 3)).toBeNull();
    });

    it("returns null for an index outside the layer", () => {
      expect(zOrderTarget("front", 3, 3)).toBeNull();
      expect(zOrderTarget("front", -1, 3)).toBeNull();
      expect(zOrderTarget("front", 0, 0)).toBeNull();
      // `parseShapeId` fails closed to NaN for a malformed key, so NaN is the
      // reachable non-integer here — not a fractional index.
      expect(zOrderTarget("front", Number.NaN, 3)).toBeNull();
    });
  });

  describe("applyShapeReorder", () => {
    it("moves a shape to the end without touching the inherited layer", () => {
      const next = applyShapeReorder(withShapes([A, B, C]), 0, 2);
      expect(ownShapes(next)).toEqual([B, C, A]);
      expect(next.diagramLayers.at(0)?.from).toBe("Base");
      expect(next.diagramLayers.at(0)?.shapes).toHaveLength(1);
    });

    it("moves a shape to the start", () => {
      expect(ownShapes(applyShapeReorder(withShapes([A, B, C]), 2, 0))).toEqual(
        [C, A, B],
      );
    });

    it("returns the same layout for a no-op or out-of-range move", () => {
      const layout = withShapes([A, B]);
      expect(applyShapeReorder(layout, 1, 1)).toBe(layout);
      expect(applyShapeReorder(layout, 2, 0)).toBe(layout);
      expect(applyShapeReorder(layout, 0, 2)).toBe(layout);
      expect(applyShapeReorder(layout, -1, 0)).toBe(layout);
    });

    it("returns the same layout when the class has no own layer", () => {
      const layout = baseLayout();
      expect(applyShapeReorder(layout, 0, 1)).toBe(layout);
    });
  });

  describe("ownShapeCount", () => {
    it("counts only the host's own layer", () => {
      expect(ownShapeCount(withShapes([A, B, C]))).toBe(3);
      expect(ownShapeCount(baseLayout())).toBe(0);
    });
  });
});
