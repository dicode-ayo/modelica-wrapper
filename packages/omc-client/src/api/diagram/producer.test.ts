/**
 * Fixture-driven tests for the DiagramLayout producer.
 *
 * No OMC contact. The fixtures are JSON copies of getModelInstance output
 * captured against OMC 1.26.7 (`Modelica.Blocks.Math.Sin`,
 * `Modelica.Blocks.Examples.PID_Controller`) and committed under
 * `*.modelInstance.fixture.json` to escape the gitignore that excludes
 * the regeneration-target `*.modelInstance.json` files.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ModelInstanceSchema } from "../../_shared/modelInstance.js";
import type {
  ConnectionNode,
  ModelInstance,
} from "../../_shared/modelInstance.js";
import type {
  DiagramLayout,
  IconLayer,
  Placement,
  Shape,
} from "../../_shared/diagramLayout.js";
import { produceDiagramLayout } from "./producer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..", "..", "..");
const FIXTURES = resolve(PKG_ROOT, "test", "fixtures");

function loadFixture(name: string): ModelInstance {
  const path = resolve(FIXTURES, name);
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  return ModelInstanceSchema.parse(parsed);
}

/**
 * Coordinate-array predicate: a [number, number] pair.
 * Modelica annotations encode points and extent corners this way.
 */
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
      throw new Error(`${ctx}: unknown shape.kind ${JSON.stringify(_exhaustive)}`);
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

/**
 * Walk a fully-produced layout and assert every element carries the
 * fields the renderer needs. The aim is to catch regressions where the
 * producer drops a field or emits a malformed sub-tree, without depending
 * on a specific fixture's content.
 */
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

describe("produceDiagramLayout: Sin (icon)", () => {
  it("collects the host's own icon shapes plus ancestor layers", () => {
    const sin = loadFixture("sin.modelInstance.fixture.json");
    const layout = produceDiagramLayout(sin, "icon");

    expect(layout.kind).toBe("icon");
    expect(layout.className).toBe("Modelica.Blocks.Math.Sin");
    expect(layout.iconLayers.length).toBeGreaterThanOrEqual(1);

    const last = layout.iconLayers[layout.iconLayers.length - 1];
    expect(last?.from).toBe("Modelica.Blocks.Math.Sin");
    expect(last?.shapes.length).toBe(6);

    const blockLayer = layout.iconLayers.find(
      (l) => l.from === "Modelica.Blocks.Icons.Block",
    );
    expect(blockLayer).toBeDefined();
    expect(blockLayer?.shapes.length).toBe(2);
  });

  it("has no sub-component classes (Sin is leaf-shaped)", () => {
    const sin = loadFixture("sin.modelInstance.fixture.json");
    const layout = produceDiagramLayout(sin, "icon");

    // Only connector classes should appear (RealInput, RealOutput) —
    // those come in via the standalone-connector path.
    const subComponentClasses = Object.values(layout.classes).filter(
      (c) => c.restriction !== "connector",
    );
    expect(subComponentClasses).toHaveLength(0);
    expect(Object.keys(layout.components)).toHaveLength(0);
  });

  it("registers RealInput `u` and RealOutput `y` as standalone connectors", () => {
    const sin = loadFixture("sin.modelInstance.fixture.json");
    const layout = produceDiagramLayout(sin, "icon");

    expect(Object.keys(layout.connectors).sort()).toEqual(["u", "y"]);
    expect(layout.connectors.u?.classRef).toBe(
      "Modelica.Blocks.Interfaces.RealInput",
    );
    expect(layout.connectors.y?.classRef).toBe(
      "Modelica.Blocks.Interfaces.RealOutput",
    );

    // Each connector's classRef resolves to a ClassDef in `classes`
    // with its own iconLayers.
    const realInput = layout.classes["Modelica.Blocks.Interfaces.RealInput"];
    expect(realInput).toBeDefined();
    expect(realInput?.iconLayers.length).toBeGreaterThan(0);

    const realOutput = layout.classes["Modelica.Blocks.Interfaces.RealOutput"];
    expect(realOutput).toBeDefined();
    expect(realOutput?.iconLayers.length).toBeGreaterThan(0);
  });
});

