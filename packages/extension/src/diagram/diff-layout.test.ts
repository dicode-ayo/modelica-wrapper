import { describe, expect, it } from "vitest";
import type {
  BitmapShape,
  DiagramLayout,
  EllipseShape,
  LineShape,
  PolygonShape,
  RectangleShape,
  Shape,
  TextShape,
} from "@dicode/omc-client";

import {
  diffLayouts,
  isTrustedOnStaleBase,
  lineAnnotation,
  placementAnnotation,
  type LayoutEdit,
} from "./diff-layout.js";

/** `baseLayout()` always seeds exactly one connection; guard the index access. */
function firstConnection(
  layout: DiagramLayout,
): DiagramLayout["connections"][number] {
  const conn = layout.connections[0];
  if (conn === undefined) throw new Error("expected at least one connection");
  return conn;
}

function baseLayout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "T",
    source: { file: "T.mo", line: 1, column: 1 } as never,
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
            [20, 0],
            [40, 20],
          ],
        },
      },
    },
    connectors: {},
    connections: [
      {
        lhs: { component: "R1", port: "p" },
        rhs: { component: "C1", port: "n" },
        waypoints: [
          [0, 0],
          [20, 0],
        ],
      },
    ],
  };
}

describe("diffLayouts", () => {
  it("returns no edits when layouts are equal", () => {
    const a = baseLayout();
    const b = baseLayout();
    expect(diffLayouts(a, b)).toEqual([]);
  });

  it("emits componentPlacement when an extent moves", () => {
    const a = baseLayout();
    const b = baseLayout();
    b.components.R1!.placement = {
      extent: [
        [5, -5],
        [25, 5],
      ],
    };
    const edits = diffLayouts(a, b);
    expect(edits).toEqual([
      {
        kind: "componentPlacement",
        componentName: "R1",
        componentClass: "Modelica.Electrical.Resistor",
        transformation: {
          extent: [
            [5, -5],
            [25, 5],
          ],
        },
      },
    ]);
  });

  it("carries a placement origin on the move, since it adds to the extent", () => {
    // OMC's placement is origin + extent, so writing the extent alone moves
    // the entity by whatever its origin was — a rotated boundary connector
    // lands in the middle of the diagram.
    const a = baseLayout();
    const b = baseLayout();
    a.components.R1!.placement = {
      extent: [
        [20, -20],
        [-20, 20],
      ],
      origin: [0, -120],
      rotation: 270,
    };
    b.components.R1!.placement = {
      extent: [
        [25, -15],
        [-15, 25],
      ],
      origin: [0, -120],
      rotation: 270,
    };
    expect(diffLayouts(a, b)).toContainEqual({
      kind: "componentPlacement",
      componentName: "R1",
      componentClass: "Modelica.Electrical.Resistor",
      transformation: {
        extent: [
          [25, -15],
          [-15, 25],
        ],
        origin: [0, -120],
        rotation: 270,
      },
    });
  });

  it("emits an edit when only the origin moved", () => {
    const a = baseLayout();
    const b = baseLayout();
    a.components.R1!.placement = {
      ...a.components.R1!.placement,
      origin: [0, 0],
    };
    b.components.R1!.placement = {
      ...b.components.R1!.placement,
      origin: [0, 40],
    };
    const edits = diffLayouts(a, b);
    expect(edits).toHaveLength(1);
    const edit = edits[0];
    expect(edit?.kind).toBe("componentPlacement");
    if (edit?.kind === "componentPlacement") {
      expect(edit.transformation.origin).toEqual([0, 40]);
    }
  });

  it("emits no origin when the placement has none", () => {
    const a = baseLayout();
    const b = baseLayout();
    b.components.R1!.placement = {
      extent: [
        [5, -5],
        [25, 5],
      ],
    };
    const edit = diffLayouts(a, b).at(0);
    expect(edit?.kind).toBe("componentPlacement");
    if (edit?.kind === "componentPlacement") {
      expect("origin" in edit.transformation).toBe(false);
      expect(edit.iconTransformation).toBeUndefined();
    }
  });

  it("emits componentDeleted when a component disappears", () => {
    const a = baseLayout();
    const b = baseLayout();
    delete b.components.R1;
    expect(diffLayouts(a, b)).toContainEqual({
      kind: "componentDeleted",
      componentName: "R1",
    });
  });

  describe("standalone connector diffing", () => {
    function withConnector(
      name: string,
      extent: [[number, number], [number, number]],
      rotation?: number,
    ): DiagramLayout {
      const layout = baseLayout();
      layout.connectors = {
        [name]: {
          name,
          classRef: "Modelica.Electrical.Interfaces.Pin",
          placement: {
            extent,
            ...(rotation !== undefined ? { rotation } : {}),
          },
        },
      };
      return layout;
    }

    it("emits no edits when the connector is unchanged", () => {
      const a = withConnector("p", [
        [-5, -5],
        [5, 5],
      ]);
      const b = withConnector("p", [
        [-5, -5],
        [5, 5],
      ]);
      expect(diffLayouts(a, b)).toEqual([]);
    });

    it("emits componentDeleted when a connector disappears", () => {
      const a = withConnector("p", [
        [-5, -5],
        [5, 5],
      ]);
      const b = baseLayout();
      expect(diffLayouts(a, b)).toContainEqual({
        kind: "componentDeleted",
        componentName: "p",
      });
    });

    it("emits componentPlacement when a connector's extent changes", () => {
      const a = withConnector("p", [
        [-5, -5],
        [5, 5],
      ]);
      const b = withConnector("p", [
        [10, -5],
        [20, 5],
      ]);
      const edits = diffLayouts(a, b);
      expect(edits).toContainEqual({
        kind: "componentPlacement",
        componentName: "p",
        componentClass: "Modelica.Electrical.Interfaces.Pin",
        transformation: {
          extent: [
            [10, -5],
            [20, 5],
          ],
        },
      });
    });

    it("emits componentPlacement when a connector's rotation changes", () => {
      const a = withConnector(
        "p",
        [
          [-5, -5],
          [5, 5],
        ],
        0,
      );
      const b = withConnector(
        "p",
        [
          [-5, -5],
          [5, 5],
        ],
        90,
      );
      const edits = diffLayouts(a, b);
      expect(edits).toContainEqual({
        kind: "componentPlacement",
        componentName: "p",
        componentClass: "Modelica.Electrical.Interfaces.Pin",
        transformation: {
          extent: [
            [-5, -5],
            [5, 5],
          ],
          rotation: 90,
        },
      });
    });

    it("does not emit a delete for a connector that was never in prev", () => {
      const a = baseLayout();
      const b = withConnector("p", [
        [-5, -5],
        [5, 5],
      ]);
      const edits = diffLayouts(a, b);
      expect(edits.some((e) => e.kind === "componentDeleted")).toBe(false);
      expect(edits.some((e) => e.kind === "componentPlacement")).toBe(false);
    });
  });

  it("emits connectionAdded / connectionDeleted on endpoint mismatch", () => {
    const a = baseLayout();
    const b = baseLayout();
    b.connections = [
      {
        lhs: { component: "R1", port: "p" },
        rhs: { component: undefined, port: "out" },
        waypoints: [],
      },
    ];
    const edits = diffLayouts(a, b);
    expect(edits).toContainEqual({
      kind: "connectionDeleted",
      from: "R1.p",
      to: "C1.n",
    });
    expect(edits).toContainEqual({
      kind: "connectionAdded",
      from: "R1.p",
      to: "out",
      waypoints: [],
    });
  });

  it("emits connectionWaypoints when waypoints change but endpoints don't", () => {
    const a = baseLayout();
    const b = baseLayout();
    // Move R1: applyDeltaMove would translate the first waypoint
    // (anchored to R1) by the drag delta; the second is anchored to
    // unmoved C1.
    b.components.R1!.placement = {
      extent: [
        [-5, -5],
        [15, 5],
      ],
    };
    b.connections = [
      {
        lhs: { component: "R1", port: "p" },
        rhs: { component: "C1", port: "n" },
        waypoints: [
          [5, 0],
          [20, 0],
        ],
      },
    ];
    const edits = diffLayouts(a, b);
    expect(edits).toContainEqual({
      kind: "connectionWaypoints",
      from: "R1.p",
      to: "C1.n",
      waypoints: [
        [5, 0],
        [20, 0],
      ],
    });
    // The component move still fires as its own edit.
    expect(edits.some((e) => e.kind === "componentPlacement")).toBe(true);
    // And we don't double up by also emitting a delete + add for the
    // same (from, to) pair.
    expect(edits.some((e) => e.kind === "connectionDeleted")).toBe(false);
    expect(edits.some((e) => e.kind === "connectionAdded")).toBe(false);
  });

  it("keys connectionWaypoints by the subscripted cref for a vector-port endpoint", () => {
    // `connect(kinematicPTP.y[1], integrator.u)`: the `[1]` must survive into
    // the `from` cref, else `updateConnection` matches nothing and silently
    // drops the moved waypoints (the PID_Controller drag corruption).
    const a = baseLayout();
    a.connections = [
      {
        lhs: { component: "kinematicPTP", port: "y", portSubscripts: "[1]" },
        rhs: { component: "integrator", port: "u" },
        waypoints: [
          [-71, 30],
          [-65, 30],
        ],
      },
    ];
    const b = baseLayout();
    b.connections = [
      {
        lhs: { component: "kinematicPTP", port: "y", portSubscripts: "[1]" },
        rhs: { component: "integrator", port: "u" },
        waypoints: [
          [-71, 30],
          [-48, 30],
          [-48, 60],
          [-25, 60],
        ],
      },
    ];
    expect(diffLayouts(a, b)).toContainEqual({
      kind: "connectionWaypoints",
      from: "kinematicPTP.y[1]",
      to: "integrator.u",
      waypoints: [
        [-71, 30],
        [-48, 30],
        [-48, 60],
        [-25, 60],
      ],
    });
  });

  it("keys connectionWaypoints by the subscripted cref for a vector component", () => {
    // Subscript on the component part (`pins[3].p`) must survive into `from`
    // too, not just the port part.
    const mk = (waypoints: [number, number][]): DiagramLayout => {
      const l = baseLayout();
      l.connections = [
        {
          lhs: { component: "pins", port: "p", componentSubscripts: "[3]" },
          rhs: { component: "ground", port: "p" },
          waypoints,
        },
      ];
      return l;
    };
    expect(
      diffLayouts(
        mk([
          [0, 0],
          [10, 0],
        ]),
        mk([
          [0, 0],
          [10, 10],
        ]),
      ),
    ).toContainEqual({
      kind: "connectionWaypoints",
      from: "pins[3].p",
      to: "ground.p",
      waypoints: [
        [0, 0],
        [10, 10],
      ],
    });
  });

  it("does not emit connectionWaypoints when waypoints are unchanged", () => {
    const a = baseLayout();
    const b = baseLayout();
    expect(
      diffLayouts(a, b).some((e) => e.kind === "connectionWaypoints"),
    ).toBe(false);
  });

  it("carries the connection's style on connectionWaypoints so it survives the write (issue #219)", () => {
    const a = baseLayout();
    const styledConn = {
      ...firstConnection(a),
      color: [255, 0, 0] as [number, number, number],
      thickness: 0.5,
      pattern: "Dash",
    };
    a.connections[0] = styledConn;
    const b = baseLayout();
    // Same style, only the route changes (e.g. a component drag).
    b.connections = [
      {
        ...styledConn,
        waypoints: [
          [5, 0],
          [20, 0],
        ],
      },
    ];
    const edits = diffLayouts(a, b);
    const edit = edits.find((e) => e.kind === "connectionWaypoints");
    expect(edit).toMatchObject({
      style: { color: [255, 0, 0], thickness: 0.5, pattern: "Dash" },
    });
  });

  it("emits connectionWaypoints on a style-only change, even with waypoints unchanged", () => {
    const a = baseLayout();
    const b = baseLayout();
    b.connections = [{ ...firstConnection(b), color: [0, 255, 0] }];
    const edits = diffLayouts(a, b);
    expect(edits).toContainEqual({
      kind: "connectionWaypoints",
      from: "R1.p",
      to: "C1.n",
      waypoints: firstConnection(b).waypoints,
      style: { color: [0, 255, 0] },
    });
  });

  it("carries style on connectionAdded for a newly appearing styled connection", () => {
    const a = baseLayout();
    a.connections = [];
    const b = baseLayout();
    b.connections = [{ ...firstConnection(b), pattern: "Dot" }];
    const edits = diffLayouts(a, b);
    expect(edits).toContainEqual({
      kind: "connectionAdded",
      from: "R1.p",
      to: "C1.n",
      waypoints: firstConnection(b).waypoints,
      style: { pattern: "Dot" },
    });
  });

  describe("connectionRenamed (vector-port re-index, issue #26)", () => {
    // A connectorSizing re-index shifts an indexed endpoint
    // (pins[3].p → pins[2].p) while the other endpoint and the
    // waypoints carry over. The diff must collapse the would-be
    // delete+add into a single in-place rename.
    function vectorLayout(fromCref: string): DiagramLayout {
      const [comp, port] = fromCref.split(".");
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
            lhs: { component: comp, port: port! },
            rhs: { component: "ground", port: "p" },
            waypoints: [
              [0, 0],
              [10, 0],
            ],
          },
        ],
      };
    }

    it("collapses an indexed-endpoint shift into one connectionRenamed", () => {
      const a = vectorLayout("pins[3].p");
      const b = vectorLayout("pins[2].p");
      const edits = diffLayouts(a, b);
      expect(edits).toEqual([
        {
          kind: "connectionRenamed",
          oldFrom: "pins[3].p",
          oldTo: "ground.p",
          newFrom: "pins[2].p",
          newTo: "ground.p",
          waypoints: [
            [0, 0],
            [10, 0],
          ],
        },
      ]);
      // No more-disruptive delete+add pair.
      expect(edits.some((e) => e.kind === "connectionDeleted")).toBe(false);
      expect(edits.some((e) => e.kind === "connectionAdded")).toBe(false);
    });

    it("handles the indexed endpoint sitting on the `to` side", () => {
      const mk = (idx: number): DiagramLayout => {
        const l = vectorLayout("ground.p");
        l.connections = [
          {
            lhs: { component: "ground", port: "p" },
            rhs: { component: `pins[${idx}]`, port: "p" },
            waypoints: [[0, 0]],
          },
        ];
        return l;
      };
      const edits = diffLayouts(mk(3), mk(2));
      expect(edits).toEqual([
        {
          kind: "connectionRenamed",
          oldFrom: "ground.p",
          oldTo: "pins[3].p",
          newFrom: "ground.p",
          newTo: "pins[2].p",
          waypoints: [[0, 0]],
        },
      ]);
    });

    it("does NOT rename when the waypoints changed (re-drawn, not re-indexed)", () => {
      const a = vectorLayout("pins[3].p");
      const b = vectorLayout("pins[2].p");
      b.connections[0]!.waypoints = [
        [5, 5],
        [15, 5],
      ];
      const edits = diffLayouts(a, b);
      expect(edits.some((e) => e.kind === "connectionRenamed")).toBe(false);
      expect(edits).toContainEqual({
        kind: "connectionDeleted",
        from: "pins[3].p",
        to: "ground.p",
      });
      expect(edits).toContainEqual({
        kind: "connectionAdded",
        from: "pins[2].p",
        to: "ground.p",
        waypoints: [
          [5, 5],
          [15, 5],
        ],
      });
    });

    it("does NOT rename an unrelated endpoint swap (different base)", () => {
      const a = vectorLayout("pins[3].p");
      const b = vectorLayout("ports[1].p");
      const edits = diffLayouts(a, b);
      expect(edits.some((e) => e.kind === "connectionRenamed")).toBe(false);
      expect(edits.some((e) => e.kind === "connectionDeleted")).toBe(true);
      expect(edits.some((e) => e.kind === "connectionAdded")).toBe(true);
    });

    it("does NOT rename when BOTH endpoints changed", () => {
      const a = vectorLayout("pins[3].p");
      const b = vectorLayout("pins[2].p");
      // Also change the other endpoint, so it's not a single-endpoint
      // re-index any more.
      b.connections[0]!.rhs = { component: "ground2", port: "p" };
      const edits = diffLayouts(a, b);
      expect(edits.some((e) => e.kind === "connectionRenamed")).toBe(false);
    });

    // ── Cascade / swap safety (issue #76, item 7) ──────────────────────
    // Build a layout with N connections, each pins[idx].p ↔ ground.p.
    function multiVectorLayout(indices: number[]): DiagramLayout {
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
        connections: indices.map((i) => ({
          lhs: { component: `pins[${i}]`, port: "p" },
          rhs: { component: "ground", port: "p" },
          waypoints: [[0, 0] as [number, number]],
        })),
      };
    }

    it("does NOT collapse a cascade shift into a bogus single rename", () => {
      // pins[1],pins[2] → pins[2],pins[3]. A greedy matcher pairs
      // pins[1]→pins[3] and drops pins[2]'s move; the safe behaviour is
      // delete+add for the genuinely removed/added indices and no bogus
      // rename.
      const a = multiVectorLayout([1, 2]);
      const b = multiVectorLayout([2, 3]);
      const edits = diffLayouts(a, b);
      expect(edits.some((e) => e.kind === "connectionRenamed")).toBe(false);
      // pins[1] removed, pins[3] added; pins[2] survives verbatim.
      expect(edits).toContainEqual({
        kind: "connectionDeleted",
        from: "pins[1].p",
        to: "ground.p",
      });
      // Flagged cascadeRisk: this group had 2 `prev` members, so the
      // addition could be completing a rename a stale-base report never
      // fully saw — see the `cascadeRisk` describe block (issue #503).
      expect(edits).toContainEqual({
        kind: "connectionAdded",
        from: "pins[3].p",
        to: "ground.p",
        waypoints: [[0, 0]],
        cascadeRisk: true,
      });
      // The bogus pins[1]→pins[3] rename must NOT appear.
      expect(
        edits.some(
          (e) =>
            e.kind === "connectionRenamed" &&
            e.oldFrom === "pins[1].p" &&
            e.newFrom === "pins[3].p",
        ),
      ).toBe(false);
    });

    it("does NOT collapse a swap (pins[1]↔pins[2]) into renames", () => {
      // pins[1],pins[2] → pins[2],pins[1]: indices are the same set, so
      // nothing actually changed key-wise — both survive verbatim, no edits.
      const a = multiVectorLayout([1, 2]);
      const b = multiVectorLayout([2, 1]);
      const edits = diffLayouts(a, b);
      expect(edits.some((e) => e.kind === "connectionRenamed")).toBe(false);
    });

    it("does NOT collapse when a second connection shares the base (>1 per base)", () => {
      // Two connections on base pins.p in prev; one re-indexes. With more
      // than one connection on the base, fall back to delete+add.
      const a = multiVectorLayout([1, 5]);
      const b = multiVectorLayout([2, 5]); // pins[1]→pins[2], pins[5] stays
      const edits = diffLayouts(a, b);
      expect(edits.some((e) => e.kind === "connectionRenamed")).toBe(false);
      expect(edits).toContainEqual({
        kind: "connectionDeleted",
        from: "pins[1].p",
        to: "ground.p",
      });
      // Flagged cascadeRisk for the same reason as above: the base has 2
      // `prev` members, so the group isn't a clean 1:1 pair.
      expect(edits).toContainEqual({
        kind: "connectionAdded",
        from: "pins[2].p",
        to: "ground.p",
        waypoints: [[0, 0]],
        cascadeRisk: true,
      });
    });

    // ── Stale-base duplication (issue #503) ─────────────────────────────
    describe("cascadeRisk: connectionAdded from an ambiguous re-index group", () => {
      it("flags a cascade's connectionAdded", () => {
        // Cascade: 2 prev members on the same base+fixed-endpoint, 1 next —
        // exactly the shape issue #503 reports (a missed push means the
        // stale report never learned pins[2] existed at all). The "lone
        // re-draw" (1:1, not cascade risk) case is already covered by "does
        // NOT rename when the waypoints changed" above: its exact-match
        // `connectionAdded` assertion would fail if `cascadeRisk` leaked in.
        const cascadePrev = multiVectorLayout([1, 2]);
        const cascadeNext = multiVectorLayout([3]);
        const cascadeEdits = diffLayouts(cascadePrev, cascadeNext);
        const cascadeAdd = cascadeEdits.find(
          (e) => e.kind === "connectionAdded",
        );
        expect(cascadeAdd?.cascadeRisk).toBe(true);
      });

      it("isTrustedOnStaleBase distrusts a cascadeRisk addition but trusts a plain one", () => {
        expect(
          isTrustedOnStaleBase({
            kind: "connectionAdded",
            from: "pins[3].p",
            to: "ground.p",
            waypoints: [],
            cascadeRisk: true,
          }),
        ).toBe(false);
        expect(
          isTrustedOnStaleBase({
            kind: "connectionAdded",
            from: "a.x",
            to: "b.y",
            waypoints: [],
          }),
        ).toBe(true);
      });
    });
  });
});

