import { describe, expect, it } from "vitest";

import {
  DiagramLayoutSchema,
  IconLayerSchema,
  ShapeSchema,
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
