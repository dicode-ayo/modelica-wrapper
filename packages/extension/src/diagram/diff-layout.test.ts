import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@modelica-wrapper/omc-client";

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
        placement: { extent: [[-10, -5], [10, 5]] },
      },
      C1: {
        name: "C1",
        classRef: "Modelica.Electrical.Capacitor",
        placement: { extent: [[20, 0], [40, 20]] },
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
    b.components.R1!.placement = { extent: [[5, -5], [25, 5]] };
    const edits = diffLayouts(a, b);
    expect(edits).toEqual([
      {
        kind: "componentPlacement",
        componentName: "R1",
        componentClass: "Modelica.Electrical.Resistor",
        extent: [[5, -5], [25, 5]],
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
});

describe("placementAnnotation", () => {
  it("emits a Placement with extent in {{x1,y1},{x2,y2}} form", () => {
    expect(placementAnnotation([[-10, -5], [10, 5]], 0)).toBe(
      "Placement(transformation(extent={{-10,-5},{10,5}}))",
    );
  });

  it("includes rotation when non-zero", () => {
    expect(placementAnnotation([[0, 0], [10, 10]], 90)).toBe(
      "Placement(transformation(extent={{0,0},{10,10}}, rotation=90))",
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
});
