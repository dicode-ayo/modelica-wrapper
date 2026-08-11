import type { DiagramLayout, Point, Shape } from "@dicode/omc-client";

/**
 * `DiagramLayout` builders shared by the pure op suites and by the mount
 * harness. DOM-free and renderer-free: importing this must not pull in
 * `<om-graphical-layout>`.
 */

export function emptyLayout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Demo",
    source: {
      filename: "Demo.mo",
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
  };
}

/** Two components, one standalone connector and one routed connection from
 *  the connector to `R1` — enough for every op that walks a layout. */
export function baseLayout(): DiagramLayout {
  return {
    ...emptyLayout(),
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

/** `baseLayout()` with the connection's waypoints replaced by `route`. */
export function withRoute(route: Point[]): DiagramLayout {
  const base = baseLayout();
  return {
    ...base,
    connections: base.connections.map((c) => ({ ...c, waypoints: route })),
  };
}

export const RECT_0: Shape = {
  kind: "rectangle",
  extent: [
    [0, 0],
    [10, 10],
  ],
  lineColor: [0, 0, 0],
};

export const LINE_1: Shape = {
  kind: "line",
  points: [
    [0, 0],
    [10, 0],
  ],
  color: [0, 0, 0],
};

/**
 * `baseLayout()` carrying host-own (`from === "Demo"`) diagram shapes, plus
 * an inherited (`from === "Base"`) layer that shape ops must never touch.
 */
export function withShapes(shapes: Shape[]): DiagramLayout {
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
export function ownShapes(layout: DiagramLayout): Shape[] {
  return layout.diagramLayers.find((l) => l.from === "Demo")?.shapes ?? [];
}
