import { describe, expect, it } from "vitest";
import type { Shape } from "@dicode/omc-client";

import {
  retainExistingSelection,
  selectAllKeys,
  selectByDiagramRect,
} from "../src/interaction/selection-ops.js";
import {
  baseLayout,
  LINE_1,
  RECT_0,
  withShapes,
} from "./harness/layout-fixtures.js";

describe("selectByDiagramRect", () => {
  it("selects components the band covers", () => {
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

  it("selects an entity the band only clips, not just one it centres on", () => {
    // R1 spans x ∈ [-10, 10] with its centre at 0. A band starting at x = 5
    // covers a quarter of it and none of its centre — under a centre rule the
    // user drags across a component and nothing happens.
    const keys = selectByDiagramRect(baseLayout(), {
      x1: 5,
      y1: -50,
      x2: 50,
      y2: 50,
    });
    expect(keys.has("c:R1")).toBe(true);
  });

  it("selects a boundary connector the band reaches the edge of", () => {
    // A connector placed off the class's own extent has its centre outside
    // any band drawn over the canvas; touching its box is the only way to get
    // it without Select All.
    const layout = baseLayout();
    const p = layout.connectors.p;
    if (!p) throw new Error("expected connector p");
    p.placement = {
      extent: [
        [-140, -20],
        [-100, 20],
      ],
    };
    const keys = selectByDiagramRect(layout, {
      x1: -110,
      y1: -50,
      x2: 50,
      y2: 50,
    });
    expect(keys.has("k:p")).toBe(true);
  });

  it("counts a rotated entity's real footprint, not its unrotated box", () => {
    // A 90° rotation swaps the extent's span; the band clips the rotated box
    // only.
    const layout = baseLayout();
    const c1 = layout.components.C1;
    if (!c1) throw new Error("expected component C1");
    c1.placement = {
      extent: [
        [-40, -5],
        [40, 5],
      ],
      rotation: 90,
    };
    // Rotated it spans y ∈ [-40, 40]; a band well above its unrotated box.
    const keys = selectByDiagramRect(layout, {
      x1: -2,
      y1: 20,
      x2: 2,
      y2: 60,
    });
    expect(keys.has("c:C1")).toBe(true);
  });

  it("rotates an off-centre placement about its extent centre, as the renderer does", () => {
    // A boundary connector: extent x ∈ [-140, -100], centre (-120, 0).
    // Rotated 90° about that centre it paints at x ∈ [-130, -110],
    // y ∈ [-20, 20]. Pivoting at the origin instead would put it at
    // x ∈ [-10, 10] — the far side of the diagram.
    const layout = baseLayout();
    const p = layout.connectors.p;
    if (!p) throw new Error("expected connector p");
    p.placement = {
      extent: [
        [-140, -10],
        [-100, 10],
      ],
      rotation: 90,
    };

    const onPaint = selectByDiagramRect(layout, {
      x1: -130,
      y1: -20,
      x2: -110,
      y2: 20,
    });
    expect(onPaint.has("k:p")).toBe(true);

    // And nothing near the origin, where an origin pivot would have put it.
    const atOrigin = selectByDiagramRect(layout, {
      x1: -10,
      y1: -140,
      x2: 10,
      y2: -100,
    });
    expect(atOrigin.has("k:p")).toBe(false);
  });

  it("rotates a poly shape counter-clockwise, the Modelica convention", () => {
    // An asymmetric poly is the only geometry here where the sign shows:
    // points [[0,0],[40,10]] rotated +90° about the origin span
    // x ∈ [-10, 0], y ∈ [0, 40]. Clockwise would mirror both.
    const line: Shape = {
      kind: "line",
      points: [
        [0, 0],
        [40, 10],
      ],
      rotation: 90,
      color: [0, 0, 0],
    };
    const ccw = selectByDiagramRect(withShapes([line]), {
      x1: -10,
      y1: 30,
      x2: -1,
      y2: 40,
    });
    expect(ccw.has("shape:line:0")).toBe(true);

    const cw = selectByDiagramRect(withShapes([line]), {
      x1: 1,
      y1: -40,
      x2: 10,
      y2: -30,
    });
    expect(cw.has("shape:line:0")).toBe(false);
  });

  it("selects an own-layer shape the band covers", () => {
    // A shape was never selectable by rubber band, so sweeping a diagram and
    // copying it silently left every graphic behind.
    const keys = selectByDiagramRect(withShapes([RECT_0]), {
      x1: -100,
      y1: -100,
      x2: 100,
      y2: 100,
    });
    expect(keys.has("shape:rectangle:0")).toBe(true);
  });

  it("never selects an inherited shape", () => {
    // `withShapes` seeds an inherited layer whose shape sits at the origin,
    // well inside this rect. Only the host's own layer is editable.
    const keys = selectByDiagramRect(withShapes([RECT_0]), {
      x1: -100,
      y1: -100,
      x2: 100,
      y2: 100,
    });
    expect([...keys].filter((k) => k.startsWith("shape:"))).toEqual([
      "shape:rectangle:0",
    ]);
  });

  it("excludes a shape the band does not reach", () => {
    const keys = selectByDiagramRect(withShapes([RECT_0]), {
      x1: 200,
      y1: 200,
      x2: 300,
      y2: 300,
    });
    expect([...keys].some((k) => k.startsWith("shape:"))).toBe(false);
  });

  it("excludes entities the rect does not reach", () => {
    // Rect covers only x ∈ [-100, -20]; only the connector's box
    // (x ∈ [-50, -46]) reaches it. R1's box stops at x = -10, C1's starts
    // at x = 20.
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

describe("retainExistingSelection", () => {
  it("keeps keys still backed by a shape and drops the rest", () => {
    const out = retainExistingSelection(baseLayout(), [
      "c:R1",
      "c:gone",
      "k:p",
      "edge:0",
    ]);
    expect([...out].sort()).toEqual(["c:R1", "k:p"]);
  });

  it("retains a host-shape key only when its index still holds the same kind", () => {
    const layout = withShapes([RECT_0, LINE_1]);
    const out = retainExistingSelection(layout, [
      "shape:rectangle:0", // index 0 is still a rectangle → kept
      "shape:line:1", // index 1 is still a line → kept
      "shape:ellipse:0", // index 0 is a rectangle, not ellipse → dropped
      "shape:rectangle:5", // out of range → dropped
    ]);
    expect([...out].sort()).toEqual(["shape:line:1", "shape:rectangle:0"]);
  });
});

describe("selectAllKeys", () => {
  it("takes every component, connector and own-layer shape", () => {
    const keys = selectAllKeys(withShapes([RECT_0, LINE_1]));
    expect(keys).toEqual(
      new Set(["c:R1", "c:C1", "k:p", "shape:rectangle:0", "shape:line:1"]),
    );
  });

  it("takes entities placed outside the coordinate system", () => {
    // The reason this exists: a rubber band can only take what it covers, and
    // a class routinely places its connectors beyond its own extent.
    const layout = baseLayout();
    const p = layout.connectors.p;
    if (!p) throw new Error("expected connector p");
    p.placement = {
      extent: [
        [-400, -400],
        [-380, -380],
      ],
    };
    expect(selectAllKeys(layout).has("k:p")).toBe(true);
  });

  it("takes nothing from a class with no own layer", () => {
    const keys = selectAllKeys(baseLayout());
    expect([...keys].some((k) => k.startsWith("shape:"))).toBe(false);
  });
});
