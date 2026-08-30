/**
 * Tests for the DiagramLayout producer.
 *
 * No OMC contact, no on-disk fixtures. The producer is a pure function of
 * `ModelInstance`, so we synthesize a minimal `ModelInstance` literal that
 * exercises every behavior in one shot:
 *
 *  - host extends a base class that contributes its own Icon shapes
 *    (extends-chain icon walker)
 *  - host has standalone connectors `u`, `y` registered into the catalog
 *  - host has two sub-components of the same type (class-registry dedup),
 *    each with distinct modifiers (per-instance preservation)
 *  - host has a Real-typed parameter (`restriction: "type"`) that must be
 *    filtered out of `components`
 *  - sub-component class itself extends a base that defines connectors
 *    (extends-chain port walker)
 *  - host has three connections: two routed via `annotation.Line`, one
 *    equation-only (no annotation) that must be filtered
 *  - one routed connection's lhs is a 1-part cref (host port), the other's
 *    is a 2-part cref (sub-component port) — exercises both flatten cases
 *
 * The synthetic literal is round-tripped through `ModelInstanceSchema` so
 * any divergence between our hand-built shape and the schema fails the
 * test rather than the producer.
 */

import { describe, expect, it } from "vitest";

import {
  ModelInstanceSchema,
  type ConnectionNode,
  type ModelInstance,
} from "../../_shared/modelInstance.js";
import type {
  DiagramLayout,
  IconLayer,
  Placement,
  Shape,
} from "../../_shared/diagramLayout.js";
import { produceComponentClass, produceDiagramLayout } from "./producer.js";

// =====================================================================
// Synthetic ModelInstance builders.
// =====================================================================
//
// Modelica §18.6 records are positional, so each shape builder fills the
// full field list — even fields we don't care about — to keep the indexes
// the decoder expects in alignment.

const SOLID_LINE = { $kind: "enum", name: "LinePattern.Solid", index: 1 };
const SOLID_FILL = { $kind: "enum", name: "FillPattern.Solid", index: 1 };
const NO_BORDER = { $kind: "enum", name: "BorderPattern.None", index: 1 };
const NO_SMOOTH = { $kind: "enum", name: "Smooth.None", index: 1 };

function rectShape(extent: [[number, number], [number, number]]): unknown {
  return {
    $kind: "record",
    name: "Rectangle",
    elements: [
      true, // visible
      [0, 0], // origin
      0, // rotation
      [0, 0, 0], // lineColor
      [255, 255, 255], // fillColor
      SOLID_LINE, // pattern
      SOLID_FILL, // fillPattern
      1, // lineThickness
      NO_BORDER, // borderPattern
      extent, // extent
      0, // radius
    ],
  };
}

function polygonShape(points: [number, number][]): unknown {
  return {
    $kind: "record",
    name: "Polygon",
    elements: [
      true,
      [0, 0],
      0,
      [0, 0, 0],
      [128, 128, 128],
      SOLID_LINE,
      SOLID_FILL,
      1,
      points,
      NO_SMOOTH,
    ],
  };
}

function placementAnno(extent: [[number, number], [number, number]]): unknown {
  return { Placement: { transformation: { extent } } };
}

// ----- Class definitions used by Synth.Host -----

