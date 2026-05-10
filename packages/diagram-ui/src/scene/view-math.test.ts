import { describe, expect, it } from "vitest";

import {
  applyPanDelta,
  applyZoomAroundCursor,
  clientToDiagram,
  diagramToClient,
} from "./view-math.js";

const CANVAS = { width: 800, height: 400 };

describe("clientToDiagram / diagramToClient", () => {
  it("maps the canvas centre to (panX, panY)", () => {
    const view = { zoom: 100, panX: 5, panY: -3 };
    const pt = clientToDiagram(view, CANVAS, 400, 200);
    expect(pt.x).toBeCloseTo(5);
    expect(pt.y).toBeCloseTo(-3);
  });

  it("right of centre → larger diagram x; below centre → smaller diagram y", () => {
    const view = { zoom: 100, panX: 0, panY: 0 };
    const right = clientToDiagram(view, CANVAS, 600, 200);
    const below = clientToDiagram(view, CANVAS, 400, 300);
    expect(right.x).toBeGreaterThan(0);
    expect(below.y).toBeLessThan(0);
  });

  it("round-trips through diagramToClient", () => {
    const view = { zoom: 75, panX: 12, panY: -8 };
    for (const [cx, cy] of [
      [100, 50],
      [700, 350],
      [400, 200],
      [0, 0],
    ]) {
      const dia = clientToDiagram(view, CANVAS, cx as number, cy as number);
      const back = diagramToClient(view, CANVAS, dia.x, dia.y);
      expect(back.x).toBeCloseTo(cx as number, 4);
      expect(back.y).toBeCloseTo(cy as number, 4);
    }
  });
});

describe("applyPanDelta", () => {
  it("a pointer drag right by N px keeps the world point under the cursor", () => {
    const view = { zoom: 100, panX: 0, panY: 0 };
    const dx = 80;
    const dy = -40;
    // World point originally at cursor (400, 200) (canvas centre).
    const before = clientToDiagram(view, CANVAS, 400, 200);
    const next = applyPanDelta(view, CANVAS, dx, dy);
    const afterView = { zoom: 100, panX: next.panX, panY: next.panY };
    const after = clientToDiagram(afterView, CANVAS, 400 + dx, 200 + dy);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe("applyZoomAroundCursor", () => {
  it("keeps the world point under the cursor stationary", () => {
    const view = { zoom: 100, panX: 0, panY: 0 };
    const cursor = { x: 100, y: 50 };
    const before = clientToDiagram(view, CANVAS, cursor.x, cursor.y);
    const next = applyZoomAroundCursor(view, CANVAS, cursor.x, cursor.y, 0.5, {
      min: 1,
      max: 1000,
    });
    const after = clientToDiagram(next, CANVAS, cursor.x, cursor.y);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(next.zoom).toBeCloseTo(50);
  });

  it("clamps zoom to the provided bounds", () => {
    const view = { zoom: 100, panX: 0, panY: 0 };
    const tooSmall = applyZoomAroundCursor(view, CANVAS, 400, 200, 0.001, {
      min: 10,
      max: 1000,
    });
    expect(tooSmall.zoom).toBe(10);
    const tooLarge = applyZoomAroundCursor(view, CANVAS, 400, 200, 100, {
      min: 10,
      max: 1000,
    });
    expect(tooLarge.zoom).toBe(1000);
  });
});
