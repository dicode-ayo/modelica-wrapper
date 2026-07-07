import { describe, expect, it } from "vitest";
import type { DiagramLayout, RectangleShape } from "@dicode/omc-client";

import {
  diffLayouts,
  lineAnnotation,
  placementAnnotation,
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
        extent: [
          [5, -5],
          [25, 5],
        ],
        rotation: 0,
      },
    ]);
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
        extent: [
          [10, -5],
          [20, 5],
        ],
        rotation: 0,
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
        extent: [
          [-5, -5],
          [5, 5],
        ],
        rotation: 90,
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
      expect(edits).toContainEqual({
        kind: "connectionAdded",
        from: "pins[3].p",
        to: "ground.p",
        waypoints: [[0, 0]],
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
      expect(edits).toContainEqual({
        kind: "connectionAdded",
        from: "pins[2].p",
        to: "ground.p",
        waypoints: [[0, 0]],
      });
    });
  });
});

describe("placementAnnotation", () => {
  it("emits a Placement with extent in {{x1,y1},{x2,y2}} form", () => {
    expect(
      placementAnnotation(
        [
          [-10, -5],
          [10, 5],
        ],
        0,
      ),
    ).toBe("Placement(transformation(extent={{-10,-5},{10,5}}))");
  });

  it("includes rotation when non-zero", () => {
    expect(
      placementAnnotation(
        [
          [0, 0],
          [10, 10],
        ],
        90,
      ),
    ).toBe("Placement(transformation(extent={{0,0},{10,10}}, rotation=90))");
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
  function withIcon(shapes: RectangleShape[], from = "T"): DiagramLayout {
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