describe("placementAnnotation", () => {
  it("emits a Placement with extent in {{x1,y1},{x2,y2}} form", () => {
    expect(
      placementAnnotation({
        transformation: {
          extent: [
            [-10, -5],
            [10, 5],
          ],
        },
      }),
    ).toBe("Placement(transformation(extent={{-10,-5},{10,5}}))");
  });

  it("includes rotation when non-zero", () => {
    expect(
      placementAnnotation({
        transformation: {
          extent: [
            [-10, -5],
            [10, 5],
          ],
          rotation: 90,
        },
      }),
    ).toBe("Placement(transformation(extent={{-10,-5},{10,5}}, rotation=90))");
  });

  it("re-emits origin and visible, which updateComponent would otherwise drop", () => {
    // `updateComponent` replaces the whole annotation, so a field left out
    // here is a field the declaration loses on its first move.
    expect(
      placementAnnotation({
        transformation: {
          extent: [
            [20, -20],
            [-20, 20],
          ],
          origin: [0, -120],
          rotation: 270,
          visible: false,
        },
      }),
    ).toBe(
      "Placement(visible=false, transformation(origin={0,-120}, extent={{20,-20},{-20,20}}, rotation=270))",
    );
  });

  it("emits a connector's second transformation under its own keyword", () => {
    expect(
      placementAnnotation({
        transformation: {
          extent: [
            [-140, -20],
            [-100, 20],
          ],
        },
        iconTransformation: {
          extent: [
            [-110, -10],
            [-90, 10],
          ],
        },
      }),
    ).toBe(
      "Placement(transformation(extent={{-140,-20},{-100,20}}), iconTransformation(extent={{-110,-10},{-90,10}}))",
    );
  });
});

