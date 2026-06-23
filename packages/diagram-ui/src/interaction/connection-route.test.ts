import { describe, expect, it } from "vitest";
import type {
  ClassDef,
  ConnectionLayout,
  DiagramLayout,
  PortDef,
} from "@dicode/omc-client";

import {
  endpointCentreFromLayout,
  resolveConnectionWaypoints,
} from "./connection-route.js";

// Minimal DiagramLayout with only the fields these helpers need.
function makeLayout(overrides: Partial<DiagramLayout> = {}): DiagramLayout {
  return {
    kind: "diagram",
    className: "Test",
    source: {
      filename: "test.mo",
      lineStart: 1,
      columnStart: 1,
      lineEnd: 1,
      columnEnd: 1,
    },
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {},
    components: {},
    connectors: {},
    connections: [],
    ...overrides,
  };
}

function makePortDef(extent: [[number, number], [number, number]]): PortDef {
  return {
    name: "p",
    typeName: "Test.Port",
    placement: { extent },
    iconLayers: [],
    from: "Test",
  };
}

function makeClassDef(
  connectors: Record<string, PortDef>,
  coordinateSystem?: ClassDef["coordinateSystem"],
): ClassDef {
  return {
    name: "Test.Comp",
    restriction: "model",
    iconLayers: [],
    connectors,
    parameters: {},
    ...(coordinateSystem !== undefined ? { coordinateSystem } : {}),
  };
}

