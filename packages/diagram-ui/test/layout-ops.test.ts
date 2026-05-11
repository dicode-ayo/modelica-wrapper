import { describe, expect, it } from "vitest";
import type { DiagramLayout } from "@modelica-wrapper/omc-client";

import {
  applyDelete,
  applyDeltaMove,
  applyFlip,
  applyRotate,
  selectByDiagramRect,
} from "../src/interaction/layout-ops.js";

function baseLayout(): DiagramLayout {
  return {
    kind: "diagram",
    className: "Demo",
    source: { file: "demo.mo", line: 1, column: 1 } as never,
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
        placement: { extent: [[20, 20], [40, 30]] },
      },
    },
    connectors: {
      p: {
        name: "p",
        classRef: "Pin",
        placement: { extent: [[-50, -2], [-46, 2]] },
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

describe("applyDeltaMove", () => {
  it("shifts a component's placement extent", () => {
    const l = applyDeltaMove(baseLayout(), ["c:R1"], 5, -3);
    expect(l.components.R1!.placement.extent).toEqual([
      [-5, -8],
      [15, 2],
    ]);
  });

  it("leaves untouched components alone", () => {
    const l = applyDeltaMove(baseLayout(), ["c:R1"], 5, 0);
    expect(l.components.C1).toEqual(baseLayout().components.C1);
  });

  it("returns the same reference when nothing changed", () => {
    const layout = baseLayout();
    expect(applyDeltaMove(layout, [], 5, 5)).toBe(layout);
    expect(applyDeltaMove(layout, ["c:R1"], 0, 0)).toBe(layout);
  });

  it("moves multiple components in one call", () => {
    const l = applyDeltaMove(baseLayout(), ["c:R1", "c:C1"], 1, 1);
    expect(l.components.R1!.placement.extent).toEqual([
      [-9, -4],
      [11, 6],
    ]);
    expect(l.components.C1!.placement.extent).toEqual([
      [21, 21],
      [41, 31],
    ]);
  });

  it("moves connectors as well as components", () => {
    const l = applyDeltaMove(baseLayout(), ["k:p"], 100, 0);
    expect(l.connectors.p!.placement.extent).toEqual([
      [50, -2],
      [54, 2],
    ]);
  });
});

describe("applyDelete", () => {
  it("removes a component", () => {
    const l = applyDelete(baseLayout(), ["c:R1"]);
    expect(Object.keys(l.components)).toEqual(["C1"]);
  });

  it("removes a connector", () => {
    const l = applyDelete(baseLayout(), ["k:p"]);
    expect(Object.keys(l.connectors)).toEqual([]);
  });

  it("removes a connection by edge index", () => {
    const l = applyDelete(baseLayout(), ["edge:0"]);
    expect(l.connections).toHaveLength(0);
  });

  it("returns the same reference when nothing to delete", () => {
    const layout = baseLayout();
    expect(applyDelete(layout, [])).toBe(layout);
  });
});

describe("applyRotate", () => {
  it("rotates ccw by 90°", () => {
    const l = applyRotate(baseLayout(), ["c:R1"], false);
    expect(l.components.R1!.placement.rotation).toBe(90);
  });

  it("rotates cw by -90° (mod 360)", () => {
    const l = applyRotate(baseLayout(), ["c:R1"], true);
    expect(l.components.R1!.placement.rotation).toBe(270);
  });

  it("stacks rotations: rotate cw twice == 180°", () => {
    let l = applyRotate(baseLayout(), ["c:R1"], true);
    l = applyRotate(l, ["c:R1"], true);
    expect(l.components.R1!.placement.rotation).toBe(180);
  });
});

describe("applyFlip", () => {
  it("negates the X axis when horizontal=true", () => {
    const l = applyFlip(baseLayout(), ["c:R1"], true);
    const ext = l.components.R1!.placement.extent;
    expect(ext[0][0]).toBe(10);
    expect(ext[1][0]).toBe(-10);
  });

  it("negates the Y axis when horizontal=false", () => {
    const l = applyFlip(baseLayout(), ["c:R1"], false);
    const ext = l.components.R1!.placement.extent;
    expect(ext[0][1]).toBe(5);
    expect(ext[1][1]).toBe(-5);
  });
});

describe("selectByDiagramRect", () => {
  it("selects components whose centre falls inside the rect", () => {
    const keys = selectByDiagramRect(baseLayout(), {
      x1: -100,
      y1: -100,
      x2: 100,
      y2: 100,
    });
    expect(keys.has("c:R1")).toBe(true);
    expect(keys.has("c:C1")).toBe(true);
    expect(keys.has("k:p")).toBe(true);
  });

  it("excludes centres outside the rect", () => {
    // Rect covers only x ∈ [-100, -20]; only the connector centre at
    // (-48, 0) qualifies. R1's centre is at (0, 0) and C1's at (30, 25).
    const keys = selectByDiagramRect(baseLayout(), {
      x1: -100,
      y1: -100,
      x2: -20,
      y2: 100,
    });
    expect(keys.has("c:R1")).toBe(false);
    expect(keys.has("c:C1")).toBe(false);
    expect(keys.has("k:p")).toBe(true);
  });

  it("normalises an inverted rect (x1>x2)", () => {
    const keys = selectByDiagramRect(baseLayout(), {
      x1: 100,
      y1: 100,
      x2: -100,
      y2: -100,
    });
    expect(keys.size).toBeGreaterThan(0);
  });
});
