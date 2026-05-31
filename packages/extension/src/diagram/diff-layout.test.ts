import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

import {
  diffLayouts,
  lineAnnotation,
  placementAnnotation,
} from "./diff-layout.js";

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
});
