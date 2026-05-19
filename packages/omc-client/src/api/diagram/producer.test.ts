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
import { produceDiagramLayout } from "./producer.js";

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
const NO_ARROW = { $kind: "enum", name: "Arrow.None", index: 1 };

function rectShape(extent: [[number, number], [number, number]]): unknown {
  return {
    $kind: "record",
    name: "Rectangle",
    elements: [
      true,           // visible
      [0, 0],         // origin
      0,              // rotation
      [0, 0, 0],      // lineColor
      [255, 255, 255],// fillColor
      SOLID_LINE,     // pattern
      SOLID_FILL,     // fillPattern
      1,              // lineThickness
      NO_BORDER,      // borderPattern
      extent,         // extent
      0,              // radius
    ],
  };
}

function polygonShape(points: [number, number][]): unknown {
  return {
    $kind: "record",
    name: "Polygon",
    elements: [
      true, [0, 0], 0,
      [0, 0, 0], [128, 128, 128], SOLID_LINE, SOLID_FILL, 1,
      points,
      NO_SMOOTH,
    ],
  };
}

function lineShape(points: [number, number][]): unknown {
  return {
    $kind: "record",
    name: "Line",
    elements: [
      true, [0, 0], 0,
      points,
      [0, 0, 0],      // color
      SOLID_LINE,     // pattern
      0.5,            // thickness
      [NO_ARROW, NO_ARROW],
      3,              // arrowSize
      NO_SMOOTH,
    ],
  };
}

function placementAnno(
  extent: [[number, number], [number, number]],
): unknown {
  return { Placement: { transformation: { extent } } };
}

// ----- Class definitions used by Synth.Host -----

const RealInputClass: unknown = {
  name: "Synth.Interfaces.RealInput",
  restriction: "connector",
  annotation: {
    Icon: {
      coordinateSystem: { extent: [[-100, -100], [100, 100]] },
      graphics: [polygonShape([[-100, 100], [100, 0], [-100, -100]])],
    },
  },
};

const RealOutputClass: unknown = {
  name: "Synth.Interfaces.RealOutput",
  restriction: "connector",
  annotation: {
    Icon: {
      coordinateSystem: { extent: [[-100, -100], [100, 100]] },
      graphics: [polygonShape([[-100, 100], [100, 0], [-100, -100]])],
    },
  },
};