describe("produceDiagramLayout: PID_Controller (icon)", () => {
  it("collects host's own icon through Modelica.Icons.Example", () => {
    const pid = loadFixture("pidController.modelInstance.fixture.json");
    const layout = produceDiagramLayout(pid, "icon");

    expect(layout.iconLayers.length).toBeGreaterThanOrEqual(1);

    // PID_Controller has no own Icon graphics — confirmed by the host's
    // own layer either being absent or having zero shapes.
    const hostLayer = layout.iconLayers.find(
      (l) => l.from === "Modelica.Blocks.Examples.PID_Controller",
    );
    if (hostLayer) {
      expect(hostLayer.shapes).toHaveLength(0);
    }

    const exampleLayer = layout.iconLayers.find(
      (l) => l.from === "Modelica.Icons.Example",
    );
    expect(exampleLayer).toBeDefined();
    expect((exampleLayer?.shapes.length ?? 0)).toBeGreaterThan(0);
  });

  it("registers each named sub-component", () => {
    const pid = loadFixture("pidController.modelInstance.fixture.json");
    const layout = produceDiagramLayout(pid, "icon");

    const wantNames = [
      "PI",
      "inertia1",
      "inertia2",
      "spring",
      "torque",
      "kinematicPTP",
      "integrator",
    ];
    for (const name of wantNames) {
      expect(layout.components, `expected component ${name}`).toHaveProperty(name);
    }
  });

  it("dedupes Inertia: inertia1.classRef === inertia2.classRef and the class appears exactly once", () => {
    const pid = loadFixture("pidController.modelInstance.fixture.json");
    const layout = produceDiagramLayout(pid, "icon");

    const inertia1 = layout.components.inertia1;
    const inertia2 = layout.components.inertia2;
    expect(inertia1).toBeDefined();
    expect(inertia2).toBeDefined();
    expect(inertia1?.classRef).toBe(
      "Modelica.Mechanics.Rotational.Components.Inertia",
    );
    expect(inertia1?.classRef).toBe(inertia2?.classRef);

    const inertiaKey = "Modelica.Mechanics.Rotational.Components.Inertia";
    expect(layout.classes[inertiaKey]).toBeDefined();
    const occurrences = Object.keys(layout.classes).filter(
      (k) => k === inertiaKey,
    );
    expect(occurrences).toHaveLength(1);
  });

  it("LimPID's connector list walks the extends chain (u_s, u_m, y from SVcontrol; u_ff direct)", () => {
    const pid = loadFixture("pidController.modelInstance.fixture.json");
    const layout = produceDiagramLayout(pid, "icon");

    const lim = layout.classes["Modelica.Blocks.Continuous.LimPID"];
    expect(lim).toBeDefined();
    const portNames = Object.keys(lim?.connectors ?? {}).sort();
    for (const want of ["u_ff", "u_m", "u_s", "y"]) {
      expect(portNames, `expected port ${want}`).toContain(want);
    }
  });

  it("does not list Real-typed parameters as components (driveAngle has restriction='type')", () => {
    const pid = loadFixture("pidController.modelInstance.fixture.json");
    const layout = produceDiagramLayout(pid, "icon");
    expect(layout.components.driveAngle).toBeUndefined();
  });
});