describe("lineAnnotation", () => {
  it("returns empty string for no waypoints", () => {
    expect(lineAnnotation([])).toBe("");
  });

  it("emits Line(points={...}) with each waypoint", () => {
    expect(
      lineAnnotation([
        [0, 0],
        [10, 0],
        [10, 20],
      ]),
    ).toBe("Line(points={{0,0},{10,0},{10,20}})");
  });

  it("includes the full style alongside points (issue #219)", () => {
    expect(
      lineAnnotation(
        [
          [0, 0],
          [10, 0],
        ],
        {
          color: [255, 0, 0],
          thickness: 0.5,
          pattern: "Dash",
          arrow: ["None", "Filled"],
          arrowSize: 3,
          smooth: "Bezier",
        },
      ),
    ).toBe(
      "Line(points={{0,0},{10,0}},color={255,0,0},thickness=0.5," +
        "pattern=LinePattern.Dash,arrow={Arrow.None,Arrow.Filled}," +
        "arrowSize=3,smooth=Smooth.Bezier)",
    );
  });

  it("emits style fields even when waypoints are empty (auto-route + style)", () => {
    expect(lineAnnotation([], { color: [0, 0, 255] })).toBe(
      "Line(color={0,0,255})",
    );
  });

  it("still returns empty string when there are neither waypoints nor style", () => {
    expect(lineAnnotation([], {})).toBe("");
  });
});