/** Host's base — contributes one Icon layer to Synth.Host's iconLayers. */
const BaseFrameClass: unknown = {
  name: "Synth.BaseFrame",
  restriction: "block",
  annotation: {
    Icon: {
      coordinateSystem: { extent: [[-100, -100], [100, 100]] },
      graphics: [rectShape([[-100, -100], [100, 100]])],
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
      annotation: placementAnno([[-110, -10], [-90, 10]]),
    },
    {
      $kind: "component",
      name: "y",
      type: RealOutputClass,
      annotation: placementAnno([[90, -10], [110, 10]]),
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
      annotation: placementAnno([[-110, 40], [-90, 60]]),
    },
  ],
  annotation: {
    Icon: {
      coordinateSystem: { extent: [[-100, -100], [100, 100]] },
      graphics: [polygonShape([[-100, -50], [100, 0], [-100, 50]])],
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
      annotation: placementAnno([[-110, -10], [-90, 10]]),
    },
  ],
  annotation: {
    Icon: { graphics: [rectShape([[-50, -50], [50, 50]])] },
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
        coordinateSystem: { extent: [[-100, -100], [100, 100]] },
        graphics: [polygonShape([[-50, -50], [50, -50], [0, 50]])],
      },
      Diagram: {
        coordinateSystem: { extent: [[-100, -100], [100, 100]] },
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
        annotation: placementAnno([[-110, -10], [-90, 10]]),
      },
      {
        $kind: "component",
        name: "y",
        type: RealOutputClass,
        annotation: placementAnno([[90, -10], [110, 10]]),
      },
      // sub-components — two of the same type (dedup), one of another type
      {
        $kind: "component",
        name: "gain1",
        type: GainClass,
        modifiers: { k: "1" },
        annotation: placementAnno([[-50, -50], [-30, -30]]),
      },
      {
        $kind: "component",
        name: "gain2",
        type: GainClass,
        modifiers: { k: "2" },
        annotation: placementAnno([[10, -50], [30, -30]]),
      },
      {
        $kind: "component",
        name: "proc",
        type: ProcessorClass,
        annotation: placementAnno([[50, -50], [70, -30]]),
      },
      // Modelica `type` alias — must be filtered from components
      { $kind: "component", name: "tau", type: TypeAlias },
    ],
    connections: [
      // routed: 1-part lhs (host port) → 2-part rhs (sub-component port)
      {
        lhs: { $kind: "cref", parts: [{ name: "u" }] },
        rhs: { $kind: "cref", parts: [{ name: "gain1" }, { name: "u" }] },
        annotation: { Line: { points: [[-90, 0], [-50, -40]] } },
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
        annotation: { Line: { points: [[30, -40], [50, -40]] } },
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
  expect(layer.from.length, `${ctx}: iconLayer.from non-empty`).toBeGreaterThan(0);
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
  /** Build a tiny ModelInstance with hand-crafted connection variants. */
  function withConnections(connections: ConnectionNode[]): ModelInstance {
    return ModelInstanceSchema.parse({
      name: "Synth.Tiny",
      restriction: "model",
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
        modifiers: { unit: "\"N.m/rad\"", $value: "100" },
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
          annotation: placementAnno([[-10, -10], [10, 10]]),
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
          annotation: placementAnno([[-5, -5], [5, 5]]),
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
   * Build a tiny model with two sub-components (`x`, `y`) and two
   * standalone connectors (`pIn`, `pOut`), each guarded by a Boolean
   * cref expression. The OMC interactive RPC stashes those guards on
   * the `condition` field of each `ComponentElement`.
   */
  function makeGuardedHost(): ModelInstance {
    const inst: unknown = {
      $kind: "model",
      name: "Pkg.Guarded",
      restriction: "model",
      annotation: {
        Icon: {
          coordinateSystem: { extent: [[-100, -100], [100, 100]] },
          graphics: [],
        },
        Diagram: {
          coordinateSystem: { extent: [[-100, -100], [100, 100]] },
          graphics: [],
        },
      },
      elements: [
        {
          $kind: "component",
          name: "pIn",
          type: RealInputClass,
          annotation: placementAnno([[-110, -10], [-90, 10]]),
          condition: { $kind: "cref", parts: [{ name: "use_in" }] },
        },
        {
          $kind: "component",
          name: "pOut",
          type: RealOutputClass,
          annotation: placementAnno([[90, -10], [110, 10]]),
          condition: { $kind: "cref", parts: [{ name: "use_out" }] },
        },
        {
          $kind: "component",
          name: "x",
          type: GainClass,
          modifiers: { k: "1" },
          annotation: placementAnno([[-50, -50], [-30, -30]]),
          condition: { $kind: "cref", parts: [{ name: "use_x" }] },
        },
        {
          $kind: "component",
          name: "y",
          type: GainClass,
          modifiers: { k: "2" },
          annotation: placementAnno([[10, -50], [30, -30]]),
          condition: { $kind: "cref", parts: [{ name: "use_y" }] },
        },
      ],
      connections: [],
    };
    return ModelInstanceSchema.parse(inst);
  }

  it("without resolvedParameters everything stays visible", () => {
    const layout = produceDiagramLayout(makeGuardedHost(), "diagram");
    expect(Object.keys(layout.components).sort()).toEqual(["x", "y"]);
    expect(Object.keys(layout.connectors).sort()).toEqual(["pIn", "pOut"]);
    expect(layout.resolvedParameters).toBeUndefined();
  });

  it("hides sub-components whose `condition` evaluates to false", () => {
    const layout = produceDiagramLayout(makeGuardedHost(), "diagram", {
      use_x: "true",
      use_y: "false",
      use_in: "true",
      use_out: "true",
    });
    expect(Object.keys(layout.components).sort()).toEqual(["x"]);
    expect(Object.keys(layout.connectors).sort()).toEqual(["pIn", "pOut"]);
  });

  it("hides standalone connectors whose `condition` evaluates to false", () => {
    const layout = produceDiagramLayout(makeGuardedHost(), "diagram", {
      use_x: "true",
      use_y: "true",
      use_in: "false",
      use_out: "true",
    });
    expect(Object.keys(layout.connectors).sort()).toEqual(["pOut"]);
  });

  it("echoes resolvedParameters onto the output", () => {
    const params = { use_x: "true", use_y: "true" };
    const layout = produceDiagramLayout(
      makeGuardedHost(),
      "diagram",
      params,
    );
    expect(layout.resolvedParameters).toEqual(params);
  });

  it("defaults to visible when a guard's cref isn't in the resolved scope", () => {
    // `use_y` missing from the map → evaluator can't reduce → wrapper
    // treats as "visible" (the same way Dialog.enable falls back).
    const layout = produceDiagramLayout(makeGuardedHost(), "diagram", {
      use_x: "false",
      use_in: "true",
      use_out: "true",
    });
    expect(Object.keys(layout.components).sort()).toEqual(["y"]);
  });
});