describe("endpointCentreFromLayout", () => {
  it("returns the centre of a standalone connector placement", () => {
    const layout = makeLayout({
      connectors: {
        p: {
          name: "p",
          classRef: "Test.Port",
          placement: {
            extent: [
              [-5, -5],
              [5, 5],
            ],
          },
        },
      },
    });
    const result = endpointCentreFromLayout(layout, {
      component: undefined,
      port: "p",
    });
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it("accounts for origin on a standalone connector", () => {
    const layout = makeLayout({
      connectors: {
        p: {
          name: "p",
          classRef: "Test.Port",
          placement: {
            extent: [
              [-5, -5],
              [5, 5],
            ],
            origin: [10, 20],
          },
        },
      },
    });
    const result = endpointCentreFromLayout(layout, {
      component: undefined,
      port: "p",
    });
    expect(result).toEqual({ x: 10, y: 20 });
  });

  it("projects a component port to diagram space with no rotation", () => {
    // Component extent [-50,-50]→[50,50] centred at origin → 100×100 box.
    // Icon coord system is default 200×200, so scale = 0.5 each axis.
    // Port extent [-10,-10]→[10,10] → portIconX=0, portIconY=0 → diagram (0,0).
    const portDef = makePortDef([
      [-10, -10],
      [10, 10],
    ]);
    const classDef = makeClassDef({ p: portDef });
    const layout = makeLayout({
      components: {
        comp: {
          name: "comp",
          classRef: "Test.Comp",
          placement: {
            extent: [
              [-50, -50],
              [50, 50],
            ],
          },
        },
      },
      classes: { "Test.Comp": classDef },
    });
    const result = endpointCentreFromLayout(layout, {
      component: "comp",
      port: "p",
    });
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(0);
    expect(result!.y).toBeCloseTo(0);
  });

  it("projects a component port offset from the component centre", () => {
    // Component: [-50,-50]→[50,50], centre (0,0), 100×100.
    // Icon coord system: default 200×200, scale 0.5 each axis.
    // Port extent: [80,80]→[100,100] → portIconX=90, portIconY=90.
    // localX = 90 * 0.5 = 45, localY = 90 * 0.5 = 45.
    // No rotation → diagram (45, 45).
    const portDef = makePortDef([
      [80, 80],
      [100, 100],
    ]);
    const classDef = makeClassDef({ p: portDef });
    const layout = makeLayout({
      components: {
        comp: {
          name: "comp",
          classRef: "Test.Comp",
          placement: {
            extent: [
              [-50, -50],
              [50, 50],
            ],
          },
        },
      },
      classes: { "Test.Comp": classDef },
    });
    const result = endpointCentreFromLayout(layout, {
      component: "comp",
      port: "p",
    });
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(45);
    expect(result!.y).toBeCloseTo(45);
  });

  it("applies component rotation when projecting port to diagram space", () => {
    // Component centred at (0,0), no placement offset.
    // Port at portIconX=10, portIconY=0 (icon space), scale=1 (comp 200×200, icon 200×200).
    // localX=10, localY=0. Rotation=90° → cosR=0, sinR=1.
    // diagramX = 0 + 10*0 - 0*1 = 0
    // diagramY = 0 + 10*1 + 0*0 = 10
    const portDef = makePortDef([
      [5, -5],
      [15, 5],
    ]);
    const classDef = makeClassDef(
      { p: portDef },
      {
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
    );
    const layout = makeLayout({
      components: {
        comp: {
          name: "comp",
          classRef: "Test.Comp",
          placement: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
            rotation: 90,
          },
        },
      },
      classes: { "Test.Comp": classDef },
    });
    const result = endpointCentreFromLayout(layout, {
      component: "comp",
      port: "p",
    });
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(0);
    expect(result!.y).toBeCloseTo(10);
  });

  it("returns null when the component is missing", () => {
    const layout = makeLayout({
      components: {},
      classes: {},
    });
    const result = endpointCentreFromLayout(layout, {
      component: "missing",
      port: "p",
    });
    expect(result).toBeNull();
  });

  it("returns null when the port def is missing from the class", () => {
    const classDef = makeClassDef({});
    const layout = makeLayout({
      components: {
        comp: {
          name: "comp",
          classRef: "Test.Comp",
          placement: {
            extent: [
              [-50, -50],
              [50, 50],
            ],
          },
        },
      },
      classes: { "Test.Comp": classDef },
    });
    const result = endpointCentreFromLayout(layout, {
      component: "comp",
      port: "missing",
    });
    expect(result).toBeNull();
  });
});

describe("resolveConnectionWaypoints", () => {
  it("returns existing waypoints when two or more points are present", () => {
    const waypoints: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const conn: ConnectionLayout = {
      lhs: { component: undefined, port: "a" },
      rhs: { component: undefined, port: "b" },
      waypoints,
    };
    const layout = makeLayout();
    expect(resolveConnectionWaypoints(layout, conn)).toBe(waypoints);
  });

  it("generates an orthogonal route when waypoints are empty", () => {
    const layout = makeLayout({
      connectors: {
        a: {
          name: "a",
          classRef: "Test.Port",
          placement: {
            extent: [
              [-5, -5],
              [5, 5],
            ],
            origin: [0, 0],
          },
        },
        b: {
          name: "b",
          classRef: "Test.Port",
          placement: {
            extent: [
              [-5, -5],
              [5, 5],
            ],
            origin: [50, 50],
          },
        },
      },
    });
    const conn: ConnectionLayout = {
      lhs: { component: undefined, port: "a" },
      rhs: { component: undefined, port: "b" },
      waypoints: [],
    };
    const result = resolveConnectionWaypoints(layout, conn);
    // Orthogonal route always has >= 2 points.
    expect(result.length).toBeGreaterThanOrEqual(2);
    // First point is the lhs centre.
    expect(result[0]).toEqual([0, 0]);
    // Last point is the rhs centre.
    expect(result.at(-1)).toEqual([50, 50]);
  });

  it("returns empty array when endpoints cannot be resolved", () => {
    const layout = makeLayout();
    const conn: ConnectionLayout = {
      lhs: { component: "missing", port: "p" },
      rhs: { component: "alsoMissing", port: "q" },
      waypoints: [],
    };
    const result = resolveConnectionWaypoints(layout, conn);
    expect(result).toEqual([]);
  });
});