const RealInputClass: unknown = {
  name: "Synth.Interfaces.RealInput",
  restriction: "connector",
  annotation: {
    Icon: {
      coordinateSystem: {
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [
        polygonShape([
          [-100, 100],
          [100, 0],
          [-100, -100],
        ]),
      ],
    },
  },
};

const RealOutputClass: unknown = {
  name: "Synth.Interfaces.RealOutput",
  restriction: "connector",
  annotation: {
    Icon: {
      coordinateSystem: {
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [
        polygonShape([
          [-100, 100],
          [100, 0],
          [-100, -100],
        ]),
      ],
    },
  },
};

/** Host's base — contributes one Icon layer to Synth.Host's iconLayers. */
const BaseFrameClass: unknown = {
  name: "Synth.BaseFrame",
  restriction: "block",
  annotation: {
    Icon: {
      coordinateSystem: {
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [
        rectShape([
          [-100, -100],
          [100, 100],
        ]),
      ],
    },
  },
};

/** Gain's base — defines `u`/`y` connectors that Gain inherits. */
const GainBaseClass: unknown = {
  name: "Synth.GainBase",
  restriction: "block",
  elements: [
    {
      $kind: "component",
      name: "u",
      type: RealInputClass,
      annotation: placementAnno([
        [-110, -10],
        [-90, 10],
      ]),
    },
    {
      $kind: "component",
      name: "y",
      type: RealOutputClass,
      annotation: placementAnno([
        [90, -10],
        [110, 10],
      ]),
    },
  ],
};

/** Sub-component class with extends-chain connectors + own connector + own icon. */
const GainClass: unknown = {
  name: "Synth.Gain",
  restriction: "block",
  elements: [
    { $kind: "extends", baseClass: GainBaseClass },
    {
      $kind: "component",
      name: "kFF",
      type: RealInputClass,
      annotation: placementAnno([
        [-110, 40],
        [-90, 60],
      ]),
    },
  ],
  annotation: {
    Icon: {
      coordinateSystem: {
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [
        polygonShape([
          [-100, -50],
          [100, 0],
          [-100, 50],
        ]),
      ],
    },
  },
};

/** Sub-component class with no extends — direct connector declaration. */
const ProcessorClass: unknown = {
  name: "Synth.Processor",
  restriction: "block",
  elements: [
    {
      $kind: "component",
      name: "in_",
      type: RealInputClass,
      annotation: placementAnno([
        [-110, -10],
        [-90, 10],
      ]),
    },
  ],
  annotation: {
    Icon: {
      graphics: [
        rectShape([
          [-50, -50],
          [50, 50],
        ]),
      ],
    },
  },
};

/** A Modelica `type` alias. The producer must NOT register this as a sub-component. */
const TypeAlias: unknown = {
  name: "Synth.Units.Time",
  restriction: "type",
};

/** The host model under test. */
function makeHostModelInstance(): ModelInstance {
  const hostLiteral: unknown = {
    name: "Synth.Host",
    restriction: "model",
    annotation: {
      Icon: {
        coordinateSystem: {
          extent: [
            [-100, -100],
            [100, 100],
          ],
        },
        graphics: [
          polygonShape([
            [-50, -50],
            [50, -50],
            [0, 50],
          ]),
        ],
      },
      Diagram: {
        coordinateSystem: {
          extent: [
            [-100, -100],
            [100, 100],
          ],
        },
        graphics: [],
      },
    },
    elements: [
      // host extends base
      { $kind: "extends", baseClass: BaseFrameClass },
      // standalone connectors on host
      {
        $kind: "component",
        name: "u",
        type: RealInputClass,
        annotation: placementAnno([
          [-110, -10],
          [-90, 10],
        ]),
      },
      {
        $kind: "component",
        name: "y",
        type: RealOutputClass,
        annotation: placementAnno([
          [90, -10],
          [110, 10],
        ]),
      },
      // sub-components — two of the same type (dedup), one of another type
      {
        $kind: "component",
        name: "gain1",
        type: GainClass,
        modifiers: { k: "1" },
        annotation: placementAnno([
          [-50, -50],
          [-30, -30],
        ]),
      },
      {
        $kind: "component",
        name: "gain2",
        type: GainClass,
        modifiers: { k: "2" },
        annotation: placementAnno([
          [10, -50],
          [30, -30],
        ]),
      },
      {
        $kind: "component",
        name: "proc",
        type: ProcessorClass,
        annotation: placementAnno([
          [50, -50],
          [70, -30],
        ]),
      },
      // Modelica `type` alias — must be filtered from components
      { $kind: "component", name: "tau", type: TypeAlias },
    ],
    connections: [
      // routed: 1-part lhs (host port) → 2-part rhs (sub-component port)
      {
        lhs: { $kind: "cref", parts: [{ name: "u" }] },
        rhs: { $kind: "cref", parts: [{ name: "gain1" }, { name: "u" }] },
        annotation: {
          Line: {
            points: [
              [-90, 0],
              [-50, -40],
            ],
          },
        },
      },
      // unrouted: NO annotation — must be skipped
      {
        lhs: { $kind: "cref", parts: [{ name: "gain1" }, { name: "y" }] },
        rhs: { $kind: "cref", parts: [{ name: "gain2" }, { name: "u" }] },
      },
      // routed: 2-part lhs → 2-part rhs
      {
        lhs: { $kind: "cref", parts: [{ name: "gain2" }, { name: "y" }] },
        rhs: { $kind: "cref", parts: [{ name: "proc" }, { name: "in_" }] },
        annotation: {
          Line: {
            points: [
              [30, -40],
              [50, -40],
            ],
          },
        },
      },
    ],
  };
  return ModelInstanceSchema.parse(hostLiteral);
}

// =====================================================================
// Well-formedness helpers — walk a layout and assert every element
// carries the fields the renderer needs. Independent of any specific
// fixture's content.
// =====================================================================

function isXY(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number"
  );
}

function assertValidExtent(
  ext: unknown,
  ctx: string,
): asserts ext is [[number, number], [number, number]] {
  expect(Array.isArray(ext), `${ctx}: extent should be an array`).toBe(true);
  const arr = ext as unknown[];
  expect(arr.length, `${ctx}: extent should have 2 corners`).toBe(2);
  expect(isXY(arr[0]), `${ctx}: extent[0] should be [x, y]`).toBe(true);
  expect(isXY(arr[1]), `${ctx}: extent[1] should be [x, y]`).toBe(true);
}

function assertValidPlacement(p: Placement | undefined, ctx: string): void {
  expect(p, `${ctx}: placement is required`).toBeDefined();
  assertValidExtent(p?.extent, `${ctx}.placement`);
  if (p?.origin !== undefined) {
    expect(isXY(p.origin), `${ctx}.placement.origin should be [x, y]`).toBe(
      true,
    );
  }
  if (p?.rotation !== undefined) {
    expect(typeof p.rotation, `${ctx}.placement.rotation`).toBe("number");
  }
}

function assertValidShape(s: Shape, ctx: string): void {
  expect(typeof s.kind, `${ctx}: shape.kind required`).toBe("string");
  switch (s.kind) {
    case "line":
    case "polygon": {
      expect(Array.isArray(s.points), `${ctx}: ${s.kind}.points required`).toBe(
        true,
      );
      for (const [i, pt] of s.points.entries()) {
        expect(isXY(pt), `${ctx}: ${s.kind}.points[${i}] not [x, y]`).toBe(
          true,
        );
      }
      break;
    }
    case "rectangle":
    case "ellipse":
    case "bitmap":
      assertValidExtent(s.extent, `${ctx}: ${s.kind}`);
      break;
    case "text":
      assertValidExtent(s.extent, `${ctx}: text`);
      expect(s.textString, `${ctx}: text.textString required`).toBeDefined();
      break;
    default: {
      const _exhaustive: never = s;
      throw new Error(
        `${ctx}: unknown shape.kind ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

function assertValidIconLayer(layer: IconLayer, ctx: string): void {
  expect(typeof layer.from, `${ctx}: iconLayer.from required`).toBe("string");
  expect(layer.from.length, `${ctx}: iconLayer.from non-empty`).toBeGreaterThan(
    0,
  );
  expect(Array.isArray(layer.shapes), `${ctx}: iconLayer.shapes required`).toBe(
    true,
  );
  for (const [i, s] of layer.shapes.entries()) {
    assertValidShape(s, `${ctx}.shapes[${i}]`);
  }
}

function assertWellFormed(layout: DiagramLayout): void {
  expect(layout.kind === "icon" || layout.kind === "diagram").toBe(true);
  expect(typeof layout.className).toBe("string");
  expect(layout.className.length).toBeGreaterThan(0);

  for (const [i, l] of layout.iconLayers.entries()) {
    assertValidIconLayer(l, `iconLayers[${i}]`);
  }
  for (const [i, l] of layout.diagramLayers.entries()) {
    assertValidIconLayer(l, `diagramLayers[${i}]`);
  }

  for (const [name, comp] of Object.entries(layout.components)) {
    const ctx = `components[${name}]`;
    expect(comp.name, `${ctx}: name == key`).toBe(name);
    expect(typeof comp.classRef, `${ctx}: classRef`).toBe("string");
    expect(
      layout.classes[comp.classRef],
      `${ctx}: classRef ${comp.classRef} resolves`,
    ).toBeDefined();
    assertValidPlacement(comp.placement, ctx);
  }

  for (const [name, conn] of Object.entries(layout.connectors)) {
    const ctx = `connectors[${name}]`;
    expect(conn.name, `${ctx}: name == key`).toBe(name);
    expect(typeof conn.classRef, `${ctx}: classRef`).toBe("string");
    expect(
      layout.classes[conn.classRef],
      `${ctx}: classRef ${conn.classRef} resolves`,
    ).toBeDefined();
    assertValidPlacement(conn.placement, ctx);
  }

  for (const [key, cls] of Object.entries(layout.classes)) {
    const ctx = `classes[${key}]`;
    expect(cls.name, `${ctx}: name == key`).toBe(key);
    expect(typeof cls.restriction, `${ctx}: restriction`).toBe("string");
    expect(cls.restriction.length).toBeGreaterThan(0);
    expect(Array.isArray(cls.iconLayers), `${ctx}: iconLayers`).toBe(true);
    for (const [i, l] of cls.iconLayers.entries()) {
      assertValidIconLayer(l, `${ctx}.iconLayers[${i}]`);
    }
    for (const [pname, port] of Object.entries(cls.connectors)) {
      const pctx = `${ctx}.connectors[${pname}]`;
      expect(port.name, `${pctx}: name == key`).toBe(pname);
      expect(typeof port.typeName).toBe("string");
      expect(port.typeName.length).toBeGreaterThan(0);
      expect(typeof port.from).toBe("string");
      expect(port.from.length).toBeGreaterThan(0);
      assertValidPlacement(port.placement, pctx);
      expect(Array.isArray(port.iconLayers)).toBe(true);
      for (const [i, l] of port.iconLayers.entries()) {
        assertValidIconLayer(l, `${pctx}.iconLayers[${i}]`);
      }
    }
  }

  for (const [i, c] of layout.connections.entries()) {
    const ctx = `connections[${i}]`;
    expect(typeof c.lhs.port, `${ctx}.lhs.port`).toBe("string");
    expect(c.lhs.port.length).toBeGreaterThan(0);
    expect(typeof c.rhs.port, `${ctx}.rhs.port`).toBe("string");
    expect(c.rhs.port.length).toBeGreaterThan(0);
    if (c.lhs.component !== undefined) {
      expect(typeof c.lhs.component).toBe("string");
      expect(c.lhs.component.length).toBeGreaterThan(0);
    }
    if (c.rhs.component !== undefined) {
      expect(typeof c.rhs.component).toBe("string");
      expect(c.rhs.component.length).toBeGreaterThan(0);
    }
    expect(Array.isArray(c.waypoints), `${ctx}.waypoints`).toBe(true);
    for (const [j, w] of c.waypoints.entries()) {
      expect(isXY(w), `${ctx}.waypoints[${j}] should be [x, y]`).toBe(true);
    }
  }
}

// =====================================================================
// Tests
// =====================================================================

describe("produceDiagramLayout: icon layers", () => {
  it("collects host's own icon plus ancestor layer in draw order", () => {
    const layout = produceDiagramLayout(makeHostModelInstance(), "icon");

    expect(layout.kind).toBe("icon");
    expect(layout.className).toBe("Synth.Host");

    // post-order: ancestors first, host last (so host paints on top)
    expect(layout.iconLayers.map((l) => l.from)).toEqual([
      "Synth.BaseFrame",
      "Synth.Host",
    ]);

    // host contributes its polygon, base contributes its rectangle
    const host = layout.iconLayers.find((l) => l.from === "Synth.Host");
    expect(host?.shapes.map((s) => s.kind)).toEqual(["polygon"]);

    const base = layout.iconLayers.find((l) => l.from === "Synth.BaseFrame");
    expect(base?.shapes.map((s) => s.kind)).toEqual(["rectangle"]);
  });
});

describe("produceDiagramLayout: standalone connectors", () => {
  it("registers host ports `u`/`y` and resolves classRef into the catalog", () => {
    const layout = produceDiagramLayout(makeHostModelInstance(), "icon");

    expect(Object.keys(layout.connectors).sort()).toEqual(["u", "y"]);
    expect(layout.connectors.u?.classRef).toBe("Synth.Interfaces.RealInput");
    expect(layout.connectors.y?.classRef).toBe("Synth.Interfaces.RealOutput");

    const realInput = layout.classes["Synth.Interfaces.RealInput"];
    expect(realInput).toBeDefined();
    expect(realInput?.iconLayers.length).toBeGreaterThan(0);

    const realOutput = layout.classes["Synth.Interfaces.RealOutput"];
    expect(realOutput).toBeDefined();
    expect(realOutput?.iconLayers.length).toBeGreaterThan(0);
  });
});

describe("produceDiagramLayout: sub-component instances", () => {
  it("registers each named sub-component", () => {
    const layout = produceDiagramLayout(makeHostModelInstance(), "icon");
    expect(Object.keys(layout.components).sort()).toEqual([
      "gain1",
      "gain2",
      "proc",
    ]);
  });

  it("filters out type-alias components (restriction='type')", () => {
    const layout = produceDiagramLayout(makeHostModelInstance(), "icon");
    expect(layout.components.tau).toBeUndefined();
    expect(layout.classes["Synth.Units.Time"]).toBeUndefined();
  });
});

describe("produceDiagramLayout: class-registry dedup", () => {
  it("collapses two Gain instances to one catalog entry", () => {
    const layout = produceDiagramLayout(makeHostModelInstance(), "icon");

    const gain1 = layout.components.gain1;
    const gain2 = layout.components.gain2;
    expect(gain1?.classRef).toBe("Synth.Gain");
    expect(gain1?.classRef).toBe(gain2?.classRef);
    expect(layout.classes["Synth.Gain"]).toBeDefined();
  });

  it("preserves modifiers per-instance even when classRef is shared", () => {
    const layout = produceDiagramLayout(makeHostModelInstance(), "icon");
    expect(layout.components.gain1?.modifiers).toBeDefined();
    expect(layout.components.gain2?.modifiers).toBeDefined();
    // The two instances carry distinct modifier values.
    expect(layout.components.gain1?.modifiers).not.toEqual(
      layout.components.gain2?.modifiers,
    );
  });
});

describe("produceDiagramLayout: connector list walks the extends chain", () => {
  it("Synth.Gain's connector list includes inherited (u, y) and own (kFF)", () => {
    const layout = produceDiagramLayout(makeHostModelInstance(), "icon");

    const gain = layout.classes["Synth.Gain"];
    expect(gain).toBeDefined();
    expect(Object.keys(gain?.connectors ?? {}).sort()).toEqual([
      "kFF",
      "u",
      "y",
    ]);

    // Provenance: u/y declared on the base; kFF on Synth.Gain itself.
    expect(gain?.connectors.u?.from).toBe("Synth.GainBase");
    expect(gain?.connectors.y?.from).toBe("Synth.GainBase");
    expect(gain?.connectors.kFF?.from).toBe("Synth.Gain");
  });
});

describe("produceDiagramLayout: connection filter and cref flatten", () => {
  it("emits only connections that have an annotation.Line", () => {
    const layout = produceDiagramLayout(makeHostModelInstance(), "diagram");
    // 3 source connections; 1 has no annotation. Layout shows 2.
    expect(layout.connections).toHaveLength(2);
  });

  it("flattens 1-part cref to a host-port endpoint and 2-part cref to a component-port endpoint", () => {
    const layout = produceDiagramLayout(makeHostModelInstance(), "diagram");
    const first = layout.connections[0];
    expect(first?.lhs).toEqual({ component: undefined, port: "u" });
    expect(first?.rhs).toEqual({ component: "gain1", port: "u" });
  });

  it("every emitted connection has its full waypoint list", () => {
    const layout = produceDiagramLayout(makeHostModelInstance(), "diagram");
    for (const c of layout.connections) {
      expect(c.waypoints.length).toBeGreaterThan(0);
    }
  });
});

describe("produceDiagramLayout: connection filter on edge cases", () => {
  /** A two-port component type so `a.p` / `b.p` resolve to a real port. */
  const TwoPortType: unknown = {
    name: "Synth.TwoPort",
    restriction: "model",
    annotation: {
      Icon: {
        coordinateSystem: {
          extent: [
            [-100, -100],
            [100, 100],
          ],
        },
        graphics: [],
      },
    },
    elements: [
      {
        $kind: "component",
        name: "p",
        type: RealInputClass,
        annotation: placementAnno([
          [-110, -10],
          [-90, 10],
        ]),
      },
    ],
  };

  /**
   * Build a tiny ModelInstance with components `a`/`b` (each a TwoPort) and
   * the given hand-crafted connections.
   */
  function withConnections(connections: ConnectionNode[]): ModelInstance {
    return ModelInstanceSchema.parse({
      name: "Synth.Tiny",
      restriction: "model",
      annotation: {
        Diagram: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
      },
      elements: [
        {
          $kind: "component",
          name: "a",
          type: TwoPortType,
          annotation: placementAnno([
            [-60, -10],
            [-40, 10],
          ]),
        },
        {
          $kind: "component",
          name: "b",
          type: TwoPortType,
          annotation: placementAnno([
            [40, -10],
            [60, 10],
          ]),
        },
      ],
      connections,
    });
  }

  it("normalizes a Line with no points to an empty waypoints array", () => {
    const layout = produceDiagramLayout(
      withConnections([
        {
          lhs: { $kind: "cref", parts: [{ name: "a" }, { name: "p" }] },
          rhs: { $kind: "cref", parts: [{ name: "b" }, { name: "p" }] },
          annotation: { Line: {} } as unknown as ConnectionNode["annotation"],
        },
      ]),
      "diagram",
    );
    expect(layout.connections).toHaveLength(1);
    expect(layout.connections[0]?.waypoints).toEqual([]);
  });

  it("surfaces the connection's annotation.Line.color", () => {
    const layout = produceDiagramLayout(
      withConnections([
        {
          lhs: { $kind: "cref", parts: [{ name: "a" }, { name: "p" }] },
          rhs: { $kind: "cref", parts: [{ name: "b" }, { name: "p" }] },
          annotation: {
            Line: { points: [], color: [0, 0, 127] },
          } as unknown as ConnectionNode["annotation"],
        },
      ]),
      "diagram",
    );
    expect(layout.connections[0]?.color).toEqual([0, 0, 127]);
  });

  it("omits color when the Line has none or it is malformed", () => {
    const layout = produceDiagramLayout(
      withConnections([
        {
          lhs: { $kind: "cref", parts: [{ name: "a" }, { name: "p" }] },
          rhs: { $kind: "cref", parts: [{ name: "b" }, { name: "p" }] },
          annotation: {
            Line: { points: [] },
          } as unknown as ConnectionNode["annotation"],
        },
        {
          lhs: { $kind: "cref", parts: [{ name: "a" }, { name: "p" }] },
          rhs: { $kind: "cref", parts: [{ name: "b" }, { name: "p" }] },
          annotation: {
            Line: { points: [], color: [0, 0] },
          } as unknown as ConnectionNode["annotation"],
        },
      ]),
      "diagram",
    );
    expect(layout.connections[0]?.color).toBeUndefined();
    expect(layout.connections[1]?.color).toBeUndefined();
  });

  it("surfaces thickness/pattern/arrow/arrowSize/smooth from annotation.Line (issue #219)", () => {
    const layout = produceDiagramLayout(
      withConnections([
        {
          lhs: { $kind: "cref", parts: [{ name: "a" }, { name: "p" }] },
          rhs: { $kind: "cref", parts: [{ name: "b" }, { name: "p" }] },
          annotation: {
            Line: {
              points: [],
              thickness: 0.5,
              pattern: { $kind: "enum", name: "LinePattern.Dash", index: 2 },
              arrow: [
                { $kind: "enum", name: "Arrow.None", index: 0 },
                { $kind: "enum", name: "Arrow.Filled", index: 1 },
              ],
              arrowSize: 3,
              smooth: { $kind: "enum", name: "Smooth.Bezier", index: 1 },
            },
          } as unknown as ConnectionNode["annotation"],
        },
      ]),
      "diagram",
    );
    expect(layout.connections[0]).toMatchObject({
      thickness: 0.5,
      pattern: "Dash",
      arrow: ["None", "Filled"],
      arrowSize: 3,
      smooth: "Bezier",
    });
  });

  it("omits the new style fields when the Line doesn't set them", () => {
    const layout = produceDiagramLayout(
      withConnections([
        {
          lhs: { $kind: "cref", parts: [{ name: "a" }, { name: "p" }] },
          rhs: { $kind: "cref", parts: [{ name: "b" }, { name: "p" }] },
          annotation: {
            Line: { points: [] },
          } as unknown as ConnectionNode["annotation"],
        },
      ]),
      "diagram",
    );
    const conn = layout.connections[0];
    expect(conn?.thickness).toBeUndefined();
    expect(conn?.pattern).toBeUndefined();
    expect(conn?.arrow).toBeUndefined();
    expect(conn?.arrowSize).toBeUndefined();
    expect(conn?.smooth).toBeUndefined();
  });
});

describe("produceDiagramLayout: connections to gated-out endpoints (issue #76, item 6)", () => {
  // Host with a conditional sub-component `cond` (gated false) and a kept
  // component `keep`, plus a sub-component `g` whose `support` port is gated.
  const KeptType: unknown = {
    name: "Synth.Kept",
    restriction: "model",
    annotation: {
      Icon: {
        coordinateSystem: {
          extent: [
            [-100, -100],
            [100, 100],
          ],
        },
        graphics: [],
      },
    },
    elements: [
      {
        $kind: "component",
        name: "p",
        type: RealInputClass,
        annotation: placementAnno([
          [-110, -10],
          [-90, 10],
        ]),
      },
    ],
  };
  const GainWithGatedPort: unknown = {
    name: "Synth.GainGatedPort",
    restriction: "block",
    annotation: {
      Icon: {
        coordinateSystem: {
          extent: [
            [-100, -100],
            [100, 100],
          ],
        },
        graphics: [],
      },
    },
    elements: [
      {
        $kind: "component",
        name: "u",
        type: RealInputClass,
        annotation: placementAnno([
          [-110, -10],
          [-90, 10],
        ]),
      },
      {
        $kind: "component",
        name: "support",
        type: RealInputClass,
        annotation: placementAnno([
          [-10, -110],
          [10, -90],
        ]),
        condition: false,
      },
    ],
  };

  function gatedHost(): ModelInstance {
    return ModelInstanceSchema.parse({
      name: "Synth.GatedHost",
      restriction: "model",
      annotation: {
        Diagram: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
      },
      elements: [
        {
          $kind: "component",
          name: "keep",
          type: KeptType,
          annotation: placementAnno([
            [-60, -10],
            [-40, 10],
          ]),
        },
        {
          $kind: "component",
          name: "cond",
          type: KeptType,
          annotation: placementAnno([
            [40, -10],
            [60, 10],
          ]),
          condition: false,
        },
        {
          $kind: "component",
          name: "g",
          type: GainWithGatedPort,
          annotation: placementAnno([
            [-10, 40],
            [10, 60],
          ]),
        },
      ],
      connections: [
        // Survives — both endpoints visible.
        {
          lhs: { $kind: "cref", parts: [{ name: "keep" }, { name: "p" }] },
          rhs: { $kind: "cref", parts: [{ name: "g" }, { name: "u" }] },
          annotation: {
            Line: {
              points: [
                [0, 0],
                [10, 10],
              ],
            },
          } as unknown as ConnectionNode["annotation"],
        },
        // Dropped — `cond` is a gated-out component.
        {
          lhs: { $kind: "cref", parts: [{ name: "keep" }, { name: "p" }] },
          rhs: { $kind: "cref", parts: [{ name: "cond" }, { name: "p" }] },
          annotation: {
            Line: {
              points: [
                [0, 0],
                [20, 20],
              ],
            },
          } as unknown as ConnectionNode["annotation"],
        },
        // Dropped — `g.support` is a gated-out port.
        {
          lhs: { $kind: "cref", parts: [{ name: "keep" }, { name: "p" }] },
          rhs: { $kind: "cref", parts: [{ name: "g" }, { name: "support" }] },
          annotation: {
            Line: {
              points: [
                [0, 0],
                [30, 30],
              ],
            },
          } as unknown as ConnectionNode["annotation"],
        },
      ],
    });
  }

  it("keeps only the connection whose endpoints all survived gating", () => {
    const layout = produceDiagramLayout(gatedHost(), "diagram");
    // `cond` is gone from components; `g.support` is in g.hiddenPorts.
    expect(Object.keys(layout.components).sort()).toEqual(["g", "keep"]);
    expect(layout.components.g!.hiddenPorts).toEqual(["support"]);
    // Exactly one connection survives: keep.p ↔ g.u.
    expect(layout.connections).toHaveLength(1);
    expect(layout.connections[0]!.lhs).toEqual({
      component: "keep",
      port: "p",
    });
    expect(layout.connections[0]!.rhs).toEqual({ component: "g", port: "u" });
  });
});

describe("produceDiagramLayout: class parameter defaults", () => {
  // SpringDamper-like class embedded as a sub-component of an outer
  // host. The producer only registers sub-component classes in the
  // catalog, so this is the only path that exercises `collectParameters`
  // on a class with the SpringDamper-style `c`/`d` parameters.
  const SpringDamperLike: unknown = {
    name: "Synth.SpringDamper",
    restriction: "model",
    elements: [
      // Plain Real parameter with a resolved binding.
      {
        $kind: "component",
        name: "c",
        type: "Real",
        modifiers: { unit: '"N.m/rad"', $value: "100" },
        value: { binding: 100 },
        prefixes: { variability: "parameter" },
        comment: "Spring constant",
      },
      // Parameter where the literal modifier expression is the only
      // source — no `value.binding` present.
      {
        $kind: "component",
        name: "d",
        type: "Real",
        modifiers: { $value: "0.5" },
        prefixes: { variability: "parameter" },
      },
      // Non-parameter component (variable). Must NOT appear in parameters.
      {
        $kind: "component",
        name: "phi_rel",
        type: "Real",
      },
    ],
  };

  function makeOuterWithSpringDamper(): ModelInstance {
    const literal: unknown = {
      name: "Synth.Outer",
      restriction: "model",
      elements: [
        {
          $kind: "component",
          name: "sd1",
          type: SpringDamperLike,
          annotation: placementAnno([
            [-10, -10],
            [10, 10],
          ]),
        },
      ],
    };
    return ModelInstanceSchema.parse(literal);
  }

  it("populates ClassDef.parameters with resolved bindings", () => {
    const layout = produceDiagramLayout(makeOuterWithSpringDamper(), "icon");
    const cls = layout.classes["Synth.SpringDamper"];
    expect(cls).toBeDefined();
    expect(cls?.parameters.c?.value).toBe("100");
  });

  it("falls back to the literal modifier $value when no binding exists", () => {
    const layout = produceDiagramLayout(makeOuterWithSpringDamper(), "icon");
    const cls = layout.classes["Synth.SpringDamper"];
    expect(cls?.parameters.d?.value).toBe("0.5");
  });

  it("does not include non-parameter components", () => {
    const layout = produceDiagramLayout(makeOuterWithSpringDamper(), "icon");
    const cls = layout.classes["Synth.SpringDamper"];
    expect(cls?.parameters.phi_rel).toBeUndefined();
  });

  it("strips surrounding quotes from unit modifiers", () => {
    const layout = produceDiagramLayout(makeOuterWithSpringDamper(), "icon");
    const cls = layout.classes["Synth.SpringDamper"];
    expect(cls?.parameters.c?.unit).toBe("N.m/rad");
  });

  it("walks the extends chain so inherited parameters are included", () => {
    const base: unknown = {
      name: "Synth.Base",
      restriction: "model",
      elements: [
        {
          $kind: "component",
          name: "useHeatPort",
          type: "Boolean",
          value: { binding: false },
          prefixes: { variability: "parameter" },
        },
      ],
    };
    const child: unknown = {
      name: "Synth.Child",
      restriction: "model",
      elements: [{ $kind: "extends", baseClass: base }],
    };
    const outer: unknown = {
      name: "Synth.OuterChild",
      restriction: "model",
      elements: [
        {
          $kind: "component",
          name: "c1",
          type: child,
          annotation: placementAnno([
            [-5, -5],
            [5, 5],
          ]),
        },
      ],
    };
    const layout = produceDiagramLayout(
      ModelInstanceSchema.parse(outer),
      "icon",
    );
    expect(layout.classes["Synth.Child"]?.parameters.useHeatPort?.value).toBe(
      "false",
    );
  });
});

describe("produceDiagramLayout: well-formedness", () => {
  it("icon layout: every element carries its required fields", () => {
    assertWellFormed(produceDiagramLayout(makeHostModelInstance(), "icon"));
  });

  it("diagram layout: every element carries its required fields", () => {
    assertWellFormed(produceDiagramLayout(makeHostModelInstance(), "diagram"));
  });
});

describe("produceDiagramLayout: conditional gating", () => {
  /**
   * Synthesize the shape OMC's `getModelInstance` actually emits: every
   * `if`-predicate has been pre-reduced to a Boolean literal (Modelica
   * §4.4.5 requires conditions to be parameter-expressible, so OMC can
   * always evaluate them at instantiation). The two literal shapes we
   * see live: `condition: false` and `condition: { binding: false }`.
   */
  function makeGuardedHost(opts: {
    pIn: boolean | { binding: boolean };
    pOut: boolean | { binding: boolean };
    x: boolean | { binding: boolean };
    y: boolean | { binding: boolean };
  }): ModelInstance {
    const inst: unknown = {
      $kind: "model",
      name: "Pkg.Guarded",
      restriction: "model",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
        Diagram: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
      },
      elements: [
        {
          $kind: "component",
          name: "pIn",
          type: RealInputClass,
          annotation: placementAnno([
            [-110, -10],
            [-90, 10],
          ]),
          condition: opts.pIn,
        },
        {
          $kind: "component",
          name: "pOut",
          type: RealOutputClass,
          annotation: placementAnno([
            [90, -10],
            [110, 10],
          ]),
          condition: opts.pOut,
        },
        {
          $kind: "component",
          name: "x",
          type: GainClass,
          modifiers: { k: "1" },
          annotation: placementAnno([
            [-50, -50],
            [-30, -30],
          ]),
          condition: opts.x,
        },
        {
          $kind: "component",
          name: "y",
          type: GainClass,
          modifiers: { k: "2" },
          annotation: placementAnno([
            [10, -50],
            [30, -30],
          ]),
          condition: opts.y,
        },
      ],
      connections: [],
    };
    return ModelInstanceSchema.parse(inst);
  }

  it("keeps every element when all predicates reduced to true", () => {
    const layout = produceDiagramLayout(
      makeGuardedHost({ pIn: true, pOut: true, x: true, y: true }),
      "diagram",
    );
    expect(Object.keys(layout.components).sort()).toEqual(["x", "y"]);
    expect(Object.keys(layout.connectors).sort()).toEqual(["pIn", "pOut"]);
  });

  it("hides sub-components whose `condition` reduced to literal `false`", () => {
    const layout = produceDiagramLayout(
      makeGuardedHost({ pIn: true, pOut: true, x: true, y: false }),
      "diagram",
    );
    expect(Object.keys(layout.components).sort()).toEqual(["x"]);
    expect(Object.keys(layout.connectors).sort()).toEqual(["pIn", "pOut"]);
  });

  it("hides standalone connectors whose `condition` reduced to literal `false`", () => {
    const layout = produceDiagramLayout(
      makeGuardedHost({ pIn: false, pOut: true, x: true, y: true }),
      "diagram",
    );
    expect(Object.keys(layout.connectors).sort()).toEqual(["pOut"]);
  });

  it("handles OMC's `{ binding: bool }` wrapper shape", () => {
    // OMC sometimes emits the reduced literal wrapped in a `Value`
    // record: `condition: { binding: false }`. Same outcome as bare.
    const layout = produceDiagramLayout(
      makeGuardedHost({
        pIn: { binding: true },
        pOut: { binding: false },
        x: { binding: false },
        y: { binding: true },
      }),
      "diagram",
    );
    expect(Object.keys(layout.components).sort()).toEqual(["y"]);
    expect(Object.keys(layout.connectors).sort()).toEqual(["pIn"]);
  });

  it("echoes resolvedParameters onto the output (for label substitution)", () => {
    // The resolvedParameters map is purely a renderer pass-through
    // now — gating reads the pre-reduced `condition` field directly.
    // Asserts the echo is still there for the label substitution path.
    const params = { driveAngle: "1.57", k: "100" };
    const layout = produceDiagramLayout(
      makeGuardedHost({ pIn: true, pOut: true, x: true, y: true }),
      "diagram",
      params,
    );
    expect(layout.resolvedParameters).toEqual(params);
  });

  it("defaults to visible when `condition` is an unreduced shape", () => {
    // OMC always reduces in practice, but if a future build ships an
    // unreduced shape (or a caller hand-builds a ModelInstance) we
    // default to visible — matches the form-side enable fallback.
    const layout = produceDiagramLayout(
      // Pass an object that isn't `{ binding: bool }` — the gate
      // should leave the element visible.
      makeGuardedHost({
        pIn: true,
        pOut: true,
        x: { binding: "unknown" } as unknown as { binding: boolean },
        y: true,
      }),
      "diagram",
    );
    expect(Object.keys(layout.components).sort()).toEqual(["x", "y"]);
  });

  it("hides per-instance ports whose type carries a literal `condition: false`", () => {
    // OMC's `getModelInstance` pre-reduces a sub-component's connector
    // predicates against the use-site modifiers — so a port like
    // `Torque.support` arrives with `condition: false` when the
    // surrounding component sets `useSupport=false`. Synthesize that
    // shape directly so the test doesn't depend on a fixture or OMC.
    const gainWithConditionalPort: unknown = {
      $kind: "model",
      name: "Pkg.GainWithSupport",
      restriction: "block",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
      },
      elements: [
        {
          $kind: "component",
          name: "u",
          type: RealInputClass,
          annotation: placementAnno([
            [-110, -10],
            [-90, 10],
          ]),
        },
        {
          $kind: "component",
          name: "support",
          type: RealInputClass,
          annotation: placementAnno([
            [-10, -110],
            [10, -90],
          ]),
          // OMC's pre-reduction: the predicate has been resolved to
          // a literal `false` at this use-site.
          condition: false,
        },
      ],
    };
    const hostLiteral: unknown = {
      $kind: "model",
      name: "Pkg.Host",
      restriction: "model",
      annotation: {
        Diagram: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
      },
      elements: [
        {
          $kind: "component",
          name: "g",
          type: gainWithConditionalPort,
          annotation: placementAnno([
            [-20, -20],
            [20, 20],
          ]),
        },
      ],
      connections: [],
    };
    const layout = produceDiagramLayout(
      ModelInstanceSchema.parse(hostLiteral),
      "diagram",
    );
    const inst = layout.components.g;
    expect(inst).toBeDefined();
    // The catalog still lists every port on the type — the class def
    // is shared across all instances, so we don't bake visibility in.
    expect(layout.classes["Pkg.GainWithSupport"]).toBeDefined();
    expect(
      Object.keys(layout.classes["Pkg.GainWithSupport"]!.connectors).sort(),
    ).toEqual(["support", "u"]);
    // But the instance carries `hiddenPorts` so the renderer can mask
    // the gated port for THIS instance only.
    expect(inst!.hiddenPorts).toEqual(["support"]);
  });

  it("hides per-instance ports whose `condition` is the wrapped `{ binding: false }` (issue #76, item 5)", () => {
    // Host-level component gating already handled both the bare `false`
    // and the wrapped Value form, but the per-port path only checked
    // `=== false` — so a `Torque(useSupport=false)` whose support.condition
    // arrived wrapped was wrongly rendered.
    const gainWithWrappedPort: unknown = {
      $kind: "model",
      name: "Pkg.GainWithSupport",
      restriction: "block",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
      },
      elements: [
        {
          $kind: "component",
          name: "u",
          type: RealInputClass,
          annotation: placementAnno([
            [-110, -10],
            [-90, 10],
          ]),
        },
        {
          $kind: "component",
          name: "support",
          type: RealInputClass,
          annotation: placementAnno([
            [-10, -110],
            [10, -90],
          ]),
          // The wrapped Value shape OMC sometimes emits.
          condition: { binding: false },
        },
      ],
    };
    const hostLiteral: unknown = {
      $kind: "model",
      name: "Pkg.Host",
      restriction: "model",
      annotation: {
        Diagram: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
      },
      elements: [
        {
          $kind: "component",
          name: "g",
          type: gainWithWrappedPort,
          annotation: placementAnno([
            [-20, -20],
            [20, 20],
          ]),
        },
      ],
      connections: [],
    };
    const layout = produceDiagramLayout(
      ModelInstanceSchema.parse(hostLiteral),
      "diagram",
    );
    expect(layout.components.g!.hiddenPorts).toEqual(["support"]);
  });
});

describe("produceDiagramLayout: array dimensions on sub-components", () => {
  /**
   * Build a host with one vector / matrix sub-component. OMC 1.26.7
   * serializes `dims` as `{ absyn: string[], typed: string[] }` on the
   * component element — see the live probe in the PR description.
   */
  function hostWithDims(dims: unknown): ModelInstance {
    const VectorType: unknown = {
      $kind: "model",
      name: "Pkg.PinArray",
      restriction: "block",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
      },
    };
    const compEl: Record<string, unknown> = {
      $kind: "component",
      name: "pins",
      type: VectorType,
      annotation: placementAnno([
        [-20, -20],
        [20, 20],
      ]),
    };
    if (dims !== undefined) compEl.dims = dims;
    const hostLiteral: unknown = {
      $kind: "model",
      name: "Pkg.Host",
      restriction: "model",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
      },
      elements: [compEl],
    };
    return ModelInstanceSchema.parse(hostLiteral);
  }

  it("surfaces the typed dimension sizes on the instance", () => {
    const layout = produceDiagramLayout(
      hostWithDims({ absyn: ["n"], typed: ["3"] }),
      "icon",
    );
    expect(layout.components.pins?.dims).toEqual(["3"]);
  });

  it("surfaces every dimension of a matrix component in declaration order", () => {
    const layout = produceDiagramLayout(
      hostWithDims({ absyn: ["2", "4"], typed: ["2", "4"] }),
      "icon",
    );
    expect(layout.components.pins?.dims).toEqual(["2", "4"]);
  });

  it("falls back to absyn dims when typed is missing", () => {
    const layout = produceDiagramLayout(hostWithDims({ absyn: ["k"] }), "icon");
    expect(layout.components.pins?.dims).toEqual(["k"]);
  });

  it("leaves dims undefined for a scalar component (no dims field)", () => {
    const layout = produceDiagramLayout(hostWithDims(undefined), "icon");
    expect(layout.components.pins?.dims).toBeUndefined();
  });
});

describe("produceDiagramLayout: parameter displayUnit", () => {
  function outerWithAngle(): ModelInstance {
    const AngleClass: unknown = {
      name: "Synth.HasAngle",
      restriction: "model",
      elements: [
        {
          $kind: "component",
          name: "a",
          type: "Real",
          // OMC emits displayUnit as a direct modifier field, quoted.
          modifiers: { displayUnit: '"deg"', $value: "1.57" },
          value: { binding: 1.57 },
          prefixes: { variability: "parameter" },
        },
        // Same shape but with no displayUnit modifier.
        {
          $kind: "component",
          name: "b",
          type: "Real",
          modifiers: { $value: "2.0" },
          prefixes: { variability: "parameter" },
        },
      ],
    };
    const outer: unknown = {
      name: "Synth.OuterAngle",
      restriction: "model",
      elements: [
        {
          $kind: "component",
          name: "c1",
          type: AngleClass,
          annotation: placementAnno([
            [-5, -5],
            [5, 5],
          ]),
        },
      ],
    };
    return ModelInstanceSchema.parse(outer);
  }

  it("surfaces displayUnit on the parameter def, unquoted", () => {
    const layout = produceDiagramLayout(outerWithAngle(), "icon");
    const cls = layout.classes["Synth.HasAngle"];
    expect(cls?.parameters.a?.displayUnit).toBe("deg");
  });

  it("leaves displayUnit undefined when not declared", () => {
    const layout = produceDiagramLayout(outerWithAngle(), "icon");
    const cls = layout.classes["Synth.HasAngle"];
    expect(cls?.parameters.b?.displayUnit).toBeUndefined();
  });

  it("registers the opened HOST class in classes with its own params (issue #76, item 10)", () => {
    // The host model itself declares a displayUnit parameter. Previously the
    // registry was seeded only from sub-component types, so the host's own
    // params never reached `classes` and the host-side displayUnit pass
    // skipped them. Now `classes[host]` must carry the host's parameters.
    const host: unknown = {
      name: "Synth.HostWithAngle",
      restriction: "model",
      annotation: {
        Diagram: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
      },
      elements: [
        {
          $kind: "component",
          name: "a",
          type: "Real",
          modifiers: { displayUnit: '"deg"', $value: "1.57" },
          value: { binding: 1.57 },
          prefixes: { variability: "parameter" },
        },
      ],
    };
    const layout = produceDiagramLayout(
      ModelInstanceSchema.parse(host),
      "diagram",
    );
    const cls = layout.classes["Synth.HostWithAngle"];
    expect(cls).toBeDefined();
    expect(cls?.parameters.a?.displayUnit).toBe("deg");
    expect(cls?.parameters.a?.unit ?? cls?.parameters.a?.value).toBeDefined();
  });
});

describe("produceDiagramLayout: primitivesVisible=false on extends annotation", () => {
  /**
   * A derived class that extends a base with Icon graphics, but suppresses the
   * base primitives via `IconMap(primitivesVisible=false)` on the extends clause.
   * The base's coord system is still inherited; only its shapes are hidden.
   */
  function makeHostWithHiddenBase(): ModelInstance {
    const baseClass: unknown = {
      name: "Synth.HiddenBase",
      restriction: "block",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [
            rectShape([
              [-100, -100],
              [100, 100],
            ]),
          ],
        },
      },
    };
    const literal: unknown = {
      name: "Synth.DerivedHidden",
      restriction: "model",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [
            rectShape([
              [-50, -50],
              [50, 50],
            ]),
          ],
        },
      },
      elements: [
        {
          $kind: "extends",
          baseClass,
          annotation: { IconMap: { primitivesVisible: false } },
        },
      ],
    };
    return ModelInstanceSchema.parse(literal);
  }

  it("omits base-class shapes when IconMap.primitivesVisible=false", () => {
    const layout = produceDiagramLayout(makeHostWithHiddenBase(), "icon");
    const base = layout.iconLayers.find((l) => l.from === "Synth.HiddenBase");
    expect(base?.shapes).toHaveLength(0);
  });

  it("still emits the suppressed base-class layer for its coord-system info", () => {
    const layout = produceDiagramLayout(makeHostWithHiddenBase(), "icon");
    const fromNames = layout.iconLayers.map((l) => l.from);
    expect(fromNames).toContain("Synth.HiddenBase");
  });

  it("leaves host-class shapes unaffected", () => {
    const layout = produceDiagramLayout(makeHostWithHiddenBase(), "icon");
    const host = layout.iconLayers.find(
      (l) => l.from === "Synth.DerivedHidden",
    );
    expect(host?.shapes).toHaveLength(1);
  });

  it("propagates suppression to deeper ancestors (A→B→C, B hides A)", () => {
    // C extends B extends A. B's extends-A annotation has primitivesVisible=false.
    // Both A and B's layers should have empty shapes when C is produced.
    const classA: unknown = {
      name: "Synth.A",
      restriction: "block",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [
            rectShape([
              [-100, -100],
              [100, 100],
            ]),
          ],
        },
      },
    };
    const classB: unknown = {
      name: "Synth.B",
      restriction: "block",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [
            rectShape([
              [-80, -80],
              [80, 80],
            ]),
          ],
        },
      },
      elements: [
        {
          $kind: "extends",
          baseClass: classA,
          annotation: { IconMap: { primitivesVisible: false } },
        },
      ],
    };
    const literal: unknown = {
      name: "Synth.C",
      restriction: "model",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [
            rectShape([
              [-50, -50],
              [50, 50],
            ]),
          ],
        },
      },
      elements: [{ $kind: "extends", baseClass: classB }],
    };
    const layout = produceDiagramLayout(
      ModelInstanceSchema.parse(literal),
      "icon",
    );
    const layerA = layout.iconLayers.find((l) => l.from === "Synth.A");
    const layerB = layout.iconLayers.find((l) => l.from === "Synth.B");
    const layerC = layout.iconLayers.find((l) => l.from === "Synth.C");
    expect(layerA?.shapes).toHaveLength(0);
    expect(layerB?.shapes).toHaveLength(1);
    expect(layerC?.shapes).toHaveLength(1);
  });

  it("shows base-class shapes when primitivesVisible is absent (default true)", () => {
    const baseClass: unknown = {
      name: "Synth.VisibleBase",
      restriction: "block",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [
            rectShape([
              [-100, -100],
              [100, 100],
            ]),
          ],
        },
      },
    };
    const literal: unknown = {
      name: "Synth.DerivedVisible",
      restriction: "model",
      annotation: {
        Icon: {
          coordinateSystem: {
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [],
        },
      },
      elements: [
        // No IconMap annotation — base shapes must show.
        { $kind: "extends", baseClass },
      ],
    };
    const layout = produceDiagramLayout(
      ModelInstanceSchema.parse(literal),
      "icon",
    );
    const base = layout.iconLayers.find((l) => l.from === "Synth.VisibleBase");
    expect(base?.shapes).toHaveLength(1);
  });
});

describe("produceDiagramLayout: parameter unit from type-alias chain (#71)", () => {
  // OMC inlines the SI type-alias chain on each `extends` element's
  // baseClass. `Angle` carries `unit="rad"` on its immediate extends;
  // `Inertia` only reaches `unit="kg.m2"` through a nested
  // `extends MomentOfInertia extends Real(unit="kg.m2")`.
  function outerWithSiParams(): ModelInstance {
    const angleType: unknown = {
      name: "Modelica.Units.SI.Angle",
      restriction: "type",
      elements: [
        {
          $kind: "extends",
          baseClass: "Real",
          modifiers: { unit: '"rad"', displayUnit: '"deg"' },
        },
      ],
    };
    const inertiaType: unknown = {
      name: "Modelica.Units.SI.Inertia",
      restriction: "type",
      elements: [
        {
          $kind: "extends",
          // baseClass is itself an inlined ModelInstance whose own
          // extends carries the unit — the nested-chain case.
          baseClass: {
            name: "Modelica.Units.SI.MomentOfInertia",
            restriction: "type",
            elements: [
              {
                $kind: "extends",
                baseClass: "Real",
                modifiers: { unit: '"kg.m2"' },
              },
            ],
          },
        },
      ],
    };
    const host: unknown = {
      name: "Synth.SiHost",
      restriction: "model",
      elements: [
        {
          $kind: "component",
          name: "a",
          type: angleType,
          modifiers: { displayUnit: '"deg"', $value: "1.57" },
          prefixes: { variability: "parameter" },
        },
        {
          $kind: "component",
          name: "J",
          type: inertiaType,
          modifiers: "1",
          value: { binding: 1 },
          prefixes: { variability: "parameter" },
        },
      ],
    };
    const outer: unknown = {
      name: "Synth.OuterSi",
      restriction: "model",
      elements: [
        {
          $kind: "component",
          name: "h1",
          type: host,
          annotation: placementAnno([
            [-5, -5],
            [5, 5],
          ]),
        },
      ],
    };
    return ModelInstanceSchema.parse(outer);
  }

  it("reads unit from the immediate type-alias extends (Angle → rad)", () => {
    const layout = produceDiagramLayout(outerWithSiParams(), "icon");
    const cls = layout.classes["Synth.SiHost"];
    expect(cls?.parameters.a?.unit).toBe("rad");
    expect(cls?.parameters.a?.displayUnit).toBe("deg");
  });

  it("reads unit from a nested type-alias chain (Inertia → kg.m2)", () => {
    const layout = produceDiagramLayout(outerWithSiParams(), "icon");
    const cls = layout.classes["Synth.SiHost"];
    expect(cls?.parameters.J?.unit).toBe("kg.m2");
    expect(cls?.parameters.J?.displayUnit).toBeUndefined();
  });
});

describe("produceComponentClass", () => {
  it("yields a self-contained class: own icon, coordinate system, and ports", () => {
    const def = produceComponentClass(GainClass as ModelInstance);

    expect(def.name).toBe("Synth.Gain");
    expect(def.restriction).toBe("block");
    expect(def.iconLayers.length).toBeGreaterThan(0);
    expect(def.coordinateSystem?.extent).toEqual([
      [-100, -100],
      [100, 100],
    ]);
    // Ports are inherited from GainBase; each carries its own icon so the
    // preview can draw it without a second fetch.
    expect(Object.keys(def.connectors).sort()).toEqual(["kFF", "u", "y"]);
    for (const port of Object.values(def.connectors)) {
      expect(port.iconLayers.length).toBeGreaterThan(0);
    }
  });
});

// =====================================================================
// Catalog icon fallback (issue #510) — a class whose visuals live only
// in its Diagram annotation still gets renderable catalog layers.
// =====================================================================

/** Connector whose graphics live ONLY in the Diagram annotation. */
const DiagramOnlyPinClass: unknown = {
  name: "Synth.Interfaces.DiagramOnlyPin",
  restriction: "connector",
  annotation: {
    Diagram: {
      coordinateSystem: {
        extent: [
          [-100, -100],
          [100, 100],
        ],
      },
      graphics: [
        rectShape([
          [-40, -40],
          [40, 40],
        ]),
      ],
    },
  },
};

/** Connector with distinct Icon and Diagram graphics. */
const DualLayerPinClass: unknown = {
  name: "Synth.Interfaces.DualLayerPin",
  restriction: "connector",
  annotation: {
    Icon: {
      graphics: [
        polygonShape([
          [-100, 100],
          [100, 0],
          [-100, -100],
        ]),
      ],
    },
    Diagram: {
      graphics: [
        rectShape([
          [-40, -40],
          [40, 40],
        ]),
      ],
    },
  },
};

function hostWithConnector(connectorClass: unknown): ModelInstance {
  return ModelInstanceSchema.parse({
    name: "Synth.FallbackHost",
    restriction: "model",
    elements: [
      {
        $kind: "component",
        name: "p",
        type: connectorClass,
        annotation: placementAnno([
          [-110, -10],
          [-90, 10],
        ]),
      },
    ],
  });
}

describe("produceDiagramLayout: catalog Icon→Diagram layer fallback (issue #510)", () => {
  it("substitutes Diagram layers when the Icon draws nothing", () => {
    const layout = produceDiagramLayout(
      hostWithConnector(DiagramOnlyPinClass),
      "diagram",
    );
    const cls = layout.classes["Synth.Interfaces.DiagramOnlyPin"];
    expect(cls).toBeDefined();
    expect(cls?.iconLayers.flatMap((l) => l.shapes.map((s) => s.kind))).toEqual(
      ["rectangle"],
    );
    // The coordinate system follows the annotation the layers came from.
    expect(cls?.coordinateSystem?.extent).toEqual([
      [-100, -100],
      [100, 100],
    ]);
  });

  it("keeps Icon layers when the Icon draws, and surfaces diagramLayers separately", () => {
    const layout = produceDiagramLayout(
      hostWithConnector(DualLayerPinClass),
      "diagram",
    );
    const cls = layout.classes["Synth.Interfaces.DualLayerPin"];
    expect(cls?.iconLayers.flatMap((l) => l.shapes.map((s) => s.kind))).toEqual(
      ["polygon"],
    );
    expect(
      cls?.diagramLayers?.flatMap((l) => l.shapes.map((s) => s.kind)),
    ).toEqual(["rectangle"]);
  });

  it("omits diagramLayers when the Diagram annotation draws nothing", () => {
    const layout = produceDiagramLayout(makeHostModelInstance(), "diagram");
    const cls = layout.classes["Synth.Interfaces.RealInput"];
    expect(cls?.diagramLayers).toBeUndefined();
  });

  it("applies the fallback to PortDef.iconLayers", () => {
    const blockWithDiagramOnlyPort: unknown = {
      name: "Synth.DiagramOnlyPortBlock",
      restriction: "block",
      elements: [
        {
          $kind: "component",
          name: "p",
          type: DiagramOnlyPinClass,
          annotation: placementAnno([
            [-110, -10],
            [-90, 10],
          ]),
        },
      ],
    };
    const host = ModelInstanceSchema.parse({
      name: "Synth.PortFallbackHost",
      restriction: "model",
      elements: [
        {
          $kind: "component",
          name: "b",
          type: blockWithDiagramOnlyPort,
          annotation: placementAnno([
            [-20, -20],
            [20, 20],
          ]),
        },
      ],
    });
    const layout = produceDiagramLayout(host, "diagram");
    const port = layout.classes["Synth.DiagramOnlyPortBlock"]?.connectors.p;
    expect(
      port?.iconLayers.flatMap((l) => l.shapes.map((s) => s.kind)),
    ).toEqual(["rectangle"]);
  });

  it("never substitutes into the host class's own layer sets", () => {
    // The host's own layers are positionally addressed by `shape:<idx>` keys
    // and diffed into source writes — a substituted layer there would shift
    // indices and leak into user source.
    const diagramOnlyHost = ModelInstanceSchema.parse({
      name: "Synth.DiagramOnlyHost",
      restriction: "model",
      annotation: {
        Diagram: {
          graphics: [
            rectShape([
              [-40, -40],
              [40, 40],
            ]),
          ],
        },
      },
    });
    const layout = produceDiagramLayout(diagramOnlyHost, "icon");
    expect(layout.iconLayers.flatMap((l) => l.shapes)).toEqual([]);
    // The catalog entry for the same class still gets the fallback.
    expect(
      layout.classes["Synth.DiagramOnlyHost"]?.iconLayers.flatMap((l) =>
        l.shapes.map((s) => s.kind),
      ),
    ).toEqual(["rectangle"]);
  });
});

// =====================================================================
// Standalone connector placement follows the layout kind (issue #516).
// =====================================================================

describe("produceDiagramLayout: standalone connector placement by kind (issue #516)", () => {
  const DIAGRAM_EXTENT: [[number, number], [number, number]] = [
    [-140, -20],
    [-100, 20],
  ];
  const ICON_EXTENT: [[number, number], [number, number]] = [
    [-110, -10],
    [-90, 10],
  ];

  function hostWithDualPlacement(): ModelInstance {
    return ModelInstanceSchema.parse({
      name: "Synth.DualPlacementHost",
      restriction: "model",
      elements: [
        {
          $kind: "component",
          name: "u",
          type: RealInputClass,
          annotation: {
            Placement: {
              transformation: { extent: DIAGRAM_EXTENT },
              iconTransformation: { extent: ICON_EXTENT },
            },
          },
        },
      ],
    });
  }

  it("uses `transformation` in a diagram-kind layout and carries the icon counterpart", () => {
    const layout = produceDiagramLayout(hostWithDualPlacement(), "diagram");
    expect(layout.connectors.u?.placement.extent).toEqual(DIAGRAM_EXTENT);
    expect(layout.connectors.u?.iconPlacement?.extent).toEqual(ICON_EXTENT);
    expect(layout.connectors.u?.diagramPlacement).toBeUndefined();
  });

  it("uses `iconTransformation` in an icon-kind layout and carries the diagram counterpart", () => {
    const layout = produceDiagramLayout(hostWithDualPlacement(), "icon");
    expect(layout.connectors.u?.placement.extent).toEqual(ICON_EXTENT);
    expect(layout.connectors.u?.diagramPlacement?.extent).toEqual(
      DIAGRAM_EXTENT,
    );
    expect(layout.connectors.u?.iconPlacement).toBeUndefined();
  });

  it("falls back to the declared transformation when only one exists", () => {
    // makeHostModelInstance's connectors declare only `transformation`.
    const icon = produceDiagramLayout(makeHostModelInstance(), "icon");
    const diagram = produceDiagramLayout(makeHostModelInstance(), "diagram");
    expect(icon.connectors.u?.placement.extent).toEqual(
      diagram.connectors.u?.placement.extent,
    );
    // A single declared keyword has no counterpart to carry in either kind.
    expect(icon.connectors.u?.diagramPlacement).toBeUndefined();
    expect(diagram.connectors.u?.iconPlacement).toBeUndefined();
  });
});
