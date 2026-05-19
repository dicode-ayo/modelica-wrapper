import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@modelica-wrapper/omc-client";

import {
  canConnect,
  resolvePortInfo,
} from "../src/interaction/connection-compat.js";

function layoutWithBlocks(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Demo",
    source: { file: "demo.mo", line: 1, column: 1 } as never,
    iconLayers: [],
    diagramLayers: [],
    labels: [],
    classes: {
      "Modelica.Blocks.Math.Gain": {
        name: "Modelica.Blocks.Math.Gain",
        restriction: "block",
        iconLayers: [],
        connectors: {
          u: {
            name: "u",
            typeName: "Modelica.Blocks.Interfaces.RealInput",
            placement: { extent: [[-110, -10], [-90, 10]] },
            iconLayers: [],
            from: "Modelica.Blocks.Math.Gain",
            direction: "input",
          },
          y: {
            name: "y",
            typeName: "Modelica.Blocks.Interfaces.RealOutput",
            placement: { extent: [[90, -10], [110, 10]] },
            iconLayers: [],
            from: "Modelica.Blocks.Math.Gain",
            direction: "output",
          },
        },
        parameters: {},
      },
      "Modelica.Electrical.Analog.Basic.Resistor": {
        name: "Modelica.Electrical.Analog.Basic.Resistor",
        restriction: "model",
        iconLayers: [],
        connectors: {
          p: {
            name: "p",
            typeName: "Modelica.Electrical.Analog.Interfaces.PositivePin",
            placement: { extent: [[-110, -10], [-90, 10]] },
            iconLayers: [],
            from: "Modelica.Electrical.Analog.Basic.Resistor",
            direction: "",
          },
          n: {
            name: "n",
            typeName: "Modelica.Electrical.Analog.Interfaces.NegativePin",
            placement: { extent: [[90, -10], [110, 10]] },
            iconLayers: [],
            from: "Modelica.Electrical.Analog.Basic.Resistor",
            direction: "",
          },
        },
        parameters: {},
      },
    },
    components: {
      g1: { name: "g1", classRef: "Modelica.Blocks.Math.Gain", placement: { extent: [[0, 0], [20, 20]] } },
      g2: { name: "g2", classRef: "Modelica.Blocks.Math.Gain", placement: { extent: [[40, 0], [60, 20]] } },
      r1: { name: "r1", classRef: "Modelica.Electrical.Analog.Basic.Resistor", placement: { extent: [[80, 0], [100, 20]] } },
    },
    connectors: {},
    connections: [],
  };
}

describe("resolvePortInfo", () => {
  it("returns PortInfo for a nested connector", () => {
    const info = resolvePortInfo(layoutWithBlocks(), "k:g1.u");
    expect(info).toEqual({
      typeName: "Modelica.Blocks.Interfaces.RealInput",
      direction: "input",
      flow: false,
      stream: false,
    });
  });

  it("infers direction from typeName when explicit prefix is missing", () => {
    const layout = layoutWithBlocks();
    // Strip the explicit direction to force the suffix-inference path.
    delete layout.classes["Modelica.Blocks.Math.Gain"]!.connectors.u!.direction;
    const info = resolvePortInfo(layout, "k:g1.u");
    expect(info?.direction).toBe("input");
  });

  it("returns null for an unknown key", () => {
    expect(resolvePortInfo(layoutWithBlocks(), "k:nope.x")).toBeNull();
    expect(resolvePortInfo(layoutWithBlocks(), "c:g1")).toBeNull();
  });
});

describe("canConnect", () => {
  it("rejects two inputs", () => {
    const a = resolvePortInfo(layoutWithBlocks(), "k:g1.u")!;
    const b = resolvePortInfo(layoutWithBlocks(), "k:g2.u")!;
    expect(canConnect(a, b)).toEqual({ ok: false, reason: "both input" });
  });

  it("rejects two outputs", () => {
    const a = resolvePortInfo(layoutWithBlocks(), "k:g1.y")!;
    const b = resolvePortInfo(layoutWithBlocks(), "k:g2.y")!;
    expect(canConnect(a, b)).toEqual({ ok: false, reason: "both output" });
  });

  it("accepts input ↔ output of the same family", () => {
    const a = resolvePortInfo(layoutWithBlocks(), "k:g1.y")!;
    const b = resolvePortInfo(layoutWithBlocks(), "k:g2.u")!;
    expect(canConnect(a, b)).toEqual({ ok: true });
  });

  it("accepts two same-type acausal connectors (Pin ↔ Pin)", () => {
    // We model two resistors and connect r1.p ↔ r1.n by faking a
    // second resistor port pair. Same type, acausal — must accept.
    const layout = layoutWithBlocks();
    const a = resolvePortInfo(layout, "k:r1.p")!;
    const b = resolvePortInfo(layout, "k:r1.n")!;
    // Different types here — defer to OMC, no client rejection.
    expect(canConnect(a, b)).toEqual({ ok: true });
  });

  it("rejects different-package types (cross-domain)", () => {
    // RealOutput (signal, blocks package) → PositivePin (electrical
    // package). OMC would reject; we surface it locally so the user
    // sees the red highlight during the drag.
    const a = resolvePortInfo(layoutWithBlocks(), "k:g1.y")!;
    const b = resolvePortInfo(layoutWithBlocks(), "k:r1.p")!;
    const result = canConnect(a, b);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("incompatible types");
  });

  it("rejects RealOutput → Rotational Flange (the original bug)", () => {
    const from = {
      typeName: "Modelica.Blocks.Interfaces.RealOutput",
      direction: "output" as const,
      flow: false,
      stream: false,
    };
    const to = {
      typeName: "Modelica.Mechanics.Rotational.Interfaces.Flange_a",
      direction: "" as const,
      flow: false,
      stream: false,
    };
    expect(canConnect(from, to).ok).toBe(false);
  });

  it("accepts same-package different-type pairs (Flange_a ↔ Flange_b)", () => {
    const from = {
      typeName: "Modelica.Mechanics.Rotational.Interfaces.Flange_a",
      direction: "" as const,
      flow: false,
      stream: false,
    };
    const to = {
      typeName: "Modelica.Mechanics.Rotational.Interfaces.Flange_b",
      direction: "" as const,
      flow: false,
      stream: false,
    };
    expect(canConnect(from, to)).toEqual({ ok: true });
  });
});
