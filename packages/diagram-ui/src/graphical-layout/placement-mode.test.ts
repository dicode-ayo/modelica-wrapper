import { describe, expect, it } from "vitest";

import { PlacementController, pointInRect } from "./placement-mode.js";

describe("pointInRect", () => {
  const rect = { left: 10, right: 110, top: 20, bottom: 220 };

  it("includes the edges", () => {
    expect(pointInRect(10, 20, rect)).toBe(true);
    expect(pointInRect(110, 220, rect)).toBe(true);
  });

  it("excludes points outside any side", () => {
    expect(pointInRect(9, 100, rect)).toBe(false);
    expect(pointInRect(111, 100, rect)).toBe(false);
    expect(pointInRect(50, 19, rect)).toBe(false);
    expect(pointInRect(50, 221, rect)).toBe(false);
  });
});

describe("PlacementController", () => {
  it("starts idle", () => {
    const c = new PlacementController();
    expect(c.active).toBeNull();
    expect(c.ghostPoint).toBeNull();
  });

  it("arms with a class name and ignores empty names", () => {
    const c = new PlacementController();
    c.begin("");
    expect(c.active).toBeNull();
    c.begin("Modelica.Blocks.Math.Gain");
    expect(c.active).toBe("Modelica.Blocks.Math.Gain");
    expect(c.ghostPoint).toBeNull();
  });

  it("tracks the cursor over the canvas and hides it off-canvas", () => {
    const c = new PlacementController();
    c.begin("A");
    expect(c.move(30, 40, true)).toEqual({ x: 30, y: 40 });
    expect(c.ghostPoint).toEqual({ x: 30, y: 40 });
    expect(c.move(5, 5, false)).toBeNull();
    expect(c.ghostPoint).toBeNull();
    // Still armed after leaving the canvas.
    expect(c.active).toBe("A");
  });

  it("ignores moves while idle", () => {
    const c = new PlacementController();
    expect(c.move(1, 2, true)).toBeNull();
    expect(c.ghostPoint).toBeNull();
  });

  it("commits at the release point over the canvas and disarms", () => {
    const c = new PlacementController();
    c.begin("A");
    c.move(30, 40, true);
    const point = c.release(31, 41, true);
    expect(point).toEqual({ x: 31, y: 41 });
    expect(c.active).toBeNull();
    expect(c.ghostPoint).toBeNull();
  });

  it("cancels a release off the canvas and disarms", () => {
    const c = new PlacementController();
    c.begin("A");
    expect(c.release(0, 0, false)).toBeNull();
    expect(c.active).toBeNull();
  });

  it("release while idle is a no-op", () => {
    const c = new PlacementController();
    expect(c.release(1, 2, true)).toBeNull();
  });

  it("reset disarms and clears the ghost", () => {
    const c = new PlacementController();
    c.begin("A");
    c.move(30, 40, true);
    c.reset();
    expect(c.active).toBeNull();
    expect(c.ghostPoint).toBeNull();
  });
});