describe("diffLayouts — graphics", () => {
  function rect(x: number): RectangleShape {
    return {
      kind: "rectangle",
      extent: [
        [x, x],
        [x + 10, x + 10],
      ],
    };
  }

  /** `baseLayout()` with one host-owned icon layer holding `shapes`. */
  function withIcon(shapes: Shape[], from = "T"): DiagramLayout {
    return { ...baseLayout(), iconLayers: [{ from, shapes }] };
  }

  it("emits no graphics edits when the shapes are unchanged", () => {
    expect(diffLayouts(withIcon([rect(0)]), withIcon([rect(0)]))).toEqual([]);
  });

  it("emits graphicsAdded for an appended shape", () => {
    const edits = diffLayouts(
      withIcon([rect(0)]),
      withIcon([rect(0), rect(20)]),
    );
    expect(edits).toEqual([
      { kind: "graphicsAdded", layer: "icon", shape: rect(20) },
    ]);
  });

  it("emits graphicsModified for a same-index change", () => {
    const edits = diffLayouts(withIcon([rect(0)]), withIcon([rect(5)]));
    expect(edits).toEqual([
      { kind: "graphicsModified", layer: "icon", index: 0, shape: rect(5) },
    ]);
  });

  it("treats a key-reordered, value-equal shape as unchanged", () => {
    const a: RectangleShape = {
      kind: "rectangle",
      extent: [
        [0, 0],
        [10, 10],
      ],
      lineColor: [1, 2, 3],
    };
    // Same values, different key order, plus a present-but-undefined optional.
    const b: RectangleShape = {
      lineColor: [1, 2, 3],
      extent: [
        [0, 0],
        [10, 10],
      ],
      kind: "rectangle",
      radius: undefined,
    };
    expect(diffLayouts(withIcon([a]), withIcon([b]))).toEqual([]);
  });

  describe("default-aware comparison (issue #415)", () => {
    /** What a drawn shape carries: only what the user actually chose. */
    const sparse: RectangleShape = {
      kind: "rectangle",
      extent: [
        [0, 0],
        [10, 10],
      ],
      lineColor: [1, 2, 3],
    };
    /** What OMC answers on re-read: `sparse` with every §18.6 default filled in. */
    const canonical: RectangleShape = {
      kind: "rectangle",
      extent: [
        [0, 0],
        [10, 10],
      ],
      lineColor: [1, 2, 3],
      fillColor: [0, 0, 0],
      pattern: "Solid",
      fillPattern: "None",
      lineThickness: 0.25,
      borderPattern: "None",
      radius: 0,
      visible: true,
      rotation: 0,
    };

    it("treats a sparse shape as unchanged against the canonical one OMC would answer", () => {
      expect(diffLayouts(withIcon([sparse]), withIcon([canonical]))).toEqual(
        [],
      );
    });

    it("still emits graphicsModified when a field differs from its spec default", () => {
      const changed: RectangleShape = {
        kind: "rectangle",
        extent: [
          [0, 0],
          [10, 10],
        ],
        fillPattern: "Solid", // spec default is "None"
      };
      const edits = diffLayouts(
        withIcon([{ kind: "rectangle", extent: changed.extent }]),
        withIcon([changed]),
      );
      expect(edits).toEqual([
        { kind: "graphicsModified", layer: "icon", index: 0, shape: changed },
      ]);
    });

    it("treats default-equal shapes as identical in the reorder path, not a spurious modify", () => {
      const b = rect(20);
      const edits = diffLayouts(
        withIcon([sparse, b]),
        withIcon([b, canonical]),
      );
      expect(edits).toEqual([
        { kind: "graphicsReordered", layer: "icon", from: 0, to: 1 },
      ]);
    });

    /** What a drawn Line carries: no arrow-editing UI exists, so `arrow` is never set. */
    const sparseLine: LineShape = {
      kind: "line",
      points: [
        [0, 0],
        [10, 10],
      ],
      color: [1, 2, 3],
    };
    /** What OMC answers on re-read: `sparseLine` with every §18.6 default filled in. */
    const canonicalLine: LineShape = {
      kind: "line",
      points: [
        [0, 0],
        [10, 10],
      ],
      color: [1, 2, 3],
      thickness: 0.25,
      pattern: "Solid",
      smooth: "None",
      arrow: ["None", "None"],
      arrowSize: 3,
      visible: true,
      rotation: 0,
    };

    it("treats a sparse Line as unchanged against the canonical one OMC would answer for arrow", () => {
      expect(
        diffLayouts(withIcon([sparseLine]), withIcon([canonicalLine])),
      ).toEqual([]);
    });

    it("still emits graphicsModified when Line.arrow differs from its spec default", () => {
      const changed: LineShape = {
        kind: "line",
        points: [
          [0, 0],
          [10, 10],
        ],
        arrow: ["Filled", "None"], // spec default is {Arrow.None, Arrow.None}
      };
      const edits = diffLayouts(
        withIcon([{ kind: "line", points: changed.points }]),
        withIcon([changed]),
      );
      expect(edits).toEqual([
        { kind: "graphicsModified", layer: "icon", index: 0, shape: changed },
      ]);
    });

    /** What a drawn Polygon carries: only what the user actually chose. */
    const sparsePolygon: PolygonShape = {
      kind: "polygon",
      points: [
        [0, 0],
        [10, 10],
        [20, 0],
      ],
      lineColor: [1, 2, 3],
    };
    /** What OMC answers on re-read: `sparsePolygon` with every §18.6 default filled in. */
    const canonicalPolygon: PolygonShape = {
      kind: "polygon",
      points: [
        [0, 0],
        [10, 10],
        [20, 0],
      ],
      lineColor: [1, 2, 3],
      fillColor: [0, 0, 0],
      pattern: "Solid",
      fillPattern: "None",
      lineThickness: 0.25,
      smooth: "None",
      visible: true,
      rotation: 0,
    };

    it("treats a sparse Polygon as unchanged against the canonical one OMC would answer", () => {
      expect(
        diffLayouts(withIcon([sparsePolygon]), withIcon([canonicalPolygon])),
      ).toEqual([]);
    });

    /** What a drawn full Ellipse carries: the angles are never set by the draw tool. */
    const sparseEllipse: EllipseShape = {
      kind: "ellipse",
      extent: [
        [0, 0],
        [10, 10],
      ],
      lineColor: [1, 2, 3],
    };
    /**
     * What OMC answers on re-read. `closure` comes back `"Chord"`, not
     * `"None"`: §18.6.5.5 defaults it by the angles, and this one spans 0–360.
     */
    const canonicalEllipse: EllipseShape = {
      kind: "ellipse",
      extent: [
        [0, 0],
        [10, 10],
      ],
      lineColor: [1, 2, 3],
      fillColor: [0, 0, 0],
      pattern: "Solid",
      fillPattern: "None",
      lineThickness: 0.25,
      startAngle: 0,
      endAngle: 360,
      closure: "Chord",
      visible: true,
      rotation: 0,
    };

    it("treats a sparse full Ellipse as unchanged against the canonical one OMC would answer", () => {
      expect(
        diffLayouts(withIcon([sparseEllipse]), withIcon([canonicalEllipse])),
      ).toEqual([]);
    });

    it("defaults a partial Ellipse's closure to Radial, not Chord", () => {
      const sparseArc: EllipseShape = {
        kind: "ellipse",
        extent: [
          [0, 0],
          [10, 10],
        ],
        startAngle: 0,
        endAngle: 180,
      };
      const canonicalArc: EllipseShape = {
        ...sparseArc,
        lineColor: [0, 0, 0],
        fillColor: [0, 0, 0],
        pattern: "Solid",
        fillPattern: "None",
        lineThickness: 0.25,
        closure: "Radial",
        visible: true,
        rotation: 0,
      };
      expect(
        diffLayouts(withIcon([sparseArc]), withIcon([canonicalArc])),
      ).toEqual([]);
    });

    it("still emits graphicsModified when Ellipse.closure differs from its angle-derived default", () => {
      const changed: EllipseShape = {
        kind: "ellipse",
        extent: [
          [0, 0],
          [10, 10],
        ],
        closure: "Radial", // a 0–360 ellipse defaults to Chord
      };
      const edits = diffLayouts(
        withIcon([{ kind: "ellipse", extent: changed.extent }]),
        withIcon([changed]),
      );
      expect(edits).toEqual([
        { kind: "graphicsModified", layer: "icon", index: 0, shape: changed },
      ]);
    });

    /** What a drawn Text carries: only what the user actually chose. */
    const sparseText: TextShape = {
      kind: "text",
      extent: [
        [0, 0],
        [10, 10],
      ],
      textString: "hello",
      textColor: [1, 2, 3],
    };
    /** What OMC answers on re-read: `sparseText` with every §18.6 default filled in. */
    const canonicalText: TextShape = {
      kind: "text",
      extent: [
        [0, 0],
        [10, 10],
      ],
      textString: "hello",
      textColor: [1, 2, 3],
      fontName: "",
      fontSize: 0,
      horizontalAlignment: "Center",
      textStyle: [],
      visible: true,
      rotation: 0,
    };

    it("treats a sparse Text as unchanged against the canonical one OMC would answer for textStyle", () => {
      expect(
        diffLayouts(withIcon([sparseText]), withIcon([canonicalText])),
      ).toEqual([]);
    });

    it("treats an unset Text.textColor as unchanged against OMC's sentinel", () => {
      const sparseUncolored: TextShape = {
        kind: "text",
        extent: [
          [0, 0],
          [10, 10],
        ],
        textString: "hello",
      };
      const canonicalUncolored: TextShape = {
        ...sparseUncolored,
        textColor: [-1, -1, -1],
        fontName: "",
        fontSize: 0,
        horizontalAlignment: "Center",
        textStyle: [],
        visible: true,
        rotation: 0,
      };
      expect(
        diffLayouts(
          withIcon([sparseUncolored]),
          withIcon([canonicalUncolored]),
        ),
      ).toEqual([]);
    });

    it("still emits graphicsModified when Text.textColor is set to explicit black", () => {
      const changed: TextShape = {
        kind: "text",
        extent: [
          [0, 0],
          [10, 10],
        ],
        textString: "hello",
        textColor: [0, 0, 0],
      };
      const edits = diffLayouts(
        withIcon([
          {
            kind: "text",
            extent: changed.extent,
            textString: changed.textString,
          },
        ]),
        withIcon([changed]),
      );
      expect(edits).toEqual([
        { kind: "graphicsModified", layer: "icon", index: 0, shape: changed },
      ]);
    });

    it("still emits graphicsModified when Text.textStyle differs from its spec default", () => {
      const changed: TextShape = {
        kind: "text",
        extent: [
          [0, 0],
          [10, 10],
        ],
        textString: "hello",
        textStyle: ["Bold"], // spec default is {}
      };
      const edits = diffLayouts(
        withIcon([
          {
            kind: "text",
            extent: changed.extent,
            textString: changed.textString,
          },
        ]),
        withIcon([changed]),
      );
      expect(edits).toEqual([
        { kind: "graphicsModified", layer: "icon", index: 0, shape: changed },
      ]);
    });

    /** What a drawn Bitmap carries: no Bitmap-drawing UI exists, but a
     *  shape-properties edit can submit an empty `fileName`. */
    const sparseBitmap: BitmapShape = {
      kind: "bitmap",
      extent: [
        [0, 0],
        [10, 10],
      ],
    };
    /** What OMC answers on re-read: `sparseBitmap` with every §18.6 default filled in. */
    const canonicalBitmap: BitmapShape = {
      kind: "bitmap",
      extent: [
        [0, 0],
        [10, 10],
      ],
      fileName: "",
      imageSource: "",
      visible: true,
      rotation: 0,
    };

    it("treats a sparse Bitmap as unchanged against the canonical one OMC would answer for fileName/imageSource", () => {
      expect(
        diffLayouts(withIcon([sparseBitmap]), withIcon([canonicalBitmap])),
      ).toEqual([]);
    });

    it("still emits graphicsModified when Bitmap.fileName differs from empty", () => {
      const changed: BitmapShape = {
        kind: "bitmap",
        extent: [
          [0, 0],
          [10, 10],
        ],
        fileName: "icon.png", // spec default is ""
      };
      const edits = diffLayouts(
        withIcon([{ kind: "bitmap", extent: changed.extent }]),
        withIcon([changed]),
      );
      expect(edits).toEqual([
        { kind: "graphicsModified", layer: "icon", index: 0, shape: changed },
      ]);
    });
  });

  describe("reorder (z-order editing)", () => {
    const a = rect(0);
    const b = rect(20);
    const c = rect(40);

    /**
     * Deliberately a hand-rolled splice rather than `moveWithin` from
     * @dicode/omc-client: this is the oracle the production move is checked
     * against, and sharing the implementation would make it tautological.
     */
    function applyMove<T>(arr: readonly T[], from: number, to: number): T[] {
      const out = [...arr];
      const [moved] = out.splice(from, 1);
      if (moved === undefined) throw new Error(`from index ${from} invalid`);
      out.splice(to, 0, moved);
      return out;
    }

    /** The sole reorder a diff produced; fails loudly on any other shape. */
    function soleReorder(edits: LayoutEdit[]): { from: number; to: number } {
      expect(edits).toHaveLength(1);
      const edit = edits[0];
      if (edit?.kind !== "graphicsReordered") {
        throw new Error(`expected graphicsReordered, got ${edit?.kind}`);
      }
      return { from: edit.from, to: edit.to };
    }

    it("emits one graphicsReordered for a send-to-back instead of N modifies", () => {
      // Positional scanning would call this three modifies, each a whole-array
      // rewrite that transiently duplicates a shape in the file.
      const edits = diffLayouts(withIcon([a, b, c]), withIcon([c, a, b]));
      expect(edits).toEqual([
        { kind: "graphicsReordered", layer: "icon", from: 2, to: 0 },
      ]);
    });

    it("emits one graphicsReordered for a bring-to-front", () => {
      const edits = diffLayouts(withIcon([a, b, c]), withIcon([b, c, a]));
      expect(edits).toEqual([
        { kind: "graphicsReordered", layer: "icon", from: 0, to: 2 },
      ]);
    });

    it("emits one graphicsReordered for an adjacent swap", () => {
      // A two-element swap has two equally correct encodings (0→1 and 1→0),
      // so pin the array it produces rather than one arbitrary pair.
      const { from, to } = soleReorder(
        diffLayouts(withIcon([a, b, c]), withIcon([b, a, c])),
      );
      expect(applyMove([a, b, c], from, to)).toEqual([b, a, c]);
    });

    it("reorders the diagram layer independently of the icon layer", () => {
      const prev: DiagramLayout = {
        ...baseLayout(),
        diagramLayers: [{ from: "T", shapes: [a, b] }],
      };
      const next: DiagramLayout = {
        ...baseLayout(),
        diagramLayers: [{ from: "T", shapes: [b, a] }],
      };
      const edits = diffLayouts(prev, next);
      expect(edits[0]).toMatchObject({
        kind: "graphicsReordered",
        layer: "diagram",
      });
      const { from, to } = soleReorder(edits);
      expect(applyMove([a, b], from, to)).toEqual([b, a]);
    });

    it("emits a reorder alongside another layer's add, each layer-scoped", () => {
      // `editRank` puts a reorder last on the claim that nothing in the batch
      // shifts the indices it addresses. That holds because indices are
      // layer-scoped, not because a reorder is emitted alone.
      const prev: DiagramLayout = {
        ...baseLayout(),
        iconLayers: [{ from: "T", shapes: [a, b] }],
        diagramLayers: [{ from: "T", shapes: [c] }],
      };
      const next: DiagramLayout = {
        ...baseLayout(),
        iconLayers: [{ from: "T", shapes: [b, a] }],
        diagramLayers: [{ from: "T", shapes: [c, rect(99)] }],
      };
      const edits = diffLayouts(prev, next);
      expect(edits).toHaveLength(2);
      expect(edits).toContainEqual({
        kind: "graphicsAdded",
        layer: "diagram",
        shape: rect(99),
      });
      const reorders = edits.filter((e) => e.kind === "graphicsReordered");
      expect(reorders).toHaveLength(1);
      expect(reorders[0]).toMatchObject({ layer: "icon" });
    });

    it("falls back to modifies when the change is not a permutation", () => {
      // Same length, but a value changed — no single move produces it.
      const edits = diffLayouts(withIcon([a, b]), withIcon([a, rect(99)]));
      expect(edits).toEqual([
        { kind: "graphicsModified", layer: "icon", index: 1, shape: rect(99) },
      ]);
    });

    it("detects every single move, and never encodes one that does not reproduce the array", () => {
      // The candidate pair is derived from the first and last differing index,
      // which is only obviously exhaustive for a move at one of those ends.
      // Enumerate instead: every single move must be found, and any move
      // reported for an arbitrary permutation must reproduce it exactly.
      for (let n = 2; n <= 6; n += 1) {
        const shapes = Array.from({ length: n }, (_, i) => rect(i * 10));
        for (let from = 0; from < n; from += 1) {
          for (let to = 0; to < n; to += 1) {
            const after = applyMove(shapes, from, to);
            if (after.every((s, i) => s === shapes[i])) continue;
            const move = soleReorder(
              diffLayouts(withIcon(shapes), withIcon(after)),
            );
            expect(applyMove(shapes, move.from, move.to)).toEqual(after);
          }
        }
      }
    });

    it("falls back to modifies when a permutation needs more than one move", () => {
      // [a,b,c,d] → [b,a,d,c] is two independent swaps.
      const d = rect(60);
      const edits = diffLayouts(withIcon([a, b, c, d]), withIcon([b, a, d, c]));
      expect(edits.every((e) => e.kind === "graphicsModified")).toBe(true);
      expect(edits).toHaveLength(4);
    });
  });

  it("emits graphicsDeleted (descending) for trailing removals", () => {
    const edits = diffLayouts(
      withIcon([rect(0), rect(20), rect(40)]),
      withIcon([rect(0)]),
    );
    expect(edits).toEqual([
      { kind: "graphicsDeleted", layer: "icon", index: 2 },
      { kind: "graphicsDeleted", layer: "icon", index: 1 },
    ]);
  });

  it("emits minimal deletes for a non-contiguous multi-delete (pure deletion)", () => {
    // Delete indices 1 and 3 of [A,B,C,D], keeping A and C. LCS detects that
    // rect(0) and rect(40) survive and emits only two targeted deletes (in
    // descending order) rather than a shift-modify + trailing deletes.
    const edits = diffLayouts(
      withIcon([rect(0), rect(20), rect(40), rect(60)]),
      withIcon([rect(0), rect(40)]),
    );
    expect(edits).toEqual([
      { kind: "graphicsDeleted", layer: "icon", index: 3 },
      { kind: "graphicsDeleted", layer: "icon", index: 1 },
    ]);
  });

  it("falls back to positional modifies when a deletion coincides with a shape change", () => {
    // rect(20) is removed AND rect(0) is edited to rect(5): mixed delete+modify.
    // isPureDeletion is false (rect(5) not in before), so the positional fallback
    // runs: scan the first after.length=2 positions for mods (modify(0,rect(5))
    // and modify(1,rect(40))), then delete the one trailing slot (delete(2)).
    const edits = diffLayouts(
      withIcon([rect(0), rect(20), rect(40)]),
      withIcon([rect(5), rect(40)]),
    );
    expect(edits).toEqual([
      { kind: "graphicsModified", layer: "icon", index: 0, shape: rect(5) },
      { kind: "graphicsModified", layer: "icon", index: 1, shape: rect(40) },
      { kind: "graphicsDeleted", layer: "icon", index: 2 },
    ]);
  });

  it("emits a single delete for a non-contiguous single-shape removal", () => {
    // Remove the middle shape from three: LCS matches the outer two.
    const edits = diffLayouts(
      withIcon([rect(0), rect(20), rect(40)]),
      withIcon([rect(0), rect(40)]),
    );
    expect(edits).toEqual([
      { kind: "graphicsDeleted", layer: "icon", index: 1 },
    ]);
  });

  it("emits an independent modify per shape on a multi-select move", () => {
    // Two shapes moved at once: same length, two same-index value changes.
    const edits = diffLayouts(
      withIcon([rect(0), rect(20), rect(40)]),
      withIcon([rect(5), rect(20), rect(45)]),
    );
    expect(edits).toEqual([
      { kind: "graphicsModified", layer: "icon", index: 0, shape: rect(5) },
      { kind: "graphicsModified", layer: "icon", index: 2, shape: rect(45) },
    ]);
  });

  it("appends multiple shapes in ascending index order", () => {
    const edits = diffLayouts(withIcon([]), withIcon([rect(0), rect(20)]));
    expect(edits).toEqual([
      { kind: "graphicsAdded", layer: "icon", shape: rect(0) },
      { kind: "graphicsAdded", layer: "icon", shape: rect(20) },
    ]);
  });

  it("ignores inherited layers (only the host's own layer is editable)", () => {
    const prev = withIcon([rect(0)], "Ancestor");
    const next = withIcon([rect(0), rect(20)], "Ancestor");
    expect(diffLayouts(prev, next)).toEqual([]);
  });

  it("diffs the diagram layer independently of the icon layer", () => {
    const prev: DiagramLayout = {
      ...baseLayout(),
      diagramLayers: [{ from: "T", shapes: [rect(0)] }],
    };
    const next: DiagramLayout = {
      ...baseLayout(),
      diagramLayers: [{ from: "T", shapes: [rect(0), rect(20)] }],
    };
    expect(diffLayouts(prev, next)).toEqual([
      { kind: "graphicsAdded", layer: "diagram", shape: rect(20) },
    ]);
  });
});
