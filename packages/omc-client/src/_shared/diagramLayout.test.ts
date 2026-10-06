import { describe, expect, it } from "vitest";

import {
  DiagramLayoutSchema,
  IconLayerSchema,
  layoutDependsOn,
  ShapeSchema,
  type ClassDef,
  type DiagramLayout,
} from "./diagramLayout.js";

const SOURCE = {
  filename: "<fixture>",
  lineStart: 1,
  columnStart: 1,
  lineEnd: 1,
  columnEnd: 1,
};

describe("DiagramLayoutSchema: round-trip on a minimal valid layout", () => {
  it("accepts an empty-shaped diagram with no components or connections", () => {
    const layout = {
      kind: "diagram" as const,
      className: "Foo.Bar",
      source: SOURCE,
      iconLayers: [],
      diagramLayers: [],
      labels: [],
      classes: {},
      components: {},
      connectors: {},
      connections: [],
    };
    const out = DiagramLayoutSchema.parse(layout);
    expect(out.kind).toBe("diagram");
    expect(out.className).toBe("Foo.Bar");
  });

  it("accepts a layout with one rectangle in an icon layer", () => {
    const layout = {
      kind: "icon" as const,
      className: "Foo.Bar",
      source: SOURCE,
      iconLayers: [
        {
          from: "Foo.Bar",
          shapes: [
            {
              kind: "rectangle" as const,
              extent: [
                [-10, -10],
                [10, 10],
              ],
              fillColor: [255, 255, 255],
            },
          ],
        },
      ],
      diagramLayers: [],
      labels: [],
      classes: {},
      components: {},
      connectors: {},
      connections: [],
    };
    expect(() => DiagramLayoutSchema.parse(layout)).not.toThrow();
  });

  it("accepts a connection with a single endpoint on the host class", () => {
    const layout = {
      kind: "diagram" as const,
      className: "Foo.Bar",
      source: SOURCE,
      iconLayers: [],
      diagramLayers: [],
      labels: [],
      classes: {},
      components: {},
      connectors: {},
      connections: [
        {
          lhs: { component: undefined, port: "u" },
          rhs: { component: "sub", port: "y" },
          waypoints: [
            [0, 0],
            [10, 10],
          ],
        },
      ],
    };
    const parsed = DiagramLayoutSchema.parse(layout);
    expect(parsed.connections).toHaveLength(1);
    expect(parsed.connections[0]?.lhs.component).toBeUndefined();
    expect(parsed.connections[0]?.lhs.port).toBe("u");
  });

  it("accepts a connection carrying full Line style fields (issue #219)", () => {
    const layout = {
      kind: "diagram" as const,
      className: "Foo.Bar",
      source: SOURCE,
      iconLayers: [],
      diagramLayers: [],
      labels: [],
      classes: {},
      components: {},
      connectors: {},
      connections: [
        {
          lhs: { component: undefined, port: "u" },
          rhs: { component: "sub", port: "y" },
          waypoints: [
            [0, 0],
            [10, 10],
          ],
          color: [255, 0, 0],
          thickness: 0.5,
          pattern: "Dash",
          arrow: ["None", "Filled"],
          arrowSize: 3,
          smooth: "Bezier",
        },
      ],
    };
    const parsed = DiagramLayoutSchema.parse(layout);
    expect(parsed.connections[0]).toMatchObject({
      thickness: 0.5,
      pattern: "Dash",
      arrow: ["None", "Filled"],
      arrowSize: 3,
      smooth: "Bezier",
    });
  });
});

describe("DiagramLayoutSchema: rejects malformed input", () => {
  it("rejects an unknown shape kind", () => {
    const bogus = {
      kind: "smiley",
      extent: [
        [0, 0],
        [1, 1],
      ],
    };
    expect(() => ShapeSchema.parse(bogus)).toThrow();
  });

  it("rejects an icon layer missing the required `from` field", () => {
    const layer = {
      shapes: [],
    };
    expect(() => IconLayerSchema.parse(layer)).toThrow();
  });

  it("rejects a component instance missing classRef on a layout", () => {
    const layout = {
      kind: "icon" as const,
      className: "Foo.Bar",
      source: SOURCE,
      iconLayers: [],
      diagramLayers: [],
      labels: [],
      classes: {},
      components: {
        sub: {
          name: "sub",
          // classRef intentionally omitted
          placement: {
            extent: [
              [0, 0],
              [10, 10],
            ],
          },
        },
      },
      connectors: {},
      connections: [],
    };
    expect(() => DiagramLayoutSchema.parse(layout)).toThrow();
  });

  it("rejects a connection whose waypoints are not number pairs", () => {
    const layout = {
      kind: "diagram" as const,
      className: "Foo.Bar",
      source: SOURCE,
      iconLayers: [],
      diagramLayers: [],
      labels: [],
      classes: {},
      components: {},
      connectors: {},
      connections: [
        {
          lhs: { component: "a", port: "x" },
          rhs: { component: "b", port: "y" },
          waypoints: [["nope" as unknown as number, 1]],
        },
      ],
    };
    expect(() => DiagramLayoutSchema.parse(layout)).toThrow();
  });
});

describe("layoutDependsOn", () => {
  const PLACEMENT = {
    extent: [
      [-10, -10],
      [10, 10],
    ] as [[number, number], [number, number]],
  };

  function host(classes: Record<string, ClassDef> = {}): DiagramLayout {
    return {
      kind: "diagram",
      className: "P.Host",
      source: SOURCE,
      iconLayers: [{ from: "P.HostBase", shapes: [] }],
      diagramLayers: [],
      labels: [],
      classes,
      components: {},
      connectors: {},
      connections: [],
    };
  }

  function classDef(name: string, overrides: Partial<ClassDef> = {}): ClassDef {
    return {
      name,
      restriction: "model",
      iconLayers: [],
      connectors: {},
      parameters: {},
      ...overrides,
    };
  }

  it("follows the host class and the ancestors drawing its layers", () => {
    expect(layoutDependsOn(host(), "P.Host")).toBe(true);
    expect(layoutDependsOn(host(), "P.HostBase")).toBe(true);
  });

  it("follows a catalogued type by its class name, not its catalog key", () => {
    const layout = host({ "P.Sub#1": classDef("P.Sub") });
    expect(layoutDependsOn(layout, "P.Sub")).toBe(true);
    expect(layoutDependsOn(layout, "P.Sub#1")).toBe(false);
  });

  it("follows a type's drawing ancestors and its ports' connector types", () => {
    const layout = host({
      sub: classDef("P.Sub", {
        iconLayers: [{ from: "P.SubBase", shapes: [] }],
        connectors: {
          u: {
            name: "u",
            typeName: "P.RealInput",
            placement: PLACEMENT,
            iconLayers: [{ from: "P.InputBase", shapes: [] }],
            from: "P.PortOwner",
          },
        },
      }),
    });
    for (const name of [
      "P.SubBase",
      "P.RealInput",
      "P.InputBase",
      "P.PortOwner",
    ]) {
      expect(layoutDependsOn(layout, name)).toBe(true);
    }
  });

  it("does not follow a class the layout was not built from", () => {
    expect(layoutDependsOn(host({ sub: classDef("P.Sub") }), "P.Else")).toBe(
      false,
    );
  });
});