describe("produceDiagramLayout: PID_Controller (diagram)", () => {
  it("emits exactly the connections that have annotation.Line", () => {
    const pid = loadFixture("pidController.modelInstance.fixture.json");
    const layout = produceDiagramLayout(pid, "diagram");

    // Cross-check against the fixture itself — the count we emit must
    // equal the count of source connections with a non-null Line.
    const expected = (pid.connections ?? []).filter(
      (c) =>
        (c.annotation as { Line?: unknown } | undefined)?.Line !== undefined &&
        (c.annotation as { Line?: unknown } | undefined)?.Line !== null,
    ).length;
    expect(layout.connections).toHaveLength(expected);
    // The fixture currently has 9 such connections — pinning the count
    // catches accidental filter-rule regressions even if the fixture is
    // re-captured later.
    expect(layout.connections).toHaveLength(9);
  });

  it("every emitted connection has at least one waypoint (the fixture supplies them)", () => {
    const pid = loadFixture("pidController.modelInstance.fixture.json");
    const layout = produceDiagramLayout(pid, "diagram");
    for (const c of layout.connections) {
      expect(c.waypoints.length).toBeGreaterThan(0);
    }
  });

  it("flattens the first connection cref correctly: spring.flange_b → inertia2.flange_a", () => {
    const pid = loadFixture("pidController.modelInstance.fixture.json");
    const layout = produceDiagramLayout(pid, "diagram");
    const first = layout.connections[0];
    expect(first?.lhs).toEqual({ component: "spring", port: "flange_b" });
    expect(first?.rhs).toEqual({ component: "inertia2", port: "flange_a" });
  });

  it("preserves per-instance modifiers and dedupes the type", () => {
    const pid = loadFixture("pidController.modelInstance.fixture.json");
    const layout = produceDiagramLayout(pid, "diagram");

    // inertia1 in the fixture has J=1 with phi/a start/fixed modifiers.
    expect(layout.components.inertia1?.modifiers).toBeDefined();

    // inertia2 also has modifiers (J=2 in the fixture).
    expect(layout.components.inertia2?.modifiers).toBeDefined();

    // Yet only one Inertia entry in the catalog.
    expect(
      Object.keys(layout.classes).filter(
        (k) => k === "Modelica.Mechanics.Rotational.Components.Inertia",
      ),
    ).toHaveLength(1);
  });
});

describe("produceDiagramLayout: connection filter on synthetic input", () => {
  /**
   * Build a tiny synthetic ModelInstance carrying two connect(...) calls:
   * one with annotation.Line.points and one with no annotation. The
   * producer must emit only the first.
   */
  function makeFixture(): ModelInstance {
    const stubConn = (
      lhsName: [string, string],
      rhsName: [string, string],
      withLine: boolean,
    ): ConnectionNode => {
      const node: ConnectionNode = {
        lhs: {
          $kind: "cref",
          parts: [{ name: lhsName[0] }, { name: lhsName[1] }],
        },
        rhs: {
          $kind: "cref",
          parts: [{ name: rhsName[0] }, { name: rhsName[1] }],
        },
      };
      if (withLine) {
        node.annotation = {
          Line: { points: [[0, 0], [10, 10]] },
        } as unknown as ConnectionNode["annotation"];
      }
      return node;
    };
    return {
      name: "Synth.Tiny",
      restriction: "model",
      connections: [
        stubConn(["a", "p"], ["b", "p"], true),
        stubConn(["c", "p"], ["d", "p"], false),
      ],
    };
  }

  it("emits only the connection that has an annotation.Line", () => {
    const layout = produceDiagramLayout(makeFixture(), "diagram");
    expect(layout.connections).toHaveLength(1);
    expect(layout.connections[0]?.lhs).toEqual({
      component: "a",
      port: "p",
    });
  });

  it("normalizes a missing/empty waypoints list to []", () => {
    const node: ConnectionNode = {
      lhs: { $kind: "cref", parts: [{ name: "a" }, { name: "p" }] },
      rhs: { $kind: "cref", parts: [{ name: "b" }, { name: "p" }] },
      annotation: { Line: {} } as unknown as ConnectionNode["annotation"],
    };
    const fixture: ModelInstance = {
      name: "Synth.Tiny2",
      restriction: "model",
      connections: [node],
    };
    const layout = produceDiagramLayout(fixture, "diagram");
    expect(layout.connections).toHaveLength(1);
    expect(layout.connections[0]?.waypoints).toEqual([]);
  });
});

describe("produceDiagramLayout: well-formedness", () => {
  it("Sin (icon): every element carries its required fields", () => {
    const sin = loadFixture("sin.modelInstance.fixture.json");
    const layout = produceDiagramLayout(sin, "icon");
    assertWellFormed(layout);
  });

  it("PID_Controller (icon): every element carries its required fields", () => {
    const pid = loadFixture("pidController.modelInstance.fixture.json");
    const layout = produceDiagramLayout(pid, "icon");
    assertWellFormed(layout);
  });

  it("PID_Controller (diagram): every element carries its required fields", () => {
    const pid = loadFixture("pidController.modelInstance.fixture.json");
    const layout = produceDiagramLayout(pid, "diagram");
    assertWellFormed(layout);
  });
});
