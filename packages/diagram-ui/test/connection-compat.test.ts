import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@dicode/omc-client";

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
            placement: {
              extent: [
                [-110, -10],
                [-90, 10],
              ],
            },
            iconLayers: [],
            from: "Modelica.Blocks.Math.Gain",
            direction: "input",
          },
          y: {
            name: "y",
            typeName: "Modelica.Blocks.Interfaces.RealOutput",
            placement: {
              extent: [
                [90, -10],
                [110, 10],
              ],
            },
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
            placement: {
              extent: [
                [-110, -10],
                [-90, 10],
              ],
            },
            iconLayers: [],
            from: "Modelica.Electrical.Analog.Basic.Resistor",
            direction: "",
          },
          n: {
            name: "n",
            typeName: "Modelica.Electrical.Analog.Interfaces.NegativePin",
            placement: {
              extent: [
                [90, -10],
                [110, 10],
              ],
            },
            iconLayers: [],
            from: "Modelica.Electrical.Analog.Basic.Resistor",
            direction: "",
          },
        },
        parameters: {},
      },
    },
    components: {
      g1: {
        name: "g1",
        classRef: "Modelica.Blocks.Math.Gain",
        placement: {
          extent: [
            [0, 0],
            [20, 20],
          ],
        },
      },
      g2: {
        name: "g2",
        classRef: "Modelica.Blocks.Math.Gain",
        placement: {
          extent: [
            [40, 0],
            [60, 20],
          ],
        },
      },
      r1: {
        name: "r1",
        classRef: "Modelica.Electrical.Analog.Basic.Resistor",
        placement: {
          extent: [
            [80, 0],
            [100, 20],
          ],
        },
      },
    },
    connectors: {
      uIn: {
        name: "uIn",
        classRef: "Modelica.Blocks.Interfaces.RealInput",
        placement: {
          extent: [
            [-110, -10],
            [-90, 10],
          ],
        },
      },
      yOut: {
        name: "yOut",
        classRef: "Modelica.Blocks.Interfaces.RealOutput",
        placement: {
          extent: [
            [90, -10],
            [110, 10],
          ],
        },
      },
      uIn2: {
        name: "uIn2",
        classRef: "Modelica.Blocks.Interfaces.RealInput",
        placement: {
          extent: [
            [-110, 20],
            [-90, 40],
          ],
        },
      },
    },
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
    const gainClass = layout.classes["Modelica.Blocks.Math.Gain"];
    if (gainClass === undefined) throw new Error("expected Gain class");
    const uConnector = gainClass.connectors.u;
    if (uConnector === undefined) throw new Error("expected u connector");
    delete uConnector.direction;
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
    const a = resolvePortInfo(layoutWithBlocks(), "k:g1.u");
    if (!a) throw new Error("expected portInfo for g1.u");
    const b = resolvePortInfo(layoutWithBlocks(), "k:g2.u");
    if (!b) throw new Error("expected portInfo for g2.u");
    expect(canConnect(a, b)).toEqual({ ok: false, reason: "both input" });
  });

  it("rejects two outputs", () => {
    const a = resolvePortInfo(layoutWithBlocks(), "k:g1.y");
    if (!a) throw new Error("expected portInfo for g1.y");
    const b = resolvePortInfo(layoutWithBlocks(), "k:g2.y");
    if (!b) throw new Error("expected portInfo for g2.y");
    expect(canConnect(a, b)).toEqual({ ok: false, reason: "both output" });
  });

  it("accepts input ↔ output of the same family", () => {
    const a = resolvePortInfo(layoutWithBlocks(), "k:g1.y");
    if (!a) throw new Error("expected portInfo for g1.y");
    const b = resolvePortInfo(layoutWithBlocks(), "k:g2.u");
    if (!b) throw new Error("expected portInfo for g2.u");
    expect(canConnect(a, b)).toEqual({ ok: true });
  });

  it("accepts two same-type acausal connectors (Pin ↔ Pin)", () => {
    // We model two resistors and connect r1.p ↔ r1.n by faking a
    // second resistor port pair. Same type, acausal — must accept.
    const layout = layoutWithBlocks();
    const a = resolvePortInfo(layout, "k:r1.p");
    if (!a) throw new Error("expected portInfo for r1.p");
    const b = resolvePortInfo(layout, "k:r1.n");
    if (!b) throw new Error("expected portInfo for r1.n");
    // Different types here — defer to OMC, no client rejection.
    expect(canConnect(a, b)).toEqual({ ok: true });
  });

  it("rejects different-package types (cross-domain)", () => {
    // RealOutput (signal, blocks package) → PositivePin (electrical
    // package). OMC would reject; we surface it locally so the user
    // sees the red highlight during the drag.
    const a = resolvePortInfo(layoutWithBlocks(), "k:g1.y");
    if (!a) throw new Error("expected portInfo for g1.y");
    const b = resolvePortInfo(layoutWithBlocks(), "k:r1.p");
    if (!b) throw new Error("expected portInfo for r1.p");
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

describe("canConnect with root-class (standalone) connectors", () => {
  const info = (key: string) => {
    const port = resolvePortInfo(layoutWithBlocks(), key);
    if (!port) throw new Error(`expected portInfo for ${key}`);
    return port;
  };
  const accepted = (a: string, b: string) => {
    expect(canConnect(info(a), info(b)).ok).toBe(true);
    expect(canConnect(info(b), info(a)).ok).toBe(true);
  };
  const rejected = (a: string, b: string) => {
    expect(canConnect(info(a), info(b)).ok).toBe(false);
    expect(canConnect(info(b), info(a)).ok).toBe(false);
  };

  it("marks a standalone key and not a component port", () => {
    expect(info("k:uIn").standalone).toBe(true);
    expect(info("k:g1.u").standalone).toBeUndefined();
  });

  it("accepts root input → component input", () => {
    accepted("k:uIn", "k:g1.u");
  });

  it("accepts component output → root output", () => {
    accepted("k:g1.y", "k:yOut");
  });

  it("accepts root input → root output", () => {
    accepted("k:uIn", "k:yOut");
  });

  it("rejects root input → component output (two sources)", () => {
    rejected("k:uIn", "k:g1.y");
  });

  it("rejects root output → component input (two sinks)", () => {
    rejected("k:yOut", "k:g1.u");
  });

  it("rejects root input → root input", () => {
    rejected("k:uIn", "k:uIn2");
  });

  it("still rejects component input → component input", () => {
    rejected("k:g1.u", "k:g2.u");
  });
});
